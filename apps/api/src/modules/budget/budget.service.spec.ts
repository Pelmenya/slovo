import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { BUDGET_REDIS_TOKEN } from './budget.constants';
import { BudgetService } from './budget.service';

type TRedisMock = {
    get: jest.Mock;
    incrbyfloat: jest.Mock;
    expire: jest.Mock;
    quit: jest.Mock;
};

type TConfigMock = { get: jest.Mock };

describe('BudgetService', () => {
    let service: BudgetService;
    let redis: TRedisMock;
    let config: TConfigMock;

    beforeEach(async () => {
        redis = {
            get: jest.fn(),
            incrbyfloat: jest.fn().mockResolvedValue('0'),
            expire: jest.fn().mockResolvedValue(1),
            quit: jest.fn().mockResolvedValue('OK'),
        };
        config = {
            get: jest.fn((key: string) => {
                if (key === 'VISION_BUDGET_DAILY_USD') return 5;
                if (key === 'EMBEDDING_BUDGET_DAILY_USD') return 1;
                return undefined;
            }),
        };

        const moduleRef = await Test.createTestingModule({
            providers: [
                BudgetService,
                { provide: BUDGET_REDIS_TOKEN, useValue: redis as unknown as Redis },
                { provide: ConfigService, useValue: config as unknown as ConfigService },
            ],
        }).compile();

        service = moduleRef.get(BudgetService);
    });

    describe('assertVisionBudget', () => {
        it('counter < cap → пропускает (no throw)', async () => {
            redis.get.mockResolvedValueOnce('2.5');

            await expect(service.assertVisionBudget()).resolves.toBeUndefined();
        });

        it('counter null (никогда не записывали) → пропускает', async () => {
            redis.get.mockResolvedValueOnce(null);

            await expect(service.assertVisionBudget()).resolves.toBeUndefined();
        });

        it('counter ≥ cap → 503 ServiceUnavailable с payload', async () => {
            redis.get.mockResolvedValueOnce('5.01');

            try {
                await service.assertVisionBudget();
                fail('expected throw');
            } catch (err) {
                expect(err).toBeInstanceOf(ServiceUnavailableException);
                const response = (err as ServiceUnavailableException).getResponse() as Record<
                    string,
                    unknown
                >;
                expect(response.message).toContain('vision budget exceeded');
                expect(response.spent_usd).toBe(5.01);
                expect(response.budget_usd).toBe(5);
                expect(response.resets_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            }
        });

        it('counter ровно = cap → блокирует (≥, не >)', async () => {
            redis.get.mockResolvedValueOnce('5');

            await expect(service.assertVisionBudget()).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
        });

        it('counter невалидный (мусор в Redis) → fail-open + warn', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.get.mockResolvedValueOnce('not-a-number');

            await expect(service.assertVisionBudget()).resolves.toBeUndefined();
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('использует UTC date в key', async () => {
            redis.get.mockResolvedValueOnce('0');

            await service.assertVisionBudget();

            const keyArg = redis.get.mock.calls[0][0] as string;
            expect(keyArg).toMatch(/^slovo:budget:vision:\d{8}$/);
        });
    });

    describe('assertEmbeddingBudget', () => {
        it('использует EMBEDDING_BUDGET_DAILY_USD из config', async () => {
            redis.get.mockResolvedValueOnce('0.5');

            await service.assertEmbeddingBudget();

            expect(config.get).toHaveBeenCalledWith('EMBEDDING_BUDGET_DAILY_USD', { infer: true });
        });

        it('counter ≥ embedding cap → 503', async () => {
            redis.get.mockResolvedValueOnce('1.5');

            await expect(service.assertEmbeddingBudget()).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
        });
    });

    describe('recordVisionCall', () => {
        it('INCRBYFLOAT cost + EXPIRE 86400', async () => {
            await service.recordVisionCall(0.007);

            expect(redis.incrbyfloat).toHaveBeenCalledWith(
                expect.stringMatching(/^slovo:budget:vision:\d{8}$/),
                0.007,
            );
            expect(redis.expire).toHaveBeenCalledWith(
                expect.stringMatching(/^slovo:budget:vision:\d{8}$/),
                86400,
            );
        });
    });

    describe('recordEmbeddingTokens', () => {
        it('30 tokens → cost 30/1M × $0.02 = $0.0000006', async () => {
            await service.recordEmbeddingTokens(30);

            expect(redis.incrbyfloat).toHaveBeenCalledWith(
                expect.stringMatching(/^slovo:budget:embedding:\d{8}$/),
                expect.any(Number),
            );
            const cost = redis.incrbyfloat.mock.calls[0][1] as number;
            // 30/1M × 0.02 = 6e-7
            expect(cost).toBeCloseTo(6e-7, 10);
        });
    });

    describe('approximateTokensFromText (static)', () => {
        it('эмпирически 4 chars per token', () => {
            expect(BudgetService.approximateTokensFromText('hello world!')).toBe(3); // 12 chars / 4 = 3
            expect(BudgetService.approximateTokensFromText('a')).toBe(1); // ceil(1/4) = 1
            expect(BudgetService.approximateTokensFromText('')).toBe(0);
        });
    });

    describe('onModuleDestroy — graceful shutdown', () => {
        it('вызывает redis.quit()', async () => {
            await service.onModuleDestroy();
            expect(redis.quit).toHaveBeenCalled();
        });

        it('redis.quit() упал → warn, не throw', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.quit.mockRejectedValueOnce(new Error('Connection lost'));

            await expect(service.onModuleDestroy()).resolves.toBeUndefined();
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });
});
