import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type TVisionConfidence = 'low' | 'mid' | 'high';

// Один документ из top-K результата vector search. Shape совпадает с
// предыдущим SearchTextDocResponseDto из PR7 — переиспользуем как базу
// universal response (PR9 universal-search refactor).
export class SearchDocResponseDto {
    @ApiProperty({
        description: 'Stable id чанка из Flowise vector store',
        example: 'aec6b741-loader-1-chunk-42',
    })
    id!: string;

    @ApiProperty({
        description: 'Текст чанка, собранный feeder\'ом из rich-text каталога',
        example: 'Товар: Аквафор DWM-101S\nОписание: фильтр обратного осмоса...',
    })
    pageContent!: string;

    @ApiProperty({
        description:
            'Whitelist-фильтрованные feeder-метаданные (externalId, categoryPath, name, description, salePriceKopecks, ...).',
        type: Object,
        additionalProperties: true,
        example: {
            externalId: 'moysklad-uuid',
            externalType: 'product',
            name: 'Аквафор DWM-101S',
            categoryPath: 'Фильтры/Обратный осмос',
            salePriceKopecks: 4500000,
        },
    })
    metadata!: Record<string, unknown>;

    @ApiProperty({
        description:
            'Presigned S3 URLs для картинок товара (TTL 1ч). Пустой массив если в metadata нет imageUrls.',
        type: [String],
    })
    imageUrls!: string[];

    @ApiProperty({
        description:
            'Relevance score 0..100 для UX «91% совпадение». Phase 1: rank-based ' +
            '(top doc=100, scaled линейно вниз) — Flowise vectorstoreQuery использует ' +
            'asRetriever() который не пропускает similaritySearchWithScore. Defensive ' +
            'fallback: если в metadata появится numeric `score` (0..1) — используется ' +
            'напрямую. Phase 2+: bypass Flowise через прямой pgvector query для точных ' +
            'cosine-баллов.',
        minimum: 0,
        maximum: 100,
        example: 91,
    })
    matchScore!: number;
}

// Vision-describer output. Возвращается в response **только если** клиент
// прислал `imageBase64` — для UX прозрачности (фронт показывает «AI распознал
// X» рядом с результатами).
//
// @deprecated since 2026-05-15 (smart-search Phase 1). Используй `vision`
// (compact `VisionDto`) — там category/description/confidence уже bucketed
// в фронт-ready shape. Этот legacy сохранён для B2B-сценариев требующих
// brand/modelHint/isRelevant; после миграции consumers — удалить.
//
// Response-only DTO: class-validator декораторы не требуются (валидация
// запускается только на request DTO через ValidationPipe).
export class VisionOutputDto {
    @ApiProperty({
        description: 'true — на фото оборудование/товар. false — кот/документ/прочее',
        example: true,
    })
    isRelevant!: boolean;

    @ApiProperty({
        description: 'Категория товара (free-form, не enum) или "прочее"',
        example: 'обратный осмос',
        nullable: true,
        type: String,
    })
    category!: string | null;

    @ApiProperty({
        description: 'Бренд если виден на фото',
        example: 'Аквафор',
        nullable: true,
        type: String,
    })
    brand!: string | null;

    @ApiProperty({
        description: 'Модель/артикул если читается на упаковке',
        example: 'DWM-101S',
        nullable: true,
        type: String,
    })
    modelHint!: string | null;

    @ApiProperty({
        description: 'Естественное описание товара на русском — используется как query для search',
        example: 'Кран смеситель для питьевой воды с двумя рычагами',
    })
    descriptionRu!: string;

    @ApiProperty({
        description: 'Уровень уверенности классификатора',
        enum: ['high', 'medium', 'low'],
        example: 'high',
    })
    confidence!: 'high' | 'medium' | 'low';
}

// Compact Vision-describer output для smart-search UX (Phase 1).
// В отличие от полного `VisionOutputDto` (isRelevant/brand/modelHint/...) —
// здесь только три поля которые рисует фронт: что распознали (category) +
// описание для подписи + bucket уверенности для UI-fallback'а («low →
// "Не уверен что распознал, опишите словами"»).
//
// `confidence: 'low' | 'mid' | 'high'` — bucketed из numeric/discrete
// Vision output через `toVisionConfidence()`:
// - numeric input: `>= 0.8 → high`, `>= 0.5 → mid`, else `low`
// - discrete input: `high → high`, `medium → mid`, `low → low`
// Текущий Vision-describer возвращает discrete (см. image.service.ts);
// numeric ветка — forward-compat для Phase 1.5 где можно расширить prompt.
//
// Response-only DTO: class-validator декораторы не требуются (валидация
// запускается только на request DTO через ValidationPipe).
export class VisionDto {
    @ApiProperty({
        description: 'Категория товара распознанная Vision (free-form, не enum)',
        example: 'обратный осмос',
        nullable: true,
        type: String,
    })
    category!: string | null;

    @ApiProperty({
        description: 'Натуральное описание распознанного — рисуется в шапке результатов',
        example: 'Компактная система обратного осмоса под мойку, белый корпус, 4 колбы',
    })
    description!: string;

    @ApiProperty({
        description:
            'Bucket уверенности Vision. UI: low → подсказка «уточните словами», ' +
            'mid → результаты без warning, high → confident badge «AI распознал».',
        enum: ['low', 'mid', 'high'],
        example: 'high',
    })
    confidence!: TVisionConfidence;
}

// Universal search response. `visionOutput` (legacy полный shape) опционален.
// `vision` (Phase 1 compact shape) — null когда image не передан, present
// иначе. Дублирование осознанное: `visionOutput` хранит brand/modelHint/
// isRelevant — потенциально полезное в B2B-сценариях; `vision` — UX shape
// для smart-search фронта. См. `docs/features/smart-search-integration.md`.
export class SearchResponseDto {
    @ApiProperty({ description: 'Сколько документов вернулось (≤ topK)', example: 10 })
    count!: number;

    @ApiProperty({ type: [SearchDocResponseDto] })
    docs!: SearchDocResponseDto[];

    @ApiProperty({
        description: 'Время выполнения downstream vector search во Flowise (мс), без Vision overhead',
        example: 312,
    })
    timeTakenMs!: number;

    @ApiPropertyOptional({
        description:
            '⚠️ Deprecated since 2026-05-15: используй compact поле `vision` ниже. ' +
            'Полный Vision-describer output — присутствует только когда был передан imageBase64. ' +
            'Сохранён для legacy B2B-сценариев требующих brand/modelHint/isRelevant.',
        type: VisionOutputDto,
        deprecated: true,
    })
    visionOutput?: VisionOutputDto;

    @ApiProperty({
        description:
            'Compact Vision output для smart-search UX. `null` если image не передан. ' +
            'Phase 1 shape: `{ category, description, confidence: low|mid|high }`.',
        type: VisionDto,
        nullable: true,
    })
    vision!: VisionDto | null;
}
