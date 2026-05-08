import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Per-param breakdown в cell — что вернётся для каждого регулируемого
 * paramа который реально измерялся в этой cell.
 *
 * Sort order на фронте: `topProblems` (exceedsPct desc) → клиент видит
 * самые серьёзные проблемы первыми.
 */
export class ParamBreakdownDto {
    @ApiProperty({ description: 'Canonical paramCode (СанПиН).', example: 'iron_total' })
    paramCode!: string;

    @ApiProperty({ description: 'Русское название (UI label).', example: 'Железо (общее)' })
    nameRu!: string;

    @ApiProperty({ description: 'Единица измерения для UI.', example: 'мг/л' })
    unit!: string;

    @ApiProperty({
        description:
            'ПДК. Для большинства params — число (single). Для pH — объект `{ min, max }`. ' +
            'Для popup UI: «при ПДК 0.3 max 1.5».',
        example: 0.3,
    })
    pdk!: number | { min: number; max: number };

    @ApiProperty({ description: 'Сколько rows в cell имели измерение этого param.', example: 14 })
    n!: number;

    @ApiProperty({
        description: 'Сколько rows превышают ПДК (для UI «6 из 14 анализов»).',
        example: 6,
    })
    exceedsCount!: number;

    @ApiProperty({
        description: '% rows с превышением. Используется для sort topProblems.',
        example: 43,
    })
    exceedsPct!: number;

    @ApiProperty({
        description: 'Максимальное измеренное значение в cell. UI показывает «max 1.5».',
        example: 1.5,
    })
    max!: number;

    @ApiProperty({
        description: 'Медианное значение в cell (P50). UI показывает «обычно ~0.42».',
        example: 0.42,
    })
    median!: number;
}

/**
 * Response `/water-analysis/heatmap/cell` — детали одной cell.
 *
 * UI популяет popup при тапе на cell:
 *   - Header: «Раменское · 14 анализов, 8 с превышениями»
 *   - Top problems list: топ 5 проблемных params с цветами severity
 *   - Footer: «В норме: 12 параметров» + кнопка-ссылка «Подобрать оборудование»
 */
export class CellDetailResponseDto {
    @ApiProperty({
        description:
            'Топ N самых проблемных params в cell (sort by exceedsPct desc). ' +
            'Если в cell нет ни одного превышения — пустой массив.',
        type: [ParamBreakdownDto],
    })
    topProblems!: ParamBreakdownDto[];

    @ApiProperty({
        description:
            'paramCode параметров которые в cell measured но не превышают ПДК. UI показывает ' +
            'compact «В норме: pH, жёсткость, мутность, цвет [+8 параметров]».',
        type: [String],
        example: ['ph', 'hardness_total', 'turbidity'],
    })
    inNormParams!: string[];

    @ApiProperty({
        description: 'Сколько всего анализов попало в cell bbox.',
        example: 14,
    })
    nTotal!: number;

    @ApiProperty({
        description: 'Сколько анализов имели превышение хотя бы одного регулируемого param.',
        example: 8,
    })
    nWithExceedance!: number;

    @ApiPropertyOptional({
        description: 'Минимальная дата отбора пробы в cell (ISO date). Для UI «с 2020 года».',
        example: '2020-03-15',
        nullable: true,
    })
    earliestSampleDate?: string | null;

    @ApiPropertyOptional({
        description: 'Максимальная дата отбора пробы в cell.',
        example: '2026-04-29',
        nullable: true,
    })
    latestSampleDate?: string | null;

    @ApiProperty({ description: 'Echo центра cell — lat.', example: 55.755 })
    cellLat!: number;

    @ApiProperty({ description: 'Echo центра cell — lon.', example: 37.625 })
    cellLon!: number;

    @ApiProperty({ description: 'Echo grid (степ).', example: 0.05 })
    grid!: number;

    @ApiProperty({ description: 'Время выполнения SQL+aggregation в мс.', example: 47 })
    timeTakenMs!: number;

    @ApiProperty({ description: 'true если из Redis cache.', example: false })
    cached!: boolean;
}
