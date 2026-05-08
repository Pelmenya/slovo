import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Один interval-уровень. Используется как primary 80% (P10-P90), IQR 50% (P25-P75)
 * или hardRange 100% (observed extremes).
 */
export class ParamIntervalDto {
    @ApiProperty({ description: 'Нижняя граница диапазона (в единицах параметра).', example: 0.18 })
    lower!: number;

    @ApiProperty({ description: 'Верхняя граница.', example: 0.72 })
    upper!: number;

    @ApiProperty({
        description: 'Уровень доверия в %. 80 для primary (P10-P90), 50 для IQR, 100 для hardRange.',
        example: 80,
    })
    confidence!: number;
}

/**
 * Status относительно ПДК. Interval-aware с 4 уровнями (severity gradation):
 *
 * - `'safe'` — весь primary interval внутри норматива (upper ≤ ПДК).
 * - `'borderline'` — interval пересекает ПДК но **median ≤ ПДК**. Большинство
 *   соседей в норме, но есть выбросы выше — может или не может быть проблемой.
 *   «Возможно норма».
 * - `'concerning'` — interval пересекает ПДК и **median > ПДК**. Большинство
 *   соседей превышает норматив. Реальный анализ почти точно покажет проблему.
 *   «Скорее всего проблема».
 * - `'unsafe'` — весь interval вне норматива (lower > ПДК). 100% соседей
 *   превышают — точно нужна фильтрация.
 * - `null` — параметр не нормируется СанПиН (temperature, electrical_conductivity).
 *
 * 4 уровня вместо 3 — потому что binary borderline-vs-unsafe не различает
 * случаи когда interval [1, 70] median 50 при ПДК 20 (явная проблема) от
 * [1, 25] median 5 при ПДК 20 (скорее норма). Оба crosses, но семантически
 * разные. `concerning` — недостающее звено.
 */
export type TPdkStatus = 'safe' | 'borderline' | 'concerning' | 'unsafe';

/**
 * Прогноз одного параметра — interval-валуированный (PhD interval analysis).
 *
 * Точная цифра «iron = 0.42 мг/л» **обманывает**: в воде нондетерминированный
 * процесс, у соседних скважин может разлетаться 0.05-0.8 из-за локальной
 * геологии. Honest output — интервал, не число.
 *
 * Три уровня (от мягкого к жёсткому):
 *
 * - `interval` (primary, 80% conf) — диапазон P10..P90. Главный объект для
 *   принятия решения «нужен ли мне фильтр».
 *
 * - `iqr` (50% conf) — узкий типичный диапазон P25..P75. Полезен когда
 *   `interval` слишком широкий (соседи в разных горизонтах) — UI показать
 *   «но половина соседей всё же вот тут».
 *
 * - `hardRange` (100% conf, observed) — абсолютные min/max выборки. Worst-case
 *   для риск-оценки.
 *
 * - `pointEstimate` — distance+recency weighted mean. Просто UI marker
 *   «ожидаемо ~X», НЕ для решения.
 *
 * - `pdkStatus` — interval-aware safe/borderline/unsafe (см. TPdkStatus).
 */
export class PredictParamEstimateDto {
    @ApiProperty({
        description: 'Primary interval (80% confidence) — диапазон P10..P90. Главный для оценки.',
        type: ParamIntervalDto,
    })
    interval!: ParamIntervalDto;

    @ApiProperty({
        description: 'IQR (50% confidence) — узкий типичный диапазон P25..P75.',
        type: ParamIntervalDto,
    })
    iqr!: ParamIntervalDto;

    @ApiProperty({
        description: 'Observed hardRange (min..max выборки, 100% confidence).',
        type: ParamIntervalDto,
    })
    hardRange!: ParamIntervalDto;

    @ApiProperty({
        description:
            'Distance+recency-weighted mean. UI marker «ожидаемо ~X». Не для принимаемого решения.',
        example: 0.42,
    })
    pointEstimate!: number;

    @ApiProperty({ description: 'Сколько соседей имели этот параметр.', example: 18 })
    n!: number;

    @ApiProperty({
        description:
            'Interval-aware status относительно ПДК. 4 уровня severity: ' +
            '`safe` — весь interval ниже норматива; ' +
            '`borderline` — interval пересекает ПДК, median ≤ ПДК (возможно норма); ' +
            '`concerning` — interval пересекает ПДК, median > ПДК (скорее всего проблема); ' +
            '`unsafe` — весь interval превышает (100% соседей вне нормы). ' +
            '`null` — параметр не нормируется.',
        enum: ['safe', 'borderline', 'concerning', 'unsafe'],
        nullable: true,
        example: 'concerning',
    })
    pdkStatus!: TPdkStatus | null;
}

/**
 * Группировка paramCodes по pdkStatus — UI shortcut для рендера секций
 * без итерации по 22 параметрам. Все 5 buckets всегда возвращаются (могут быть
 * пустыми). Внутри bucket sorted: для проблем — по pointEstimate desc (сильнее
 * первыми), для safe/unmonitored — по paramCode alphabetically.
 *
 * Семантически:
 *  - `unsafe` — точно требует фильтра (100% соседей вне нормы)
 *  - `concerning` — скорее всего требует (median вне)
 *  - `borderline` — может или нет (выбросы вне, но median в норме)
 *  - `safe` — норма у соседей
 *  - `unmonitored` — не нормируется СанПиН (temperature, electrical_conductivity)
 */
export class PredictByCategoryDto {
    @ApiProperty({
        description: 'paramCodes с unsafe pdkStatus. Для UI секции «срочные проблемы» (красный).',
        example: ['nitrites', 'iron_total'],
    })
    unsafe!: string[];

    @ApiProperty({
        description: 'paramCodes с concerning pdkStatus. Для UI «вероятные проблемы» (оранжевый).',
        example: ['manganese', 'turbidity'],
    })
    concerning!: string[];

    @ApiProperty({
        description: 'paramCodes с borderline pdkStatus. Для UI «на границе» (жёлтый).',
        example: ['color', 'odor'],
    })
    borderline!: string[];

    @ApiProperty({
        description: 'paramCodes с safe pdkStatus. Для UI «всё ок» (зелёный).',
        example: ['hardness_total', 'ph'],
    })
    safe!: string[];

    @ApiProperty({
        description: 'paramCodes которые не нормируются СанПиН (temperature, electrical_conductivity). Для UI «справочно» (серый).',
        example: ['temperature', 'electrical_conductivity'],
    })
    unmonitored!: string[];
}

export class PredictResponseDto {
    @ApiProperty({
        description: 'Прогноз каждого из 22 canonical paramCode. Параметры без данных у соседей — отсутствуют.',
        type: 'object',
        additionalProperties: { $ref: '#/components/schemas/PredictParamEstimateDto' },
        example: {
            iron_total: {
                interval: { lower: 0.18, upper: 0.72, confidence: 80 },
                iqr: { lower: 0.25, upper: 0.55, confidence: 50 },
                hardRange: { lower: 0.05, upper: 1.5, confidence: 100 },
                pointEstimate: 0.42,
                n: 18,
                pdkStatus: 'concerning',
            },
        },
    })
    predicted!: Record<string, PredictParamEstimateDto>;

    @ApiProperty({
        description:
            'Группировка paramCodes из `predicted` по pdkStatus — UI shortcut для рендера секций ' +
            'без iteration по 22 параметрам. Sorted внутри: проблемы по pointEstimate desc, ' +
            'safe/unmonitored по name alphabetically.',
        type: PredictByCategoryDto,
    })
    byCategory!: PredictByCategoryDto;

    @ApiProperty({ description: 'Сколько всего соседей найдено в радиусе.', example: 18 })
    nNeighbors!: number;

    @ApiProperty({
        description:
            'Медианное расстояние до соседа в км. Маленькое = высокая уверенность. Большое = extrapolated.',
        example: 4.7,
    })
    medianDistKm!: number;

    @ApiProperty({ description: 'Использованный радиус (echo).', example: 50 })
    radiusKm!: number;

    @ApiPropertyOptional({
        description:
            'Если ≥5 соседей-скважин/колодцев имели depth — наиболее вероятный водоносный горизонт ' +
            'по медиане их глубин. Bonus drilling-фича (cross USP-1 / USP-4).',
        example: '50-100m / Песчано-известняковый',
    })
    mostLikelyAquiferLayer?: string;

    @ApiProperty({
        description: 'true если nNeighbors=0 (фронту проще branch на флаге).',
        example: false,
    })
    insufficientData!: boolean;

    @ApiProperty({ description: 'Время выполнения SQL в мс.', example: 47 })
    timeTakenMs!: number;

    @ApiProperty({ description: 'true если из Redis cache.', example: false })
    cached!: boolean;
}
