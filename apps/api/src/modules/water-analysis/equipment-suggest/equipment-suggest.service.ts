import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CATALOG_AQUAPHOR_STORE_NAME } from '@slovo/common';
import {
    ENDPOINTS,
    type FlowiseClient,
    type TFlowiseDocumentStore,
    type TFlowiseQueryDoc,
    type TFlowiseQueryResponse,
} from '@slovo/flowise-client';
import { StorageService } from '@slovo/storage';
import { WATER_PARAMS_BY_CODE } from '@slovo/water-blank-extraction';
import type Redis from 'ioredis';
import {
    CATALOG_PRESIGNED_CACHE_KEY_PREFIX,
    CATALOG_PRESIGNED_CACHE_TTL_SEC,
    CATALOG_PRESIGNED_URL_TTL_SEC,
} from '../../catalog/catalog.constants';
import {
    EQUIPMENT_SUGGEST_CACHE_TTL_SECONDS,
    EQUIPMENT_SUGGEST_DEFAULT_TOP_K,
    EQUIPMENT_SUGGEST_MAX_PROBLEM_QUERIES,
    EQUIPMENT_SUGGEST_PER_PROBLEM_K,
    EQUIPMENT_SUGGEST_REDIS_TOKEN,
    FLOWISE_CLIENT_TOKEN,
    WATER_ANALYSIS_CACHE_VERSION,
} from '../water-analysis.constants';
import { stringifyError } from '../_shared';
import { PredictService } from '../predict/predict.service';
import type { TPdkStatus } from '../predict/dto/predict.response.dto';
import type { EquipmentSuggestRequestDto } from './dto/equipment-suggest.request.dto';
import type {
    EquipmentRecommendationDto,
    EquipmentSuggestResponseDto,
    WaterProblemDto,
} from './dto/equipment-suggest.response.dto';
import { getTargetedQueryForParam } from './queries';

// =============================================================================
// EquipmentSuggestService — flagship USP-2 cross-domain.
//
// Pipeline:
//   1. Cache lookup по координатам (rounded 0.001°).
//   2. Predict химию через PredictService — взваживает k ближайших соседей,
//      возвращает interval-aware estimates per param.
//   3. Identify problems — params с pdkStatus IN ('borderline', 'unsafe').
//      Только regulated — non-regulated (temperature) пропускаются.
//   4. Build natural-language query из problems — фраза которая ляжет в
//      vector search catalog'а ровно как клиент бы спросил продавца.
//   5. Catalog vector search через Flowise — используем тот же storeId lookup
//      pattern что в catalog/search/text.service (single-flight + retry on err).
//      Не импортим CatalogModule (избегаем cyclic deps), используем общий
//      FlowiseClient.
//   6. Map docs → EquipmentRecommendationDto.
//   7. Cache TTL 10мин.
//
// Insufficient data branch: predict вернул insufficientData=true → возвращаем
// пустые problems + recommendations + insufficientData=true. Фронт показывает
// «недостаточно данных по адресу — введи свой анализ или попробуй другую точку».
// =============================================================================

@Injectable()
export class EquipmentSuggestService {
    private readonly logger = new Logger(EquipmentSuggestService.name);

    private storeIdPromise: Promise<string> | null = null;

    // Single-flight cache stampede protection для presigned URL resolution —
    // паттерн скопирован из TextSearchService. 50 concurrent requests на тот же
    // cold S3-key → один S3 sign call, остальные await ту же Promise.
    private readonly inflightUrls = new Map<string, Promise<string>>();

    constructor(
        private readonly predictService: PredictService,
        @Inject(FLOWISE_CLIENT_TOKEN) private readonly flowise: FlowiseClient,
        @Inject(EQUIPMENT_SUGGEST_REDIS_TOKEN) private readonly redis: Redis,
        // StorageService injected через `StorageModule.forFeature({ bucketEnvKey:
        // 'S3_CATALOG_BUCKET' })` в WaterAnalysisModule — bound к catalog bucket,
        // не knowledge. Используется для presign первой картинки товара.
        private readonly storage: StorageService,
    ) {}

    async suggest(dto: EquipmentSuggestRequestDto): Promise<EquipmentSuggestResponseDto> {
        const topK = dto.topK ?? EQUIPMENT_SUGGEST_DEFAULT_TOP_K;
        const cacheKey = buildCacheKey(dto.lat, dto.lon, topK);

        // t0 ловим до cache GET — см. heatmap.service rationale.
        const t0 = Date.now();

        const cached = await this.tryCacheGet(cacheKey);
        if (cached) {
            return { ...cached, cached: true, timeTakenMs: Date.now() - t0 };
        }


        // Step 2-3: predict + identify problems
        const prediction = await this.predictService.predict({
            lat: dto.lat,
            lon: dto.lon,
        });

        if (prediction.insufficientData) {
            const response: EquipmentSuggestResponseDto = {
                problems: [],
                recommendations: [],
                searchQuery: '',
                nNeighbors: 0,
                medianDistKm: 0,
                insufficientData: true,
                timeTakenMs: Date.now() - t0,
                cached: false,
            };
            // fire-and-forget: tryCacheSet логирует cache-set ошибки внутри.
            void this.tryCacheSet(cacheKey, response);
            return response;
        }

        const problems = extractProblems(prediction.predicted);
        const searchQuery = buildSearchQuery(problems);

        // Step 5: per-problem catalog search для **targeted** рекомендаций.
        // Раньше делали один общий query → catalog vector search возвращал
        // generic фильтры (Кристалл Н, Викинг Миди корпус, и т.п.) которые
        // matched по semantic similarity к концу natural-language query, но
        // не to specific problems.
        //
        // Теперь: для каждой problem делаем отдельный targeted query
        // (например для iron_total — «обезжелезиватель удаление железа»),
        // берём top-2-3 результата, мерджим уникально по SKU/name.
        // Per-problem queries используют technology-keywords из mapping
        // PROBLEM_TO_QUERY ниже — они попадают в semantic neighborhood
        // соответствующих product descriptions vision-augmenter'а.
        //
        // Если problems пустой — empty recommendations (вода в норме).
        const recommendations =
            problems.length === 0 ? [] : await this.runPerProblemCatalogSearch(problems, topK);

        const timeTakenMs = Date.now() - t0;
        const response: EquipmentSuggestResponseDto = {
            problems,
            recommendations,
            searchQuery,
            nNeighbors: prediction.nNeighbors,
            medianDistKm: prediction.medianDistKm,
            insufficientData: false,
            timeTakenMs,
            cached: false,
        };

        this.tryCacheSet(cacheKey, response).catch(() => {
            /* swallowed */
        });
        return response;
    }

    /**
     * Per-problem targeted catalog search. Для каждой problem (в порядке severity)
     * делаем отдельный vector query с technology-keywords (PROBLEM_TO_QUERY mapping).
     * Берём top-PER_PROBLEM_K из каждого, дедупим по `name`+`sku` (один и тот же
     * товар не повторяем), сохраняем порядок (severity-ordered).
     *
     * Cap по итоговому topK — клиент получит ровно столько уникальных рекомендаций
     * сколько просил, не больше.
     */
    private async runPerProblemCatalogSearch(
        problems: WaterProblemDto[],
        topK: number,
    ): Promise<EquipmentRecommendationDto[]> {
        const storeId = await this.resolveCatalogStoreId();

        // Ограничиваем кол-во per-problem запросов к Flowise чтобы не делать
        // 7 round-trips при наличии 7 проблем (latency cap). Топ-N проблем
        // (severity-ordered) обычно дают достаточно targeted variety.
        const topProblems = problems.slice(0, EQUIPMENT_SUGGEST_MAX_PROBLEM_QUERIES);

        // Per-problem queries параллельно через Promise.all — Flowise
        // vectorstoreQuery thread-safe для read-only `query`. Sequential
        // for...await давал ~1.8s wall-clock на 3 round-trip × 600мс,
        // Promise.all сокращает до ~600мс (один round-trip).
        //
        // Severity-ordering preserved: `Promise.all` сохраняет порядок результатов,
        // соответствующий порядку `topProblems` (severity-sorted) — dedup loop ниже
        // обрабатывает результаты в severity-priority order.
        const responses = await Promise.all(
            topProblems.map((problem) => {
                const targetedQuery = buildTargetedQuery(problem);
                return this.flowise.request<TFlowiseQueryResponse>(
                    ENDPOINTS.vectorstoreQuery,
                    {
                        method: 'POST',
                        body: { storeId, query: targetedQuery, topK: EQUIPMENT_SUGGEST_PER_PROBLEM_K },
                    },
                ).then((response) => ({ docs: response.docs, problem }));
            }),
        );

        // Track matched problem на каждый doc — для UI «почему этот товар».
        // `{ doc, problem }` пары: дедуп сохраняет **первую** matched problem
        // (severity-ordered preserves: для doc найденного через unsafe-iron, потом
        // через borderline-manganese — оставляем iron, более серьёзная проблема).
        const allMatches: Array<{ doc: TFlowiseQueryDoc; problem: WaterProblemDto }> = [];
        for (const { docs, problem } of responses) {
            for (const doc of docs) {
                allMatches.push({ doc, problem });
            }
        }

        // Dedup по externalId (MoySklad UUID). Без externalId фронт не сможет
        // открыть страницу товара / добавить в корзину — рекомендация **отбрасывается**.
        // Severity-ordered preserves: для doc найденного через unsafe-iron, потом
        // через borderline-manganese — оставляем iron (более серьёзная проблема).
        const seen = new Set<string>();
        const baseRecs: TBaseRecommendation[] = [];
        for (const { doc, problem } of allMatches) {
            const base = mapDocToBaseRecommendation(doc, problem);
            if (base === null) continue;
            if (seen.has(base.externalId)) continue;
            seen.add(base.externalId);
            baseRecs.push(base);
            if (baseRecs.length >= topK) break;
        }

        // Resolve presigned URL первой картинки параллельно для всех recommendations
        // (single-flight protection в `resolvePresignedUrl`). Если у товара нет
        // картинок — `imageUrl = null`.
        const recommendations = await Promise.all(
            baseRecs.map(async (base): Promise<EquipmentRecommendationDto> => {
                const imageUrl = base.firstImageKey
                    ? await this.resolvePresignedUrl(base.firstImageKey).catch((err: unknown) => {
                          this.logger.warn(
                              `presign failed for ${base.firstImageKey}: ${stringifyError(err)}`,
                          );
                          return null;
                      })
                    : null;
                const { firstImageKey: _firstImageKey, ...rest } = base;
                return { ...rest, imageUrl };
            }),
        );

        return recommendations;
    }

    private resolvePresignedUrl(key: string): Promise<string> {
        const existing = this.inflightUrls.get(key);
        if (existing) return existing;
        const promise = this.doResolvePresignedUrl(key).finally(() => {
            this.inflightUrls.delete(key);
        });
        this.inflightUrls.set(key, promise);
        return promise;
    }

    private async doResolvePresignedUrl(key: string): Promise<string> {
        const cacheKey = `${CATALOG_PRESIGNED_CACHE_KEY_PREFIX}${key}`;
        const cached = await this.redis.get(cacheKey).catch(() => null);
        if (cached) return cached;
        const url = await this.storage.getPresignedDownloadUrl(key, {
            expiresInSeconds: CATALOG_PRESIGNED_URL_TTL_SEC,
        });
        await this.redis.set(cacheKey, url, 'EX', CATALOG_PRESIGNED_CACHE_TTL_SEC).catch(() => {
            /* swallow Redis errors — fresh presign at least успешен */
        });
        return url;
    }

    private resolveCatalogStoreId(): Promise<string> {
        if (!this.storeIdPromise) {
            this.storeIdPromise = this.lookupCatalogStoreId().catch((err: unknown) => {
                this.storeIdPromise = null;
                throw err;
            });
        }
        return this.storeIdPromise;
    }

    private async lookupCatalogStoreId(): Promise<string> {
        const stores = await this.flowise.request<TFlowiseDocumentStore[]>(
            ENDPOINTS.documentStores,
        );
        const store = stores.find((s) => s.name === CATALOG_AQUAPHOR_STORE_NAME);
        if (!store) {
            // Detail в logger.error (для on-call), generic message клиенту чтобы не
            // раскрывать internals (имя Flowise store + что catalog backend Flowise).
            this.logger.error(
                `Document Store "${CATALOG_AQUAPHOR_STORE_NAME}" not found in Flowise — ` +
                    `catalog не ingested или Flowise недоступен`,
            );
            throw new ServiceUnavailableException(
                'Подбор оборудования временно недоступен',
            );
        }
        this.logger.log(
            `equipment-suggest catalog store "${CATALOG_AQUAPHOR_STORE_NAME}" → id=${store.id}`,
        );
        return store.id;
    }

    private async tryCacheGet(key: string): Promise<EquipmentSuggestResponseDto | null> {
        try {
            const raw = await this.redis.get(key);
            if (!raw) return null;
            return JSON.parse(raw) as EquipmentSuggestResponseDto;
        } catch (err) {
            this.logger.warn(`equipment-suggest cache GET failed: ${stringifyError(err)} (key=${key})`);
            return null;
        }
    }

    private async tryCacheSet(key: string, value: EquipmentSuggestResponseDto): Promise<void> {
        try {
            await this.redis.set(
                key,
                JSON.stringify(value),
                'EX',
                EQUIPMENT_SUGGEST_CACHE_TTL_SECONDS,
            );
        } catch (err) {
            this.logger.warn(`equipment-suggest cache SET failed: ${stringifyError(err)} (key=${key})`);
        }
    }
}

// PROBLEM_TO_QUERY mapping + GENERIC_FALLBACK_QUERY вынесены в `./queries.ts`
// (это prompt-context, не код — отдельный файл для A/B-теста wording).
// Tuning constants (MAX_PROBLEM_QUERIES / PER_PROBLEM_K) — в
// water-analysis.constants.ts: EQUIPMENT_SUGGEST_*.

function buildTargetedQuery(problem: WaterProblemDto): string {
    return getTargetedQueryForParam(problem.paramCode);
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Извлечь проблемы из predict-output: pdkStatus ∈ {borderline, concerning, unsafe}
 * (safe не попадает — нечего рекомендовать). Sort by severity (unsafe → concerning →
 * borderline), затем по n (больше соседей = выше уверенность).
 */
function extractProblems(
    predicted: Record<
        string,
        {
            interval: { lower: number; upper: number; confidence: number };
            n: number;
            pdkStatus: TPdkStatus | null;
        }
    >,
): WaterProblemDto[] {
    const problems: WaterProblemDto[] = [];

    for (const [paramCode, est] of Object.entries(predicted)) {
        if (
            est.pdkStatus !== 'unsafe' &&
            est.pdkStatus !== 'concerning' &&
            est.pdkStatus !== 'borderline'
        ) {
            continue;
        }

        const meta = WATER_PARAMS_BY_CODE[paramCode];
        if (!meta || meta.pdk === null) continue;

        problems.push({
            paramCode,
            severity: est.pdkStatus,
            // est.interval — IntervalDto (lower/upper/confidence). Spread
            // сохраняет confidence для UI «80% соседей в этом диапазоне».
            interval: { ...est.interval },
            pdk: meta.pdk,
            n: est.n,
        });
    }

    const SEVERITY_RANK: Record<TPdkStatus, number> = {
        unsafe: 0,
        concerning: 1,
        borderline: 2,
        safe: 3, // never в этой выборке, но нужен для type-completeness
    };

    return problems.sort((a, b) => {
        const rankDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        if (rankDiff !== 0) return rankDiff;
        return b.n - a.n;
    });
}

/**
 * Натурально-языковой запрос для catalog vector search. Конструируется так
 * чтобы embedding попал в semantic neighborhood каталоговых описаний vision-
 * augmenter'а (фразы типа «удаление железа», «умягчение жёсткой воды»).
 */
function buildSearchQuery(problems: WaterProblemDto[]): string {
    if (problems.length === 0) {
        return 'Профилактическая фильтрация воды в норме';
    }

    const parts: string[] = [];
    for (const problem of problems) {
        const meta = WATER_PARAMS_BY_CODE[problem.paramCode];
        const label = meta?.nameRu ?? problem.paramCode;
        const unit = meta?.unit ?? '';
        const intervalStr = `${problem.interval.lower}-${problem.interval.upper}${unit ? ' ' + unit : ''}`;

        if (problem.severity === 'unsafe') {
            parts.push(`явное превышение «${label}» (${intervalStr})`);
        } else if (problem.severity === 'concerning') {
            parts.push(`вероятное превышение «${label}» (${intervalStr})`);
        } else {
            parts.push(`«${label}» на границе ПДК (${intervalStr})`);
        }
    }

    return `Подобрать оборудование для воды с проблемами: ${parts.join('; ')}.`;
}

/**
 * Intermediate тип — pre-presign mapping. Содержит S3-key первой картинки
 * (если есть) который потом резолвится в presigned URL в async-pass.
 */
type TBaseRecommendation = Omit<EquipmentRecommendationDto, 'imageUrl'> & {
    firstImageKey: string | null;
};

/**
 * Map Flowise document → TBaseRecommendation. Возвращает `null` если в metadata
 * отсутствует `externalId` (MoySklad UUID) — без него фронт не открывает товар
 * и не добавляет в корзину. Битый chunk feeder'а отбрасывается тихо.
 */
function mapDocToBaseRecommendation(
    doc: TFlowiseQueryDoc,
    matchedProblem: WaterProblemDto,
): TBaseRecommendation | null {
    const meta = doc.metadata;
    const externalId = stringOrUndefined(meta.externalId);
    if (!externalId) return null;

    const name = stringOr(meta.name, stringOr(meta.title, 'Без названия'));
    const relevance = numberOr(meta.score, 1.0);
    const description = doc.pageContent.slice(0, 280);
    const salePriceKopecks = numberOrNull(meta.salePriceKopecks);
    const firstImageKey = extractFirstImageKey(meta);
    const reason = buildReason(matchedProblem);

    return {
        externalId,
        name,
        relevance,
        description,
        matchedProblem: matchedProblem.paramCode,
        reason,
        salePriceKopecks,
        firstImageKey,
    };
}

/**
 * Извлечь S3-key первой картинки из `metadata.imageUrls[]`. Тот же contract
 * что в catalog/search (`feeder` кладёт relative S3-keys). Возвращает null если
 * массива нет / пустой / первый элемент не валидный S3-key.
 *
 * Whitelist validation совпадает с TextSearchService.isValidS3Key — защита от
 * path-injection если feeder теоретически положит `../../etc` или absolute URL.
 */
function extractFirstImageKey(metadata: Record<string, unknown>): string | null {
    const raw = metadata.imageUrls;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const first: unknown = raw[0];
    if (typeof first !== 'string' || !isValidS3Key(first)) return null;
    return first;
}

const S3_KEY_ALLOWED_CHARS = /^[a-zA-Z0-9/_.-]+$/;

function isValidS3Key(key: string): boolean {
    if (key.length === 0 || key.length > 1024) return false;
    if (key.startsWith('/') || key.startsWith('.')) return false;
    if (key.split('/').some((segment) => segment === '..')) return false;
    return S3_KEY_ALLOWED_CHARS.test(key);
}

/**
 * Human-readable объяснение «почему этот товар» — UI показывает под названием.
 * Формат: severity-aware фраза + русский label параметра.
 */
function buildReason(problem: WaterProblemDto): string {
    const meta = WATER_PARAMS_BY_CODE[problem.paramCode];
    const label = meta?.nameRu ?? problem.paramCode;

    if (problem.severity === 'unsafe') {
        return `Решает явное превышение «${label}»`;
    }
    if (problem.severity === 'concerning') {
        return `Решает вероятное превышение «${label}»`;
    }
    return `Подходит для «${label}» на границе ПДК`;
}

function stringOr(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildCacheKey(lat: number, lon: number, topK: number): string {
    const r = (n: number): string => n.toFixed(3);
    return `equipment-suggest:${WATER_ANALYSIS_CACHE_VERSION}:${r(lat)}:${r(lon)}:${topK}`;
}
