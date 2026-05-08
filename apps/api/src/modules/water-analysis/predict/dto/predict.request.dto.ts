import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, Max, Min } from 'class-validator';
import {
    PREDICT_DEFAULT_K,
    PREDICT_DEFAULT_RADIUS_KM,
    PREDICT_MAX_K,
    PREDICT_MAX_RADIUS_KM,
    PREDICT_MIN_K,
    PREDICT_MIN_RADIUS_KM,
} from '../../water-analysis.constants';

/**
 * Запрос «спрогнозируй воду по адресу» (USP-1).
 *
 * Сценарий: клиент вводит свои координаты (через адрес → geocoding на фронте)
 * до того как сделать анализ воды. Endpoint возвращает прогноз 22 параметров +
 * confidence interval (P10/P90 percentile) на основе ближайших соседей в
 * 6-летнем архиве.
 *
 * Это flagship USP-фича PROSTOR: никто из конкурентов / магазинов фильтров
 * не имеет dataset чтобы давать такой прогноз. Демо-аргумент для разговора с
 * руководителем Аквафор: «увидь воду у соседей за 5 секунд, без анализа».
 */
export class PredictQueryDto {
    @ApiProperty({
        description: 'Latitude (WGS84). Координаты адреса клиента.',
        example: 55.7558,
    })
    @Type(() => Number)
    @IsNumber()
    @IsLatitude()
    lat!: number;

    @ApiProperty({
        description: 'Longitude (WGS84).',
        example: 37.6173,
    })
    @Type(() => Number)
    @IsNumber()
    @IsLongitude()
    lon!: number;

    @ApiPropertyOptional({
        description:
            'Кол-во ближайших соседей для усреднения. Меньше — больше шум на percentile interval, ' +
            'больше — захватываются точки в других водоносных горизонтах. ' +
            `Default ${PREDICT_DEFAULT_K} — баланс stability и locality.`,
        default: PREDICT_DEFAULT_K,
        minimum: PREDICT_MIN_K,
        maximum: PREDICT_MAX_K,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(PREDICT_MIN_K)
    @Max(PREDICT_MAX_K)
    k?: number;

    @ApiPropertyOptional({
        description:
            'Радиус поиска в км. Hard cutoff — за пределами этого радиуса точки не учитываются ' +
            'даже если их меньше k. Если в радиусе нет анализов — response возвращает n=0 без ' +
            'прогноза (фронт показывает «недостаточно данных по адресу»).',
        default: PREDICT_DEFAULT_RADIUS_KM,
        minimum: PREDICT_MIN_RADIUS_KM,
        maximum: PREDICT_MAX_RADIUS_KM,
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(PREDICT_MIN_RADIUS_KM)
    @Max(PREDICT_MAX_RADIUS_KM)
    radiusKm?: number;
}
