import { z } from 'zod';

// =============================================================================
// Schema контракта `slovo-datasets/catalogs/aquaphor/latest.json` от feeder'а.
// Полностью совпадает с `TBulkIngestItem` из vision-catalog-search.md и
// контрактом ADR-007. zod-валидация на стороне slovo защищает от feeder
// regression — если CRM выкатит сломанный shape, мы упадём на parse, не
// в середине upsert цикла.
// =============================================================================

export const bulkIngestRelatedServiceSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(['installation', 'maintenance', 'other']),
});

export const bulkIngestRelatedComponentSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
});

export const bulkIngestItemSchema = z.object({
    externalId: z.string().min(1),
    externalSource: z.enum(['moysklad', '1c', 'manual']),
    externalType: z.enum(['product', 'service', 'cartridge', 'bundle']),
    externalUpdatedAt: z.string(),

    name: z.string().min(1),
    description: z.string().nullable().optional(),
    salePriceKopecks: z.number().int().nullable().optional(),
    categoryPath: z.string().nullable().optional(),
    isVisible: z.boolean(),
    rangForApp: z.number().int().nullable().optional(),

    imageUrls: z.array(z.string()).default([]),
    groupImageKeys: z.array(z.string()).default([]),

    relatedServices: z.array(bulkIngestRelatedServiceSchema).default([]),
    relatedComponents: z.array(bulkIngestRelatedComponentSchema).default([]),

    // Rich text для embedding собран feeder'ом — slovo использует as-is для
    // PlainText loader в Flowise.
    contentForEmbedding: z.string().min(1),

    contentHash: z.string().min(1),

    attributes: z.record(z.string(), z.unknown()).optional(),
});

export const bulkIngestPayloadSchema = z.object({
    syncMode: z.enum(['full', 'partial']),
    sourceSystem: z.enum(['moysklad', '1c', 'manual']),
    syncedAt: z.string(),
    items: z.array(bulkIngestItemSchema),
});

export type TBulkIngestRelatedService = z.infer<typeof bulkIngestRelatedServiceSchema>;
export type TBulkIngestRelatedComponent = z.infer<typeof bulkIngestRelatedComponentSchema>;
export type TBulkIngestItem = z.infer<typeof bulkIngestItemSchema>;
export type TBulkIngestPayload = z.infer<typeof bulkIngestPayloadSchema>;
