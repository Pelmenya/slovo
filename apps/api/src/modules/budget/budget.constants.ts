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
// ≈ 30 tokens (включая Vision-extracted description при combined). Token
// count приближаем как `query.length / 4` (avg chars-per-token для en/ru).
export const EMBEDDING_COST_PER_1M_TOKENS_USD = 0.02;
export const EMBEDDING_AVG_CHARS_PER_TOKEN = 4;
