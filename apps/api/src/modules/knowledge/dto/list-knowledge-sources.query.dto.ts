import { ApiPropertyOptional } from '@nestjs/swagger';
import { KnowledgeSourceStatus, KnowledgeSourceType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListKnowledgeSourcesQueryDto {
    @ApiPropertyOptional({ minimum: 1, default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 20;

    @ApiPropertyOptional({ enum: KnowledgeSourceStatus })
    @IsOptional()
    @IsEnum(KnowledgeSourceStatus)
    status?: KnowledgeSourceStatus;

    @ApiPropertyOptional({ enum: KnowledgeSourceType })
    @IsOptional()
    @IsEnum(KnowledgeSourceType)
    sourceType?: KnowledgeSourceType;
}
