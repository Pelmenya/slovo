import {
    BadRequestException,
    Inject,
    Injectable,
    Logger,
    NotImplementedException,
    ServiceUnavailableException,
} from '@nestjs/common';
import {
    ENDPOINTS,
    type FlowiseClient,
    type TFlowiseDocumentStore,
    type TFlowiseQueryDoc,
    type TFlowiseQueryResponse,
} from '@slovo/flowise-client';
import { exceedsPdk, generateEmbeddingText, getParamUnit } from '@slovo/water-blank-extraction';
import {
    FLOWISE_CLIENT_TOKEN,
    SIMILAR_DEFAULT_TOP_K,
    WATER_ANALYSIS_AQUAPHOR_STORE_NAME,
} from '../water-analysis.constants';
import {
    SimilarFiltersDto,
    SimilarSearchRequestDto,
} from './dto/similar.request.dto';
import {
    SimilarBlankDto,
    SimilarSearchResponseDto,
} from './dto/similar.response.dto';

// Oversample factor для post-filter — сколько кандидатов запрашиваем у Flowise
// при наличии фильтров. *5 — эмпирическая оценка: при regionContains='Московская'
// hit rate среди 15 504 ≈ 14% (2 100 анализов), для top-K=10 нужно ≥10/0.14≈72
// кандидата. *5 для top-K=10 даёт 50 — обычно хватает; для top-K=50 потолок
// =MAX_TOP_K=50, oversample упрётся. Acceptable trade-off — без жёстких SLA
// ситуация «count<topK» легитимна и видна клиенту в response.
const OVERSAMPLE_FACTOR = 5;
// Hard cap для vectorstoreQuery — защита от unbounded retrieval. Cosine
// в pgvector linear по top-K, на 15 504 chunks 250 запросов укладываются в ~1s.
const MAX_FETCH_K = 250;

// =============================================================================
// SimilarSearchService — vector search по water-analysis Document Store через
// Flowise. Шаги:
//
// 1. Resolve storeId по имени (lazy + single-flight + retry on failure) — тот
//    же паттерн что в catalog/search/text.service.ts. Хардкод UUID отвергнут:
//    при reset Flowise dev-инстанса id меняется → service ломается тихо.
//
// 2. Построить natural-language description через generateEmbeddingText():
//    детерминированный генератор который при ingest 15 504 записей создавал
//    embedding_text. Та же функция → тот же текст-формат → семантически
//    сравнимое embedding с тем что в pgvector.
//
// 3. paramFlags считаем здесь же — для каждого param смотрим exceedsPdk()
//    из СанПиН справочника, добавляем 'exceeds_pdk' если превышение. Без
//    этого generateEmbeddingText не выделит «Превышения ПДК» секцию и
//    embedding query «съедет» от ingest формата (помним: похожие тексты =
//    похожие embedding).
//
// 4. POST /document-store/vectorstore/query → top-K docs с metadata.
//
// 5. Преобразуем metadata → SimilarBlankDto (явный whitelist полей через
//    TypeScript shape, не pass-through всего объекта).
// =============================================================================

@Injectable()
export class SimilarSearchService {
    private readonly logger = new Logger(SimilarSearchService.name);

    private storeIdPromise: Promise<string> | null = null;

    constructor(
        @Inject(FLOWISE_CLIENT_TOKEN) private readonly flowise: FlowiseClient,
    ) {}

    async search(request: SimilarSearchRequestDto): Promise<SimilarSearchResponseDto> {
        // Geo-filter не реализован — fail-fast чтобы фронт не тратил Flowise call.
        // ETA Phase 2.5 при появлении prostor-app потребителя. Текущий путь:
        // или oversample + post-filter через Prisma raw `ST_DWithin` поверх
        // Flowise-managed `<storeId>_chunks.metadata->>'orderNumber'`, или
        // полный переход на свой combined geo+semantic raw SQL без Flowise.
        if (request.filters?.geo) {
            throw new NotImplementedException(
                'geo filter not implemented yet — ETA Phase 2.5 (prostor-app integration). ' +
                    'Используй regionContains/localityContains как промежуточное решение.',
            );
        }

        validateRequest(request);

        const effectiveTopK = request.topK ?? SIMILAR_DEFAULT_TOP_K;
        const fetchK = this.computeFetchK(effectiveTopK, request.filters);
        const storeId = await this.resolveStoreId();

        const query = this.buildQueryText(request);

        const flowiseResponse = await this.flowise.request<TFlowiseQueryResponse>(
            ENDPOINTS.vectorstoreQuery,
            {
                method: 'POST',
                body: { storeId, query, topK: fetchK },
            },
        );

        const filteredDocs = applyPostFilters(
            flowiseResponse.docs,
            request.intakeType,
            request.filters,
        ).slice(0, effectiveTopK);

        const blanks = filteredDocs.map(
            (doc): SimilarBlankDto => ({
                orderNumber: stringOrEmpty(doc.metadata.orderNumber),
                intakeType: stringOrEmpty(doc.metadata.intakeType),
                depthMeters: numberOrNull(doc.metadata.depthMeters),
                region: stringOrNull(doc.metadata.region),
                locality: stringOrNull(doc.metadata.locality),
                lat: roundCoord(numberOrNull(doc.metadata.lat)),
                lon: roundCoord(numberOrNull(doc.metadata.lon)),
                pageContent: doc.pageContent,
            }),
        );

        return {
            count: blanks.length,
            blanks,
            timeTakenMs: flowiseResponse.timeTaken,
        };
    }

    /**
     * Сколько кандидатов запрашивать у Flowise. Без фильтров — ровно topK.
     * С фильтрами — oversample, чтобы после post-filter осталось ≈topK.
     */
    private computeFetchK(effectiveTopK: number, filters?: SimilarFiltersDto): number {
        if (!hasActiveFilters(filters)) {
            return effectiveTopK;
        }
        // Oversample × OVERSAMPLE_FACTOR, но не больше MAX_FETCH_K
        // (защита от unbounded retrieval из Flowise/pgvector).
        return Math.min(effectiveTopK * OVERSAMPLE_FACTOR, MAX_FETCH_K);
    }

    /**
     * Построить query-текст в том же формате что embedding_text в БД.
     *
     * Критично: формат должен совпадать с ingest (06-generate-embedding-text.ts
     * использовал ту же `generateEmbeddingText`). Расхождения в шаблоне дадут
     * embedding в другой точке latent space — топ-K будет случайным.
     */
    private buildQueryText(request: SimilarSearchRequestDto): string {
        const paramUnits: Record<string, string> = {};
        const paramFlags: Record<string, string[]> = {};

        for (const [code, value] of Object.entries(request.params)) {
            const unit = getParamUnit(code, request.paramUnits);
            if (unit) {
                paramUnits[code] = unit;
            }
            if (exceedsPdk(code, value)) {
                paramFlags[code] = ['exceeds_pdk'];
            }
        }

        return generateEmbeddingText({
            intakeType: request.intakeType,
            depthMeters: request.depthMeters ?? null,
            appearance: request.appearance ?? null,
            params: request.params,
            paramUnits,
            paramFlags,
        });
    }

    private resolveStoreId(): Promise<string> {
        if (!this.storeIdPromise) {
            this.storeIdPromise = this.lookupStoreId().catch((err: unknown) => {
                // Reset чтобы следующий request попробовал заново — без
                // этого временный network-blip намертво сломал бы service.
                this.storeIdPromise = null;
                throw err;
            });
        }
        return this.storeIdPromise;
    }

    private async lookupStoreId(): Promise<string> {
        const stores = await this.flowise.request<TFlowiseDocumentStore[]>(
            ENDPOINTS.documentStores,
        );
        const store = stores.find((s) => s.name === WATER_ANALYSIS_AQUAPHOR_STORE_NAME);
        if (!store) {
            // 503 ServiceUnavailable, не 500 — внешний ресурс (Flowise) не в нужном
            // состоянии. Клиент / мониторинг отличает «store mis-provisioned» от
            // «slovo внутренняя ошибка» (другие 500). FlowiseClient сам бросает
            // FlowiseError на network/HTTP errors — те уйдут как 500, что корректно
            // (slovo не контролирует Flowise pool).
            throw new ServiceUnavailableException(
                `Document Store "${WATER_ANALYSIS_AQUAPHOR_STORE_NAME}" not found in Flowise — ` +
                    `проверь что store создан и embedding pipeline отработал ` +
                    `(experiments/water-analysis-dataset/scripts/10-flowise-custom-loader.ts)`,
            );
        }
        this.logger.log(
            `water-analysis store "${WATER_ANALYSIS_AQUAPHOR_STORE_NAME}" → id=${store.id}`,
        );
        return store.id;
    }
}

// =============================================================================
// Type guards для metadata из Flowise — приходит `Record<string, unknown>`,
// а интерфейс DTO жёсткий (orderNumber: string, lat: number | null, и т.д.).
// При drift loader'а (если кто-то изменит metadata schema) — fail-soft на
// уровне отдельного blank, а не throw на весь search.
// =============================================================================

function stringOrEmpty(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// =============================================================================
// roundCoord — снижение точности lat/lon до ~500 м для PII-mitigation в public
// response. Ahunter geocoding по `objectAddress` даёт точку с радиусом 200м-2км
// (с этой точностью можно идентифицировать конкретный дом / частную скважину).
// Снижение precision до 500м даёт деревню / коттеджный посёлок (5-50 семей) —
// useful для UI карты, но не указывает на конкретное домохозяйство.
//
// 0.005° lat = 555 м (constant независимо от широты).
// 0.005° lon = 555 × cos(lat) м — на 55° широты МО ≈ 320 м.
// Среднее на МО ≈ 400-500 м — целевой уровень обезличивания.
//
// Memory `project_water_analysis_pii_strategy`: derived должен быть обезличенный;
// raw содержит точные координаты локально (под git).
// =============================================================================

const COORD_ROUND_GRID = 200; // 1° / 200 = 0.005°

function roundCoord(value: number | null): number | null {
    if (value === null) return null;
    return Math.round(value * COORD_ROUND_GRID) / COORD_ROUND_GRID;
}

// =============================================================================
// validateRequest — defensive checks которые class-validator не покрывает:
// (1) cross-field invariant `depthRange.minMeters <= maxMeters` — без custom
//     decorator class-validator не валидирует cross-field на nested DTO.
//     Без этой проверки клиент с обратным диапазоном получает silent count=0
//     и думает что в БД пусто.
// (2) value-types в `params` / `paramUnits` — `@IsObject()` пропускает
//     `{ "iron_total": "DROP TABLE" }` или NaN. embedding-text builder
//     полагается на Number.isFinite на caller-side.
// (3) bounded размер `params` — защита от DoS на embedding-builder через
//     гигантский payload. 50 ключей хватает на 21 canonical paramCode +
//     запас для будущих расширений (electrical_conductivity вариации).
// =============================================================================

const MAX_PARAMS_KEYS = 50;
const MAX_PARAM_VALUE = 1e6;

function validateRequest(request: SimilarSearchRequestDto): void {
    const dr = request.filters?.depthRange;
    if (dr && dr.minMeters > dr.maxMeters) {
        throw new BadRequestException(
            `depthRange.minMeters (${dr.minMeters}) > maxMeters (${dr.maxMeters}) — ` +
                `обратный диапазон. Передай min <= max.`,
        );
    }

    const paramKeys = Object.keys(request.params);
    if (paramKeys.length === 0) {
        throw new BadRequestException('params не может быть пустым объектом');
    }
    if (paramKeys.length > MAX_PARAMS_KEYS) {
        throw new BadRequestException(
            `params содержит ${paramKeys.length} ключей, лимит ${MAX_PARAMS_KEYS}`,
        );
    }
    for (const [code, value] of Object.entries(request.params)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new BadRequestException(
                `params["${code}"] должно быть конечным числом, получено: ${typeof value}`,
            );
        }
        if (value < 0 || value > MAX_PARAM_VALUE) {
            throw new BadRequestException(
                `params["${code}"]=${value} вне допустимого диапазона [0, ${MAX_PARAM_VALUE}]`,
            );
        }
    }

    if (request.paramUnits) {
        for (const [code, unit] of Object.entries(request.paramUnits)) {
            if (typeof unit !== 'string' || unit.length === 0 || unit.length > 16) {
                throw new BadRequestException(
                    `paramUnits["${code}"] должно быть непустой строкой ≤16 chars`,
                );
            }
        }
    }
}

// =============================================================================
// Post-filter helpers — apply фильтров к docs из vector response.
// Все фильтры выполняются над `metadata` (не делаем JOIN на water_analysis
// в БД) — embedding pipeline проектировался так чтобы все часто-фильтруемые
// поля попадали в loader metadata (см. memory `feedback_minimal_denorm`).
// =============================================================================

function hasActiveFilters(filters?: SimilarFiltersDto): boolean {
    if (!filters) return false;
    return (
        filters.matchIntakeType === true ||
        typeof filters.regionContains === 'string' ||
        typeof filters.localityContains === 'string' ||
        filters.depthRange !== undefined ||
        filters.geo !== undefined
    );
}

function applyPostFilters(
    docs: TFlowiseQueryDoc[],
    requestIntakeType: string,
    filters: SimilarFiltersDto | undefined,
): TFlowiseQueryDoc[] {
    if (!hasActiveFilters(filters)) {
        return docs;
    }
    const f = filters as SimilarFiltersDto;

    const regionLower = f.regionContains?.toLowerCase();
    const localityLower = f.localityContains?.toLowerCase();

    return docs.filter((doc) => {
        const meta = doc.metadata;

        if (f.matchIntakeType === true) {
            if (meta.intakeType !== requestIntakeType) return false;
        }

        if (regionLower !== undefined) {
            const region = typeof meta.region === 'string' ? meta.region.toLowerCase() : '';
            if (!region.includes(regionLower)) return false;
        }

        if (localityLower !== undefined) {
            const locality =
                typeof meta.locality === 'string' ? meta.locality.toLowerCase() : '';
            if (!locality.includes(localityLower)) return false;
        }

        if (f.depthRange !== undefined) {
            // Depth NULL для municipal/spring/river — отфильтровываем (не bound для
            // unknown depth). Семантически: если клиент задал depthRange — он ищет
            // именно скважины/колодцы определённой глубины.
            const depth = typeof meta.depthMeters === 'number' ? meta.depthMeters : null;
            if (depth === null) return false;
            if (depth < f.depthRange.minMeters || depth > f.depthRange.maxMeters) return false;
        }

        // geo handled via NotImplementedException в search() — сюда не доходит.
        return true;
    });
}

