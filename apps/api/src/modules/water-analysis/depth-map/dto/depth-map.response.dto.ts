import { ApiProperty } from '@nestjs/swagger';

export class AquiferLayerCountDto {
    @ApiProperty({
        description: 'Стабильный id водоносного горизонта (top_water/sandy/sandy_limestone/limestone/artesian).',
        example: 'sandy',
    })
    id!: string;

    @ApiProperty({
        description: 'UI label с диапазоном глубин и русским названием.',
        example: '15-50m / Песчаный',
    })
    label!: string;

    @ApiProperty({
        description: 'Сколько скважин/колодцев в ячейке попадают в этот горизонт.',
        example: 12,
    })
    count!: number;

    @ApiProperty({
        description: '% от всех скважин в ячейке. Округлено до целого. Полезно для UI bar-chart высоты.',
        example: 52,
    })
    pct!: number;
}

export class DepthMapCellPropertiesDto {
    @ApiProperty({ description: 'Сколько скважин/колодцев агрегировано в ячейке.', example: 23 })
    count!: number;

    @ApiProperty({
        description: 'Медианная глубина бурения в ячейке (м). Главное число для UI.',
        example: 47.5,
    })
    median!: number;

    @ApiProperty({
        description: '25-й перцентиль (м). «Минимум четверть скважин в ячейке мельче этого».',
        example: 32.0,
    })
    p25!: number;

    @ApiProperty({
        description: '75-й перцентиль (м). «Минимум четверть скважин в ячейке глубже этого».',
        example: 71.0,
    })
    p75!: number;

    @ApiProperty({
        description: 'Минимальная глубина в ячейке (м).',
        example: 12,
    })
    minDepth!: number;

    @ApiProperty({
        description: 'Максимальная глубина в ячейке (м).',
        example: 145,
    })
    maxDepth!: number;

    @ApiProperty({
        description:
            'Распределение скважин по водоносным горизонтам. 5 buckets всегда — даже пустые (count=0) ' +
            'возвращаются для UI bar-chart consistency.',
        type: [AquiferLayerCountDto],
    })
    aquiferLayers!: AquiferLayerCountDto[];

    @ApiProperty({
        description:
            'id наиболее представленного водоносного горизонта в ячейке. Для UI — основной color/label.',
        example: 'sandy',
    })
    dominantLayerId!: string;

    @ApiProperty({
        description: 'Доля скважин типа `well` в ячейке (%). Остальные — well_dug.',
        example: 87,
    })
    pctWell!: number;
}

export class DepthMapPointGeometryDto {
    @ApiProperty({ enum: ['Point'], example: 'Point' })
    type!: 'Point';

    @ApiProperty({ example: [37.625, 55.755] })
    coordinates!: [number, number];
}

export class DepthMapFeatureDto {
    @ApiProperty({ enum: ['Feature'], example: 'Feature' })
    type!: 'Feature';

    @ApiProperty({ type: DepthMapPointGeometryDto })
    geometry!: DepthMapPointGeometryDto;

    @ApiProperty({ type: DepthMapCellPropertiesDto })
    properties!: DepthMapCellPropertiesDto;
}

export class DepthMapResponseDto {
    @ApiProperty({ enum: ['FeatureCollection'], example: 'FeatureCollection' })
    type!: 'FeatureCollection';

    @ApiProperty({ type: [DepthMapFeatureDto] })
    features!: DepthMapFeatureDto[];

    @ApiProperty({ example: 'all', enum: ['all', 'well', 'well_dug'] })
    intakeType!: string;

    @ApiProperty({ description: 'Использованный grid step в градусах.', example: 0.05 })
    grid!: number;

    @ApiProperty({ description: 'Время выполнения SQL в мс.', example: 92 })
    timeTakenMs!: number;

    @ApiProperty({ description: 'true если ответ из Redis cache.', example: false })
    cached!: boolean;
}
