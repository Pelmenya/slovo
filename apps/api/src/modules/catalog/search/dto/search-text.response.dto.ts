import { ApiProperty } from '@nestjs/swagger';

// Один документ из top-K результата vector search.
// `metadata` — произвольный объект из Document Store (чанк имеет любые поля,
// которые feeder положил при upsert). Type: Object — Swagger покажет это как
// generic object без жёсткой схемы. Когда метаданные стабилизируются
// (PR9: Prisma CatalogItem) — заменим на конкретный CatalogMetadataDto.
export class SearchTextDocResponseDto {
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
        description: 'Произвольные feeder-метаданные (externalId, categoryPath, attributes…)',
        type: Object,
        additionalProperties: true,
        example: {
            externalId: 'moysklad-uuid',
            externalType: 'product',
            categoryPath: 'Фильтры/Обратный осмос',
        },
    })
    metadata!: Record<string, unknown>;

    @ApiProperty({
        description:
            'Presigned S3 URLs для картинок товара (TTL 1ч). Пустой массив если в metadata нет imageUrls.',
        type: [String],
        example: ['https://s3.example.com/catalogs/aquaphor/images/.../abc123.jpg?X-Amz-Signature=...'],
    })
    imageUrls!: string[];
}

export class SearchTextResponseDto {
    @ApiProperty({ description: 'Сколько документов вернулось (≤ topK)', example: 10 })
    count!: number;

    @ApiProperty({ type: [SearchTextDocResponseDto] })
    docs!: SearchTextDocResponseDto[];

    @ApiProperty({
        description: 'Время выполнения vector search во Flowise (мс), без presigned overhead',
        example: 312,
    })
    timeTakenMs!: number;
}
