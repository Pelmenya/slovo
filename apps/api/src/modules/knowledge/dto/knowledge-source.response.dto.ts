import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KnowledgeSourceStatus, KnowledgeSourceType } from '@prisma/client';

// Response-DTO: отдаём клиенту. Исключаем internal поля — rawText, extractedText,
// storageKey, metadata, error (это либо PII, либо infrastructure details).
// Если клиенту нужен raw/extracted текст — через отдельный endpoint
// GET /knowledge/sources/:id/content с presigned URL или inline (с throttle).
export class KnowledgeSourceResponseDto {
    @ApiProperty({ format: 'uuid', example: '479d5323-4268-4add-8ea6-76cd21ad892d' })
    id!: string;

    @ApiPropertyOptional({ format: 'uuid', nullable: true })
    userId!: string | null;

    @ApiProperty({ enum: KnowledgeSourceType })
    sourceType!: KnowledgeSourceType;

    @ApiProperty({ enum: KnowledgeSourceStatus })
    status!: KnowledgeSourceStatus;

    @ApiProperty({ minimum: 0, maximum: 100 })
    progress!: number;

    @ApiPropertyOptional({ maxLength: 256, nullable: true })
    title!: string | null;

    @ApiProperty({ format: 'date-time' })
    createdAt!: Date;

    @ApiProperty({ format: 'date-time' })
    updatedAt!: Date;

    @ApiPropertyOptional({ format: 'date-time', nullable: true })
    startedAt!: Date | null;

    @ApiPropertyOptional({ format: 'date-time', nullable: true })
    completedAt!: Date | null;
}
