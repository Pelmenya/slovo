import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MaxDecodedBytes } from '@slovo/common';
import { IsBase64, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
    CATALOG_DEFAULT_TOP_K,
    CATALOG_MAX_TOP_K,
    CATALOG_MIN_TOP_K,
    VISION_ALLOWED_MIME_TYPES,
    VISION_MAX_IMAGE_SIZE_BYTES,
} from '../../catalog.constants';

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
            'Base64-encoded JPEG/PNG/WebP image (БЕЗ префикса `data:image/...;base64,`). ' +
            'Декодированный размер ≤5MB.',
        // Корректный padded base64 (1×1 пиксель белый PNG): валидный для @IsBase64.
        example: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
    })
    @IsString()
    @IsBase64()
    // Реальный декодированный размер ≤5MB — точнее чем @MaxLength на строке
    // (base64 раздувает на 33%, и attacker мог бы залить пустой 7MB padding).
    @MaxDecodedBytes(VISION_MAX_IMAGE_SIZE_BYTES)
    imageBase64!: string;

    @ApiProperty({
        description: 'MIME-тип картинки',
        enum: VISION_ALLOWED_MIME_TYPES,
        example: 'image/jpeg',
    })
    @IsString()
    @IsIn(VISION_ALLOWED_MIME_TYPES)
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
