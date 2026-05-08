import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CATALOG_AQUAPHOR_STORE_NAME } from '@slovo/common';
import {
    ENDPOINTS,
    type FlowiseClient,
    type TFlowiseDocumentStore,
    type TFlowiseQueryDoc,
    type TFlowiseQueryResponse,
} from '@slovo/flowise-client';
import { WATER_PARAMS_BY_CODE } from '@slovo/water-blank-extraction';
import type Redis from 'ioredis';
import {
    EQUIPMENT_SUGGEST_CACHE_TTL_SECONDS,
    EQUIPMENT_SUGGEST_DEFAULT_TOP_K,
    EQUIPMENT_SUGGEST_REDIS_TOKEN,
    FLOWISE_CLIENT_TOKEN,
} from '../water-analysis.constants';
import { PredictService } from '../predict/predict.service';
import type { TPdkStatus } from '../predict/dto/predict.response.dto';
import type { EquipmentSuggestRequestDto } from './dto/equipment-suggest.request.dto';
import type {
    EquipmentRecommendationDto,
    EquipmentSuggestResponseDto,
    WaterProblemDto,
} from './dto/equipment-suggest.response.dto';

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

    constructor(
        private readonly predictService: PredictService,
        @Inject(FLOWISE_CLIENT_TOKEN) private readonly flowise: FlowiseClient,
        @Inject(EQUIPMENT_SUGGEST_REDIS_TOKEN) private readonly redis: Redis,
    ) {}

    async suggest(dto: EquipmentSuggestRequestDto): Promise<EquipmentSuggestResponseDto> {
        const topK = dto.topK ?? EQUIPMENT_SUGGEST_DEFAULT_TOP_K;
        const cacheKey = buildCacheKey(dto.lat, dto.lon, topK);

        const cached = await this.tryCacheGet(cacheKey);
        if (cached) {
            return { ...cached, cached: true };
        }

        const t0 = Date.now();

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
            this.tryCacheSet(cacheKey, response).catch(() => {
                /* swallowed */
            });
            return response;
        }

        const problems = extractProblems(prediction.predicted);
        const searchQuery = buildSearchQuery(problems);

        // Step 5: catalog vector search. Если problems пустой — query тоже
        // пустой/слабый, smoke-search всё равно вернёт generic фильтры.
        // Решение: при отсутствии problems пропускаем catalog search и отдаём
        // empty recommendations — UI скажет «вода в норме, дополнительная
        // фильтрация необязательна».
        const recommendations =
            problems.length === 0 ? [] : await this.runCatalogSearch(searchQuery, topK);

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

    private async runCatalogSearch(
        query: string,
        topK: number,
    ): Promise<EquipmentRecommendationDto[]> {
        const storeId = await this.resolveCatalogStoreId();
        const response = await this.flowise.request<TFlowiseQueryResponse>(
            ENDPOINTS.vectorstoreQuery,
            { method: 'POST', body: { storeId, query, topK } },
        );

        return response.docs.map(mapDocToRecommendation);
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
            throw new ServiceUnavailableException(
                `Document Store "${CATALOG_AQUAPHOR_STORE_NAME}" not found in Flowise — ` +
                    `проверь что catalog ingested и Flowise running`,
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

// =============================================================================
// Helpers
// =============================================================================

/**
 * Извлечь проблемы из predict-output: только параметры с `pdkStatus` ∈
 * {'borderline', 'unsafe'}. Sort by severity (unsafe сначала, потом borderline)
 * + дополнительно по n (больше соседей = выше уверенность).
 */
function extractProblems(
    predicted: Record<
        string,
        {
            interval: { lower: number; upper: number };
            n: number;
            pdkStatus: TPdkStatus | null;
        }
    >,
): WaterProblemDto[] {
    const problems: WaterProblemDto[] = [];

    for (const [paramCode, est] of Object.entries(predicted)) {
        if (est.pdkStatus !== 'unsafe' && est.pdkStatus !== 'borderline') continue;

        const meta = WATER_PARAMS_BY_CODE[paramCode];
        if (!meta || meta.pdk === null) continue;

        problems.push({
            paramCode,
            severity: est.pdkStatus,
            interval: { lower: est.interval.lower, upper: est.interval.upper },
            pdk: meta.pdk,
            n: est.n,
        });
    }

    return problems.sort((a, b) => {
        if (a.severity !== b.severity) {
            return a.severity === 'unsafe' ? -1 : 1;
        }
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
            parts.push(`превышение по показателю «${label}» (${intervalStr})`);
        } else {
            parts.push(`${label} на границе ПДК (${intervalStr})`);
        }
    }

    return `Подобрать оборудование для воды с проблемами: ${parts.join('; ')}.`;
}

function mapDocToRecommendation(doc: TFlowiseQueryDoc): EquipmentRecommendationDto {
    const meta = doc.metadata;
    const sku = stringOr(meta.orderNumber, stringOr(meta.sku, 'unknown'));
    const name = stringOr(meta.name, stringOr(meta.title, 'Без названия'));
    // Flowise vectorstoreQuery score обычно в metadata либо undefined.
    // Fallback 1.0 если нет — UI всё равно показывает первую как наиболее релевантную.
    const relevance = numberOr(meta.score, 1.0);
    const description = doc.pageContent.slice(0, 280);
    const imageUrl = stringOrUndefined(meta.imageUrl);

    return imageUrl
        ? { sku, name, relevance, description, imageUrl }
        : { sku, name, relevance, description };
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

function buildCacheKey(lat: number, lon: number, topK: number): string {
    const r = (n: number): string => n.toFixed(3);
    return `equipment-suggest:${r(lat)}:${r(lon)}:${topK}`;
}

function stringifyError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return typeof err === 'string' ? err : JSON.stringify(err);
}
