import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBase64, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
    CATALOG_DEFAULT_TOP_K,
    CATALOG_MAX_TOP_K,
    CATALOG_MIN_TOP_K,
    VISION_ALLOWED_MIME_TYPES,
    VISION_MAX_BASE64_LENGTH,
} from '../../catalog.constants';

const ALLOWED_MIME_LIST = Array.from(VISION_ALLOWED_MIME_TYPES);

// Image upload через JSON base64 (а не multipart) — клиенты `prostor-app`
// (Telegram MiniApp / web) уже base64-кодируют файлы для CRM API. Один
// content-type на всю API surface, без Multer dependency, без file-handling
// edge cases.
//
// Альтернатива multipart (`@UploadedFile()`) может быть добавлена позже если
// фронт upload'ит сырые binary напрямую — для текущих клиентов JSON base64
// идиоматичнее.
export class SearchImageRequestDto {
    @ApiProperty({
        description:
            'Base64-encoded JPEG/PNG/WebP image (без data: prefix). Декодированный размер ≤5MB.',
        example: '/9j/4AAQSkZJRgABAQEAYABgAAD...',
        maxLength: VISION_MAX_BASE64_LENGTH,
    })
    @IsString()
    @IsBase64()
    @MaxLength(VISION_MAX_BASE64_LENGTH)
    imageBase64!: string;

    @ApiProperty({
        description: 'MIME-тип картинки',
        enum: ALLOWED_MIME_LIST,
        example: 'image/jpeg',
    })
    @IsString()
    @IsIn(ALLOWED_MIME_LIST)
    mime!: string;

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
