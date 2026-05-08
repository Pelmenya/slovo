import { Test, type TestingModule } from '@nestjs/testing';
import { CATALOG_AQUAPHOR_STORE_NAME } from '@slovo/common';
import {
    ENDPOINTS,
    type FlowiseClient,
    type TFlowiseQueryDoc,
    type TFlowiseQueryResponse,
} from '@slovo/flowise-client';
import {
    EQUIPMENT_SUGGEST_CACHE_TTL_SECONDS,
    EQUIPMENT_SUGGEST_DEFAULT_TOP_K,
    EQUIPMENT_SUGGEST_REDIS_TOKEN,
    FLOWISE_CLIENT_TOKEN,
} from '../water-analysis.constants';
import { PredictService } from '../predict/predict.service';
import type { PredictResponseDto } from '../predict/dto/predict.response.dto';
import type { EquipmentSuggestRequestDto } from './dto/equipment-suggest.request.dto';
import { EquipmentSuggestService } from './equipment-suggest.service';

// =============================================================================
// EquipmentSuggestService unit-тесты — flagship USP-2 cross-domain pipeline.
//
// Архитектурный сдвиг 2026-05-08: вместо одного общего vectorstoreQuery с
// natural-language searchQuery теперь делаем **per-problem targeted catalog
// search** — для каждой top-N severity-проблемы отдельный query из
// PROBLEM_TO_QUERY mapping (technology-keywords). Дедуп по name+sku, cap
// по итоговому topK от клиента.
//
// Контрактные константы из service.ts:
//   MAX_PROBLEM_QUERIES = 3   — сколько top severity problems тригерим query
//   PER_PROBLEM_K       = 2   — сколько top docs забираем из каждого query
//
// Зависимости которые мокаем:
//   - PredictService    → захардкоженный output по тест-сценарию
//   - FlowiseClient     → endpoint-aware mockImplementation: documentStores →
//                         stores list, vectorstoreQuery → docs (опц. per-call
//                         через mockImplementationOnce последовательно)
//   - Redis (ioredis)   → в большинстве тестов get→null, set→OK
//
// Внутренние helpers (extractProblems / buildSearchQuery / buildTargetedQuery /
// mapDocToRecommendation / dedup / buildCacheKey) проверяются через public
// service.suggest() + assert на flowise.request.mock.calls[].body.query.
//
// `jest.useFakeTimers({ doNotFake: ['setImmediate', ...] })` — нужно чтобы
// fire-and-forget tryCacheSet (Promise без await) успевал выполниться через
// `await new Promise(setImmediate)` после suggest().
// =============================================================================

type TPredictMock = {
    predict: jest.Mock;
};

type TRedisMock = {
    get: jest.Mock;
    set: jest.Mock;
};

/**
 * Минимальный «store stub» — TFlowiseDocumentStore требует ~10 полей которые
 * в тестах не нужны (status / loaders / whereUsed / vectorStoreConfig / ...).
 * lookupCatalogStoreId читает только `id` и `name`, поэтому через `unknown as`
 * сужаем типизацию (тот же паттерн что в similar.service.spec).
 */
type TStoreStub = { id: string; name: string };

/**
 * Опции для setupService. queryResults — массив TFlowiseQueryResponse, по одному
 * на каждый ожидаемый vectorstoreQuery call (per-problem search). Если задано
 * меньше чем будет вызвано — недостающие падают на default empty docs.
 */
type TSetupOpts = {
    storesResult?: TStoreStub[];
    queryResults?: TFlowiseQueryResponse[];
};

describe('EquipmentSuggestService', () => {
    let service: EquipmentSuggestService;
    let predict: TPredictMock;
    let flowise: { request: jest.Mock };
    let redis: TRedisMock;

    /**
     * Универсальный setup — endpoint-aware FlowiseClient mock через
     * `mockImplementation` (различает documentStores vs vectorstoreQuery).
     * Поддерживает несколько последовательных vectorstoreQuery вызовов
     * через `queryResults[]` (по индексу call'а).
     */
    async function setupService(opts: TSetupOpts = {}): Promise<void> {
        const stores: TStoreStub[] = opts.storesResult ?? [
            { id: 'catalog-store-uuid', name: CATALOG_AQUAPHOR_STORE_NAME },
        ];
        const queryResults: TFlowiseQueryResponse[] = opts.queryResults ?? [
            { docs: [], timeTaken: 100 },
        ];
        let queryCallIdx = 0;

        predict = { predict: jest.fn() };
        flowise = {
            request: jest.fn().mockImplementation((endpoint: string) => {
                if (endpoint === ENDPOINTS.documentStores) return Promise.resolve(stores);
                if (endpoint === ENDPOINTS.vectorstoreQuery) {
                    const result =
                        queryResults[queryCallIdx] ??
                        queryResults[queryResults.length - 1] ?? { docs: [], timeTaken: 50 };
                    queryCallIdx += 1;
                    return Promise.resolve(result);
                }
                return Promise.reject(new Error(`unexpected endpoint: ${endpoint}`));
            }),
        };
        redis = {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
        };

        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                EquipmentSuggestService,
                { provide: PredictService, useValue: predict },
                { provide: FLOWISE_CLIENT_TOKEN, useValue: flowise as unknown as FlowiseClient },
                { provide: EQUIPMENT_SUGGEST_REDIS_TOKEN, useValue: redis },
            ],
        }).compile();
        service = moduleRef.get(EquipmentSuggestService);
    }

    function buildDto(
        overrides: Partial<EquipmentSuggestRequestDto> = {},
    ): EquipmentSuggestRequestDto {
        return {
            lat: overrides.lat ?? 55.7558,
            lon: overrides.lon ?? 37.6173,
            topK: overrides.topK,
        } as EquipmentSuggestRequestDto;
    }

    /**
     * Минимальный predict-output — успешный (insufficientData=false), без проблем.
     * Тесты переопределяют predicted по сценарию.
     *
     * `byCategory` — required в новом DTO; equipment-suggest service её не читает
     * (использует `predicted` напрямую через extractProblems), но shape должен
     * валидироваться TS-компилятором. Default empty buckets.
     */
    function buildPredictResponse(
        overrides: Partial<PredictResponseDto> = {},
    ): PredictResponseDto {
        return {
            predicted: overrides.predicted ?? {},
            byCategory: overrides.byCategory ?? {
                unsafe: [],
                concerning: [],
                borderline: [],
                safe: [],
                unmonitored: [],
            },
            nNeighbors: overrides.nNeighbors ?? 18,
            medianDistKm: overrides.medianDistKm ?? 4.2,
            radiusKm: overrides.radiusKm ?? 50,
            insufficientData: overrides.insufficientData ?? false,
            timeTakenMs: overrides.timeTakenMs ?? 120,
            cached: overrides.cached ?? false,
            mostLikelyAquiferLayer: overrides.mostLikelyAquiferLayer,
        };
    }

    /**
     * Хелпер для построения "param-estimate" части predicted с заданным severity.
     * Numeric values фиктивные — service не пересчитывает pdkStatus, использует
     * mock как-есть (логика evaluatePdkStatus уже покрыта в predict.service.spec).
     */
    function paramEstimate(severity: 'safe' | 'borderline' | 'concerning' | 'unsafe' | null, n = 18) {
        return {
            interval: { lower: 0.5, upper: 1.5, confidence: 80 },
            iqr: { lower: 0.7, upper: 1.2, confidence: 50 },
            hardRange: { lower: 0.1, upper: 2, confidence: 100 },
            pointEstimate: 0.95,
            n,
            pdkStatus: severity,
        };
    }

    /**
     * Утилита: достать все query-строки из тех flowise.request вызовов которые
     * шли в vectorstoreQuery endpoint. Порядок сохраняется — соответствует
     * severity-order проблем.
     */
    function vectorQueryStrings(): string[] {
        return flowise.request.mock.calls
            .filter((c) => c[0] === ENDPOINTS.vectorstoreQuery)
            .map((c) => {
                const opts = c[1] as { body: { query: string } };
                return opts.body.query;
            });
    }

    /**
     * Утилита: количество vectorstoreQuery вызовов.
     */
    function vectorQueryCount(): number {
        return flowise.request.mock.calls.filter((c) => c[0] === ENDPOINTS.vectorstoreQuery).length;
    }

    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask', 'nextTick'] });
        jest.setSystemTime(new Date('2026-05-08T00:00:00.000Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // ------------------------------------------------------------------------
    // 1. Pipeline happy-path — predict → problems → per-problem vector search
    // ------------------------------------------------------------------------

    describe('pipeline happy-path', () => {
        it('predict с unsafe iron_total → 1 vectorstoreQuery с targeted query «обезжелезиватель…» + topK=PER_PROBLEM_K', async () => {
            await setupService({
                queryResults: [
                    {
                        docs: [
                            {
                                id: 'doc-1',
                                pageContent: 'Колонна для удаления железа.',
                                metadata: {
                                    orderNumber: 'OZ-15',
                                    name: 'Аквафор ОС-15',
                                    imageUrl: 'https://cdn/oz15.jpg',
                                },
                            },
                        ],
                        timeTaken: 200,
                    },
                ],
            });
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { iron_total: paramEstimate('unsafe') },
                    nNeighbors: 18,
                    medianDistKm: 4.2,
                }),
            );

            const result = await service.suggest(buildDto());

            expect(predict.predict).toHaveBeenCalledTimes(1);
            expect(predict.predict).toHaveBeenCalledWith({ lat: 55.7558, lon: 37.6173 });

            // 1 lookup + 1 vectorstoreQuery (1 problem → 1 targeted call).
            expect(flowise.request).toHaveBeenCalledWith(ENDPOINTS.documentStores);
            expect(vectorQueryCount()).toBe(1);

            // Targeted query — из PROBLEM_TO_QUERY[iron_total] (technology-keywords).
            const queries = vectorQueryStrings();
            expect(queries[0]).toBe('обезжелезиватель удаление растворённого железа из воды');

            // Body shape: storeId resolved + topK=PER_PROBLEM_K (=2), не клиентский topK.
            expect(flowise.request).toHaveBeenCalledWith(
                ENDPOINTS.vectorstoreQuery,
                expect.objectContaining({
                    method: 'POST',
                    body: expect.objectContaining({
                        storeId: 'catalog-store-uuid',
                        query: 'обезжелезиватель удаление растворённого железа из воды',
                        topK: 2,
                    }),
                }),
            );

            expect(result.problems).toHaveLength(1);
            expect(result.problems[0]).toMatchObject({
                paramCode: 'iron_total',
                severity: 'unsafe',
                pdk: 0.3,
                n: 18,
            });
            expect(result.recommendations).toHaveLength(1);
            expect(result.recommendations[0]).toMatchObject({
                sku: 'OZ-15',
                name: 'Аквафор ОС-15',
                imageUrl: 'https://cdn/oz15.jpg',
                matchedProblem: 'iron_total',
                reason: expect.stringContaining('явное превышение'),
            });
            expect(result.nNeighbors).toBe(18);
            expect(result.medianDistKm).toBe(4.2);
            expect(result.insufficientData).toBe(false);
            expect(result.cached).toBe(false);
        });

        it('3 проблемы (unsafe iron, concerning manganese, borderline hardness) → 3 vectorstoreQuery с разными targeted queries', async () => {
            await setupService({
                queryResults: [
                    // iron_total → 2 docs
                    {
                        docs: [
                            {
                                id: 'd1',
                                pageContent: 'Обезжелезиватель.',
                                metadata: { orderNumber: 'OZ-15', name: 'OS-15' },
                            },
                            {
                                id: 'd2',
                                pageContent: 'Картридж.',
                                metadata: { orderNumber: 'CR-1', name: 'Картридж Fe' },
                            },
                        ],
                        timeTaken: 100,
                    },
                    // manganese → 2 docs
                    {
                        docs: [
                            {
                                id: 'd3',
                                pageContent: 'MnO2 фильтр.',
                                metadata: { orderNumber: 'MN-1', name: 'Mn-1' },
                            },
                            {
                                id: 'd4',
                                pageContent: 'Картридж.',
                                metadata: { orderNumber: 'CR-2', name: 'Картридж Mn' },
                            },
                        ],
                        timeTaken: 100,
                    },
                    // hardness_total → 2 docs
                    {
                        docs: [
                            {
                                id: 'd5',
                                pageContent: 'Умягчитель.',
                                metadata: { orderNumber: 'SF-1', name: 'Soft-1' },
                            },
                            {
                                id: 'd6',
                                pageContent: 'Колонна.',
                                metadata: { orderNumber: 'SF-2', name: 'Soft-2' },
                            },
                        ],
                        timeTaken: 100,
                    },
                ],
            });
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {
                        iron_total: paramEstimate('unsafe'),
                        manganese: paramEstimate('concerning'),
                        hardness_total: paramEstimate('borderline'),
                    },
                }),
            );

            const result = await service.suggest(buildDto({ topK: 10 }));

            // По одному vectorstoreQuery на каждую problem.
            expect(vectorQueryCount()).toBe(3);

            const queries = vectorQueryStrings();
            // Severity order: unsafe (iron) → concerning (manganese) → borderline (hardness).
            expect(queries[0]).toBe('обезжелезиватель удаление растворённого железа из воды');
            expect(queries[1]).toBe('обезмарганцевание удаление марганца окислительная фильтрация');
            expect(queries[2]).toBe('умягчитель смягчение жёсткой воды ионный обмен');

            // 3 problems × 2 docs = 6 кандидатов, все уникальные → 6 рекомендаций
            // (topK=10 не cap'ает).
            expect(result.recommendations).toHaveLength(6);
            expect(result.recommendations.map((r) => r.sku)).toEqual([
                'OZ-15',
                'CR-1',
                'MN-1',
                'CR-2',
                'SF-1',
                'SF-2',
            ]);
        });
    });

    // ------------------------------------------------------------------------
    // 2. Insufficient data — predict.insufficientData=true → empty + skip catalog
    // ------------------------------------------------------------------------

    describe('insufficient data', () => {
        it('predict.insufficientData=true → empty problems/recommendations + insufficientData=true, vector search НЕ вызывается', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {},
                    nNeighbors: 0,
                    medianDistKm: 0,
                    insufficientData: true,
                }),
            );

            const result = await service.suggest(buildDto());

            expect(result.insufficientData).toBe(true);
            expect(result.problems).toEqual([]);
            expect(result.recommendations).toEqual([]);
            expect(result.searchQuery).toBe('');
            expect(result.nNeighbors).toBe(0);
            expect(result.medianDistKm).toBe(0);
            expect(result.cached).toBe(false);

            // НИКАКИХ catalog calls — ни lookup, ни query.
            expect(flowise.request).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------------
    // 3. No problems — все pdkStatus='safe' → empty recommendations + skip search
    // ------------------------------------------------------------------------

    describe('no problems (вода в норме)', () => {
        it('все pdkStatus=safe → empty problems/recommendations, searchQuery="Профилактическая...", catalog search skipped', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {
                        iron_total: paramEstimate('safe'),
                        manganese: paramEstimate('safe'),
                    },
                }),
            );

            const result = await service.suggest(buildDto());

            expect(result.problems).toEqual([]);
            expect(result.recommendations).toEqual([]);
            expect(result.searchQuery).toBe('Профилактическая фильтрация воды в норме');
            expect(result.insufficientData).toBe(false);

            // problems пустой → runPerProblemCatalogSearch не вызван → flowise не дёрнут.
            expect(flowise.request).not.toHaveBeenCalled();
        });

        it('pdkStatus=null (non-regulated, temperature) тоже не попадает в problems', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { temperature: paramEstimate(null) },
                }),
            );

            const result = await service.suggest(buildDto());

            expect(result.problems).toEqual([]);
            expect(result.recommendations).toEqual([]);
            expect(flowise.request).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------------
    // 4. extractProblems sort — by severity (unsafe → concerning → borderline) + by n desc
    // ------------------------------------------------------------------------

    describe('extractProblems — sort order (4-level severity)', () => {
        it('unsafe идёт раньше concerning раньше borderline (даже если n меньше)', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {
                        // borderline с большим n
                        hardness_total: paramEstimate('borderline', 25),
                        // concerning со средним n
                        manganese: paramEstimate('concerning', 15),
                        // unsafe с меньшим n
                        iron_total: paramEstimate('unsafe', 10),
                    },
                }),
            );

            const result = await service.suggest(buildDto());

            expect(result.problems).toHaveLength(3);
            expect(result.problems[0].paramCode).toBe('iron_total');
            expect(result.problems[0].severity).toBe('unsafe');
            expect(result.problems[1].paramCode).toBe('manganese');
            expect(result.problems[1].severity).toBe('concerning');
            expect(result.problems[2].paramCode).toBe('hardness_total');
            expect(result.problems[2].severity).toBe('borderline');
        });

        it('одинаковая severity → сортировка по n убыв (больше соседей = выше)', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {
                        iron_total: paramEstimate('unsafe', 10),
                        manganese: paramEstimate('unsafe', 22),
                    },
                }),
            );

            const result = await service.suggest(buildDto());

            expect(result.problems).toHaveLength(2);
            // оба unsafe, manganese.n=22 > iron.n=10 → manganese первым.
            expect(result.problems[0].paramCode).toBe('manganese');
            expect(result.problems[0].n).toBe(22);
            expect(result.problems[1].paramCode).toBe('iron_total');
            expect(result.problems[1].n).toBe(10);
        });

        it('concerning попадает в problems (новая severity, не отбрасывается)', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { manganese: paramEstimate('concerning') },
                }),
            );

            const result = await service.suggest(buildDto());

            expect(result.problems).toHaveLength(1);
            expect(result.problems[0].paramCode).toBe('manganese');
            expect(result.problems[0].severity).toBe('concerning');
        });
    });

    // ------------------------------------------------------------------------
    // 5. extractProblems filter — safe / null / unknown / pdk=null params skipped
    // ------------------------------------------------------------------------

    describe('extractProblems — filtering', () => {
        it('pdkStatus=safe не попадает в problems', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {
                        manganese: paramEstimate('safe'),
                        iron_total: paramEstimate('unsafe'),
                    },
                }),
            );

            const result = await service.suggest(buildDto());

            expect(result.problems).toHaveLength(1);
            expect(result.problems[0].paramCode).toBe('iron_total');
        });

        it('pdkStatus=null (non-regulated) не попадает в problems', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { temperature: paramEstimate(null) },
                }),
            );

            const result = await service.suggest(buildDto());
            expect(result.problems).toEqual([]);
        });
    });

    // ------------------------------------------------------------------------
    // 6. buildSearchQuery — natural-language formatting (3 severity wordings)
    // ------------------------------------------------------------------------

    describe('buildSearchQuery — natural-language phrasing', () => {
        it('1 unsafe iron_total → «явное превышение «Железо…» (0.5-1.5 мг/л)»', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { iron_total: paramEstimate('unsafe') },
                }),
            );

            const result = await service.suggest(buildDto());

            expect(result.searchQuery).toContain('явное превышение');
            expect(result.searchQuery).toContain('Железо');
            expect(result.searchQuery).toContain('0.5-1.5');
            expect(result.searchQuery).toContain('мг/л');
        });

        it('1 concerning manganese → «вероятное превышение «Марганец…» (0.5-1.5 мг/л)»', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { manganese: paramEstimate('concerning') },
                }),
            );

            const result = await service.suggest(buildDto());

            expect(result.searchQuery).toContain('вероятное превышение');
            expect(result.searchQuery).toContain('Марганец');
            expect(result.searchQuery).toContain('0.5-1.5');
            expect(result.searchQuery).toContain('мг/л');
        });

        it('1 borderline hardness_total → «Жёсткость общая» на границе ПДК (0.5-1.5 мг-экв/л)', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { hardness_total: paramEstimate('borderline') },
                }),
            );

            const result = await service.suggest(buildDto());

            expect(result.searchQuery).toContain('Жёсткость общая');
            expect(result.searchQuery).toContain('на границе ПДК');
            expect(result.searchQuery).toContain('0.5-1.5');
            expect(result.searchQuery).toContain('мг-экв/л');
        });

        it('mixed severities → разные wording-фрагменты в одной строке', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {
                        iron_total: paramEstimate('unsafe'),
                        manganese: paramEstimate('concerning'),
                        hardness_total: paramEstimate('borderline'),
                    },
                }),
            );

            const result = await service.suggest(buildDto({ topK: 10 }));

            expect(result.searchQuery).toContain('явное превышение');
            expect(result.searchQuery).toContain('вероятное превышение');
            expect(result.searchQuery).toContain('на границе ПДК');
            // joinер парт через "; "
            expect(result.searchQuery).toMatch(/;\s/);
        });

        it('пустой problems → "Профилактическая фильтрация воды в норме"', async () => {
            await setupService();
            // pdkStatus=safe → problems пустой
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { iron_total: paramEstimate('safe') },
                }),
            );

            const result = await service.suggest(buildDto());
            expect(result.searchQuery).toBe('Профилактическая фильтрация воды в норме');
        });
    });

    // ------------------------------------------------------------------------
    // 7. PROBLEM_TO_QUERY mapping — каждой проблеме своя targeted query
    // ------------------------------------------------------------------------

    describe('PROBLEM_TO_QUERY mapping (per-problem targeted queries)', () => {
        it('iron_total → query содержит "обезжелезиватель"', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { iron_total: paramEstimate('unsafe') },
                }),
            );
            await service.suggest(buildDto());

            const queries = vectorQueryStrings();
            expect(queries).toHaveLength(1);
            expect(queries[0]).toContain('обезжелезиватель');
        });

        it('manganese → query содержит "обезмарганцевание"', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { manganese: paramEstimate('unsafe') },
                }),
            );
            await service.suggest(buildDto());

            const queries = vectorQueryStrings();
            expect(queries[0]).toContain('обезмарганцевание');
        });

        it('hardness_total → query содержит "умягчитель"', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { hardness_total: paramEstimate('unsafe') },
                }),
            );
            await service.suggest(buildDto());

            const queries = vectorQueryStrings();
            expect(queries[0]).toContain('умягчитель');
        });

        it('nitrates → query содержит "обратный осмос"', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { nitrates: paramEstimate('unsafe') },
                }),
            );
            await service.suggest(buildDto());

            const queries = vectorQueryStrings();
            expect(queries[0]).toContain('обратный осмос');
        });

        it('ph → query содержит "нейтрализация" / "корректировка кислотности"', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { ph: paramEstimate('unsafe') },
                }),
            );
            await service.suggest(buildDto());

            const queries = vectorQueryStrings();
            expect(queries[0]).toMatch(/нейтрализация|кислотности/);
        });
    });

    // ------------------------------------------------------------------------
    // 8. MAX_PROBLEM_QUERIES cap — ≤ 3 query'ев даже при 7 проблемах
    // ------------------------------------------------------------------------

    describe('MAX_PROBLEM_QUERIES cap', () => {
        it('7 проблем → только 3 vectorstoreQuery вызова (top-3 severity)', async () => {
            await setupService({
                queryResults: [
                    { docs: [], timeTaken: 50 },
                    { docs: [], timeTaken: 50 },
                    { docs: [], timeTaken: 50 },
                ],
            });
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {
                        iron_total: paramEstimate('unsafe', 20),
                        manganese: paramEstimate('unsafe', 18),
                        hardness_total: paramEstimate('unsafe', 15),
                        nitrates: paramEstimate('concerning'),
                        sulfates: paramEstimate('concerning'),
                        chlorides: paramEstimate('borderline'),
                        ammonium: paramEstimate('borderline'),
                    },
                }),
            );

            const result = await service.suggest(buildDto({ topK: 20 }));

            // problems[] содержит ВСЕ 7 (UI показывает полную картину)
            expect(result.problems).toHaveLength(7);
            // Но catalog query ограничен MAX_PROBLEM_QUERIES=3 (latency cap).
            expect(vectorQueryCount()).toBe(3);

            // Top-3 severity-ordered: 3 unsafe (по n убыв) → iron(20), manganese(18), hardness(15).
            const queries = vectorQueryStrings();
            expect(queries[0]).toContain('обезжелезиватель'); // iron_total
            expect(queries[1]).toContain('обезмарганцевание'); // manganese
            expect(queries[2]).toContain('умягчитель'); // hardness_total
        });
    });

    // ------------------------------------------------------------------------
    // 9. PER_PROBLEM_K — каждый vectorstoreQuery с topK=2
    // ------------------------------------------------------------------------

    describe('PER_PROBLEM_K (topK per single vectorstoreQuery)', () => {
        it('каждый vectorstoreQuery body.topK = 2 (PER_PROBLEM_K), а не клиентский topK', async () => {
            await setupService({
                queryResults: [
                    { docs: [], timeTaken: 50 },
                    { docs: [], timeTaken: 50 },
                ],
            });
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {
                        iron_total: paramEstimate('unsafe'),
                        manganese: paramEstimate('unsafe'),
                    },
                }),
            );

            // Клиент попросил topK=15 — это итоговый cap, а не per-query.
            await service.suggest(buildDto({ topK: 15 }));

            const queryCalls = flowise.request.mock.calls.filter(
                (c) => c[0] === ENDPOINTS.vectorstoreQuery,
            );
            expect(queryCalls).toHaveLength(2);
            for (const call of queryCalls) {
                const body = (call[1] as { body: { topK: number } }).body;
                expect(body.topK).toBe(2);
            }
        });
    });

    // ------------------------------------------------------------------------
    // 10. Dedup по name+sku — если разные queries вернули одинаковый товар
    // ------------------------------------------------------------------------

    describe('dedup по name+sku', () => {
        it('manganese query вернул товар уже найденный в iron query → пропускается', async () => {
            // Один и тот же товар (name+orderNumber совпадают) присутствует в обоих
            // ответах. Dedup должен оставить только первое появление.
            const sharedDoc: TFlowiseQueryDoc = {
                id: 'shared-1',
                pageContent: 'Универсальная колонна Fe+Mn.',
                metadata: { orderNumber: 'UNI-1', name: 'Universal Fe+Mn' },
            };
            await setupService({
                queryResults: [
                    { docs: [sharedDoc], timeTaken: 50 },
                    { docs: [sharedDoc], timeTaken: 50 },
                ],
            });
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {
                        iron_total: paramEstimate('unsafe'),
                        manganese: paramEstimate('unsafe'),
                    },
                }),
            );

            const result = await service.suggest(buildDto({ topK: 10 }));

            // Оба queries вернули один и тот же товар → дубликат удалён, остался один.
            expect(result.recommendations).toHaveLength(1);
            expect(result.recommendations[0].sku).toBe('UNI-1');
        });

        it('частичный overlap: 2 уникальных + 1 общий → 3 уникальных в итоге', async () => {
            const shared: TFlowiseQueryDoc = {
                id: 'shared',
                pageContent: 'Универсал.',
                metadata: { orderNumber: 'UNI-1', name: 'Universal' },
            };
            await setupService({
                queryResults: [
                    {
                        docs: [
                            shared,
                            {
                                id: 'fe-only',
                                pageContent: 'Только Fe.',
                                metadata: { orderNumber: 'FE-1', name: 'Iron-only' },
                            },
                        ],
                        timeTaken: 50,
                    },
                    {
                        docs: [
                            shared,
                            {
                                id: 'mn-only',
                                pageContent: 'Только Mn.',
                                metadata: { orderNumber: 'MN-1', name: 'Mn-only' },
                            },
                        ],
                        timeTaken: 50,
                    },
                ],
            });
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {
                        iron_total: paramEstimate('unsafe'),
                        manganese: paramEstimate('unsafe'),
                    },
                }),
            );

            const result = await service.suggest(buildDto({ topK: 10 }));

            expect(result.recommendations).toHaveLength(3);
            // Severity-ordered preserves importance: shared (из iron) перед FE-1, MN-1 в конце.
            expect(result.recommendations.map((r) => r.sku)).toEqual([
                'UNI-1',
                'FE-1',
                'MN-1',
            ]);
        });
    });

    // ------------------------------------------------------------------------
    // 11. Cap по итоговому topK — клиент получает не больше чем просил
    // ------------------------------------------------------------------------

    describe('итоговый topK cap', () => {
        it('3 problems × 2 docs = 6 кандидатов, но клиент попросил topK=4 → 4 рекомендации', async () => {
            await setupService({
                queryResults: [
                    {
                        docs: [
                            {
                                id: '1',
                                pageContent: 'A',
                                metadata: { orderNumber: 'A', name: 'A' },
                            },
                            {
                                id: '2',
                                pageContent: 'B',
                                metadata: { orderNumber: 'B', name: 'B' },
                            },
                        ],
                        timeTaken: 50,
                    },
                    {
                        docs: [
                            {
                                id: '3',
                                pageContent: 'C',
                                metadata: { orderNumber: 'C', name: 'C' },
                            },
                            {
                                id: '4',
                                pageContent: 'D',
                                metadata: { orderNumber: 'D', name: 'D' },
                            },
                        ],
                        timeTaken: 50,
                    },
                    {
                        docs: [
                            {
                                id: '5',
                                pageContent: 'E',
                                metadata: { orderNumber: 'E', name: 'E' },
                            },
                            {
                                id: '6',
                                pageContent: 'F',
                                metadata: { orderNumber: 'F', name: 'F' },
                            },
                        ],
                        timeTaken: 50,
                    },
                ],
            });
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {
                        iron_total: paramEstimate('unsafe'),
                        manganese: paramEstimate('unsafe'),
                        hardness_total: paramEstimate('unsafe'),
                    },
                }),
            );

            const result = await service.suggest(buildDto({ topK: 4 }));

            expect(result.recommendations).toHaveLength(4);
            // Severity-ordered preserves importance: первые 4 unique = A, B, C, D.
            expect(result.recommendations.map((r) => r.sku)).toEqual(['A', 'B', 'C', 'D']);
        });

        it('topK undefined → DEFAULT_TOP_K=5 cap, при 6 кандидатах → 5 рекомендаций', async () => {
            await setupService({
                queryResults: [
                    {
                        docs: [
                            {
                                id: '1',
                                pageContent: 'A',
                                metadata: { orderNumber: 'A', name: 'A' },
                            },
                            {
                                id: '2',
                                pageContent: 'B',
                                metadata: { orderNumber: 'B', name: 'B' },
                            },
                        ],
                        timeTaken: 50,
                    },
                    {
                        docs: [
                            {
                                id: '3',
                                pageContent: 'C',
                                metadata: { orderNumber: 'C', name: 'C' },
                            },
                            {
                                id: '4',
                                pageContent: 'D',
                                metadata: { orderNumber: 'D', name: 'D' },
                            },
                        ],
                        timeTaken: 50,
                    },
                    {
                        docs: [
                            {
                                id: '5',
                                pageContent: 'E',
                                metadata: { orderNumber: 'E', name: 'E' },
                            },
                            {
                                id: '6',
                                pageContent: 'F',
                                metadata: { orderNumber: 'F', name: 'F' },
                            },
                        ],
                        timeTaken: 50,
                    },
                ],
            });
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {
                        iron_total: paramEstimate('unsafe'),
                        manganese: paramEstimate('unsafe'),
                        hardness_total: paramEstimate('unsafe'),
                    },
                }),
            );

            const result = await service.suggest(buildDto({ topK: undefined }));

            expect(EQUIPMENT_SUGGEST_DEFAULT_TOP_K).toBe(5);
            expect(result.recommendations).toHaveLength(5);
        });
    });

    // ------------------------------------------------------------------------
    // 11.5. matchedProblem + reason — каждая рекомендация знает «свою» проблему
    // ------------------------------------------------------------------------

    describe('matchedProblem + reason (per-doc traceability)', () => {
        it('docs из iron-search получают matchedProblem=iron_total + unsafe-reason', async () => {
            await setupService({
                queryResults: [
                    {
                        docs: [
                            {
                                id: 'd1',
                                pageContent: 'pc',
                                metadata: { orderNumber: 'A', name: 'A' },
                            },
                        ],
                        timeTaken: 50,
                    },
                ],
            });
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { iron_total: paramEstimate('unsafe') },
                }),
            );

            const result = await service.suggest(buildDto());

            expect(result.recommendations[0].matchedProblem).toBe('iron_total');
            expect(result.recommendations[0].reason).toContain('явное превышение');
            expect(result.recommendations[0].reason).toContain('Железо');
        });

        it('reason различается по severity: unsafe → "Решает явное", concerning → "Решает вероятное", borderline → "Подходит для…на границе"', async () => {
            await setupService({
                queryResults: [
                    {
                        docs: [{ id: '1', pageContent: 'pc', metadata: { orderNumber: '1', name: 'A' } }],
                        timeTaken: 50,
                    },
                    {
                        docs: [{ id: '2', pageContent: 'pc', metadata: { orderNumber: '2', name: 'B' } }],
                        timeTaken: 50,
                    },
                    {
                        docs: [{ id: '3', pageContent: 'pc', metadata: { orderNumber: '3', name: 'C' } }],
                        timeTaken: 50,
                    },
                ],
            });
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {
                        iron_total: paramEstimate('unsafe'),
                        manganese: paramEstimate('concerning'),
                        hardness_total: paramEstimate('borderline'),
                    },
                }),
            );

            const result = await service.suggest(buildDto({ topK: 10 }));

            expect(result.recommendations).toHaveLength(3);
            // Severity-ordered: unsafe → concerning → borderline.
            expect(result.recommendations[0].matchedProblem).toBe('iron_total');
            expect(result.recommendations[0].reason).toMatch(/Решает явное превышение/);
            expect(result.recommendations[1].matchedProblem).toBe('manganese');
            expect(result.recommendations[1].reason).toMatch(/Решает вероятное превышение/);
            expect(result.recommendations[2].matchedProblem).toBe('hardness_total');
            expect(result.recommendations[2].reason).toMatch(/Подходит для.+на границе ПДК/);
        });

        it('dedup сохраняет matched problem ПЕРВОГО появления (severity-priority)', async () => {
            // Один и тот же товар вернулся в iron-search (unsafe, severity 0) и
            // mn-search (borderline, severity 2) — оставляем первый, т.е. iron.
            const sharedDoc: TFlowiseQueryDoc = {
                id: 'shared',
                pageContent: 'Универсал.',
                metadata: { orderNumber: 'UNI-1', name: 'Universal' },
            };
            await setupService({
                queryResults: [
                    { docs: [sharedDoc], timeTaken: 50 },
                    { docs: [sharedDoc], timeTaken: 50 },
                ],
            });
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {
                        iron_total: paramEstimate('unsafe'),
                        manganese: paramEstimate('borderline'),
                    },
                }),
            );

            const result = await service.suggest(buildDto({ topK: 10 }));

            expect(result.recommendations).toHaveLength(1);
            expect(result.recommendations[0].matchedProblem).toBe('iron_total');
            expect(result.recommendations[0].reason).toMatch(/Решает явное превышение/);
        });
    });

    // ------------------------------------------------------------------------
    // 12. mapDocToRecommendation — fallback chain
    // ------------------------------------------------------------------------

    describe('mapDocToRecommendation — metadata fallbacks', () => {
        async function suggestWithDocs(docs: TFlowiseQueryDoc[]) {
            // Один problem → один vectorstoreQuery → docs идут единственным batch'ем.
            await setupService({ queryResults: [{ docs, timeTaken: 100 }] });
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { iron_total: paramEstimate('unsafe') },
                }),
            );
            return service.suggest(buildDto());
        }

        it('orderNumber → sku (primary)', async () => {
            const result = await suggestWithDocs([
                {
                    id: 'd1',
                    pageContent: 'Описание...',
                    metadata: { orderNumber: 'OZ-15', sku: 'fallback-sku', name: 'X' },
                },
            ]);
            expect(result.recommendations[0].sku).toBe('OZ-15');
        });

        it('orderNumber отсутствует → fallback на sku', async () => {
            const result = await suggestWithDocs([
                {
                    id: 'd1',
                    pageContent: 'pc',
                    metadata: { sku: 'SKU-X', name: 'X' },
                },
            ]);
            expect(result.recommendations[0].sku).toBe('SKU-X');
        });

        it('ни orderNumber ни sku → "unknown"', async () => {
            const result = await suggestWithDocs([
                {
                    id: 'd1',
                    pageContent: 'pc',
                    metadata: { name: 'X' },
                },
            ]);
            expect(result.recommendations[0].sku).toBe('unknown');
        });

        it('name → primary, title → fallback, иначе "Без названия"', async () => {
            const result = await suggestWithDocs([
                { id: 'd1', pageContent: 'pc', metadata: { orderNumber: '1', name: 'Имя' } },
                { id: 'd2', pageContent: 'pc', metadata: { orderNumber: '2', title: 'Title' } },
                { id: 'd3', pageContent: 'pc', metadata: { orderNumber: '3' } },
            ]);
            expect(result.recommendations[0].name).toBe('Имя');
            expect(result.recommendations[1].name).toBe('Title');
            expect(result.recommendations[2].name).toBe('Без названия');
        });

        it('relevance: numeric metadata.score → пробрасывается; иначе fallback 1.0', async () => {
            const result = await suggestWithDocs([
                { id: 'd1', pageContent: 'pc', metadata: { orderNumber: '1', score: 0.84 } },
                { id: 'd2', pageContent: 'pc', metadata: { orderNumber: '2' } },
                { id: 'd3', pageContent: 'pc', metadata: { orderNumber: '3', score: 'oops' } },
            ]);
            expect(result.recommendations[0].relevance).toBe(0.84);
            expect(result.recommendations[1].relevance).toBe(1.0);
            // non-numeric score → fallback 1.0
            expect(result.recommendations[2].relevance).toBe(1.0);
        });

        it('description = pageContent.slice(0, 280) (длинный контент урезается)', async () => {
            const longContent = 'А'.repeat(500);
            const result = await suggestWithDocs([
                {
                    id: 'd1',
                    pageContent: longContent,
                    metadata: { orderNumber: '1' },
                },
            ]);
            expect(result.recommendations[0].description).toHaveLength(280);
            expect(result.recommendations[0].description).toBe('А'.repeat(280));
        });

        it('imageUrl: только если string, иначе undefined и поле опускается', async () => {
            const result = await suggestWithDocs([
                {
                    id: 'd1',
                    pageContent: 'pc',
                    metadata: { orderNumber: '1', imageUrl: 'https://cdn/img.jpg' },
                },
                {
                    id: 'd2',
                    pageContent: 'pc',
                    metadata: { orderNumber: '2', imageUrl: 12345 },
                },
                {
                    id: 'd3',
                    pageContent: 'pc',
                    metadata: { orderNumber: '3' },
                },
            ]);
            expect(result.recommendations[0].imageUrl).toBe('https://cdn/img.jpg');
            // не-string и отсутствующий → поле просто отсутствует (см. mapDocToRecommendation
            // спред-conditional).
            expect(result.recommendations[1].imageUrl).toBeUndefined();
            expect('imageUrl' in result.recommendations[1]).toBe(false);
            expect(result.recommendations[2].imageUrl).toBeUndefined();
            expect('imageUrl' in result.recommendations[2]).toBe(false);
        });
    });

    // ------------------------------------------------------------------------
    // 13. Cache hit / miss / errors
    // ------------------------------------------------------------------------

    describe('cache behaviour', () => {
        it('cache hit: redis.get → valid JSON → cached=true, predict + flowise НЕ вызваны', async () => {
            await setupService();
            const cachedResponse = {
                problems: [],
                recommendations: [],
                searchQuery: 'cached-query',
                nNeighbors: 7,
                medianDistKm: 2.1,
                insufficientData: false,
                timeTakenMs: 50,
                cached: false,
            };
            redis.get.mockResolvedValueOnce(JSON.stringify(cachedResponse));

            const result = await service.suggest(buildDto());

            expect(result.cached).toBe(true);
            expect(result.searchQuery).toBe('cached-query');
            expect(result.nNeighbors).toBe(7);
            expect(predict.predict).not.toHaveBeenCalled();
            expect(flowise.request).not.toHaveBeenCalled();
        });

        it('cache miss → predict + flowise вызваны, redis.set с EX TTL=600 (CACHE_TTL_SECONDS)', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(buildPredictResponse({ predicted: {} }));

            await service.suggest(buildDto());
            // tryCacheSet — fire-and-forget Promise, нужен tick.
            await new Promise((r) => setImmediate(r));

            expect(redis.set).toHaveBeenCalledTimes(1);
            const [key, value, mode, ttl] = redis.set.mock.calls[0] as [
                string,
                string,
                string,
                number,
            ];
            expect(key).toMatch(/^equipment-suggest:/);
            expect(typeof value).toBe('string');
            expect(mode).toBe('EX');
            expect(ttl).toBe(EQUIPMENT_SUGGEST_CACHE_TTL_SECONDS);
        });

        it('Redis GET error → fall through (predict + catalog search всё равно выполнятся)', async () => {
            await setupService();
            redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
            predict.predict.mockResolvedValueOnce(buildPredictResponse({ predicted: {} }));

            const result = await service.suggest(buildDto());

            expect(result.cached).toBe(false);
            expect(predict.predict).toHaveBeenCalledTimes(1);
        });

        it('Redis GET вернул битый JSON → fall through to predict', async () => {
            await setupService();
            redis.get.mockResolvedValueOnce('{not-valid-json{{{');
            predict.predict.mockResolvedValueOnce(buildPredictResponse({ predicted: {} }));

            const result = await service.suggest(buildDto());

            expect(result.cached).toBe(false);
            expect(predict.predict).toHaveBeenCalledTimes(1);
        });

        it('Redis SET error → response отдаётся без падения (fire-and-forget swallow)', async () => {
            await setupService();
            redis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
            predict.predict.mockResolvedValueOnce(buildPredictResponse({ predicted: {} }));

            const result = await service.suggest(buildDto());
            await new Promise((r) => setImmediate(r));

            expect(result.cached).toBe(false);
            expect(result.insufficientData).toBe(false);
        });

        it('insufficientData branch также пишет в cache (чтобы не повторять SQL/predict)', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {},
                    insufficientData: true,
                    nNeighbors: 0,
                    medianDistKm: 0,
                }),
            );

            await service.suggest(buildDto());
            await new Promise((r) => setImmediate(r));

            expect(redis.set).toHaveBeenCalledTimes(1);
            const [, , , ttl] = redis.set.mock.calls[0] as [string, string, string, number];
            expect(ttl).toBe(EQUIPMENT_SUGGEST_CACHE_TTL_SECONDS);
        });
    });

    // ------------------------------------------------------------------------
    // 14. Catalog storeId resolution — single-flight + retry on failure
    // ------------------------------------------------------------------------

    describe('catalog storeId resolution', () => {
        it('single-flight: 3 параллельных suggest используют один lookup', async () => {
            await setupService({
                queryResults: [
                    { docs: [], timeTaken: 50 },
                    { docs: [], timeTaken: 50 },
                    { docs: [], timeTaken: 50 },
                ],
            });
            predict.predict.mockResolvedValue(
                buildPredictResponse({
                    predicted: { iron_total: paramEstimate('unsafe') },
                }),
            );
            // 3 разных координаты чтобы cache не пересеклся
            await Promise.all([
                service.suggest(buildDto({ lat: 55.1 })),
                service.suggest(buildDto({ lat: 55.2 })),
                service.suggest(buildDto({ lat: 55.3 })),
            ]);

            const lookupCalls = flowise.request.mock.calls.filter(
                (c) => c[0] === ENDPOINTS.documentStores,
            );
            expect(lookupCalls).toHaveLength(1);
            // 3 suggest × 1 problem = 3 vectorstoreQuery всего.
            expect(vectorQueryCount()).toBe(3);
        });

        it('lookup error → storeIdPromise обнуляется, следующий request делает retry', async () => {
            // Особый setup — first lookup throws, second succeeds + ms call для query.
            predict = { predict: jest.fn() };
            const calls: string[] = [];
            flowise = {
                request: jest.fn().mockImplementation(async (endpoint: string) => {
                    calls.push(endpoint);
                    if (endpoint === ENDPOINTS.documentStores) {
                        // 1st = fail, 2nd = ok
                        const lookupCount = calls.filter(
                            (c) => c === ENDPOINTS.documentStores,
                        ).length;
                        if (lookupCount === 1) throw new Error('ECONNREFUSED');
                        return [{ id: 'catalog-store-uuid', name: CATALOG_AQUAPHOR_STORE_NAME }];
                    }
                    return { docs: [], timeTaken: 50 };
                }),
            };
            redis = {
                get: jest.fn().mockResolvedValue(null),
                set: jest.fn().mockResolvedValue('OK'),
            };
            const moduleRef: TestingModule = await Test.createTestingModule({
                providers: [
                    EquipmentSuggestService,
                    { provide: PredictService, useValue: predict },
                    { provide: FLOWISE_CLIENT_TOKEN, useValue: flowise },
                    { provide: EQUIPMENT_SUGGEST_REDIS_TOKEN, useValue: redis },
                ],
            }).compile();
            service = moduleRef.get(EquipmentSuggestService);

            // predict возвращает problem (чтобы дойти до runPerProblemCatalogSearch)
            predict.predict.mockResolvedValue(
                buildPredictResponse({
                    predicted: { iron_total: paramEstimate('unsafe') },
                }),
            );

            // Первый вызов — lookup fail, suggest бросает.
            await expect(service.suggest(buildDto({ lat: 55.1 }))).rejects.toThrow(
                'ECONNREFUSED',
            );

            // Второй вызов — lookup retry, успех.
            const ok = await service.suggest(buildDto({ lat: 55.2 }));
            expect(ok.recommendations).toBeDefined();

            const lookupCalls = flowise.request.mock.calls.filter(
                (c) => c[0] === ENDPOINTS.documentStores,
            );
            expect(lookupCalls).toHaveLength(2); // первый failed, второй retry
        });

        it('catalog store отсутствует в Flowise → ServiceUnavailableException 503', async () => {
            await setupService({
                storesResult: [
                    { id: 'wa-store', name: 'water-analysis-aquaphor' },
                    { id: 'other', name: 'some-other-store' },
                ],
            });
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { iron_total: paramEstimate('unsafe') },
                }),
            );

            // Generic message клиенту чтобы не раскрывать internals (Flowise backend
            // + имя store). Detail логируется через logger.error на сервере.
            await expect(service.suggest(buildDto())).rejects.toMatchObject({
                status: 503,
                message: 'Подбор оборудования временно недоступен',
            });
        });
    });

    // ------------------------------------------------------------------------
    // 15. buildCacheKey — формат + idempotency + topK influence
    // ------------------------------------------------------------------------

    describe('cache key', () => {
        it('одинаковые координаты + topK → одинаковый cache-key', async () => {
            await setupService();
            predict.predict.mockResolvedValue(buildPredictResponse({ predicted: {} }));

            await service.suggest(buildDto({ lat: 55.7558, lon: 37.6173, topK: 5 }));
            await service.suggest(buildDto({ lat: 55.7558, lon: 37.6173, topK: 5 }));

            const keys = redis.get.mock.calls.map((c) => c[0] as string);
            expect(keys[0]).toBe(keys[1]);
        });

        it('координаты различающиеся менее 0.001° (toFixed(3)) → одинаковый cache-key', async () => {
            await setupService();
            predict.predict.mockResolvedValue(buildPredictResponse({ predicted: {} }));

            await service.suggest(buildDto({ lat: 55.123456, lon: 37.654321 }));
            await service.suggest(buildDto({ lat: 55.1234, lon: 37.6543 }));

            const keys = redis.get.mock.calls.map((c) => c[0] as string);
            expect(keys[0]).toBe(keys[1]);
        });

        it('разные topK → разные cache-keys', async () => {
            await setupService();
            predict.predict.mockResolvedValue(buildPredictResponse({ predicted: {} }));

            await service.suggest(buildDto({ topK: 5 }));
            await service.suggest(buildDto({ topK: 10 }));
            await service.suggest(buildDto({ topK: 15 }));

            const keys = redis.get.mock.calls.map((c) => c[0] as string);
            expect(new Set(keys).size).toBe(3);
        });

        it('формат ключа: equipment-suggest:<lat>:<lon>:<topK>', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(buildPredictResponse({ predicted: {} }));

            await service.suggest(buildDto({ lat: 55.7558, lon: 37.6173, topK: 5 }));

            expect(redis.get).toHaveBeenCalledWith('equipment-suggest:55.756:37.617:5');
        });
    });

    // ------------------------------------------------------------------------
    // 16. Response shape — все required поля присутствуют
    // ------------------------------------------------------------------------

    describe('response shape', () => {
        it('все required fields при наличии problems + recommendations', async () => {
            await setupService({
                queryResults: [
                    {
                        docs: [
                            {
                                id: 'd1',
                                pageContent: 'pc',
                                metadata: { orderNumber: '1', name: 'X' },
                            },
                        ],
                        timeTaken: 100,
                    },
                ],
            });
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: { iron_total: paramEstimate('unsafe') },
                    nNeighbors: 18,
                    medianDistKm: 4.2,
                }),
            );

            const result = await service.suggest(buildDto());

            expect(result).toEqual(
                expect.objectContaining({
                    problems: expect.any(Array),
                    recommendations: expect.any(Array),
                    searchQuery: expect.any(String),
                    nNeighbors: 18,
                    medianDistKm: 4.2,
                    insufficientData: false,
                    timeTakenMs: expect.any(Number),
                    cached: false,
                }),
            );
            expect(result.timeTakenMs).toBeGreaterThanOrEqual(0);
        });

        it('все required fields при insufficientData branch', async () => {
            await setupService();
            predict.predict.mockResolvedValueOnce(
                buildPredictResponse({
                    predicted: {},
                    insufficientData: true,
                    nNeighbors: 0,
                    medianDistKm: 0,
                }),
            );

            const result = await service.suggest(buildDto());

            expect(result).toEqual(
                expect.objectContaining({
                    problems: [],
                    recommendations: [],
                    searchQuery: '',
                    nNeighbors: 0,
                    medianDistKm: 0,
                    insufficientData: true,
                    timeTakenMs: expect.any(Number),
                    cached: false,
                }),
            );
        });
    });
});
