// Размерные лимиты и дефолты knowledge-module. Живут отдельно потому что
// пересекаются между DTO (class-validator) и service (бизнес-логика), а
// в PR5+ тот же MAX_TEXT_SOURCE_LENGTH нужен будет Flowise upsert'у.

// Максимальный размер rawText для text-адаптера. Ограничение должно
// соответствовать Express bodyParser limit в main.ts — иначе клиент получит
// 413 Payload Too Large вместо понятного 400 валидации.
// 500_000 символов ≈ 200-300 страниц A4, достаточно для одной методички /
// главы книги. Для больших источников — video/pdf адаптеры через blob storage.
export const MAX_TEXT_SOURCE_LENGTH = 500_000;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
