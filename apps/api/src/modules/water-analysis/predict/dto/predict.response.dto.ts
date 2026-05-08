import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Прогноз одного параметра. Distance + recency-weighted average + percentile
 * interval P10/P90 (диапазон в котором лежат 80% соседних значений).
 *
 * Почему percentile, а не stderr:
 *   - не assumes normality (в реальных данных воды heavy-tailed: outliers с
 *     забором из колодца с локальным загрязнением → median нормальная, но
 *     stderr задирается)
 *   - интуитивно понятно UI: «у 80% соседей значение в этом диапазоне»
 *   - PhD-фундамент interval analysis разработчика — interval estimate сильнее
 *     чем point estimate для nondeterministic processes
 */
export class PredictParamEstimateDto {
    @ApiProperty({
        description:
            'Distance + recency-weighted average. Главное число для UI: «по соседям ожидаемо ~X».',
        example: 0.42,
    })
    value!: number;

    @ApiProperty({
        description: 'P10 percentile из ближайших соседей (нижняя граница 80% interval).',
        example: 0.18,
    })
    ciLow!: number;

    @ApiProperty({
        description: 'P90 percentile (верхняя граница 80% interval).',
        example: 0.72,
    })
    ciHigh!: number;

    @ApiProperty({
        description: 'Сколько ближайших соседей имели значение этого параметра в анализе. ≤ запрошенный k.',
        example: 18,
    })
    n!: number;

    @ApiProperty({
        description: 'Превышает ли value ПДК (для UI цветовой индикации). null если параметр не нормируется.',
        example: true,
        nullable: true,
    })
    exceedsPdk!: boolean | null;
}

export class PredictResponseDto {
    @ApiProperty({
        description:
            'Прогноз каждого из 22 canonical paramCode. Параметры которых не было ни у одного соседа — отсутствуют в response.',
        type: 'object',
        additionalProperties: { $ref: '#/components/schemas/PredictParamEstimateDto' },
        example: {
            iron_total: { value: 0.42, ciLow: 0.18, ciHigh: 0.72, n: 18, exceedsPdk: true },
            hardness_total: { value: 7.8, ciLow: 4.2, ciHigh: 11.5, n: 17, exceedsPdk: true },
        },
    })
    predicted!: Record<string, PredictParamEstimateDto>;

    @ApiProperty({
        description: 'Сколько всего соседей найдено в радиусе (≤ запрошенный k).',
        example: 18,
    })
    nNeighbors!: number;

    @ApiProperty({
        description:
            'Медианное расстояние до соседа в км. Маленькое = высокая уверенность (соседи близко). ' +
            'Большое = прогноз extrapolated, доверять с осторожностью.',
        example: 4.7,
    })
    medianDistKm!: number;

    @ApiProperty({
        description: 'Использованный радиус (echo из query для логирования / debug).',
        example: 50,
    })
    radiusKm!: number;

    @ApiPropertyOptional({
        description:
            'Если ≥3 соседей-скважин/колодцев имели depth — наиболее вероятный водоносный горизонт. ' +
            'Bonus drilling-фича совмещённая с predict: «по соседям ожидаешь воду на 30-50м». ' +
            'Если данных по depth недостаточно — undefined.',
        example: '50-100m / Песчано-известняковый',
    })
    mostLikelyAquiferLayer?: string;

    @ApiProperty({
        description:
            '`true` если в радиусе НЕ нашлось ни одного соседа (predicted = {}, nNeighbors = 0). ' +
            'Фронту проще branch на этом флаге чем на пустом predicted объекте.',
        example: false,
    })
    insufficientData!: boolean;

    @ApiProperty({
        description: 'Время выполнения SQL в мс (без overhead кеша / TS aggregation).',
        example: 47,
    })
    timeTakenMs!: number;

    @ApiProperty({
        description: 'true если ответ из Redis cache.',
        example: false,
    })
    cached!: boolean;
}
