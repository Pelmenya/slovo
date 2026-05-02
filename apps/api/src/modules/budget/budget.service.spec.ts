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
    set: jest.Mock;
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
            set: jest.fn().mockResolvedValue('OK'),
        };
        config = {
            get: jest.fn((key: string) => {
                if (key === 'VISION_BUDGET_DAILY_USD') return 5;
                if (key === 'EMBEDDING_BUDGET_DAILY_USD') return 1;
                if (key === 'TELEGRAM_ALERTS_ENABLED') return false;
                if (key === 'TELEGRAM_BOT_TOKEN') return '';
                if (key === 'TELEGRAM_ALERT_CHAT_IDS') return '';
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

    describe('Telegram alert на budget-cap exhaustion (#36)', () => {
        let fetchMock: jest.SpyInstance;

        beforeEach(() => {
            // Mock global fetch — Telegram API HTTP call.
            fetchMock = jest
                .spyOn(globalThis, 'fetch')
                .mockResolvedValue(
                    new Response('{"ok":true}', {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    }),
                );
        });

        afterEach(() => {
            fetchMock.mockRestore();
        });

        function configureAlertsEnabled(): void {
            config.get.mockImplementation((key: string) => {
                if (key === 'VISION_BUDGET_DAILY_USD') return 5;
                if (key === 'EMBEDDING_BUDGET_DAILY_USD') return 1;
                if (key === 'TELEGRAM_ALERTS_ENABLED') return true;
                if (key === 'TELEGRAM_BOT_TOKEN') return 'test-bot-token';
                if (key === 'TELEGRAM_ALERT_CHAT_IDS') return '111__222__333';
                return undefined;
            });
        }

        // Helper для дожидания fire-and-forget void promise — sleep одного
        // event-loop tick'а через `await Promise.resolve()` достаточно для
        // микро-task'ов (наш notifyExhausted использует только awaits, не
        // setTimeout).
        async function flushMicrotasks(): Promise<void> {
            await new Promise((resolve) => setImmediate(resolve));
        }

        it('budget OK → Telegram не дёргается', async () => {
            configureAlertsEnabled();
            redis.get.mockResolvedValueOnce('2.5'); // под cap

            await service.assertVisionBudget();

            expect(fetchMock).not.toHaveBeenCalled();
            expect(redis.set).not.toHaveBeenCalled();
        });

        it('budget exceeded → SET NX flag + Telegram POST для каждого chat_id', async () => {
            configureAlertsEnabled();
            redis.get.mockResolvedValueOnce('5.5');

            await expect(service.assertVisionBudget()).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            await flushMicrotasks();

            // SET NX с alerted-key, EX 90000
            expect(redis.set).toHaveBeenCalledWith(
                expect.stringMatching(/^slovo:budget:alerted:vision:\d{8}$/),
                '1',
                'EX',
                90000,
                'NX',
            );

            // Telegram fetch для всех 3 chat_id
            expect(fetchMock).toHaveBeenCalledTimes(3);
            const calls = fetchMock.mock.calls;
            expect(calls[0][0]).toBe('https://api.telegram.org/bottest-bot-token/sendMessage');
            const body = JSON.parse(calls[0][1].body as string) as Record<string, unknown>;
            expect(['111', '222', '333']).toContain(body.chat_id);
            expect(body.parse_mode).toBe('HTML');
            expect(body.text).toContain('budget exceeded');
            expect(body.text).toContain('Claude Vision');
            expect(body.text).toContain('$5.5');
        });

        it('SET NX вернул null (уже алертили) → Telegram не дёргается', async () => {
            configureAlertsEnabled();
            redis.get.mockResolvedValueOnce('5.5');
            redis.set.mockResolvedValueOnce(null); // flag уже стоит

            await expect(service.assertVisionBudget()).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            await flushMicrotasks();

            expect(redis.set).toHaveBeenCalled();
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('TELEGRAM_ALERTS_ENABLED=false → 503 бросается, fetch не вызывается', async () => {
            // Default config из beforeEach уже имеет ALERTS_ENABLED=false
            redis.get.mockResolvedValueOnce('5.5');

            await expect(service.assertVisionBudget()).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            await flushMicrotasks();

            expect(fetchMock).not.toHaveBeenCalled();
            expect(redis.set).not.toHaveBeenCalled();
        });

        it('TOKEN пустой → fetch не вызывается даже при ENABLED=true', async () => {
            config.get.mockImplementation((key: string) => {
                if (key === 'VISION_BUDGET_DAILY_USD') return 5;
                if (key === 'TELEGRAM_ALERTS_ENABLED') return true;
                if (key === 'TELEGRAM_BOT_TOKEN') return ''; // пустой
                if (key === 'TELEGRAM_ALERT_CHAT_IDS') return '111';
                return undefined;
            });
            redis.get.mockResolvedValueOnce('5.5');

            await expect(service.assertVisionBudget()).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            await flushMicrotasks();

            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('CHAT_IDS пустой → fetch не вызывается', async () => {
            config.get.mockImplementation((key: string) => {
                if (key === 'VISION_BUDGET_DAILY_USD') return 5;
                if (key === 'TELEGRAM_ALERTS_ENABLED') return true;
                if (key === 'TELEGRAM_BOT_TOKEN') return 'token';
                if (key === 'TELEGRAM_ALERT_CHAT_IDS') return ''; // пустой
                return undefined;
            });
            redis.get.mockResolvedValueOnce('5.5');

            await expect(service.assertVisionBudget()).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            await flushMicrotasks();

            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('fetch упал network error → 503 всё равно бросается, ошибка логируется', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            configureAlertsEnabled();
            redis.get.mockResolvedValueOnce('5.5');
            fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));

            await expect(service.assertVisionBudget()).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            await flushMicrotasks();

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Telegram alert network error'),
            );
            warnSpy.mockRestore();
        });

        it('Telegram вернул не-200 → warn, не throw', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            configureAlertsEnabled();
            redis.get.mockResolvedValueOnce('5.5');
            fetchMock.mockResolvedValue(
                new Response('{"ok":false,"error":"forbidden"}', { status: 403 }),
            );

            await expect(service.assertVisionBudget()).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            await flushMicrotasks();

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Telegram alert HTTP 403'),
            );
            warnSpy.mockRestore();
        });

        it('embedding category — message содержит "OpenAI Embeddings"', async () => {
            configureAlertsEnabled();
            redis.get.mockResolvedValueOnce('1.5');

            await expect(service.assertEmbeddingBudget()).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            await flushMicrotasks();

            const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<
                string,
                unknown
            >;
            expect(body.text).toContain('OpenAI Embeddings');
        });

        it('chat_ids с пробелами и пустыми элементами — фильтруются', async () => {
            config.get.mockImplementation((key: string) => {
                if (key === 'VISION_BUDGET_DAILY_USD') return 5;
                if (key === 'TELEGRAM_ALERTS_ENABLED') return true;
                if (key === 'TELEGRAM_BOT_TOKEN') return 'token';
                if (key === 'TELEGRAM_ALERT_CHAT_IDS') return '111__  __222__';
                return undefined;
            });
            redis.get.mockResolvedValueOnce('5.5');

            await expect(service.assertVisionBudget()).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            await flushMicrotasks();

            // 111 и 222 — fetch только для них
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('redis.set throws → notifyExhausted swallow + 503 throws', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            configureAlertsEnabled();
            redis.get.mockResolvedValueOnce('5.5');
            redis.set.mockRejectedValueOnce(new Error('Redis OOM'));

            await expect(service.assertVisionBudget()).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            await flushMicrotasks();

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('notifyExhausted failed'),
            );
            warnSpy.mockRestore();
        });
    });
});
