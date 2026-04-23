export const STORAGE_S3_CLIENT = Symbol('STORAGE_S3_CLIENT');
export const STORAGE_BUCKET = Symbol('STORAGE_BUCKET');

// 10 минут — компромисс между безопасностью (OWASP рекомендует short-lived
// presigned URLs) и UX (лимит выдержит типичный download крупного файла).
export const DEFAULT_PRESIGNED_TTL_SECONDS = 600;
