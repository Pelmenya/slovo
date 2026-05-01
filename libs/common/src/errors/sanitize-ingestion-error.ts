// Sanitize error message перед записью в БД (knowledge_sources.error и т.п.)
// или логи. Сырые ошибки от AWS SDK / Groq / Anthropic / pdf-parse / ioredis
// / fetch могут содержать секреты (API-ключи, presigned signatures, Bearer
// tokens, postgres connection strings с паролями) и PII (фрагменты
// user-документа в stack-trace парсера). Помимо редакции применяем
// ограничение по длине — в БД не кладём >2KB на ошибку.
//
// Функция generic — `sanitizeError` экспортируется как канонический алиас.
// `sanitizeIngestionError` оставлен для обратной совместимости с knowledge
// модулем (используется в knowledge.service.ts и его spec'е).

export const MAX_SANITIZED_ERROR_LENGTH = 2048;
export const REDACTED_TOKEN = '[REDACTED]';

// Порядок имеет значение: более специфичные патерны (AWS access key) должны
// идти раньше общих (Bearer) — иначе они попадут под более широкий матч
// и редактирование будет неточным.
const REDACTION_PATTERNS: ReadonlyArray<RegExp> = [
    // AWS Access Key ID: AKIA + 16 uppercase alphanum
    /AKIA[0-9A-Z]{16}/g,
    // AWS Secret Access Key (40 base64-ish chars, after "aws_secret_access_key" / "secretAccessKey")
    /(aws[_-]?secret[_-]?access[_-]?key|secretAccessKey)["'\s:=]+[A-Za-z0-9/+=]{40}/gi,
    // AWS SigV4 signature в presigned URL query string
    /X-Amz-Signature=[0-9a-f]{64}/gi,
    // AWS Security Token в presigned URL
    /X-Amz-Security-Token=[^&\s"']+/gi,
    // AWS Credential в presigned URL (содержит access key ID)
    /X-Amz-Credential=[^&\s"']+/gi,
    // Anthropic API key
    /sk-ant-[A-Za-z0-9_-]{20,}/g,
    // OpenAI API key
    /sk-[A-Za-z0-9]{20,}/g,
    // Generic Bearer token в Authorization header
    /Bearer\s+[A-Za-z0-9._~+/=-]+/g,
    // Generic Basic auth
    /Basic\s+[A-Za-z0-9+/=]+/g,
    // JWT (three base64url parts separated by dots)
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    // Postgres connection string с паролем: postgres://user:password@host/db
    /postgres(?:ql)?:\/\/[^:/?\s]+:[^@/\s]+@/gi,
];

export function sanitizeError(err: unknown): string {
    const raw = extractMessage(err);
    const redacted = REDACTION_PATTERNS.reduce(
        (acc, pattern) => acc.replace(pattern, REDACTED_TOKEN),
        raw,
    );
    if (redacted.length <= MAX_SANITIZED_ERROR_LENGTH) {
        return redacted;
    }
    return `${redacted.slice(0, MAX_SANITIZED_ERROR_LENGTH - 3)}...`;
}

// Backward-compat алиас. Knowledge модуль импортирует этот символ — не
// переименовываем чтобы избежать diff-шума там, где имя «Ingestion» точно
// описывает контекст (запись в knowledge_sources.error).
export const sanitizeIngestionError = sanitizeError;

function extractMessage(err: unknown): string {
    if (err instanceof Error) {
        // stack включает message, но иногда usefulные детали только в stack
        return err.stack ?? err.message;
    }
    if (typeof err === 'string') {
        return err;
    }
    // JSON.stringify(undefined) возвращает undefined (не 'undefined'), поэтому
    // сначала отлавливаем через String(), а уже потом пробуем красивый JSON
    // для не-примитивных значений.
    if (err === null || err === undefined) {
        return String(err);
    }
    try {
        const json = JSON.stringify(err);
        return json ?? String(err);
    } catch {
        return String(err);
    }
}
