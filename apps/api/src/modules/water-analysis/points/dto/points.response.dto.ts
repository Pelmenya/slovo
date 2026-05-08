import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Properties одного point-feature. Содержит все 22 параметра + risk + meta.
 *
 * `params` — Record<string, number>: ключи canonical paramCodes, значения
 * в канонических единицах. Параметры которых не было в анализе — отсутствуют.
 *
 * Risk score (0-100) рассчитан на лету по той же формуле что в /heatmap.
 *
 * Координаты обезличены до 0.005° (~500м) при rounding в service. См. memory
 * `feedback_water_heatmap_pii_strategy` — для отдельных точек защита через
 * round, для агрегатов — через минимальный grid.
 */
export class PointPropertiesDto {
    @ApiProperty({
        description: 'order_number из исходного бланка анализа. Стабильный id для UI «открыть детали».',
        example: 'A-12345',
    })
    orderNumber!: string;

    @ApiProperty({
        description: 'Тип источника воды (well/well_dug/municipal/spring/other).',
        example: 'well',
    })
    intakeType!: string;

    @ApiProperty({ description: 'Глубина в м (только для well/well_dug). null если нет данных.', nullable: true, example: 45 })
    depthMeters!: number | null;

    @ApiProperty({ description: 'Дата отбора пробы (ISO).', example: '2024-06-15' })
    sampleDate!: string;

    @ApiProperty({ description: 'Регион из geocoding (Ahunter).', nullable: true, example: 'Московская область' })
    region!: string | null;

    @ApiProperty({ description: 'Локалити (город/посёлок).', nullable: true, example: 'Раменское' })
    locality!: string | null;

    @ApiProperty({
        description:
            'Канонические paramCodes → значения в их единицах. Параметры без замеров — отсутствуют. ' +
            'Доступные коды: hardness_total, iron_total, manganese, tds, ammonium, nitrates, ph, ' +
            'turbidity, color, odor, sulfates, sulfides, chlorides, fluorides, hydrogen_sulfide, ' +
            'permanganate_oxidizability, magnesium, calcium, alkalinity_total, temperature, electrical_conductivity, nitrites.',
        example: { iron_total: 0.42, hardness_total: 7.8, ph: 7.2, manganese: 0.05 },
    })
    params!: Record<string, number>;

    @ApiPropertyOptional({
        description:
            'Synthetic risk score 0-100 (weighted % от ПДК по 4 ключевым параметрам). null если ' +
            'недостаточно данных (нет ни одного из hardness/iron/manganese/tds).',
        example: 67,
        nullable: true,
    })
    risk!: number | null;
}

export class PointGeometryDto {
    @ApiProperty({ enum: ['Point'], example: 'Point' })
    type!: 'Point';

    @ApiProperty({
        description: '[lon, lat] в WGS84, обезличены до 0.005° (~500м, k-anonymity).',
        example: [37.625, 55.755],
    })
    coordinates!: [number, number];
}

export class PointFeatureDto {
    @ApiProperty({ enum: ['Feature'], example: 'Feature' })
    type!: 'Feature';

    @ApiProperty({ type: PointGeometryDto })
    geometry!: PointGeometryDto;

    @ApiProperty({ type: PointPropertiesDto })
    properties!: PointPropertiesDto;
}

export class PointsResponseDto {
    @ApiProperty({ enum: ['FeatureCollection'], example: 'FeatureCollection' })
    type!: 'FeatureCollection';

    @ApiProperty({ type: [PointFeatureDto] })
    features!: PointFeatureDto[];

    @ApiProperty({ description: 'Сколько точек в response (≤ запрошенный limit).', example: 178 })
    count!: number;

    @ApiProperty({
        description:
            '`true` если в БД больше точек в bbox чем limit (response truncated). UI может показать ' +
            '«увеличь zoom для детализации» или fetch следующую порцию.',
        example: false,
    })
    truncated!: boolean;

    @ApiProperty({ description: 'Использованный limit (echo).', example: 200 })
    limit!: number;

    @ApiProperty({ description: 'Время выполнения SQL в мс.', example: 34 })
    timeTakenMs!: number;

    @ApiProperty({ description: 'true если из Redis cache.', example: false })
    cached!: boolean;
}
