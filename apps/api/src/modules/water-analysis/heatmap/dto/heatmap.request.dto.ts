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
    HEATMAP_PARAMS,
    type THeatmapParam,
} from '../../water-analysis.constants';

/**
 * Heatmap query — bbox + параметр + grid step.
 *
 * Используется для построения агрегированной тепловой карты качества воды.
 * Чтобы построить карту по 5 параметрам — клиент делает 5 параллельных запросов
 * (или один на параметр и cycle по pills). Если в будущем UX потребует «все
 * параметры одним запросом» — добавим `params=` (array) ветку с трансформацией
 * SQL под N агрегаций. Сейчас YAGNI.
 *
 * `@Type(() => Number)` обязателен для `@IsNumber()` на query params: Express
 * парсит query как строки, без transform class-validator всегда видит string
 * и валидация падает на `west=37.5` с «must be a number».
 */
export class HeatmapQueryDto {
    @ApiProperty({
        description:
            'Параметр воды для агрегации. 4 канонических (hardness_total / iron_total / manganese / tds) + ' +
            'синтетический risk (0-100, weighted % от ПДК). Whitelist — любое другое значение = 400.',
        enum: HEATMAP_PARAMS,
        example: 'iron_total',
    })
    @IsIn(HEATMAP_PARAMS)
    param!: THeatmapParam;

    @ApiProperty({
        description: 'BBox west (минимальная долгота, WGS84).',
        example: 36.5,
    })
    @Type(() => Number)
    @IsNumber()
    @Min(BBOX_LON_MIN)
    @Max(BBOX_LON_MAX)
    west!: number;

    @ApiProperty({
        description: 'BBox south (минимальная широта, WGS84).',
        example: 54.8,
    })
    @Type(() => Number)
    @IsNumber()
    @Min(BBOX_LAT_MIN)
    @Max(BBOX_LAT_MAX)
    south!: number;

    @ApiProperty({
        description: 'BBox east (максимальная долгота, WGS84).',
        example: 39.0,
    })
    @Type(() => Number)
    @IsNumber()
    @Min(BBOX_LON_MIN)
    @Max(BBOX_LON_MAX)
    east!: number;

    @ApiProperty({
        description: 'BBox north (максимальная широта, WGS84).',
        example: 56.5,
    })
    @Type(() => Number)
    @IsNumber()
    @Min(BBOX_LAT_MIN)
    @Max(BBOX_LAT_MAX)
    north!: number;

    @ApiPropertyOptional({
        description:
            'Шаг grid в градусах. Меньше — больше cells (детальнее), больше — меньше cells (overview). ' +
            '0.005° ≈ 555м, 0.05° ≈ 5.5км, 0.5° ≈ 55км. По умолчанию 0.05° (баланс детализации и кол-ва точек).',
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
