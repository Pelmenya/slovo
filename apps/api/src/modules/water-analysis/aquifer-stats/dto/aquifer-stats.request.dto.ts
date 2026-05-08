import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import {
    BBOX_LAT_MAX,
    BBOX_LAT_MIN,
    BBOX_LON_MAX,
    BBOX_LON_MIN,
    DEPTH_MAP_INTAKE_FILTER,
    type TDepthMapIntakeFilter,
} from '../../water-analysis.constants';

/**
 * Запрос «дай статистику по водоносным горизонтам в bbox» (USP-4 deep-dive).
 *
 * Стратифицированная агрегация: для каждого из 5 горизонтов (top_water/sandy/
 * sandy_limestone/limestone/artesian) вернуть count + median depth + median
 * по 22 параметрам химии. Это deep-dive над depth-map: не только распределение,
 * но и **типичная вода на каждой глубине** в данном районе.
 *
 * Сценарий: бурильщик / гидрогеолог получает overview района — «на 50-100м
 * обычно жёсткость 8 °Ж + железо 0.4, на 100-200м — 5 + 0.1». Помогает решить
 * целевую глубину бурения.
 */
export class AquiferStatsQueryDto {
    @ApiPropertyOptional({
        description: 'Тип источника. all (default) | well | well_dug — те же варианты что в /depth-map.',
        enum: DEPTH_MAP_INTAKE_FILTER,
        default: 'all',
    })
    @IsOptional()
    @IsIn(DEPTH_MAP_INTAKE_FILTER)
    intakeType?: TDepthMapIntakeFilter;

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
}
