import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, Max, Min } from 'class-validator';
import {
    EQUIPMENT_SUGGEST_DEFAULT_TOP_K,
    EQUIPMENT_SUGGEST_MAX_TOP_K,
    EQUIPMENT_SUGGEST_MIN_TOP_K,
} from '../../water-analysis.constants';

/**
 * Запрос «подбери фильтр по адресу» (USP-2 flagship cross-domain).
 *
 * Сценарий: клиент вводит координаты адреса → endpoint сам прогнозирует химию
 * по соседним анализам → identify problems > ПДК → search Аквафор-каталог по
 * проблемам → возвращает top-N рекомендованных фильтров с обоснованием.
 *
 * Это **главный продающий аргумент** для разговора с руководителем Аквафор:
 * сквозная связка вода→каталог в одном API call. Никто из конкурентов /
 * магазинов фильтров не имеет dataset чтобы давать такую рекомендацию без
 * собственного анализа клиента.
 */
export class EquipmentSuggestRequestDto {
    @ApiProperty({ description: 'Latitude (WGS84) адреса клиента.', example: 55.7558 })
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
            'Сколько товаров вернуть. Default 5 — обычно достаточно для основного wow-эффекта; при выборе ' +
            'клиент tap\'нет 1-2 для деталей. Max 20 — ограничение чтобы не перегружать catalog vector search.',
        default: EQUIPMENT_SUGGEST_DEFAULT_TOP_K,
        minimum: EQUIPMENT_SUGGEST_MIN_TOP_K,
        maximum: EQUIPMENT_SUGGEST_MAX_TOP_K,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(EQUIPMENT_SUGGEST_MIN_TOP_K)
    @Max(EQUIPMENT_SUGGEST_MAX_TOP_K)
    topK?: number;
}
