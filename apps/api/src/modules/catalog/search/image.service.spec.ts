import { BadRequestException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FlowiseClient } from '@slovo/flowise-client';
import { FlowiseError } from '@slovo/flowise-client';
import { FLOWISE_CLIENT_TOKEN, VISION_CHATFLOW_NAME } from '../catalog.constants';
import type { SearchTextResponseDto } from './dto/search-text.response.dto';
import { ImageSearchService } from './image.service';
import { TextSearchService } from './text.service';

type TFlowiseClientMock = { request: jest.Mock };
type TTextSearchServiceMock = { search: jest.Mock };

const TEST_CHATFLOW_ID = 'vision-flow-test-id';
const SAMPLE_IMAGE_BASE64 = 'aGVsbG8gd29ybGQ='; // "hello world" — pseudo-image для тестов
const SAMPLE_MIME = 'image/jpeg';

const SAMPLE_TEXT_RESPONSE: SearchTextResponseDto = {
    count: 1,
    timeTakenMs: 312,
    docs: [
        {
            id: 'chunk-1',
            pageContent: 'Аквафор DWM-101S',
            metadata: { externalId: 'mu-1', name: 'Аквафор DWM-101S' },
            imageUrls: ['https://signed/image.jpg'],
        },
    ],
};

const SAMPLE_VISION_OUTPUT_RAW = {
    is_relevant: true,
    category: 'обратный осмос',
    brand: 'Аквафор',
    model_hint: 'DWM-101S',
    description_ru: 'Фильтр обратного осмоса с пятью ступенями очистки',
    confidence: 'high',
    features: ['пять ступеней', 'минерализатор'],
    condition: 'новый в упаковке',
};

function preCacheChatflowId(svc: ImageSearchService, id = TEST_CHATFLOW_ID): void {
    (svc as unknown as { chatflowIdPromise: Promise<string> | null }).chatflowIdPromise =
        Promise.resolve(id);
}

describe('ImageSearchService', () => {
    let service: ImageSearchService;
    let flowise: TFlowiseClientMock;
    let textSearch: TTextSearchServiceMock;

    beforeEach(async () => {
        flowise = { request: jest.fn() };
        textSearch = { search: jest.fn() };

        const moduleRef = await Test.createTestingModule({
            providers: [
                ImageSearchService,
                { provide: FLOWISE_CLIENT_TOKEN, useValue: flowise as unknown as FlowiseClient },
                { provide: TextSearchService, useValue: textSearch as unknown as TextSearchService },
            ],
        }).compile();

        service = moduleRef.get(ImageSearchService);
        preCacheChatflowId(service);
    });

    describe('happy path — image → vision → reuse text search', () => {
        it('делает Vision predict, парсит JSON, делегирует в textSearch', async () => {
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify(SAMPLE_VISION_OUTPUT_RAW),
            });
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESPONSE);

            const result = await service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME, 5);

            // Vision call с правильным uploads payload
            expect(flowise.request).toHaveBeenCalledWith(
                expect.stringContaining(`/prediction/${TEST_CHATFLOW_ID}`),
                expect.objectContaining({
                    method: 'POST',
                    body: expect.objectContaining({
                        question: '',
                        uploads: [
                            expect.objectContaining({
                                data: `data:${SAMPLE_MIME};base64,${SAMPLE_IMAGE_BASE64}`,
                                type: 'file',
                                mime: SAMPLE_MIME,
                            }),
                        ],
                    }),
                }),
            );

            // Delegation в textSearch с description_ru как query
            expect(textSearch.search).toHaveBeenCalledWith(
                SAMPLE_VISION_OUTPUT_RAW.description_ru,
                5,
            );

            // Response shape — текст docs + visionOutput
            expect(result.count).toBe(1);
            expect(result.docs).toEqual(SAMPLE_TEXT_RESPONSE.docs);
            expect(result.visionOutput).toEqual({
                isRelevant: true,
                category: 'обратный осмос',
                brand: 'Аквафор',
                modelHint: 'DWM-101S',
                descriptionRu: SAMPLE_VISION_OUTPUT_RAW.description_ru,
                confidence: 'high',
            });
        });

        it('topK не передан → service сам подставит default через textSearch', async () => {
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify(SAMPLE_VISION_OUTPUT_RAW),
            });
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESPONSE);

            await service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME);

            expect(textSearch.search).toHaveBeenCalledWith(
                SAMPLE_VISION_OUTPUT_RAW.description_ru,
                undefined,
            );
        });
    });

    describe('vision is_relevant=false → BadRequestException', () => {
        it('возвращает 400 с visionOutput hint, не вызывает textSearch', async () => {
            const irrelevantOutput = {
                is_relevant: false,
                category: 'прочее',
                brand: null,
                model_hint: null,
                description_ru: '',
                confidence: 'low',
            };
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify(irrelevantOutput),
            });

            await expect(service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME)).rejects.toBeInstanceOf(
                BadRequestException,
            );

            expect(textSearch.search).not.toHaveBeenCalled();
        });

        it('включает visionOutput в exception response для UX hint', async () => {
            const irrelevantOutput = {
                is_relevant: false,
                category: 'прочее',
                description_ru: 'Кот на фоне дивана',
                confidence: 'high',
            };
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify(irrelevantOutput),
            });

            try {
                await service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME);
                fail('Expected BadRequestException');
            } catch (error) {
                expect(error).toBeInstanceOf(BadRequestException);
                const response = (error as BadRequestException).getResponse() as Record<
                    string,
                    unknown
                >;
                expect(response.message).toContain('not relevant');
                expect(response.visionOutput).toMatchObject({
                    isRelevant: false,
                    descriptionRu: 'Кот на фоне дивана',
                });
            }
        });
    });

    describe('vision response parsing — defensive', () => {
        it('JSON в markdown wrapper ```json...``` → parses корректно', async () => {
            const wrapped = '```json\n' + JSON.stringify(SAMPLE_VISION_OUTPUT_RAW) + '\n```';
            flowise.request.mockResolvedValueOnce({ text: wrapped });
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESPONSE);

            const result = await service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME);
            expect(result.visionOutput.isRelevant).toBe(true);
        });

        it('пустой response.text → throw', async () => {
            flowise.request.mockResolvedValueOnce({ text: '' });

            await expect(service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME)).rejects.toThrow(
                /Vision response empty/,
            );
        });

        it('невалидный JSON → throw с descriptive error', async () => {
            flowise.request.mockResolvedValueOnce({ text: 'not json at all' });

            await expect(service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME)).rejects.toThrow(
                /Vision output is not valid JSON/,
            );
        });

        it('JSON без is_relevant поля → throw', async () => {
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify({ category: 'прочее', description_ru: 'foo' }),
            });

            await expect(service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME)).rejects.toThrow(
                /missing required field "is_relevant"/,
            );
        });

        it('is_relevant=true но description_ru пуст → throw', async () => {
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify({ is_relevant: true, description_ru: '' }),
            });

            await expect(service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME)).rejects.toThrow(
                /description_ru empty/,
            );
        });

        it('опциональные поля null/missing → дефолтные значения', async () => {
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify({
                    is_relevant: true,
                    description_ru: 'Минимально валидный output',
                    // category, brand, model_hint, confidence отсутствуют
                }),
            });
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESPONSE);

            const result = await service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME);

            expect(result.visionOutput).toEqual({
                isRelevant: true,
                category: null,
                brand: null,
                modelHint: null,
                descriptionRu: 'Минимально валидный output',
                confidence: 'low', // fallback при missing
            });
        });

        it('невалидный confidence → fallback на "low"', async () => {
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify({
                    ...SAMPLE_VISION_OUTPUT_RAW,
                    confidence: 'super-high', // не enum
                }),
            });
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESPONSE);

            const result = await service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME);
            expect(result.visionOutput.confidence).toBe('low');
        });
    });

    describe('chatflowId resolution — name lookup на старте', () => {
        beforeEach(() => {
            (service as unknown as { chatflowIdPromise: Promise<string> | null }).chatflowIdPromise =
                null;
        });

        it('первый search → list chatflows → найти по name → cache id', async () => {
            flowise.request
                .mockResolvedValueOnce([
                    { id: 'other-id', name: 'other-flow' },
                    { id: TEST_CHATFLOW_ID, name: VISION_CHATFLOW_NAME },
                ])
                .mockResolvedValueOnce({ text: JSON.stringify(SAMPLE_VISION_OUTPUT_RAW) });
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESPONSE);

            await service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME);

            expect(flowise.request).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining('/chatflows'),
            );
            expect(flowise.request).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining(`/prediction/${TEST_CHATFLOW_ID}`),
                expect.anything(),
            );
        });

        it('chatflow не найден → throw, retry на следующем request', async () => {
            flowise.request
                .mockResolvedValueOnce([{ id: 'wrong', name: 'wrong-name' }])
                .mockResolvedValueOnce([{ id: TEST_CHATFLOW_ID, name: VISION_CHATFLOW_NAME }])
                .mockResolvedValueOnce({ text: JSON.stringify(SAMPLE_VISION_OUTPUT_RAW) });
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESPONSE);

            await expect(service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME)).rejects.toThrow(
                /not found/,
            );

            // retry должен сработать
            const result = await service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME);
            expect(result.visionOutput.isRelevant).toBe(true);
        });
    });

    describe('error propagation', () => {
        it('Flowise vision call упал → ошибка пробрасывается клиенту', async () => {
            flowise.request.mockRejectedValueOnce(
                new FlowiseError('Internal Server Error', 500),
            );

            await expect(service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME)).rejects.toBeInstanceOf(
                FlowiseError,
            );
            expect(textSearch.search).not.toHaveBeenCalled();
        });

        it('TextSearch упал → ошибка пробрасывается клиенту', async () => {
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify(SAMPLE_VISION_OUTPUT_RAW),
            });
            textSearch.search.mockRejectedValueOnce(new Error('Flowise vectorstore down'));

            await expect(service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME)).rejects.toThrow(
                'Flowise vectorstore down',
            );
        });
    });

    describe('logger', () => {
        it('chatflow lookup success → log message с id', async () => {
            const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
            (service as unknown as { chatflowIdPromise: Promise<string> | null }).chatflowIdPromise =
                null;
            flowise.request
                .mockResolvedValueOnce([{ id: TEST_CHATFLOW_ID, name: VISION_CHATFLOW_NAME }])
                .mockResolvedValueOnce({ text: JSON.stringify(SAMPLE_VISION_OUTPUT_RAW) });
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESPONSE);

            await service.search(SAMPLE_IMAGE_BASE64, SAMPLE_MIME);

            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining(VISION_CHATFLOW_NAME),
            );
            logSpy.mockRestore();
        });
    });
});
