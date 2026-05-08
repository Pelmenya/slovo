import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import {
    BBOX_LAT_MAX,
    BBOX_LAT_MIN,
    BBOX_LON_MAX,
    BBOX_LON_MIN,
    POINTS_DEFAULT_LIMIT,
    POINTS_MAX_LIMIT,
    POINTS_MIN_LIMIT,
} from '../../water-analysis.constants';

/**
 * Запрос «дай точки анализов в этом bbox».
 *
 * Используется на high-zoom view карты (когда heatmap-aggregation становится
 * coarser чем нужно для UX). Отдаёт individual анализы с метаданными для popup.
 *
 * Координаты обезличиваются до 0.005° (~500м) — k-anonymity protection
 * (см. memory `feedback_water_heatmap_pii_strategy`).
 */
export class PointsQueryDto {
    @ApiProperty({ description: 'BBox west.', example: 36.5 })
    @Type(() => Number)
    @IsNumber()
    @Min(BBOX_LON_MIN)
    @Max(BBOX_LON_MAX)
    west!: number;

    @ApiProperty({ description: 'BBox south.', example: 54.8 })
    @Type(() => Number)
    @IsNumber()
    @Min(BBOX_LAT_MIN)
    @Max(BBOX_LAT_MAX)
    south!: number;

    @ApiProperty({ description: 'BBox east.', example: 39.0 })
    @Type(() => Number)
    @IsNumber()
    @Min(BBOX_LON_MIN)
    @Max(BBOX_LON_MAX)
    east!: number;

    @ApiProperty({ description: 'BBox north.', example: 56.5 })
    @Type(() => Number)
    @IsNumber()
    @Min(BBOX_LAT_MIN)
    @Max(BBOX_LAT_MAX)
    north!: number;

    @ApiPropertyOptional({
        description:
            'Сколько точек максимум. ORDER BY sample_date DESC — отдаём свежие первыми. ' +
            'Default 200 — обычно хватает для one viewport detailed view. Max 500 (API cap).',
        default: POINTS_DEFAULT_LIMIT,
        minimum: POINTS_MIN_LIMIT,
        maximum: POINTS_MAX_LIMIT,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(POINTS_MIN_LIMIT)
    @Max(POINTS_MAX_LIMIT)
    limit?: number;
}
