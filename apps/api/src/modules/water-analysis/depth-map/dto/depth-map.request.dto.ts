import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import {
    BBOX_LAT_MAX,
    BBOX_LAT_MIN,
    BBOX_LON_MAX,
    BBOX_LON_MIN,
    GRID_DEFAULT_DEG,
    GRID_MAX_DEG,
    GRID_MIN_DEG,
} from '../../water-analysis.constants';
import { INTAKE_TYPE_FILTER_VALUES, type TIntakeTypeFilter } from '../../_shared';

/**
 * Карта глубин скважин/колодцев по grid (USP-4 base).
 *
 * Bbox + grid агрегация аналогично heatmap, но aggregation поверх `depth_meters`
 * (не jsonb params) и только wells/well_dug. Per cell — median/P25/P75 + count +
 * aquiferLayers bucket-распределение (5 горизонтов).
 *
 * Audience: B2B бурильщики / копатели колодцев / гидрогеологи / девелоперы.
 */
export class DepthMapQueryDto {
    @ApiPropertyOptional({
        description:
            'Тип источника. `well` — скважины (mean 49м, max 300м). `well_dug` — колодцы (mean 8м, max 39м). ' +
            '`all` — оба типа (default). municipal/spring/river depth не имеет смысла, отфильтровываются.',
        enum: INTAKE_TYPE_FILTER_VALUES,
        default: 'all',
    })
    @IsOptional()
    @IsIn(INTAKE_TYPE_FILTER_VALUES)
    intakeType?: TIntakeTypeFilter;

    @ApiProperty({ description: 'BBox west (минимальная долгота, WGS84).', example: 36.5 })
    @Type(() => Number)
    @IsNumber()
    @Min(BBOX_LON_MIN)
    @Max(BBOX_LON_MAX)
    west!: number;

    @ApiProperty({ description: 'BBox south (минимальная широта, WGS84).', example: 54.8 })
    @Type(() => Number)
    @IsNumber()
    @Min(BBOX_LAT_MIN)
    @Max(BBOX_LAT_MAX)
    south!: number;

    @ApiProperty({ description: 'BBox east (максимальная долгота, WGS84).', example: 39.0 })
    @Type(() => Number)
    @IsNumber()
    @Min(BBOX_LON_MIN)
    @Max(BBOX_LON_MAX)
    east!: number;

    @ApiProperty({ description: 'BBox north (максимальная широта, WGS84).', example: 56.5 })
    @Type(() => Number)
    @IsNumber()
    @Min(BBOX_LAT_MIN)
    @Max(BBOX_LAT_MAX)
    north!: number;

    @ApiPropertyOptional({
        description:
            'Шаг grid в градусах. Те же ограничения что heatmap (минимум 0.02° для PII-safety, ' +
            'хотя для drilling-feature аргумент слабее — глубина не PII per se).',
        default: GRID_DEFAULT_DEG,
        minimum: GRID_MIN_DEG,
        maximum: GRID_MAX_DEG,
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(GRID_MIN_DEG)
    @Max(GRID_MAX_DEG)
    grid?: number;
}
