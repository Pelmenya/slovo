import { ApiProperty } from '@nestjs/swagger';

/**
 * Один interval-уровень — generic для всех predict-endpoints (chemistry,
 * depth, любая non-deterministic величина).
 *
 * Используется как primary 80% (P10-P90), IQR 50% (P25-P75) или hardRange
 * 100% (observed extremes). Каждый endpoint указывает свой example на
 * field-level @ApiProperty (через examples). Тут — generic shape.
 *
 * PhD-обоснование (interval analysis): point estimate имеет нулевую
 * вероятность быть точным для нондетерминированного процесса. Interval —
 * корректная семантика прогноза (memory `feedback_interval_first_predictions`).
 *
 * Раньше были два дубликата: ParamIntervalDto (predict) и DepthIntervalDto
 * (depth-predict) — идентичные shape, разные examples. Объединено в
 * security-fix 2026-05-08 (nestjs-code-reviewer recommendation).
 */
export class IntervalDto {
    @ApiProperty({ description: 'Нижняя граница диапазона.', example: 0.18 })
    lower!: number;

    @ApiProperty({ description: 'Верхняя граница диапазона.', example: 0.72 })
    upper!: number;

    @ApiProperty({
        description:
            'Уровень доверия в %. 80 для primary interval (P10-P90), 50 для IQR ' +
            '(P25-P75), 100 для hardRange (observed min/max).',
        example: 80,
    })
    confidence!: number;
}
