import { Test, type TestingModule } from '@nestjs/testing';
import { ENDPOINTS, type FlowiseClient } from '@slovo/flowise-client';
import {
    FLOWISE_CLIENT_TOKEN,
    WATER_ANALYSIS_AQUAPHOR_STORE_NAME,
} from '../water-analysis.constants';
import { SimilarSearchRequestDto } from './dto/similar.request.dto';
import { SimilarSearchService } from './similar.service';

// =============================================================================
// SimilarSearchService unit-тесты — мокаем FlowiseClient.request, проверяем:
//   1. resolveStoreId через name lookup (не hardcoded UUID)
//   2. Single-flight cache + reset on failure (catalog паттерн)
//   3. buildQueryText — exceedsPdk флаги попадают в embedding-text
//   4. Mapping metadata → SimilarBlankDto (numberOrNull/stringOrNull)
//   5. Подача storeId + topK в vectorstore/query
// =============================================================================

describe('SimilarSearchService', () => {
    async function setupService(flowiseRequestMock: jest.Mock): Promise<SimilarSearchService> {
        const flowiseClient = { request: flowiseRequestMock } as unknown as FlowiseClient;
        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                SimilarSearchService,
                { provide: FLOWISE_CLIENT_TOKEN, useValue: flowiseClient },
            ],
        }).compile();
        return moduleRef.get(SimilarSearchService);
    }

    function buildRequest(overrides: Partial<SimilarSearchRequestDto> = {}): SimilarSearchRequestDto {
        const dto = new SimilarSearchRequestDto();
        dto.intakeType = overrides.intakeType ?? 'well';
        dto.depthMeters = overrides.depthMeters;
        dto.appearance = overrides.appearance;
        dto.params = overrides.params ?? { ph: 7.2, hardness_total: 8.2, iron_total: 1.5 };
        dto.paramUnits = overrides.paramUnits;
        dto.topK = overrides.topK;
        dto.filters = overrides.filters;
        return dto;
    }

    it('resolves storeId по имени (не hardcoded UUID)', async () => {
        const flowiseRequest = jest.fn();
        flowiseRequest
            .mockResolvedValueOnce([
                { id: 'wa-store-uuid', name: WATER_ANALYSIS_AQUAPHOR_STORE_NAME },
                { id: 'other-store', name: 'catalog-aquaphor' },
            ])
            .mockResolvedValueOnce({ docs: [], timeTaken: 100 });

        const service = await setupService(flowiseRequest);
        await service.search(buildRequest());

        expect(flowiseRequest).toHaveBeenCalledWith(ENDPOINTS.documentStores);
        expect(flowiseRequest).toHaveBeenCalledWith(
            ENDPOINTS.vectorstoreQuery,
            expect.objectContaining({
                method: 'POST',
                body: expect.objectContaining({ storeId: 'wa-store-uuid' }),
            }),
        );
    });

    it('throws чёткий error когда store отсутствует', async () => {
        const flowiseRequest = jest.fn().mockResolvedValueOnce([
            { id: 'other-id', name: 'some-other-store' },
        ]);

        const service = await setupService(flowiseRequest);

        await expect(service.search(buildRequest())).rejects.toThrow(
            /Document Store "water-analysis-aquaphor" not found/,
        );
    });

    it('reset storeIdPromise при ошибке lookup → следующий request делает retry', async () => {
        const flowiseRequest = jest.fn();
        // Первый lookup падает с network error
        flowiseRequest.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        // Второй lookup — успех + следующий vectorstore query
        flowiseRequest
            .mockResolvedValueOnce([{ id: 'wa-store', name: WATER_ANALYSIS_AQUAPHOR_STORE_NAME }])
            .mockResolvedValueOnce({ docs: [], timeTaken: 50 });

        const service = await setupService(flowiseRequest);

        await expect(service.search(buildRequest())).rejects.toThrow('ECONNREFUSED');
        await expect(service.search(buildRequest())).resolves.toBeDefined();

        // 4 calls: failed-lookup, retry-lookup, vectorstoreQuery
        expect(flowiseRequest).toHaveBeenCalledTimes(3);
    });

    it('single-flight: concurrent search вызовы используют один lookup', async () => {
        const flowiseRequest = jest.fn();
        flowiseRequest
            .mockResolvedValueOnce([{ id: 'wa-store', name: WATER_ANALYSIS_AQUAPHOR_STORE_NAME }])
            .mockResolvedValue({ docs: [], timeTaken: 10 });

        const service = await setupService(flowiseRequest);

        await Promise.all([service.search(buildRequest()), service.search(buildRequest()), service.search(buildRequest())]);

        const lookupCalls = flowiseRequest.mock.calls.filter(
            (call) => call[0] === ENDPOINTS.documentStores,
        );
        expect(lookupCalls).toHaveLength(1);
    });

    it('buildQueryText включает превышение ПДК (iron_total=1.5 > pdk=0.3)', async () => {
        const flowiseRequest = jest.fn();
        flowiseRequest
            .mockResolvedValueOnce([{ id: 'wa-store', name: WATER_ANALYSIS_AQUAPHOR_STORE_NAME }])
            .mockResolvedValueOnce({ docs: [], timeTaken: 10 });

        const service = await setupService(flowiseRequest);
        await service.search(buildRequest({ params: { iron_total: 1.5, ph: 7.2 } }));

        const queryCall = flowiseRequest.mock.calls.find(
            (call) => call[0] === ENDPOINTS.vectorstoreQuery,
        );
        expect(queryCall).toBeDefined();
        const query = (queryCall as unknown[])[1] as { body: { query: string } };
        expect(query.body.query).toMatch(/Превышения ПДК/);
        expect(query.body.query).toMatch(/железо.*\(превышение\)/i);
    });

    it('передаёт topK из DTO в vectorstoreQuery body', async () => {
        const flowiseRequest = jest.fn();
        flowiseRequest
            .mockResolvedValueOnce([{ id: 'wa-store', name: WATER_ANALYSIS_AQUAPHOR_STORE_NAME }])
            .mockResolvedValueOnce({ docs: [], timeTaken: 10 });

        const service = await setupService(flowiseRequest);
        await service.search(buildRequest({ topK: 25 }));

        const queryCall = flowiseRequest.mock.calls.find(
            (call) => call[0] === ENDPOINTS.vectorstoreQuery,
        );
        const body = ((queryCall as unknown[])[1] as { body: { topK: number } }).body;
        expect(body.topK).toBe(25);
    });

    it('default topK=10 когда не задан в DTO', async () => {
        const flowiseRequest = jest.fn();
        flowiseRequest
            .mockResolvedValueOnce([{ id: 'wa-store', name: WATER_ANALYSIS_AQUAPHOR_STORE_NAME }])
            .mockResolvedValueOnce({ docs: [], timeTaken: 10 });

        const service = await setupService(flowiseRequest);
        await service.search(buildRequest());

        const queryCall = flowiseRequest.mock.calls.find(
            (call) => call[0] === ENDPOINTS.vectorstoreQuery,
        );
        const body = ((queryCall as unknown[])[1] as { body: { topK: number } }).body;
        expect(body.topK).toBe(10);
    });

    it('маппит metadata → SimilarBlankDto с правильными типами', async () => {
        const flowiseRequest = jest.fn();
        flowiseRequest
            .mockResolvedValueOnce([{ id: 'wa-store', name: WATER_ANALYSIS_AQUAPHOR_STORE_NAME }])
            .mockResolvedValueOnce({
                docs: [
                    {
                        id: 'chunk-1',
                        pageContent: 'Скважина 50 м.\nЖелезо общее: 1.5 мг/л.',
                        metadata: {
                            orderNumber: '14938',
                            intakeType: 'well',
                            depthMeters: 50,
                            region: 'Московская',
                            locality: 'Раменское',
                            lat: 55.6255,
                            lon: 38.1713,
                        },
                    },
                ],
                timeTaken: 620,
            });

        const service = await setupService(flowiseRequest);
        const result = await service.search(buildRequest());

        expect(result.count).toBe(1);
        expect(result.timeTakenMs).toBe(620);
        expect(result.blanks[0]).toEqual({
            orderNumber: '14938',
            intakeType: 'well',
            depthMeters: 50,
            region: 'Московская',
            locality: 'Раменское',
            lat: 55.6255,
            lon: 38.1713,
            pageContent: 'Скважина 50 м.\nЖелезо общее: 1.5 мг/л.',
        });
    });

    describe('post-filters', () => {
        function setupWithDocs(docs: Array<{ id: string; metadata: Record<string, unknown> }>): Promise<SimilarSearchService> {
            const flowiseRequest = jest.fn();
            flowiseRequest
                .mockResolvedValueOnce([{ id: 'wa-store', name: WATER_ANALYSIS_AQUAPHOR_STORE_NAME }])
                .mockResolvedValueOnce({
                    timeTaken: 50,
                    docs: docs.map((d) => ({ ...d, pageContent: `pc-${d.id}` })),
                });
            return setupService(flowiseRequest);
        }

        it('matchIntakeType: true — отбрасывает blanks с другим intakeType', async () => {
            const service = await setupWithDocs([
                { id: '1', metadata: { orderNumber: '1', intakeType: 'well' } },
                { id: '2', metadata: { orderNumber: '2', intakeType: 'municipal' } },
                { id: '3', metadata: { orderNumber: '3', intakeType: 'well' } },
            ]);
            const result = await service.search(buildRequest({
                intakeType: 'well',
                filters: { matchIntakeType: true },
            }));
            expect(result.blanks.map((b) => b.orderNumber)).toEqual(['1', '3']);
        });

        it('regionContains: case-insensitive substring match', async () => {
            const service = await setupWithDocs([
                { id: '1', metadata: { orderNumber: '1', region: 'Московская область' } },
                { id: '2', metadata: { orderNumber: '2', region: 'Тюменская область' } },
                { id: '3', metadata: { orderNumber: '3', region: 'г. Москва' } },
                { id: '4', metadata: { orderNumber: '4', region: null } },
            ]);
            const result = await service.search(buildRequest({
                filters: { regionContains: 'москов' },
            }));
            expect(result.blanks.map((b) => b.orderNumber)).toEqual(['1']);
        });

        it('depthRange: отбрасывает blanks без depth и вне диапазона', async () => {
            const service = await setupWithDocs([
                { id: '1', metadata: { orderNumber: '1', depthMeters: 50 } },
                { id: '2', metadata: { orderNumber: '2', depthMeters: 150 } },
                { id: '3', metadata: { orderNumber: '3', depthMeters: 30 } },
                { id: '4', metadata: { orderNumber: '4', depthMeters: null } },
            ]);
            const result = await service.search(buildRequest({
                filters: { depthRange: { minMeters: 40, maxMeters: 100 } },
            }));
            expect(result.blanks.map((b) => b.orderNumber)).toEqual(['1']);
        });

        it('oversample: при наличии фильтров запрашивает topK × OVERSAMPLE_FACTOR', async () => {
            const flowiseRequest = jest.fn();
            flowiseRequest
                .mockResolvedValueOnce([{ id: 'wa-store', name: WATER_ANALYSIS_AQUAPHOR_STORE_NAME }])
                .mockResolvedValueOnce({ timeTaken: 50, docs: [] });

            const service = await setupService(flowiseRequest);
            await service.search(buildRequest({
                topK: 10,
                filters: { regionContains: 'Тверская' },
            }));

            const queryCall = flowiseRequest.mock.calls.find(
                (call) => call[0] === ENDPOINTS.vectorstoreQuery,
            );
            const body = ((queryCall as unknown[])[1] as { body: { topK: number } }).body;
            expect(body.topK).toBe(50); // 10 * 5
        });

        it('без фильтров: запрашивает ровно topK (без oversample)', async () => {
            const flowiseRequest = jest.fn();
            flowiseRequest
                .mockResolvedValueOnce([{ id: 'wa-store', name: WATER_ANALYSIS_AQUAPHOR_STORE_NAME }])
                .mockResolvedValueOnce({ timeTaken: 50, docs: [] });

            const service = await setupService(flowiseRequest);
            await service.search(buildRequest({ topK: 10 }));

            const queryCall = flowiseRequest.mock.calls.find(
                (call) => call[0] === ENDPOINTS.vectorstoreQuery,
            );
            const body = ((queryCall as unknown[])[1] as { body: { topK: number } }).body;
            expect(body.topK).toBe(10);
        });

        it('обрезает результат до topK после фильтра (slice)', async () => {
            const docs = Array.from({ length: 30 }, (_, i) => ({
                id: `${i}`,
                metadata: { orderNumber: `${i}`, intakeType: 'well' },
            }));
            const service = await setupWithDocs(docs);
            const result = await service.search(buildRequest({
                topK: 5,
                intakeType: 'well',
                filters: { matchIntakeType: true },
            }));
            expect(result.count).toBe(5);
            expect(result.blanks).toHaveLength(5);
        });

        it('geo filter — 501 NotImplemented', async () => {
            const flowiseRequest = jest.fn();
            const service = await setupService(flowiseRequest);
            await expect(
                service.search(buildRequest({
                    filters: { geo: { lat: 55.75, lon: 37.61, radiusKm: 50 } },
                })),
            ).rejects.toThrow(/not implemented/i);
            // Flowise не должен дёргаться
            expect(flowiseRequest).not.toHaveBeenCalled();
        });
    });

    it('fail-soft на metadata drift — отсутствующие nullable поля становятся null', async () => {
        const flowiseRequest = jest.fn();
        flowiseRequest
            .mockResolvedValueOnce([{ id: 'wa-store', name: WATER_ANALYSIS_AQUAPHOR_STORE_NAME }])
            .mockResolvedValueOnce({
                docs: [
                    {
                        id: 'chunk-2',
                        pageContent: 'pc',
                        metadata: {
                            orderNumber: '777',
                            intakeType: 'municipal',
                            // depthMeters / region / locality / lat / lon отсутствуют
                        },
                    },
                ],
                timeTaken: 100,
            });

        const service = await setupService(flowiseRequest);
        const result = await service.search(buildRequest());

        expect(result.blanks[0].depthMeters).toBeNull();
        expect(result.blanks[0].region).toBeNull();
        expect(result.blanks[0].locality).toBeNull();
        expect(result.blanks[0].lat).toBeNull();
        expect(result.blanks[0].lon).toBeNull();
    });
});
