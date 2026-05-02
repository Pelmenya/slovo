import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import type { FlowiseClient } from '@slovo/flowise-client';
import { StorageService } from '@slovo/storage';
import {
    FLOWISE_CLIENT_TOKEN,
    REDIS_CLIENT_TOKEN,
    VISION_AUGMENT_REDIS_KEY,
} from './catalog-refresh.constants';
import { VisionAugmenterService } from './vision-augmenter.service';

type TFlowiseMock = { request: jest.Mock };
type TRedisMock = { hget: jest.Mock; hset: jest.Mock; hdel: jest.Mock };
type TStorageMock = { getObjectStream: jest.Mock };
type TConfigMock = { get: jest.Mock };

const CHATFLOW_NAME = 'catalog-vision-augmenter-v1';
const CHATFLOW_ID = 'aug-flow-id-123';

function makeImageStream(content: string): Readable {
    return Readable.from([Buffer.from(content, 'utf-8')]);
}

function streamResult(content: string) {
    return {
        key: 'catalogs/aquaphor/images/x.png',
        body: makeImageStream(content),
        contentType: 'image/png',
    };
}

describe('VisionAugmenterService', () => {
    let service: VisionAugmenterService;
    let flowise: TFlowiseMock;
    let redis: TRedisMock;
    let storage: TStorageMock;
    let config: TConfigMock;

    beforeEach(async () => {
        flowise = { request: jest.fn() };
        redis = { hget: jest.fn(), hset: jest.fn().mockResolvedValue(0), hdel: jest.fn().mockResolvedValue(0) };
        storage = { getObjectStream: jest.fn() };
        config = {
            get: jest.fn((key: string) => {
                if (key === 'VISION_AUGMENTER_CHATFLOW_NAME') return CHATFLOW_NAME;
                return undefined;
            }),
        };

        const moduleRef = await Test.createTestingModule({
            providers: [
                VisionAugmenterService,
                { provide: FLOWISE_CLIENT_TOKEN, useValue: flowise as unknown as FlowiseClient },
                { provide: REDIS_CLIENT_TOKEN, useValue: redis as unknown as Redis },
                { provide: StorageService, useValue: storage as unknown as StorageService },
                { provide: ConfigService, useValue: config as unknown as ConfigService },
            ],
        }).compile();

        service = moduleRef.get(VisionAugmenterService);
    });

    describe('augmentItem — happy path', () => {
        it('cache hit → return cached visualDescription, Vision не дёргается', async () => {
            redis.hget.mockResolvedValueOnce(
                JSON.stringify({
                    imageHash: '<some-hash>',
                    visualDescription: 'Синий компактный фильтр под мойку',
                }),
            );
            // Storage возвращает картинку с тем же content что был при первой augment'ации.
            // Нам нужно чтобы computeImageHash совпал → но это deterministic от bytes.
            // Сначала проверим что hget вернул нужное и Vision не дёргнули.
            // imageHash в spec'е unrealistic — но logic: hget → if cached.imageHash === computed → return.
            // Чтобы покрыть hit пусть computeImageHash вернёт ровно то что в моке (через моk content).
            // Простой путь: новая stream с детерминированным содержимым → известный hash.
            // Я заранее не вычислил, поэтому вместо этого проверю поведение через
            // setting hget mock с динамическим matching.

            // ALTERNATIVE: тест полнее покрывается через `сначала miss → save → потом hit`
            // pattern. Сделаем именно так:
            redis.hget.mockReset();
            redis.hget
                .mockResolvedValueOnce(null) // 1-й вызов: miss
                .mockImplementationOnce(async () => {
                    // 2-й вызов: вернёт то что записал hset
                    const lastSet = redis.hset.mock.calls[0];
                    return lastSet ? (lastSet[2] as string) : null;
                });
            storage.getObjectStream.mockResolvedValue(streamResult('aaa-image-content'));
            flowise.request
                .mockResolvedValueOnce([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }]) // chatflow_list
                .mockResolvedValueOnce({ text: 'Синий компактный фильтр под мойку' }); // prediction

            const first = await service.augmentItem('mu-001', ['imgs/1.jpg']);
            expect(first).toBe('Синий компактный фильтр под мойку');

            // 2-й вызов с тем же image — должен пойти cache HIT (Vision не дёргается)
            storage.getObjectStream.mockResolvedValue(streamResult('aaa-image-content'));
            const second = await service.augmentItem('mu-001', ['imgs/1.jpg']);
            expect(second).toBe('Синий компактный фильтр под мойку');

            // Vision call за 2 запроса — только один (первый), второй из cache
            const predictCalls = flowise.request.mock.calls.filter((c) =>
                String(c[0]).includes('/prediction/'),
            );
            expect(predictCalls).toHaveLength(1);
        });

        it('cache miss → download → Vision call → save → return', async () => {
            redis.hget.mockResolvedValueOnce(null);
            storage.getObjectStream.mockResolvedValue(streamResult('image-bytes'));
            flowise.request
                .mockResolvedValueOnce([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }])
                .mockResolvedValueOnce({ text: 'Белый компактный фильтр' });

            const result = await service.augmentItem('mu-002', ['imgs/2.jpg']);

            expect(result).toBe('Белый компактный фильтр');
            // hset вызван — записали в Redis mapping
            expect(redis.hset).toHaveBeenCalledWith(
                VISION_AUGMENT_REDIS_KEY,
                'mu-002',
                expect.stringContaining('"visualDescription":"Белый компактный фильтр"'),
            );
        });

        it('multi-image — все streamings + один Vision call с N uploads', async () => {
            redis.hget.mockResolvedValueOnce(null);
            storage.getObjectStream
                .mockResolvedValueOnce(streamResult('img1'))
                .mockResolvedValueOnce(streamResult('img2'))
                .mockResolvedValueOnce(streamResult('img3'));
            flowise.request
                .mockResolvedValueOnce([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }])
                .mockResolvedValueOnce({ text: 'Описание мульти-фото товара' });

            const result = await service.augmentItem('mu-003', [
                'imgs/3-front.jpg',
                'imgs/3-side.jpg',
                'imgs/3-label.jpg',
            ]);

            expect(result).toBe('Описание мульти-фото товара');
            // Storage download'ов было 3
            expect(storage.getObjectStream).toHaveBeenCalledTimes(3);
            // Vision predict с 3 uploads
            const predictCall = flowise.request.mock.calls.find((c) =>
                String(c[0]).includes('/prediction/'),
            );
            expect(predictCall).toBeDefined();
            const body = predictCall![1].body as { uploads: unknown[] };
            expect(body.uploads).toHaveLength(3);
        });
    });

    describe('augmentItem — graceful degradation', () => {
        it('пустой imageUrls → null без download/Vision', async () => {
            const result = await service.augmentItem('mu-001', []);

            expect(result).toBeNull();
            expect(storage.getObjectStream).not.toHaveBeenCalled();
            expect(flowise.request).not.toHaveBeenCalled();
        });

        it('все downloads упали → null + warn', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.hget.mockResolvedValueOnce(null);
            storage.getObjectStream.mockRejectedValue(new Error('S3 not found'));

            const result = await service.augmentItem('mu-001', ['imgs/x.jpg']);

            expect(result).toBeNull();
            expect(flowise.request).not.toHaveBeenCalled(); // Vision skip'ается
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('chatflow not found → null + warn (не throw)', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.hget.mockResolvedValueOnce(null);
            storage.getObjectStream.mockResolvedValue(streamResult('img'));
            // chatflow_list возвращает empty → augmenter not found
            flowise.request.mockResolvedValueOnce([]);

            const result = await service.augmentItem('mu-001', ['imgs/x.jpg']);

            expect(result).toBeNull();
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('cannot resolve chatflow'));
            warnSpy.mockRestore();
        });

        it('Vision predict упал → null + warn', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.hget.mockResolvedValueOnce(null);
            storage.getObjectStream.mockResolvedValue(streamResult('img'));
            flowise.request
                .mockResolvedValueOnce([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }])
                .mockRejectedValueOnce(new Error('Anthropic 500'));

            const result = await service.augmentItem('mu-001', ['imgs/x.jpg']);

            expect(result).toBeNull();
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('predict failed'));
            warnSpy.mockRestore();
        });

        it('Vision вернул empty text → null + warn', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.hget.mockResolvedValueOnce(null);
            storage.getObjectStream.mockResolvedValue(streamResult('img'));
            flowise.request
                .mockResolvedValueOnce([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }])
                .mockResolvedValueOnce({ text: '   ' }); // только whitespace

            const result = await service.augmentItem('mu-001', ['imgs/x.jpg']);

            expect(result).toBeNull();
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('empty Vision response'));
            warnSpy.mockRestore();
        });

        it('Vision вернул markdown-обёртку → strip-нутый text', async () => {
            redis.hget.mockResolvedValueOnce(null);
            storage.getObjectStream.mockResolvedValue(streamResult('img'));
            flowise.request
                .mockResolvedValueOnce([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }])
                .mockResolvedValueOnce({
                    text: '```text\nКомпактный синий фильтр\n```',
                });

            const result = await service.augmentItem('mu-001', ['imgs/x.jpg']);

            expect(result).toBe('Компактный синий фильтр');
        });

        it('corrupt JSON в Redis cache → null + warn → fall through на Vision call', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.hget.mockResolvedValueOnce('{ broken json'); // corrupt
            storage.getObjectStream.mockResolvedValue(streamResult('img'));
            flowise.request
                .mockResolvedValueOnce([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }])
                .mockResolvedValueOnce({ text: 'Recovered description' });

            const result = await service.augmentItem('mu-001', ['imgs/x.jpg']);

            // Cache miss → Vision call → новый ответ
            expect(result).toBe('Recovered description');
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('getCachedAugmentation'),
            );
            warnSpy.mockRestore();
        });
    });

    describe('removeStaleAugmentations', () => {
        it('пустой список → 0, hdel не вызывается', async () => {
            const removed = await service.removeStaleAugmentations([]);
            expect(removed).toBe(0);
            expect(redis.hdel).not.toHaveBeenCalled();
        });

        it('список из N items → HDEL с теми ключами', async () => {
            redis.hdel.mockResolvedValueOnce(2);

            const removed = await service.removeStaleAugmentations(['mu-001', 'mu-002']);

            expect(removed).toBe(2);
            expect(redis.hdel).toHaveBeenCalledWith(
                VISION_AUGMENT_REDIS_KEY,
                'mu-001',
                'mu-002',
            );
        });

        it('Redis HDEL упал → 0 + warn (graceful)', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.hdel.mockRejectedValueOnce(new Error('Redis OOM'));

            const removed = await service.removeStaleAugmentations(['mu-001']);

            expect(removed).toBe(0);
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });
});
