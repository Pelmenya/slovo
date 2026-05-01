import { z } from 'zod';

// =============================================================================
// Schema контракта `slovo-datasets/catalogs/aquaphor/latest.json` от feeder'а.
// Полностью совпадает с `TBulkIngestItem` из vision-catalog-search.md и
// контрактом ADR-007. zod-валидация на стороне slovo защищает от feeder
// regression — если CRM выкатит сломанный shape, мы упадём на parse, не
// в середине upsert цикла.
//
// Cap'ы (`.max()`) — защита от malicious feeder / cost burst:
// - `contentForEmbedding` 50KB на item — OpenAI text-embedding-3-small
//   $0.02/1M tokens, 50KB ≈ 12.5K tokens × 1000 items = $0.25 на refresh,
//   ×6 refresh/day = $1.5/day. Без cap'а 10MB строка → $7.75 на refresh.
// - `name` 200 chars — UI карточка товара, длинее не помещается.
// - `description` 10KB — 2-3 параграфа.
// - `imageUrls`/`groupImageKeys` 50 элементов — реальный max в каталоге ~10.
// - `relatedServices`/`relatedComponents` 100 элементов — категория группы
//   обычно 5-15 услуг, запас 10×.
// =============================================================================

const MAX_NAME_LEN = 200;
const MAX_DESCRIPTION_LEN = 10_000;
const MAX_CATEGORY_PATH_LEN = 500;
const MAX_CONTENT_FOR_EMBEDDING_LEN = 50_000;
const MAX_S3_KEY_LEN = 1024;
const MAX_IMAGE_URLS = 50;
const MAX_GROUP_IMAGE_KEYS = 50;
const MAX_RELATED_SERVICES = 100;
const MAX_RELATED_COMPONENTS = 100;

export const bulkIngestRelatedServiceSchema = z.object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(MAX_NAME_LEN),
    kind: z.enum(['installation', 'maintenance', 'other']),
});

export const bulkIngestRelatedComponentSchema = z.object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(MAX_NAME_LEN),
});

export const bulkIngestItemSchema = z.object({
    externalId: z.string().min(1).max(256),
    externalSource: z.enum(['moysklad', '1c', 'manual']),
    externalType: z.enum(['product', 'service', 'cartridge', 'bundle']),
    externalUpdatedAt: z.string().max(64),

    name: z.string().min(1).max(MAX_NAME_LEN),
    description: z.string().max(MAX_DESCRIPTION_LEN).nullable().optional(),
    salePriceKopecks: z.number().int().nullable().optional(),
    categoryPath: z.string().max(MAX_CATEGORY_PATH_LEN).nullable().optional(),
    isVisible: z.boolean(),
    rangForApp: z.number().int().nullable().optional(),

    imageUrls: z.array(z.string().max(MAX_S3_KEY_LEN)).max(MAX_IMAGE_URLS).default([]),
    groupImageKeys: z
        .array(z.string().max(MAX_S3_KEY_LEN))
        .max(MAX_GROUP_IMAGE_KEYS)
        .default([]),

    relatedServices: z
        .array(bulkIngestRelatedServiceSchema)
        .max(MAX_RELATED_SERVICES)
        .default([]),
    relatedComponents: z
        .array(bulkIngestRelatedComponentSchema)
        .max(MAX_RELATED_COMPONENTS)
        .default([]),

    // Rich text для embedding собран feeder'ом — slovo использует as-is для
    // PlainText loader в Flowise. Cap = $0.25 на refresh (см. сверху).
    contentForEmbedding: z.string().min(1).max(MAX_CONTENT_FOR_EMBEDDING_LEN),

    contentHash: z.string().min(1).max(128),

    // attributes — feeder-specific, slovo не использует напрямую (не идёт в
    // metadata). zod пропускает любую структуру; runtime cap не нужен потому
    // что в `buildItemMetadata` это поле игнорируется.
    attributes: z.record(z.string(), z.unknown()).optional(),
});

export const bulkIngestPayloadSchema = z.object({
    syncMode: z.enum(['full', 'partial']),
    sourceSystem: z.enum(['moysklad', '1c', 'manual']),
    syncedAt: z.string().max(64),
    items: z.array(bulkIngestItemSchema),
});

export type TBulkIngestRelatedService = z.infer<typeof bulkIngestRelatedServiceSchema>;
export type TBulkIngestRelatedComponent = z.infer<typeof bulkIngestRelatedComponentSchema>;
export type TBulkIngestItem = z.infer<typeof bulkIngestItemSchema>;
export type TBulkIngestPayload = z.infer<typeof bulkIngestPayloadSchema>;
