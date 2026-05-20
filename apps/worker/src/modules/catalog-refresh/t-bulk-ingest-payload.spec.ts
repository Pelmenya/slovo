import {
    bulkIngestItemSchema,
    productCategorySchema,
    type TBulkIngestItem,
} from './t-bulk-ingest-payload';

const VALID_ITEM: TBulkIngestItem = {
    externalId: 'mu-001',
    externalSource: 'moysklad',
    externalType: 'product',
    externalUpdatedAt: '2026-05-20T00:00:00Z',
    name: 'Аквафор DWM-101S',
    description: 'Обратный осмос',
    salePriceKopecks: 1690000,
    categoryPath: 'Очистка воды/.../Обратный осмос < 15000',
    productCategory: 'ro_system',
    isVisible: true,
    rangForApp: 1,
    imageUrls: [],
    groupImageKeys: [],
    relatedServices: [],
    relatedComponents: [],
    contentForEmbedding: 'Название: ...',
    contentHash: 'hash-001',
};

describe('productCategorySchema (closed enum)', () => {
    it.each([
        'ro_system',
        'flow_filter',
        'cartridge',
        'pre_filter',
        'softener',
        'housing',
        'accessory',
        'other',
    ])('accepts valid enum value: %s', (value) => {
        expect(() => productCategorySchema.parse(value)).not.toThrow();
    });

    it('rejects unknown enum value', () => {
        expect(() => productCategorySchema.parse('unknown_value')).toThrow();
        expect(() => productCategorySchema.parse('ro_systems')).toThrow(); // typo trap
        expect(() => productCategorySchema.parse('RO_SYSTEM')).toThrow(); // case-sensitive
    });

    it('rejects non-string values', () => {
        expect(() => productCategorySchema.parse(42)).toThrow();
        expect(() => productCategorySchema.parse(null)).toThrow();
        expect(() => productCategorySchema.parse(undefined)).toThrow();
        expect(() => productCategorySchema.parse({})).toThrow();
    });
});

describe('bulkIngestItemSchema — productCategory tri-state', () => {
    it('accepts valid enum string', () => {
        expect(() => bulkIngestItemSchema.parse(VALID_ITEM)).not.toThrow();
    });

    it('accepts explicit null (feeder derive failed)', () => {
        const item = { ...VALID_ITEM, productCategory: null };
        expect(() => bulkIngestItemSchema.parse(item)).not.toThrow();
    });

    it('accepts missing field (старый feeder без Slice 2)', () => {
        const item = { ...VALID_ITEM };
        delete (item as { productCategory?: unknown }).productCategory;
        expect(() => bulkIngestItemSchema.parse(item)).not.toThrow();
    });

    it('REJECTS invalid enum value (closed contract против дрифта)', () => {
        const item = { ...VALID_ITEM, productCategory: 'systems' as never };
        expect(() => bulkIngestItemSchema.parse(item)).toThrow();
    });

    it('REJECTS number вместо string', () => {
        const item = { ...VALID_ITEM, productCategory: 42 as never };
        expect(() => bulkIngestItemSchema.parse(item)).toThrow();
    });
});
