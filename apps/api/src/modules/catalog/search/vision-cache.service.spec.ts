import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { REDIS_CLIENT_TOKEN } from '../catalog.constants';
import type { VisionOutputDto } from './dto/search.response.dto';
import { VisionCacheService } from './vision-cache.service';

type TRedisMock = {
    get: jest.Mock;
    setex: jest.Mock;
};

const SAMPLE_OUTPUT: VisionOutputDto = {
    isRelevant: true,
    category: 'обратный осмос',
    brand: 'Аквафор',
    modelHint: 'DWM-101S',
    descriptionRu: 'Фильтр обратного осмоса',
    confidence: 'high',
};

describe('VisionCacheService', () => {
    let service: VisionCacheService;
    let redis: TRedisMock;

    beforeEach(async () => {
        redis = {
            get: jest.fn(),
            setex: jest.fn().mockResolvedValue('OK'),
        };

        const moduleRef = await Test.createTestingModule({
            providers: [
                VisionCacheService,
                { provide: REDIS_CLIENT_TOKEN, useValue: redis as unknown as Redis },
            ],
        }).compile();

        service = moduleRef.get(VisionCacheService);
    });

    describe('computeImageHash (static)', () => {
        it('один image → детерминированный sha256 (64 hex chars)', () => {
            const hash = VisionCacheService.computeImageHash([{ base64: 'aGVsbG8=' }]);
            expect(hash).toMatch(/^[0-9a-f]{64}$/);
        });

        it('одинаковый base64 → одинаковый hash', () => {
            const a = VisionCacheService.computeImageHash([{ base64: 'aGVsbG8=' }]);
            const b = VisionCacheService.computeImageHash([{ base64: 'aGVsbG8=' }]);
            expect(a).toBe(b);
        });

        it('разный content → разный hash', () => {
            const a = VisionCacheService.computeImageHash([{ base64: 'aGVsbG8=' }]); // 'hello'
            const b = VisionCacheService.computeImageHash([{ base64: 'd29ybGQ=' }]); // 'world'
            expect(a).not.toBe(b);
        });

        it('multi-image: order-independent (sort внутри)', () => {
            const ab = VisionCacheService.computeImageHash([
                { base64: 'YWFhYQ==' },
                { base64: 'YmJiYg==' },
            ]);
            const ba = VisionCacheService.computeImageHash([
                { base64: 'YmJiYg==' },
                { base64: 'YWFhYQ==' },
            ]);
            expect(ab).toBe(ba);
        });

        it('multi-image: разный content (один заменён) → разный hash', () => {
            const ab = VisionCacheService.computeImageHash([
                { base64: 'YWFhYQ==' },
                { base64: 'YmJiYg==' },
            ]);
            const ac = VisionCacheService.computeImageHash([
                { base64: 'YWFhYQ==' },
                { base64: 'Y2NjYw==' }, // 'cccc' вместо 'bbbb'
            ]);
            expect(ab).not.toBe(ac);
        });

        it('пустой массив → допустимый hash (но cache практически бесполезен)', () => {
            // Не throw — отдельная валидация на caller'е (search.service)
            const hash = VisionCacheService.computeImageHash([]);
            expect(hash).toMatch(/^[0-9a-f]{64}$/);
        });
    });

    describe('get()', () => {
        it('Redis вернул JSON → распарсенный VisionOutputDto', async () => {
            redis.get.mockResolvedValueOnce(JSON.stringify(SAMPLE_OUTPUT));

            const result = await service.get('abc123');

            expect(result).toEqual(SAMPLE_OUTPUT);
            expect(redis.get).toHaveBeenCalledWith('slovo:vision:cache:v1:abc123');
        });

        it('Redis вернул null → null (cache miss)', async () => {
            redis.get.mockResolvedValueOnce(null);

            const result = await service.get('abc123');

            expect(result).toBeNull();
        });

        it('Redis вернул corrupt JSON → null + warn (graceful)', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.get.mockResolvedValueOnce('{ broken json');

            const result = await service.get('abc123');

            expect(result).toBeNull();
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('vision cache read failed'));
            warnSpy.mockRestore();
        });

        it('Redis сети упал → null + warn (graceful fallback на Vision)', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.get.mockRejectedValueOnce(new Error('ETIMEDOUT'));

            const result = await service.get('abc123');

            expect(result).toBeNull();
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('hash в логах усечён до 12 символов (privacy/readability)', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.get.mockRejectedValueOnce(new Error('test'));
            const longHash = 'a'.repeat(64);

            await service.get(longHash);

            const message = warnSpy.mock.calls[0][0] as string;
            expect(message).toContain('aaaaaaaaaaaa'); // 12 a's
            expect(message).not.toContain('a'.repeat(20));
            warnSpy.mockRestore();
        });
    });

    describe('set()', () => {
        it('SETEX с TTL 86400 + сериализованный JSON', async () => {
            await service.set('abc123', SAMPLE_OUTPUT);

            expect(redis.setex).toHaveBeenCalledWith(
                'slovo:vision:cache:v1:abc123',
                86400,
                JSON.stringify(SAMPLE_OUTPUT),
            );
        });

        it('Redis SETEX упал → не throw, warn (graceful)', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.setex.mockRejectedValueOnce(new Error('Redis OOM'));

            await expect(service.set('abc123', SAMPLE_OUTPUT)).resolves.toBeUndefined();
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('vision cache write failed'),
            );
            warnSpy.mockRestore();
        });
    });
});
