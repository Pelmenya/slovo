import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { MaxDecodedBytes } from '@slovo/common';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBase64,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Length,
    Max,
    Min,
    ValidateNested,
} from 'class-validator';
import {
    CATALOG_DEFAULT_TOP_K,
    CATALOG_MAX_QUERY_LENGTH,
    CATALOG_MAX_TOP_K,
    CATALOG_MIN_TOP_K,
    VISION_ALLOWED_MIME_TYPES,
    VISION_MAX_IMAGES_PER_REQUEST,
    VISION_MAX_IMAGE_SIZE_BYTES,
} from '../../catalog.constants';

// Один image upload в массиве `images`. Per-image cap 5MB декодированных
// (~7MB base64 string), per-image mime whitelist.
export class CatalogImageItemDto {
    @ApiProperty({
        description:
            'Base64-encoded JPEG/PNG/WebP image (БЕЗ префикса `data:image/...;base64,`). ' +
            'Декодированный размер ≤5MB.',
        example: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
    })
    @IsString()
    @IsBase64()
    @MaxDecodedBytes(VISION_MAX_IMAGE_SIZE_BYTES)
    base64!: string;

    @ApiProperty({
        description: 'MIME-тип картинки',
        enum: VISION_ALLOWED_MIME_TYPES,
        example: 'image/jpeg',
    })
    @IsString()
    @IsIn(VISION_ALLOWED_MIME_TYPES)
    mime!: string;
}

// Universal search request — поддерживает три режима:
// 1. **Text only**: только `query` → vector search по embeddings.
// 2. **Image only**: только `images` (1..5 фото) → Vision describe всех
//    фото в одном вызове → description_ru → vector search.
// 3. **Combined**: `query + images` → Vision describe → effective query =
//    userText + " " + description_ru → vector search. UX: клиент уточняет
//    намерение текстом + добавляет visual context (несколько ракурсов).
//
// Хотя бы одно из `query`/`images` обязательно. Service-level check
// (`if (!query && (!images || !images.length)) throw 400`) — DTO-level
// "at least one" через class-validator constraint неудобен (custom decorator
// overhead), runtime check проще и понятнее в Swagger.
export class SearchRequestDto {
    @ApiPropertyOptional({
        description:
            'Текстовый запрос на естественном языке. Опциональный — может быть только images.',
        example: 'фильтр для жёсткой воды',
        minLength: 1,
        maxLength: CATALOG_MAX_QUERY_LENGTH,
    })
    @IsOptional()
    @IsString()
    @Length(1, CATALOG_MAX_QUERY_LENGTH)
    query?: string;

    @ApiPropertyOptional({
        description: `Массив фото (1..${VISION_MAX_IMAGES_PER_REQUEST}). Опциональный — может быть только query. Все фото идут в один Vision call (multi-image describe), Vision возвращает общее description_ru объединяющее все ракурсы.`,
        type: [CatalogImageItemDto],
        minItems: 1,
        maxItems: VISION_MAX_IMAGES_PER_REQUEST,
    })
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(VISION_MAX_IMAGES_PER_REQUEST)
    @ValidateNested({ each: true })
    @Type(() => CatalogImageItemDto)
    images?: CatalogImageItemDto[];

    @ApiPropertyOptional({
        description: 'Сколько top-K товаров вернуть',
        default: CATALOG_DEFAULT_TOP_K,
        minimum: CATALOG_MIN_TOP_K,
        maximum: CATALOG_MAX_TOP_K,
    })
    @IsOptional()
    @IsInt()
    @Min(CATALOG_MIN_TOP_K)
    @Max(CATALOG_MAX_TOP_K)
    topK?: number;
}
