import { ApiProperty } from '@nestjs/swagger';

/**
 * Статус ячейки относительно ПДК. Считается по `median` (более устойчиво к
 * outliers чем mean — у нас в данных встречаются «сорванные» точки с
 * extreme values из-за лабораторной ошибки):
 *  - `good` — median ≤ 100% ПДК
 *  - `mid`  — median 100-200% ПДК (на границе / умеренное превышение)
 *  - `bad`  — median > 200% ПДК (явное превышение)
 *
 * Для `risk` (synthetic 0-100) пороги другие (50 / 80) — обработано в service.
 */
export type THeatmapStatus = 'good' | 'mid' | 'bad';

export class HeatmapCellPropertiesDto {
    @ApiProperty({
        description: 'Канонический paramCode параметра, по которому рассчитан cell.',
        example: 'iron_total',
    })
    param!: string;

    @ApiProperty({
        description: 'Сколько анализов агрегировано в ячейке. Обычно ≥1, но мы фильтруем пустые ячейки на SQL-уровне.',
        example: 23,
    })
    count!: number;

    @ApiProperty({
        description: 'Среднее значение параметра в ячейке. Подвержено outliers — для UI лучше `median`.',
        example: 0.42,
    })
    mean!: number;

    @ApiProperty({
        description:
            'Медиана. Основная metric для UI: устойчива к экстремальным значениям. Diverging-цвет heatmap — по медиане.',
        example: 0.31,
    })
    median!: number;

    @ApiProperty({
        description: '75-й перцентиль. Показывает «верхняя четверть домохозяйств в ячейке имеет значение ≥ X».',
        example: 0.65,
    })
    p75!: number;

    @ApiProperty({
        description: 'Сколько анализов в ячейке превышают ПДК. Для risk — превышают 50 (синтетический threshold).',
        example: 12,
    })
    exceedsCount!: number;

    @ApiProperty({
        description: '% анализов, превышающих ПДК (exceedsCount / count × 100, округлённо до целого).',
        example: 52,
    })
    exceedsPct!: number;

    @ApiProperty({
        description: 'Статус ячейки по медиане относительно ПДК (для diverging-цветовой шкалы UI).',
        enum: ['good', 'mid', 'bad'],
        example: 'mid',
    })
    status!: THeatmapStatus;
}

export class HeatmapPointGeometryDto {
    @ApiProperty({ enum: ['Point'], example: 'Point' })
    type!: 'Point';

    @ApiProperty({
        description: '[lon, lat] центра ячейки в WGS84 (округлённого до grid).',
        example: [37.625, 55.755],
    })
    coordinates!: [number, number];
}

export class HeatmapFeatureDto {
    @ApiProperty({ enum: ['Feature'], example: 'Feature' })
    type!: 'Feature';

    @ApiProperty({ type: HeatmapPointGeometryDto })
    geometry!: HeatmapPointGeometryDto;

    @ApiProperty({ type: HeatmapCellPropertiesDto })
    properties!: HeatmapCellPropertiesDto;
}

/**
 * Стандартный GeoJSON FeatureCollection. maplibre-gl нативно понимает этот
 * формат как source — фронту не нужно ремапить.
 */
export class HeatmapResponseDto {
    @ApiProperty({ enum: ['FeatureCollection'], example: 'FeatureCollection' })
    type!: 'FeatureCollection';

    @ApiProperty({
        description: 'Список cells. Пустой массив = в bbox нет анализов с заданным param (не ошибка).',
        type: [HeatmapFeatureDto],
    })
    features!: HeatmapFeatureDto[];

    @ApiProperty({
        description: 'Канонический paramCode (повтор из запроса для удобства фронта при batch-load 5 параметров).',
        example: 'iron_total',
    })
    param!: string;

    @ApiProperty({
        description: 'ПДК этого параметра (мг/л / мг-экв/л / 0-100 для risk). Используется фронтом для diverging scale.',
        example: 0.3,
    })
    pdk!: number;

    @ApiProperty({
        description: 'Использованный grid step в градусах (echo из query для логирования / debug).',
        example: 0.05,
    })
    grid!: number;

    @ApiProperty({
        description: 'Время выполнения SQL-запроса в мс (без overhead кеша/сериализации). Для performance мониторинга.',
        example: 87,
    })
    timeTakenMs!: number;

    @ApiProperty({
        description: 'true если ответ из Redis cache (для observability — частота cache hit).',
        example: false,
    })
    cached!: boolean;
}
