import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
// `IntervalDto` из `_shared` — единый interval-DTO для всех predict-endpoints
// (chemistry/depth). Раньше был DepthIntervalDto-дубликат, объединён 2026-05-08.
import { IntervalDto } from '../../_shared';

/**
 * Interval-валюированный прогноз глубины бурения. Главный объект для UI.
 *
 * Точная глубина бурения **физически непредсказуема** — даже у двух соседних
 * скважин в 100м friend-of-friend может быть разница 20-40м из-за карстовых
 * полостей или локальной геологии. Поэтому прогноз — **интервал**, не число.
 *
 * Три уровня интервалов (от мягкого к жёсткому):
 *
 * - `interval` (primary, 80% confidence) — диапазон в котором лежат 80% соседей
 *   (P10..P90). Это **операционная глубина** — на которую планировать смету
 *   бурения, заказывать обсадные трубы, оценивать стоимость.
 *
 * - `iqr` (interquartile, 50% confidence) — узкий «типичный» диапазон (P25..P75).
 *   Полезен когда discharge в `interval` слишком широкий (соседи в разных
 *   водоносных горизонтах) — для UI показать «но половина соседей всё-таки в этом
 *   узком диапазоне».
 *
 * - `hardRange` (observed extremes) — абсолютные min/max из выборки. Worst-case
 *   для запаса: «в крайнем случае дно может быть на ${max}м, заказывай столько
 *   обсадных труб». Не используется для планирования стоимости, только safety.
 *
 * - `pointEstimate` (median) — distance+recency-weighted middle. Не для решения
 *   «бури столько», но для UI marker «ожидаемо ~X м».
 *
 * PhD-обоснование (interval analysis): point estimate имеет нулевую вероятность
 * быть точным для нондетерминированного процесса. Interval — корректная
 * семантика прогноза. Drilling — типичный нондетерминированный кейс.
 */

export class DepthEstimateDto {
    @ApiProperty({
        description:
            'Primary interval (80% confidence) — диапазон P10..P90 в метрах. Главный объект ' +
            'для drilling-планирования (lower/upper в метрах, например 25..95).',
        type: IntervalDto,
    })
    interval!: IntervalDto;

    @ApiProperty({
        description: 'IQR (50% confidence) — узкий типичный диапазон P25..P75 (метры).',
        type: IntervalDto,
    })
    iqr!: IntervalDto;

    @ApiProperty({
        description:
            'Observed hardRange (метры) — абсолютные min/max из выборки. Worst-case safety bound. ' +
            'confidence=100 (это observed, не оценка).',
        type: IntervalDto,
    })
    hardRange!: IntervalDto;

    @ApiProperty({
        description:
            'Distance + recency-weighted median (point estimate). UI marker «ожидаемо ~X м», ' +
            'не использовать как принимаемое решение «бури ровно столько».',
        example: 47.5,
    })
    pointEstimate!: number;

    @ApiProperty({ description: 'Сколько соседей с известной depth_meters учтено.', example: 18 })
    n!: number;
}

export class AquiferLayerCountDto {
    @ApiProperty({ example: 'sandy' })
    id!: string;

    @ApiProperty({ example: '15-50m / Песчаный' })
    label!: string;

    @ApiProperty({ description: 'Сколько соседей попадают в этот горизонт.', example: 12 })
    count!: number;

    @ApiProperty({ description: '% от всех соседей с глубиной.', example: 67 })
    pct!: number;
}

export class DepthPredictResponseDto {
    @ApiProperty({
        description: 'Прогноз глубины. null если в радиусе нет соседей с известной depth_meters.',
        type: DepthEstimateDto,
        nullable: true,
    })
    predicted!: DepthEstimateDto | null;

    @ApiPropertyOptional({
        description:
            'Наиболее вероятный водоносный горизонт по медиане глубин соседей. Если соседей <3 — undefined ' +
            '(мало данных, не показываем чтобы не вводить в заблуждение).',
        example: '50-100m / Песчано-известняковый',
    })
    mostLikelyAquiferLayer?: string;

    @ApiProperty({
        description:
            'Полное распределение соседей по 5 водоносным горизонтам (всегда 5 buckets даже пустые ' +
            'для UI bar-chart consistency).',
        type: [AquiferLayerCountDto],
    })
    layerDistribution!: AquiferLayerCountDto[];

    @ApiProperty({ description: 'Сколько всего соседей найдено в радиусе (≤ запрошенный k).', example: 18 })
    nNeighbors!: number;

    @ApiProperty({
        description: 'Медианное расстояние до соседа в км. Маленькое = высокая уверенность.',
        example: 4.7,
    })
    medianDistKm!: number;

    @ApiProperty({ description: 'Echo intakeType из query.', example: 'well' })
    intakeType!: string;

    @ApiProperty({ description: 'Echo radiusKm из query.', example: 50 })
    radiusKm!: number;

    @ApiProperty({
        description: 'true если nNeighbors=0 или predicted=null (фронту проще branch на флаге).',
        example: false,
    })
    insufficientData!: boolean;

    @ApiProperty({ description: 'Время выполнения SQL в мс.', example: 47 })
    timeTakenMs!: number;

    @ApiProperty({ description: 'true если ответ из Redis cache.', example: false })
    cached!: boolean;
}
