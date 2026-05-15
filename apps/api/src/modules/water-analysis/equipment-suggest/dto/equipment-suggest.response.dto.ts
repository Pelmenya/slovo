import { ApiProperty } from '@nestjs/swagger';
import { IntervalDto } from '../../_shared';

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

    @ApiProperty({
        description:
            'Primary interval (P10-P90, 80% confidence) — ожидаемый диапазон параметра у соседей. ' +
            'lower/upper в единицах параметра (мг/л для chemistry).',
        type: IntervalDto,
    })
    interval!: IntervalDto;

    @ApiProperty({ description: 'ПДК этого параметра по СанПиН (для context UI).', example: 0.3 })
    pdk!: number | { min: number; max: number };

    @ApiProperty({ description: 'Сколько соседей подтверждает проблему (n).', example: 17 })
    n!: number;
}

export class EquipmentRecommendationDto {
    @ApiProperty({
        description:
            'MoySklad UUID товара — primary identifier для deep-link на страницу товара ' +
            'и для добавления в корзину. Фронт сам подтягивает изображения, цену, slug и full description ' +
            'через `/catalog/products/{externalId}` (или эквивалент). ' +
            'Если в Flowise document `metadata.externalId` отсутствует — рекомендация фильтруется и не попадает в response.',
        example: 'd2b41420-cc04-11e5-7a69-93a700294993',
    })
    externalId!: string;

    @ApiProperty({
        description:
            'Название товара для immediate render в popup (избегаем flash placeholder при первом рендере). ' +
            'Фронт может затем перезаписать каноническим именем из product-detail endpoint, если оно отличается.',
        example: 'Аквафор В150 Фаворит ЭКО',
    })
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

    @ApiProperty({
        description:
            'Presigned URL первого изображения товара (TTL 1ч). Берётся из `metadata.imageUrls[0]` ' +
            'через тот же MinIO/S3 presign-pipeline что в catalog/search. null если у товара нет картинок ' +
            'в catalog feeder.',
        example: 'http://localhost:9010/slovo-datasets/catalogs/aquaphor/images/d2b41420-cc04-11e5-7a69-93a700294993/e6349c4e.png?X-Amz-...',
        nullable: true,
    })
    imageUrl!: string | null;

    @ApiProperty({
        description:
            'Цена в копейках для отображения «12 490 ₽» рядом с CTA «В корзину». null если отсутствует ' +
            'в metadata feeder\'а (вызывает fallback UI «Цена по запросу»).',
        example: 1249000,
        nullable: true,
    })
    salePriceKopecks!: number | null;
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
