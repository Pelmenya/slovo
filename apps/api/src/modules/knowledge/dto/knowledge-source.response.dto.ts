import { ApiProperty } from '@nestjs/swagger';
import { KnowledgeSourceStatus, KnowledgeSourceType } from '@prisma/client';

// Response-DTO: отдаём клиенту. Исключаем internal поля — rawText, extractedText,
// storageKey, metadata, error (это либо PII, либо infrastructure details).
// Если клиенту нужен raw/extracted текст — через отдельный endpoint
// GET /knowledge/sources/:id/content с presigned URL или inline (с throttle).
//
// Все поля всегда присутствуют в ответе (включая null-ы) — поэтому
// @ApiProperty({ nullable: true, required: true }) для nullable-required полей,
// а НЕ @ApiPropertyOptional (это исказило бы клиентский SDK: optional ≠ required-with-null).
export class KnowledgeSourceResponseDto {
    @ApiProperty({ format: 'uuid', example: '479d5323-4268-4add-8ea6-76cd21ad892d' })
    id!: string;

    @ApiProperty({ format: 'uuid', nullable: true, required: true, type: String })
    userId!: string | null;

    @ApiProperty({ enum: KnowledgeSourceType })
    sourceType!: KnowledgeSourceType;

    @ApiProperty({ enum: KnowledgeSourceStatus })
    status!: KnowledgeSourceStatus;

    @ApiProperty({ minimum: 0, maximum: 100 })
    progress!: number;

    @ApiProperty({ maxLength: 256, nullable: true, required: true, type: String })
    title!: string | null;

    @ApiProperty({ format: 'date-time' })
    createdAt!: Date;

    @ApiProperty({ format: 'date-time' })
    updatedAt!: Date;

    @ApiProperty({ format: 'date-time', nullable: true, required: true, type: String })
    startedAt!: Date | null;

    @ApiProperty({ format: 'date-time', nullable: true, required: true, type: String })
    completedAt!: Date | null;
}
