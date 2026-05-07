import { ApiProperty } from '@nestjs/swagger';

/** Один похожий анализ из топ-K результатов. */
export class SimilarBlankDto {
    @ApiProperty({
        description: 'Номер бланка в датасете Аквафор (источник правды для JOIN на полный анализ при необходимости).',
        example: '14938',
    })
    orderNumber!: string;

    @ApiProperty({
        description: 'Тип источника воды.',
        example: 'well',
    })
    intakeType!: string;

    @ApiProperty({
        description: 'Глубина источника в метрах. NULL для централизованного водопровода.',
        example: 50,
        nullable: true,
    })
    depthMeters!: number | null;

    @ApiProperty({
        description: 'Регион (от Ahunter geocoding).',
        example: 'Московская',
        nullable: true,
    })
    region!: string | null;

    @ApiProperty({
        description: 'Город / посёлок.',
        example: 'Раменское',
        nullable: true,
    })
    locality!: string | null;

    @ApiProperty({
        description:
            'Latitude (округлено до ~500 м для PII-mitigation на public endpoint). ' +
            'Точные координаты Ahunter geocoding указывают на конкретное домохозяйство — ' +
            'грубое округление до 0.005° даёт деревню/коттеджный посёлок без идентификации частной скважины.',
        example: 55.625,
        nullable: true,
    })
    lat!: number | null;

    @ApiProperty({
        description:
            'Longitude (округлено до ~500 м для PII-mitigation, см. lat).',
        example: 38.17,
        nullable: true,
    })
    lon!: number | null;

    @ApiProperty({
        description: 'Natural language description (тот же текст по которому строилось embedding). Удобно для UI вывода без отдельного fetch на water_analysis row.',
    })
    pageContent!: string;
}

export class SimilarSearchResponseDto {
    @ApiProperty({
        description: 'Время на vector query (Flowise round-trip + OpenAI embed + pgvector cosine), миллисекунды.',
        example: 620,
    })
    timeTakenMs!: number;

    @ApiProperty({
        description: 'Количество найденных похожих анализов.',
        example: 10,
    })
    count!: number;

    @ApiProperty({
        description: 'Топ-K похожих анализов в порядке близости (от самого похожего).',
        type: [SimilarBlankDto],
    })
    blanks!: SimilarBlankDto[];
}
