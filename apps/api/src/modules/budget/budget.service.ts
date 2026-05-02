import {
    Inject,
    Injectable,
    Logger,
    OnModuleDestroy,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sanitizeError, type TAppEnv } from '@slovo/common';
import type Redis from 'ioredis';
import {
    BUDGET_ALERT_FLAG_TTL_SEC,
    BUDGET_ALERT_KEY_INFIX,
    BUDGET_KEY_PREFIX,
    BUDGET_KEY_TTL_SEC,
    BUDGET_REDIS_TOKEN,
    EMBEDDING_AVG_CHARS_PER_TOKEN,
    EMBEDDING_COST_PER_1M_TOKENS_USD,
    TELEGRAM_API_BASE,
    TELEGRAM_CHAT_IDS_SEPARATOR,
    TELEGRAM_REQUEST_TIMEOUT_MS,
} from './budget.constants';

// =============================================================================
// BudgetService — daily cost cap для LLM calls (Vision / Embedding).
//
// Каждый день в Redis ведутся counters: spent USD per category. Перед
// дорогим LLM call'ом — `assertXxxBudget()` checks counter < daily cap,
// throws 503 если превышен. После успешного response — `recordXxxCall()`
// инкрементит counter.
//
// Counter keys: `slovo:budget:{category}:{YYYYMMDD}`. TTL=86400 — Redis
// сам автоматически очистит (но мы reset логикой через date-key, не
// через sliding window — counter за «сегодня» не пересчитывается каждые
// 24 часа от первого call'а, а cleanly reset'ится в UTC midnight).
//
// Cap'ы из env: VISION_BUDGET_DAILY_USD ($5), EMBEDDING_BUDGET_DAILY_USD ($1).
// На превышении — 503 ServiceUnavailable + payload c spent/budget/resets_at
// для UX hint клиенту.
// =============================================================================

type TBudgetCategory = 'vision' | 'embedding';

@Injectable()
export class BudgetService implements OnModuleDestroy {
    private readonly logger = new Logger(BudgetService.name);

    constructor(
        @Inject(BUDGET_REDIS_TOKEN) private readonly redis: Redis,
        private readonly config: ConfigService<TAppEnv, true>,
    ) {}

    async onModuleDestroy(): Promise<void> {
        try {
            await this.redis.quit();
        } catch (error) {
            this.logger.warn(`redis.quit() failed: ${sanitizeError(error)}`);
        }
    }

    async assertVisionBudget(): Promise<void> {
        await this.assertBudget(
            'vision',
            this.config.get('VISION_BUDGET_DAILY_USD', { infer: true }),
        );
    }

    async assertEmbeddingBudget(): Promise<void> {
        await this.assertBudget(
            'embedding',
            this.config.get('EMBEDDING_BUDGET_DAILY_USD', { infer: true }),
        );
    }

    async recordVisionCall(costUsd: number): Promise<void> {
        await this.recordSpend('vision', costUsd);
    }

    async recordEmbeddingTokens(approxTokens: number): Promise<void> {
        const costUsd = (approxTokens / 1_000_000) * EMBEDDING_COST_PER_1M_TOKENS_USD;
        await this.recordSpend('embedding', costUsd);
    }

    // Helper: approximate token count для query string. Для precise billing
    // нужен tiktoken, но для cap'а достаточно эвристики.
    static approximateTokensFromText(text: string): number {
        return Math.ceil(text.length / EMBEDDING_AVG_CHARS_PER_TOKEN);
    }

    private async assertBudget(category: TBudgetCategory, dailyCapUsd: number): Promise<void> {
        const key = this.dailyKey(category);
        const raw = await this.redis.get(key);
        const spent = raw === null ? 0 : Number.parseFloat(raw);
        if (Number.isNaN(spent)) {
            // Defensive — если кто-то записал гарбидж в counter, не падаем.
            // Логируем, allow request (fail-open безопасно: cap превентивный,
            // не критичный).
            this.logger.warn(`budget counter ${key} not parseable as number: ${raw}`);
            return;
        }
        if (spent >= dailyCapUsd) {
            // Fire-and-forget Telegram alert (race-safe через SET NX).
            // Не await — клиент получает 503 быстро, alert отправляется
            // параллельно. Ошибки доставки только лог-warn'ятся.
            void this.notifyExhausted(category, spent, dailyCapUsd);
            throw new ServiceUnavailableException({
                message: `Daily ${category} budget exceeded`,
                spent_usd: round4(spent),
                budget_usd: dailyCapUsd,
                resets_at: nextUtcMidnightIso(),
            });
        }
    }

    // Telegram alert при первом превышении budget-cap в день.
    // Race-safe: SET NX гарантирует ровно один success среди параллельных
    // call'ов assertBudget. Все no-op-условия (alerts disabled, нет токена,
    // нет chat_ids, alert уже был сегодня) — silent return без побочек.
    private async notifyExhausted(
        category: TBudgetCategory,
        spent: number,
        dailyCapUsd: number,
    ): Promise<void> {
        try {
            const enabled = this.config.get('TELEGRAM_ALERTS_ENABLED', { infer: true });
            if (!enabled) return;

            const token = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true });
            const chatIdsRaw = this.config.get('TELEGRAM_ALERT_CHAT_IDS', { infer: true });
            if (!token || !chatIdsRaw) return;

            const chatIds = chatIdsRaw
                .split(TELEGRAM_CHAT_IDS_SEPARATOR)
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            if (chatIds.length === 0) return;

            // SET NX: только первый caller среди параллельных assertBudget
            // call'ов получит OK. Остальные — null, no-op.
            const flagKey = `${BUDGET_KEY_PREFIX}:${BUDGET_ALERT_KEY_INFIX}:${category}:${todayUtcKey()}`;
            const acquired = await this.redis.set(
                flagKey,
                '1',
                'EX',
                BUDGET_ALERT_FLAG_TTL_SEC,
                'NX',
            );
            if (acquired !== 'OK') return;

            const text = formatAlertText(category, spent, dailyCapUsd);
            await Promise.allSettled(
                chatIds.map((chatId) => this.sendTelegram(token, chatId, text)),
            );
        } catch (error) {
            // Любая неожиданная ошибка (config, Redis SET, etc.) — не валит
            // основной flow. assertBudget уже бросил 503 callerу, alert это
            // observability, не критичный путь.
            this.logger.warn(`notifyExhausted failed: ${sanitizeError(error)}`);
        }
    }

    private async sendTelegram(token: string, chatId: string, text: string): Promise<void> {
        const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TELEGRAM_REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                }),
                signal: controller.signal,
            });
            if (!response.ok) {
                this.logger.warn(
                    `Telegram alert HTTP ${response.status} chat=${chatId}`,
                );
            }
        } catch (error) {
            this.logger.warn(
                `Telegram alert network error chat=${chatId}: ${sanitizeError(error)}`,
            );
        } finally {
            clearTimeout(timeout);
        }
    }

    private async recordSpend(category: TBudgetCategory, costUsd: number): Promise<void> {
        const key = this.dailyKey(category);
        // INCRBYFLOAT + EXPIRE — два command'а, не атомарны. Если первый
        // succeeded, второй failed → counter без TTL. Не критично — Redis
        // memory не утечёт, просто завтра key не auto-expire'нет, но и
        // не используется (мы пишем по date-key).
        await this.redis.incrbyfloat(key, costUsd);
        await this.redis.expire(key, BUDGET_KEY_TTL_SEC);
    }

    private dailyKey(category: TBudgetCategory): string {
        return `${BUDGET_KEY_PREFIX}:${category}:${todayUtcKey()}`;
    }
}

// =============================================================================
// Helpers (pure)
// =============================================================================

// `YYYYMMDD` UTC. Reset cleanly при пересечении UTC midnight.
function todayUtcKey(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

function nextUtcMidnightIso(): string {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    return tomorrow.toISOString();
}

function round4(value: number): number {
    return Math.round(value * 10000) / 10000;
}

function formatAlertText(category: TBudgetCategory, spent: number, dailyCapUsd: number): string {
    const categoryLabel = category === 'vision' ? 'Claude Vision' : 'OpenAI Embeddings';
    const overshoot = spent - dailyCapUsd;
    const overshootPercent = ((overshoot / dailyCapUsd) * 100).toFixed(0);
    return [
        `<b>⚠️ slovo budget exceeded</b>`,
        ``,
        `<b>Category:</b> ${categoryLabel}`,
        `<b>Spent:</b> $${round4(spent)} (cap $${dailyCapUsd}, +${overshootPercent}%)`,
        `<b>Resets:</b> ${nextUtcMidnightIso()}`,
        ``,
        `Endpoint возвращает 503 анонимам. Проверь причину:`,
        `1. Реальный рост traffic'а на prostor-app → расширь cap`,
        `2. Abuse / botnet → проверь throttle и логи (per-IP throttle)`,
    ].join('\n');
}
