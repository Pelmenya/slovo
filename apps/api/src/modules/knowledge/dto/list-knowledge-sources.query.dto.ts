import { ApiPropertyOptional } from '@nestjs/swagger';
import { KnowledgeSourceStatus, KnowledgeSourceType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../knowledge.constants';

export class ListKnowledgeSourcesQueryDto {
    @ApiPropertyOptional({ minimum: 1, default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({
        minimum: 1,
        maximum: MAX_PAGE_SIZE,
        default: DEFAULT_PAGE_SIZE,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(MAX_PAGE_SIZE)
    limit?: number = DEFAULT_PAGE_SIZE;

    @ApiPropertyOptional({ enum: KnowledgeSourceStatus })
    @IsOptional()
    @IsEnum(KnowledgeSourceStatus)
    status?: KnowledgeSourceStatus;

    @ApiPropertyOptional({ enum: KnowledgeSourceType })
    @IsOptional()
    @IsEnum(KnowledgeSourceType)
    sourceType?: KnowledgeSourceType;
}
