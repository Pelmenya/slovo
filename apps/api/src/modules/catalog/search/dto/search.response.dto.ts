import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
}

// Vision-describer output. Возвращается в response **только если** клиент
// прислал `imageBase64` — для UX прозрачности (фронт показывает «AI распознал
// X» рядом с результатами).
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

// Universal search response. `visionOutput` опционален — присутствует только
// когда клиент прислал image. Text-only search возвращает count/docs/timeTakenMs
// без visionOutput.
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
            'Vision-describer output — присутствует только когда был передан imageBase64. ' +
            'Для UX прозрачности: фронт показывает «AI распознал X» в шапке результатов.',
        type: VisionOutputDto,
    })
    visionOutput?: VisionOutputDto;
}
