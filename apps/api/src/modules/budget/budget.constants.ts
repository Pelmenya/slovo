// =============================================================================
// Budget cap module — cost protection для cross-cutting LLM-вызовов.
// См. tech-debt #21 (RAISED priority после PR8) — без cap'а Vision $0.005-
// 0.007/call × 5 req/min/IP × distributed botnet → катастрофа.
// =============================================================================

export const BUDGET_REDIS_TOKEN = Symbol('BUDGET_REDIS_CLIENT');

// Redis key prefix для daily counters. TTL=86400 (24h), reset на UTC
// midnight (через стейт через date-key, а не sliding window).
export const BUDGET_KEY_PREFIX = 'slovo:budget';
export const BUDGET_KEY_TTL_SEC = 86400;

// Cost-константы для approximate billing tracking. Реальный billing —
// в Anthropic / OpenAI dashboards, эти числа для local cap. Если стоимость
// меняется (модель апгрейдится / pricing шифт), обновить.
//
// VISION: Claude Sonnet 4.6, ~1500 input tokens на 1024×1024 фото +
// ~150 output. Conservative upper bound $0.007/call. На multi-image (5 фото)
// — 5× tokens, ставим $0.035 в записи cost (consumer передаёт явно).
export const VISION_COST_PER_CALL_USD_DEFAULT = 0.007;
export const VISION_COST_PER_IMAGE_USD = 0.007;

// EMBEDDING: OpenAI text-embedding-3-small $0.02/1M tokens. 1 search query
// ≈ 30 tokens (включая Vision-extracted description при combined).
//
// Token count приближаем как `query.length / 3` — safety factor для ru-heavy
// traffic. Реальный tiktoken cl100k_base даёт ~2-3 chars/token для cyrillic
// (multi-byte UTF-8 split), ~4 для latin. Default 3 underestimate'ит
// budget на ~25% для en и accurate для ru. Без safety мы могли бы пропустить
// $1/день cap до фактического превышения.
//
// Для precise billing — `js-tiktoken` (~600KB), но для $1/день cap overkill.
export const EMBEDDING_COST_PER_1M_TOKENS_USD = 0.02;
export const EMBEDDING_AVG_CHARS_PER_TOKEN = 3;

// =============================================================================
// Telegram alert (#36) — уведомление админу при первом превышении budget-cap
// в день. Race-safe через SET NX: только один процесс среди параллельных
// assertXxxBudget()-вызовов отправит алерт.
// =============================================================================

// Redis key для idempotency: `slovo:budget:alerted:{category}:{YYYYMMDD}`.
// TTL 25h — гарантированно перекрывает UTC-день для всех таймзон.
export const BUDGET_ALERT_FLAG_TTL_SEC = 90000;
export const BUDGET_ALERT_KEY_INFIX = 'alerted';

// Telegram Bot API. Без API-key fallback / без retries — fire-and-forget,
// сетевая ошибка только лог-warn'ится.
export const TELEGRAM_API_BASE = 'https://api.telegram.org';
export const TELEGRAM_REQUEST_TIMEOUT_MS = 5000;

// Разделитель множественных chat_ids в env (как в CRM-проекте `__`).
export const TELEGRAM_CHAT_IDS_SEPARATOR = '__';
