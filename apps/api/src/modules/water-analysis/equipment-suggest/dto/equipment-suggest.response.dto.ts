import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Идентифицированная проблема воды по конкретному параметру.
 *
 * Severity (4 уровня, см. TPdkStatus в /predict):
 * - `unsafe` — весь interval превышает ПДК (100% соседей вне нормы, точно проблема)
 * - `concerning` — interval crosses ПДК, **median > ПДК** (большинство соседей превышают)
 * - `borderline` — interval crosses ПДК, median ≤ ПДК (большинство в норме, выбросы выше)
 *
 * `safe` параметры в response.problems не попадают (нечего рекомендовать).
 */
export class WaterProblemDto {
    @ApiProperty({ description: 'Canonical paramCode (iron_total/manganese/...).', example: 'iron_total' })
    paramCode!: string;

    @ApiProperty({
        description:
            'Severity проблемы. unsafe (100% соседей вне нормы) → concerning (median вне) → ' +
            'borderline (median в норме, есть выбросы). См. TPdkStatus в /predict.',
        enum: ['borderline', 'concerning', 'unsafe'],
        example: 'concerning',
    })
    severity!: 'borderline' | 'concerning' | 'unsafe';

    @ApiProperty({ description: 'Primary interval (P10-P90) — ожидаемый диапазон.', example: { lower: 0.5, upper: 1.5 } })
    interval!: { lower: number; upper: number };

    @ApiProperty({ description: 'ПДК этого параметра по СанПиН (для context UI).', example: 0.3 })
    pdk!: number | { min: number; max: number };

    @ApiProperty({ description: 'Сколько соседей подтверждает проблему (n).', example: 17 })
    n!: number;
}

export class EquipmentRecommendationDto {
    @ApiProperty({ description: 'ID товара в каталоге (orderNumber).', example: 'OZ-15' })
    sku!: string;

    @ApiProperty({ description: 'Название товара.', example: 'Обезжелезиватель Аквафор ОС-15' })
    name!: string;

    @ApiProperty({ description: 'Vector-search relevance score (0-1).', example: 0.84 })
    relevance!: number;

    @ApiProperty({
        description: 'Vision-augmented описание из каталога — фрагмент matched chunk.',
        example: 'Колонна для удаления растворённого железа методом каталитического окисления...',
    })
    description!: string;

    @ApiProperty({
        description:
            'Канонический paramCode проблемы для которой матчили этот товар (через PROBLEM_TO_QUERY ' +
            'mapping). UI использует для группировки рекомендаций и highlight связи problem → product.',
        example: 'iron_total',
    })
    matchedProblem!: string;

    @ApiProperty({
        description:
            'Human-readable объяснение «почему этот товар» — UI показывает под названием. ' +
            'Различается по severity matched problem.',
        example: 'Решает явное превышение «Железо (Fe, суммарно)»',
    })
    reason!: string;

    @ApiPropertyOptional({
        description: 'URL изображения (presigned S3) — если есть в metadata. UI рендерит preview.',
    })
    imageUrl?: string;
}

export class EquipmentSuggestResponseDto {
    @ApiProperty({
        description:
            'Список идентифицированных проблем воды по соседним анализам. Только `borderline` + ' +
            '`unsafe` (safe не возвращаем — нечего рекомендовать). Пустой массив = нет проблем по ' +
            'соседям, и `recommendations` тоже пустой.',
        type: [WaterProblemDto],
    })
    problems!: WaterProblemDto[];

    @ApiProperty({
        description: 'Список рекомендованного оборудования из Аквафор-каталога (vector search по problem-driven query).',
        type: [EquipmentRecommendationDto],
    })
    recommendations!: EquipmentRecommendationDto[];

    @ApiProperty({
        description:
            'Natural-language query который служил для catalog vector search. Возвращается для transparency / debug.',
        example: 'Подобрать оборудование для воды с превышением железа (0.5-1.5 мг/л) и марганца на границе нормы.',
    })
    searchQuery!: string;

    @ApiProperty({
        description:
            'Сколько соседей было использовано для kNN-прогноза химии. Маленькое число = низкая уверенность.',
        example: 18,
    })
    nNeighbors!: number;

    @ApiProperty({ description: 'Медианное расстояние до соседа в км (echo из /predict).', example: 4.7 })
    medianDistKm!: number;

    @ApiProperty({
        description: 'true если в радиусе нет соседей с анализом (predict insufficient data).',
        example: false,
    })
    insufficientData!: boolean;

    @ApiProperty({ description: 'Время выполнения (predict + catalog search).', example: 187 })
    timeTakenMs!: number;

    @ApiProperty({ description: 'true если из Redis cache.', example: false })
    cached!: boolean;
}
