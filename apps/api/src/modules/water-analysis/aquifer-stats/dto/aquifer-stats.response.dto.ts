import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AquiferLayerStatsDto {
    @ApiProperty({
        description: 'id водоносного горизонта (top_water/sandy/sandy_limestone/limestone/artesian).',
        example: 'sandy_limestone',
    })
    id!: string;

    @ApiProperty({ description: 'UI label с диапазоном глубин.', example: '50-100m / Песчано-известняковый' })
    label!: string;

    @ApiProperty({ description: 'Минимум диапазона горизонта (м).', example: 50 })
    minDepth!: number;

    @ApiProperty({
        description: 'Максимум диапазона горизонта (м). Infinity для последнего слоя artesian (200m+) — приходит как null в JSON.',
        example: 100,
        nullable: true,
    })
    maxDepth!: number | null;

    @ApiProperty({ description: 'Сколько wells/well_dug в bbox попадают в этот горизонт.', example: 245 })
    count!: number;

    @ApiProperty({ description: '% от total wells в bbox. Округлено до целого.', example: 32 })
    pct!: number;

    @ApiPropertyOptional({
        description:
            'Медианная глубина бурения скважин в этом горизонте (м). undefined если count=0.',
        example: 72.5,
    })
    medianDepth?: number;

    @ApiPropertyOptional({
        description:
            'Доля скважин типа well в горизонте (%). Остальные — well_dug. undefined если count=0.',
        example: 95,
    })
    pctWell?: number;

    @ApiProperty({
        description:
            'Типичная химия для этого горизонта — median по каждому из canonical 22 paramCode. ' +
            'Параметры которые не было ни у одной скважины в этом bucket — отсутствуют. ' +
            'Это **типичная вода на этой глубине в данном районе**: бурильщик решает целевой ' +
            'горизонт по этим цифрам.',
        example: { iron_total: 0.42, hardness_total: 7.8, manganese: 0.05, tds: 386, ph: 7.2 },
    })
    medianChemistry!: Record<string, number>;
}

export class AquiferStatsResponseDto {
    @ApiProperty({
        description:
            'Стратифицированная статистика по 5 горизонтам в bbox. **Всегда 5 buckets** даже пустые ' +
            '(count=0) — UI рисует table/bar-chart с консистентным layout.',
        type: [AquiferLayerStatsDto],
    })
    layers!: AquiferLayerStatsDto[];

    @ApiProperty({ description: 'Echo intakeType filter из query.', example: 'all' })
    intakeType!: string;

    @ApiProperty({ description: 'Total wells/well_dug найдено в bbox (с известным depth_meters).', example: 763 })
    totalWells!: number;

    @ApiProperty({
        description:
            'Кол-во скважин использованных для chemistry agreggation. ≤ totalWells (limit AQUIFER_STATS_SAMPLE_LIMIT). ' +
            'Если samplesUsed < totalWells — ORDER BY sample_date DESC применён, свежие важнее.',
        example: 763,
    })
    samplesUsed!: number;

    @ApiProperty({
        description: 'id горизонта с максимальным count (наиболее представленный в bbox). null если total=0.',
        example: 'sandy_limestone',
        nullable: true,
    })
    dominantLayerId!: string | null;

    @ApiProperty({ description: 'Время выполнения SQL+aggregation в мс.', example: 187 })
    timeTakenMs!: number;

    @ApiProperty({ description: 'true если из Redis cache.', example: false })
    cached!: boolean;
}
