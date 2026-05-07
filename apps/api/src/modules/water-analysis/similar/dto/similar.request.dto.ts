import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsIn,
    IsInt,
    IsLatitude,
    IsLongitude,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    Length,
    Max,
    Min,
    ValidateNested,
} from 'class-validator';
import {
    SIMILAR_DEFAULT_TOP_K,
    SIMILAR_MAX_TOP_K,
    SIMILAR_MIN_TOP_K,
} from '../../water-analysis.constants';

const INTAKE_TYPES = ['well', 'well_dug', 'municipal', 'spring', 'river', 'other'] as const;

// Радиус geo-фильтра в км. Минимум 1 км — меньше теряет смысл (точность Ahunter
// geocoding ±200м-2км по locality). Максимум 500 км — выше уже не «локальная»
// вода, vector similarity сам отсортирует по составу.
const GEO_MIN_RADIUS_KM = 1;
const GEO_MAX_RADIUS_KM = 500;

// Глубина источника воды — bound те же что для request.depthMeters.
const DEPTH_MIN_METERS = 1;
const DEPTH_MAX_METERS = 1000;

/**
 * Фильтр по геолокации — найти похожие анализы в радиусе от точки клиента.
 *
 * Мотивация: похожая вода **рядом** ценнее похожей **далеко** — региональные
 * особенности гидрогеологии дают похожий состав в одном водоносном горизонте.
 * Артезианская в Тюмени и под Москвой по embedding похожи (Fe + жёсткость),
 * но рекомендованное оборудование может разниться из-за местных нюансов
 * (запах H2S в одних регионах, бор в других, и т.д.).
 *
 * Status: **зарезервирован** в Phase 2 — реализация требует или oversample
 * Flowise vectorstore + post-filter через Prisma raw `ST_DWithin`, или
 * полный переход с Flowise vectorstoreQuery на свой combined geo+semantic
 * raw SQL. Решение примем когда появится первый потребитель (prostor-app
 * виджет) — у него будет конкретный UX (radius hard-cutoff vs weighted re-rank).
 *
 * Запрос с заданным `geo` сейчас возвращает 501 Not Implemented с пояснением.
 */
export class SimilarGeoFilterDto {
    @ApiProperty({
        description: 'Latitude центра поиска (WGS84).',
        example: 55.7558,
    })
    @IsNumber()
    @IsLatitude()
    lat!: number;

    @ApiProperty({
        description: 'Longitude центра поиска (WGS84).',
        example: 37.6173,
    })
    @IsNumber()
    @IsLongitude()
    lon!: number;

    @ApiProperty({
        description: 'Радиус поиска в километрах.',
        example: 50,
        minimum: GEO_MIN_RADIUS_KM,
        maximum: GEO_MAX_RADIUS_KM,
    })
    @IsNumber()
    @Min(GEO_MIN_RADIUS_KM)
    @Max(GEO_MAX_RADIUS_KM)
    radiusKm!: number;
}

/**
 * Диапазон глубины источника. Inclusive bounds.
 */
export class SimilarDepthRangeDto {
    @ApiProperty({
        description: 'Минимальная глубина источника в метрах.',
        example: 30,
        minimum: DEPTH_MIN_METERS,
        maximum: DEPTH_MAX_METERS,
    })
    @IsNumber()
    @Min(DEPTH_MIN_METERS)
    @Max(DEPTH_MAX_METERS)
    minMeters!: number;

    @ApiProperty({
        description: 'Максимальная глубина источника в метрах.',
        example: 100,
        minimum: DEPTH_MIN_METERS,
        maximum: DEPTH_MAX_METERS,
    })
    @IsNumber()
    @Min(DEPTH_MIN_METERS)
    @Max(DEPTH_MAX_METERS)
    maxMeters!: number;
}

/**
 * Фильтры для post-processing top-K результатов от vector search.
 *
 * Все опциональные. Когда задан хотя бы один — service делает oversample
 * topK в vectorstoreQuery (запрос topK × OVERSAMPLE_FACTOR кандидатов),
 * apply post-filter, обрезает до итогового topK. Если кандидатов меньше
 * чем topK после filter — возвращается сколько есть (`count` < `topK`).
 *
 * Зачем не пропустить фильтр в Flowise vectorstoreQuery: REST API Flowise
 * `where` clause не поддерживает (~~`metadataFilter` есть только для
 * MongoDB-стиля операторов в `chatflow` predict, не в `document-store/
 * vectorstore/query`~~). Альтернатива — свой combined SQL поверх
 * Flowise-managed таблицы `<storeId>_chunks` (`metadata->>'orderNumber'`).
 */
export class SimilarFiltersDto {
    @ApiPropertyOptional({
        description:
            'Strict-match по типу источника. Если true — отдаём только blanks ' +
            'с тем же intakeType что в запросе. По умолчанию false: vector ' +
            'similarity сам ранжирует, скважина может «совпасть» с колодцем ' +
            'по составу — иногда это полезно (один водоносный горизонт).',
        example: true,
    })
    @IsOptional()
    @IsBoolean()
    matchIntakeType?: boolean;

    @ApiPropertyOptional({
        description:
            'Substring case-insensitive фильтр по полю region (от Ahunter geocoding). ' +
            'Используется когда у клиента нет lat/lon но известен регион — например, ' +
            '«Московская» матчит «Московская область», «г. Москва», «Новая Москва (Москва)».',
        example: 'Московская',
    })
    @IsOptional()
    @IsString()
    @Length(2, 64)
    regionContains?: string;

    @ApiPropertyOptional({
        description:
            'Substring case-insensitive фильтр по locality (город / посёлок). ' +
            'Полезен в комбинации с regionContains для сужения до района.',
        example: 'Раменское',
    })
    @IsOptional()
    @IsString()
    @Length(2, 64)
    localityContains?: string;

    @ApiPropertyOptional({
        description:
            'Диапазон глубины источника в метрах. Только для скважин/колодцев — ' +
            'для municipal/spring/river depth_meters NULL и blanks автоматически ' +
            'отфильтруются. Применять когда клиент знает что у него «глубокая ' +
            'артезианская» (>100м) — отсечь верховодку при поиске аналогов.',
        type: SimilarDepthRangeDto,
    })
    @IsOptional()
    @ValidateNested()
    @Type(() => SimilarDepthRangeDto)
    depthRange?: SimilarDepthRangeDto;

    @ApiPropertyOptional({
        description:
            'Гео-фильтр по радиусу от точки клиента. **Status: NOT_IMPLEMENTED** — ' +
            'service возвращает 501 при использовании. ETA: Phase 2.5 при появлении ' +
            'prostor-app виджета. См. similar.request.dto.ts:SimilarGeoFilterDto.',
        type: SimilarGeoFilterDto,
    })
    @IsOptional()
    @ValidateNested()
    @Type(() => SimilarGeoFilterDto)
    geo?: SimilarGeoFilterDto;
}

/**
 * Запрос «найди похожие водные анализы».
 *
 * Сценарий: клиент даёт свой анализ (структурированно — те же 21 paramCode что в БД)
 * + опционально тип источника, глубину, описание внешнего вида. Service строит
 * embedding-text детерминированным генератором (libs/water-blank-extraction) и
 * запрашивает топ-K похожих из Flowise Document Store water-analysis-aquaphor.
 *
 * Опционально — `filters` для сужения результата (matchIntakeType / regionContains /
 * depthRange / geo). См. SimilarFiltersDto.
 */
export class SimilarSearchRequestDto {
    @ApiProperty({
        description:
            'Тип источника воды. Определяется заказчиком при отборе пробы. Используется как chemical predictor — вода скважин, колодцев и водопровода имеет разный baseline.',
        enum: INTAKE_TYPES,
        example: 'well',
    })
    @IsString()
    @IsIn(INTAKE_TYPES)
    intakeType!: typeof INTAKE_TYPES[number];

    @ApiPropertyOptional({
        description:
            'Глубина источника в метрах. Только для скважин/колодцев. ' +
            'Артезианская >100м даёт другой состав воды, чем верховодка <25м.',
        example: 50,
        minimum: DEPTH_MIN_METERS,
        maximum: DEPTH_MAX_METERS,
    })
    @IsOptional()
    @IsNumber()
    @Min(DEPTH_MIN_METERS)
    @Max(DEPTH_MAX_METERS)
    depthMeters?: number;

    @ApiPropertyOptional({
        description:
            'Описание внешнего вида (свободный текст). Например, «прозрачная», «мутнеет со временем», «жёлтый оттенок».',
        example: 'мутнеет со временем',
    })
    @IsOptional()
    @IsString()
    @Length(1, 256)
    appearance?: string;

    @ApiProperty({
        description:
            'Карта paramCode → числовое значение. Канонические paramCode из СанПиН справочника libs/water-blank-extraction (iron_total, hardness_total, manganese, ph, color, turbidity, и т.д.). Значения в канонических единицах (мг/л для металлов и анионов, мг-экв/л для жёсткости/щёлочности, ЕМФ для мутности, °C для температуры).',
        example: {
            ph: 7.2,
            hardness_total: 8.2,
            iron_total: 1.5,
            manganese: 0.3,
            color: 35,
            turbidity: 5.2,
            tds: 720,
        },
    })
    @IsObject()
    params!: Record<string, number>;

    @ApiPropertyOptional({
        description: 'paramCode → каноническая единица измерения. Опционально — если не задано, берётся из справочника СанПиН.',
        example: { iron_total: 'мг/л', hardness_total: 'мг-экв/л' },
    })
    @IsOptional()
    @IsObject()
    paramUnits?: Record<string, string>;

    @ApiPropertyOptional({
        description:
            'Опциональные post-filter фильтры (apply поверх top-K vector результатов). ' +
            'См. SimilarFiltersDto. Когда задан хотя бы один — service делает oversample ' +
            'top-K при vector search для компенсации фильтрации.',
        type: SimilarFiltersDto,
    })
    @IsOptional()
    @ValidateNested()
    @Type(() => SimilarFiltersDto)
    filters?: SimilarFiltersDto;

    @ApiPropertyOptional({
        description: 'Сколько максимально похожих анализов вернуть.',
        default: SIMILAR_DEFAULT_TOP_K,
        minimum: SIMILAR_MIN_TOP_K,
        maximum: SIMILAR_MAX_TOP_K,
    })
    @IsOptional()
    @IsInt()
    @Min(SIMILAR_MIN_TOP_K)
    @Max(SIMILAR_MAX_TOP_K)
    topK?: number;
}
