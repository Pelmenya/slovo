import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, Max, Min } from 'class-validator';
import {
    DEPTH_PREDICT_DEFAULT_K,
    DEPTH_PREDICT_DEFAULT_RADIUS_KM,
    DEPTH_PREDICT_MAX_K,
    DEPTH_PREDICT_MAX_RADIUS_KM,
    DEPTH_PREDICT_MIN_K,
    DEPTH_PREDICT_MIN_RADIUS_KM,
} from '../../water-analysis.constants';
import { INTAKE_TYPE_FILTER_VALUES, type TIntakeTypeFilter } from '../../_shared';

/**
 * Прогноз глубины бурения для нового адреса (USP-4).
 *
 * Сценарий: бурильщик / копатель колодцев / девелопер вводит координаты участка
 * до бурения. Endpoint возвращает прогноз глубины основного водоносного
 * горизонта по соседним скважинам (kNN top-K, distance + recency weighting) +
 * mostLikelyAquiferLayer + layerDistribution.
 *
 * Это flagship USP для B2B drilling-сегмента — никто из конкурентов не имеет
 * dataset скважин с координатами + глубиной для такого прогноза.
 */
export class DepthPredictQueryDto {
    @ApiProperty({ description: 'Latitude (WGS84) участка для бурения.', example: 55.7558 })
    @Type(() => Number)
    @IsNumber()
    @IsLatitude()
    lat!: number;

    @ApiProperty({ description: 'Longitude (WGS84).', example: 37.6173 })
    @Type(() => Number)
    @IsNumber()
    @IsLongitude()
    lon!: number;

    @ApiPropertyOptional({
        description:
            'Тип источника. `well` — скважины (default, drilling). `well_dug` — копаные колодцы. ' +
            '`all` — оба типа без preference.',
        enum: INTAKE_TYPE_FILTER_VALUES,
        default: 'well',
    })
    @IsOptional()
    @IsIn(INTAKE_TYPE_FILTER_VALUES)
    intakeType?: TIntakeTypeFilter;

    @ApiPropertyOptional({
        description: 'Кол-во ближайших соседей. Меньше → больше шум. Больше → захватываются другие горизонты.',
        default: DEPTH_PREDICT_DEFAULT_K,
        minimum: DEPTH_PREDICT_MIN_K,
        maximum: DEPTH_PREDICT_MAX_K,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(DEPTH_PREDICT_MIN_K)
    @Max(DEPTH_PREDICT_MAX_K)
    k?: number;

    @ApiPropertyOptional({
        description: 'Радиус поиска в км. Hard cutoff. Если в радиусе нет соседей-скважин — insufficientData.',
        default: DEPTH_PREDICT_DEFAULT_RADIUS_KM,
        minimum: DEPTH_PREDICT_MIN_RADIUS_KM,
        maximum: DEPTH_PREDICT_MAX_RADIUS_KM,
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(DEPTH_PREDICT_MIN_RADIUS_KM)
    @Max(DEPTH_PREDICT_MAX_RADIUS_KM)
    radiusKm?: number;
}
