import { createHash } from 'node:crypto';
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
    VISION_AUGMENT_MAX_CALLS_PER_REFRESH,
    VISION_AUGMENT_MAX_DESCRIPTION_LENGTH,
    VISION_AUGMENT_MODEL_VERSION,
    VISION_AUGMENT_REDIS_KEY,
} from './catalog-refresh.constants';
import {
    VisionAugmenterService,
    computeImageHash,
    mimeFromKey,
    stripMarkdownWrapper,
} from './vision-augmenter.service';

type TFlowiseMock = { request: jest.Mock };
type TRedisMock = { hget: jest.Mock; hset: jest.Mock; hdel: jest.Mock };
type TStorageMock = { getObjectStream: jest.Mock };
type TConfigMock = { get: jest.Mock };

const CHATFLOW_NAME = 'catalog-vision-augmenter-v1';
const CHATFLOW_ID = 'aug-flow-id-123';

// Helper для детерминированного content в stream
function streamFromContent(content: string, contentType = 'image/png') {
    return {
        key: 'catalogs/aquaphor/images/x.png',
        body: Readable.from([Buffer.from(content, 'utf-8')]),
        contentType,
    };
}

// Predicted hash для сценариев с known content
function expectedHashForSingle(content: string): string {
    const perImage = createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex');
    return createHash('sha256').update(perImage).digest('hex');
}

describe('VisionAugmenterService', () => {
    let service: VisionAugmenterService;
    let flowise: TFlowiseMock;
    let redis: TRedisMock;
    let storage: TStorageMock;
    let config: TConfigMock;

    beforeEach(async () => {
        flowise = { request: jest.fn() };
        redis = {
            hget: jest.fn(),
            hset: jest.fn().mockResolvedValue(0),
            hdel: jest.fn().mockResolvedValue(0),
        };
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
        it('cache miss → download → Vision call → save с modelVersion', async () => {
            redis.hget.mockResolvedValueOnce(null);
            storage.getObjectStream.mockResolvedValue(streamFromContent('image-bytes'));
            flowise.request
                .mockResolvedValueOnce([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }])
                .mockResolvedValueOnce({ text: 'Белый компактный фильтр' });

            const result = await service.augmentItem('mu-002', ['imgs/2.jpg']);

            expect(result).toBe('Белый компактный фильтр');
            // hset вызван — записали в Redis mapping с modelVersion
            const setCall = redis.hset.mock.calls[0];
            expect(setCall[0]).toBe(VISION_AUGMENT_REDIS_KEY);
            expect(setCall[1]).toBe('mu-002');
            const stored = JSON.parse(setCall[2] as string) as Record<string, string>;
            expect(stored.visualDescription).toBe('Белый компактный фильтр');
            expect(stored.modelVersion).toBe(VISION_AUGMENT_MODEL_VERSION);
            expect(stored.imageHash).toMatch(/^[0-9a-f]{64}$/);
        });

        it('cache hit (детерминированный hash) → возвращает cached, Vision не дёргается', async () => {
            const content = 'fixed-image-content';
            const expectedHash = expectedHashForSingle(content);

            // Cache pre-populated с правильным hash + modelVersion
            redis.hget.mockResolvedValueOnce(
                JSON.stringify({
                    imageHash: expectedHash,
                    visualDescription: 'Cached description',
                    modelVersion: VISION_AUGMENT_MODEL_VERSION,
                }),
            );
            storage.getObjectStream.mockResolvedValueOnce(streamFromContent(content));

            const result = await service.augmentItem('mu-001', ['imgs/1.jpg']);

            expect(result).toBe('Cached description');
            // Vision вообще не дёргается — flowise.request НЕ вызвался
            expect(flowise.request).not.toHaveBeenCalled();
            expect(redis.hset).not.toHaveBeenCalled();
        });

        it('cache hit с stale modelVersion → re-Vision (graceful upgrade)', async () => {
            const content = 'fixed-image-content';
            const expectedHash = expectedHashForSingle(content);

            // Cache с устаревшей modelVersion
            redis.hget.mockResolvedValueOnce(
                JSON.stringify({
                    imageHash: expectedHash,
                    visualDescription: 'Old model description',
                    modelVersion: 'haiku-3-old',
                }),
            );
            storage.getObjectStream.mockResolvedValue(streamFromContent(content));
            flowise.request
                .mockResolvedValueOnce([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }])
                .mockResolvedValueOnce({ text: 'New model fresh description' });

            const result = await service.augmentItem('mu-001', ['imgs/1.jpg']);

            expect(result).toBe('New model fresh description');
            // Vision дёрнулся — modelVersion mismatch
            expect(flowise.request).toHaveBeenCalled();
        });

        it('multi-image — все streamings + один Vision call с N uploads', async () => {
            redis.hget.mockResolvedValueOnce(null);
            storage.getObjectStream
                .mockResolvedValueOnce(streamFromContent('img1'))
                .mockResolvedValueOnce(streamFromContent('img2'))
                .mockResolvedValueOnce(streamFromContent('img3'));
            flowise.request
                .mockResolvedValueOnce([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }])
                .mockResolvedValueOnce({ text: 'Описание мульти-фото' });

            const result = await service.augmentItem('mu-003', ['1.jpg', '2.jpg', '3.jpg']);

            expect(result).toBe('Описание мульти-фото');
            expect(storage.getObjectStream).toHaveBeenCalledTimes(3);
            const predictCall = flowise.request.mock.calls.find((c) =>
                String(c[0]).includes('/prediction/'),
            );
            const body = predictCall![1].body as { uploads: unknown[] };
            expect(body.uploads).toHaveLength(3);
        });

        it('description >MAX_LENGTH → обрезается + ellipsis', async () => {
            const longDescription = 'А'.repeat(VISION_AUGMENT_MAX_DESCRIPTION_LENGTH + 200);
            redis.hget.mockResolvedValueOnce(null);
            storage.getObjectStream.mockResolvedValue(streamFromContent('img'));
            flowise.request
                .mockResolvedValueOnce([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }])
                .mockResolvedValueOnce({ text: longDescription });

            const result = await service.augmentItem('mu-001', ['imgs/x.jpg']);

            expect(result).toBeDefined();
            expect(result!.length).toBeLessThanOrEqual(VISION_AUGMENT_MAX_DESCRIPTION_LENGTH + 1);
            expect(result!.endsWith('…')).toBe(true);
        });
    });

    describe('augmentItem — graceful degradation', () => {
        it('пустой imageUrls → null без download/Vision', async () => {
            const result = await service.augmentItem('mu-001', []);

            expect(result).toBeNull();
            expect(storage.getObjectStream).not.toHaveBeenCalled();
            expect(flowise.request).not.toHaveBeenCalled();
        });

        it('все downloads упали → null + warn (один aggregated)', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.hget.mockResolvedValueOnce(null);
            storage.getObjectStream
                .mockRejectedValueOnce(new Error('S3 not found A'))
                .mockRejectedValueOnce(new Error('S3 not found B'));

            const result = await service.augmentItem('mu-001', ['x.jpg', 'y.jpg']);

            expect(result).toBeNull();
            expect(flowise.request).not.toHaveBeenCalled();
            // Aggregated warn — одна строка с обеими failures
            const warnCalls = warnSpy.mock.calls.filter((c) =>
                String(c[0]).includes('downloadImages'),
            );
            expect(warnCalls).toHaveLength(1);
            expect(String(warnCalls[0][0])).toContain('2 skipped');
            warnSpy.mockRestore();
        });

        it('chatflow not found → ERROR log один раз + остальные silent (anti-spam)', async () => {
            const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
            redis.hget.mockResolvedValue(null);
            storage.getObjectStream.mockResolvedValue(streamFromContent('img'));
            // chatflow_list возвращает empty 2 раза подряд
            flowise.request.mockResolvedValue([]);

            await service.augmentItem('mu-001', ['x.jpg']);
            await service.augmentItem('mu-002', ['y.jpg']);

            // ERROR залогирован один раз — не спам
            const errorCalls = errorSpy.mock.calls.filter((c) =>
                String(c[0]).includes('chatflow resolve failed'),
            );
            expect(errorCalls).toHaveLength(1);
            errorSpy.mockRestore();
        });

        it('Vision predict упал → null + warn', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.hget.mockResolvedValueOnce(null);
            storage.getObjectStream.mockResolvedValue(streamFromContent('img'));
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
            storage.getObjectStream.mockResolvedValue(streamFromContent('img'));
            flowise.request
                .mockResolvedValueOnce([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }])
                .mockResolvedValueOnce({ text: '   ' });

            const result = await service.augmentItem('mu-001', ['imgs/x.jpg']);

            expect(result).toBeNull();
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('empty Vision response'));
            warnSpy.mockRestore();
        });

        it('Vision вернул markdown-обёртку → strip-нутый text', async () => {
            redis.hget.mockResolvedValueOnce(null);
            storage.getObjectStream.mockResolvedValue(streamFromContent('img'));
            flowise.request
                .mockResolvedValueOnce([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }])
                .mockResolvedValueOnce({ text: '```text\nКомпактный фильтр\n```' });

            const result = await service.augmentItem('mu-001', ['imgs/x.jpg']);

            expect(result).toBe('Компактный фильтр');
        });

        it('corrupt JSON в Redis cache → null + warn → fall through на Vision call', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.hget.mockResolvedValueOnce('{ broken json');
            storage.getObjectStream.mockResolvedValue(streamFromContent('img'));
            flowise.request
                .mockResolvedValueOnce([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }])
                .mockResolvedValueOnce({ text: 'Recovered description' });

            const result = await service.augmentItem('mu-001', ['imgs/x.jpg']);

            expect(result).toBe('Recovered description');
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('getCachedAugmentation'),
            );
            warnSpy.mockRestore();
        });

        it('unsupported mime (svg) → image skipped до Vision', async () => {
            redis.hget.mockResolvedValueOnce(null);
            storage.getObjectStream.mockResolvedValue(streamFromContent('svg-bytes', 'image/svg+xml'));

            const result = await service.augmentItem('mu-001', ['imgs/x.svg']);

            expect(result).toBeNull();
            // Vision НЕ дёрнулся — image skip'нут до этого
            expect(flowise.request).not.toHaveBeenCalled();
        });
    });

    describe('beginRefreshCycle + per-refresh batch cap (#1 security)', () => {
        it('cap превышен → augmentItem возвращает null без Vision call', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            // Setup для bulk прогона
            redis.hget.mockResolvedValue(null);
            storage.getObjectStream.mockImplementation(() =>
                Promise.resolve(streamFromContent(`img-${Math.random()}`)),
            );
            // Vision call всегда успешный
            flowise.request.mockImplementation((path: string) => {
                if (String(path).includes('/chatflows')) {
                    return Promise.resolve([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }]);
                }
                return Promise.resolve({ text: 'desc' });
            });

            // Симулируем cap+1 calls
            service.beginRefreshCycle();
            for (let i = 0; i < VISION_AUGMENT_MAX_CALLS_PER_REFRESH; i++) {
                await service.augmentItem(`mu-${i}`, [`img-${i}.jpg`]);
            }
            // На (cap+1)-м вызове должен быть skip
            const overCapResult = await service.augmentItem('mu-overflow', ['x.jpg']);

            expect(overCapResult).toBeNull();
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining(`per-refresh cap (${VISION_AUGMENT_MAX_CALLS_PER_REFRESH})`),
            );
            warnSpy.mockRestore();
        }, 30_000);

        it('beginRefreshCycle() сбрасывает counter — следующий refresh снова augmentит', async () => {
            redis.hget.mockResolvedValue(null);
            storage.getObjectStream.mockImplementation(() =>
                Promise.resolve(streamFromContent(`img-${Math.random()}`)),
            );
            flowise.request.mockImplementation((path: string) => {
                if (String(path).includes('/chatflows')) {
                    return Promise.resolve([{ id: CHATFLOW_ID, name: CHATFLOW_NAME }]);
                }
                return Promise.resolve({ text: 'desc' });
            });

            // Перед resetom — забить cap
            for (let i = 0; i < VISION_AUGMENT_MAX_CALLS_PER_REFRESH; i++) {
                await service.augmentItem(`mu-${i}`, [`img-${i}.jpg`]);
            }
            const beforeReset = await service.augmentItem('mu-skip', ['x.jpg']);
            expect(beforeReset).toBeNull(); // skip из-за cap

            // Reset
            service.beginRefreshCycle();
            const afterReset = await service.augmentItem('mu-fresh', ['fresh.jpg']);
            expect(afterReset).toBe('desc'); // counter сброшен → augment работает
        }, 30_000);
    });

    describe('removeStaleAugmentations', () => {
        it('пустой список → 0, hdel не вызывается', async () => {
            const removed = await service.removeStaleAugmentations([]);
            expect(removed).toBe(0);
            expect(redis.hdel).not.toHaveBeenCalled();
        });

        it('список из N items → HDEL', async () => {
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

// =============================================================================
// Pure helpers — exported из vision-augmenter.service.ts для unit-testing
// =============================================================================

describe('computeImageHash', () => {
    it('один image → детерминированный sha256 (64 hex chars)', () => {
        const hash = computeImageHash([Buffer.from('hello')]);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('одинаковый content → одинаковый hash', () => {
        const a = computeImageHash([Buffer.from('content')]);
        const b = computeImageHash([Buffer.from('content')]);
        expect(a).toBe(b);
    });

    it('разный content → разный hash', () => {
        const a = computeImageHash([Buffer.from('aaa')]);
        const b = computeImageHash([Buffer.from('bbb')]);
        expect(a).not.toBe(b);
    });

    it('multi-image: order-independent (sort внутри)', () => {
        const ab = computeImageHash([Buffer.from('A'), Buffer.from('B')]);
        const ba = computeImageHash([Buffer.from('B'), Buffer.from('A')]);
        expect(ab).toBe(ba);
    });

    it('multi-image: разный content (один заменён) → разный hash', () => {
        const ab = computeImageHash([Buffer.from('A'), Buffer.from('B')]);
        const ac = computeImageHash([Buffer.from('A'), Buffer.from('C')]);
        expect(ab).not.toBe(ac);
    });

    it('пустой массив → стабильный hash (фиксированный sha256(""))', () => {
        const a = computeImageHash([]);
        const b = computeImageHash([]);
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('mimeFromKey', () => {
    it('.png → image/png', () => {
        expect(mimeFromKey('catalogs/photo.png')).toBe('image/png');
    });
    it('.jpg → image/jpeg', () => {
        expect(mimeFromKey('catalogs/photo.jpg')).toBe('image/jpeg');
    });
    it('.jpeg → image/jpeg', () => {
        expect(mimeFromKey('catalogs/photo.jpeg')).toBe('image/jpeg');
    });
    it('.gif → image/gif', () => {
        expect(mimeFromKey('catalogs/photo.gif')).toBe('image/gif');
    });
    it('.webp → image/webp', () => {
        expect(mimeFromKey('catalogs/photo.webp')).toBe('image/webp');
    });
    it('.svg → image/jpeg fallback (whitelist отдельно отбросит)', () => {
        expect(mimeFromKey('catalogs/photo.svg')).toBe('image/jpeg');
    });
    it('uppercase extension → нормализуется', () => {
        expect(mimeFromKey('catalogs/photo.PNG')).toBe('image/png');
    });
    it('без extension → image/jpeg fallback', () => {
        expect(mimeFromKey('catalogs/photo-no-ext')).toBe('image/jpeg');
    });
});

describe('stripMarkdownWrapper', () => {
    it('plain text → as-is', () => {
        expect(stripMarkdownWrapper('Простое описание')).toBe('Простое описание');
    });
    it('triple-backtick wrapper → strip', () => {
        expect(stripMarkdownWrapper('```\nОписание\n```')).toBe('Описание');
    });
    it('triple-backtick с language label → strip', () => {
        expect(stripMarkdownWrapper('```text\nОписание\n```')).toBe('Описание');
    });
    it('whitespace вокруг → trim', () => {
        expect(stripMarkdownWrapper('   Описание   ')).toBe('Описание');
    });
});
