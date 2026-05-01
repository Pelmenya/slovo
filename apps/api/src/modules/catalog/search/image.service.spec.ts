import { BadGatewayException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FlowiseClient } from '@slovo/flowise-client';
import { FlowiseError } from '@slovo/flowise-client';
import { FLOWISE_CLIENT_TOKEN, VISION_CHATFLOW_NAME } from '../catalog.constants';
import { ImageSearchService } from './image.service';

type TFlowiseClientMock = { request: jest.Mock };

const TEST_CHATFLOW_ID = 'vision-flow-test-id';
const SAMPLE_IMAGE_BASE64 = 'aGVsbG8gd29ybGQ=';
const SAMPLE_MIME = 'image/jpeg';

const SAMPLE_VISION_OUTPUT_RAW = {
    is_relevant: true,
    category: 'обратный осмос',
    brand: 'Аквафор',
    model_hint: 'DWM-101S',
    description_ru: 'Фильтр обратного осмоса с пятью ступенями очистки',
    confidence: 'high',
    features: ['пять ступеней'],
    condition: 'новый',
};

function preCacheChatflowId(svc: ImageSearchService, id = TEST_CHATFLOW_ID): void {
    (svc as unknown as { chatflowIdPromise: Promise<string> | null }).chatflowIdPromise =
        Promise.resolve(id);
}

describe('ImageSearchService.processVision', () => {
    let service: ImageSearchService;
    let flowise: TFlowiseClientMock;

    beforeEach(async () => {
        flowise = { request: jest.fn() };

        const moduleRef = await Test.createTestingModule({
            providers: [
                ImageSearchService,
                { provide: FLOWISE_CLIENT_TOKEN, useValue: flowise as unknown as FlowiseClient },
            ],
        }).compile();

        service = moduleRef.get(ImageSearchService);
        preCacheChatflowId(service);
    });

    describe('happy path', () => {
        it('single image: делает Vision predict, парсит JSON, возвращает VisionOutputDto', async () => {
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify(SAMPLE_VISION_OUTPUT_RAW),
            });

            const result = await service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]);

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
                                name: 'image-0.jpeg',
                                mime: SAMPLE_MIME,
                            }),
                        ],
                    }),
                }),
            );

            expect(result).toEqual({
                isRelevant: true,
                category: 'обратный осмос',
                brand: 'Аквафор',
                modelHint: 'DWM-101S',
                descriptionRu: SAMPLE_VISION_OUTPUT_RAW.description_ru,
                confidence: 'high',
            });
        });

        it('multi-image (3 фото): все идут в один Vision call как uploads array', async () => {
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify(SAMPLE_VISION_OUTPUT_RAW),
            });

            const images = [
                { base64: 'aGVsbG8=', mime: 'image/jpeg' },
                { base64: 'd29ybGQ=', mime: 'image/png' },
                { base64: 'IS4=', mime: 'image/webp' },
            ];

            await service.processVision(images);

            const call = flowise.request.mock.calls[0];
            const body = call[1].body as { uploads: Array<{ data: string; name: string; mime: string }> };
            expect(body.uploads).toHaveLength(3);
            expect(body.uploads[0]).toEqual(
                expect.objectContaining({
                    data: 'data:image/jpeg;base64,aGVsbG8=',
                    name: 'image-0.jpeg',
                    mime: 'image/jpeg',
                }),
            );
            expect(body.uploads[1]).toEqual(
                expect.objectContaining({
                    data: 'data:image/png;base64,d29ybGQ=',
                    name: 'image-1.png',
                    mime: 'image/png',
                }),
            );
            expect(body.uploads[2]).toEqual(
                expect.objectContaining({
                    data: 'data:image/webp;base64,IS4=',
                    name: 'image-2.webp',
                    mime: 'image/webp',
                }),
            );
        });

        it('пустой массив → throw (invariant violation, должен быть пойман upstream)', async () => {
            await expect(service.processVision([])).rejects.toThrow(/empty images array/);
        });

        it('is_relevant=false возвращается as-is — caller сам решает что делать', async () => {
            const irrelevantOutput = {
                is_relevant: false,
                category: 'прочее',
                description_ru: 'Кот на фоне дивана',
                confidence: 'high',
            };
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify(irrelevantOutput),
            });

            const result = await service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]);

            expect(result.isRelevant).toBe(false);
            expect(result.descriptionRu).toBe('Кот на фоне дивана');
        });
    });

    describe('vision response parsing — defensive', () => {
        it('JSON в markdown wrapper ```json...``` → parses корректно', async () => {
            const wrapped = '```json\n' + JSON.stringify(SAMPLE_VISION_OUTPUT_RAW) + '\n```';
            flowise.request.mockResolvedValueOnce({ text: wrapped });

            const result = await service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]);
            expect(result.isRelevant).toBe(true);
        });

        it('пустой response.text → BadGatewayException', async () => {
            flowise.request.mockResolvedValueOnce({ text: '' });

            await expect(
                service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]),
            ).rejects.toBeInstanceOf(BadGatewayException);
        });

        it('невалидный JSON → BadGatewayException', async () => {
            flowise.request.mockResolvedValueOnce({ text: 'not json at all' });

            await expect(
                service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]),
            ).rejects.toThrow(/Vision output is not valid JSON/);
        });

        it('JSON-валидный null → BadGatewayException "not a JSON object"', async () => {
            flowise.request.mockResolvedValueOnce({ text: 'null' });

            await expect(
                service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]),
            ).rejects.toThrow(/not a JSON object/);
        });

        it('JSON-валидный array [] → BadGatewayException "not a JSON object"', async () => {
            flowise.request.mockResolvedValueOnce({ text: '[]' });

            await expect(
                service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]),
            ).rejects.toThrow(/not a JSON object/);
        });

        it('JSON-валидный primitive "string" → BadGatewayException', async () => {
            flowise.request.mockResolvedValueOnce({ text: '"hello"' });

            await expect(
                service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]),
            ).rejects.toThrow(/not a JSON object/);
        });

        it('JSON без is_relevant поля → BadGatewayException', async () => {
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify({ category: 'прочее', description_ru: 'foo' }),
            });

            await expect(
                service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]),
            ).rejects.toThrow(/missing required field "is_relevant"/);
        });

        it('is_relevant=true но description_ru пуст → BadGatewayException', async () => {
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify({ is_relevant: true, description_ru: '' }),
            });

            await expect(
                service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]),
            ).rejects.toThrow(/description_ru empty/);
        });

        it('опциональные поля null/missing → дефолтные значения', async () => {
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify({
                    is_relevant: true,
                    description_ru: 'Минимально валидный output',
                }),
            });

            const result = await service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]);

            expect(result).toEqual({
                isRelevant: true,
                category: null,
                brand: null,
                modelHint: null,
                descriptionRu: 'Минимально валидный output',
                confidence: 'low',
            });
        });

        it('невалидный confidence → fallback на "low"', async () => {
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify({
                    ...SAMPLE_VISION_OUTPUT_RAW,
                    confidence: 'super-high',
                }),
            });

            const result = await service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]);
            expect(result.confidence).toBe('low');
        });

        it('descriptionRu с control chars + HTML → sanitized', async () => {
            const adversarialDesc =
                'Фильтр' + String.fromCharCode(0) + 'обратного <script>alert(1)</script> осмоса';
            flowise.request.mockResolvedValueOnce({
                text: JSON.stringify({
                    is_relevant: true,
                    description_ru: adversarialDesc,
                    category: '<b>обратный</b>' + String.fromCharCode(127),
                    brand: 'Аквафор',
                    confidence: 'high',
                }),
            });

            const result = await service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]);

            // descriptionRu — без NUL, теги <script>/</script> удалены
            // (содержимое 'alert(1)' остаётся — basic strip, не full DOM)
            expect(result.descriptionRu).toBe('Фильтробратного alert(1) осмоса');
            expect(result.descriptionRu).not.toContain(String.fromCharCode(0));
            // category — без <b></b> и без DEL
            expect(result.category).toBe('обратный');
            expect(result.category).not.toContain(String.fromCharCode(127));
        });
    });

    describe('chatflowId resolution — name lookup на старте', () => {
        beforeEach(() => {
            (service as unknown as { chatflowIdPromise: Promise<string> | null }).chatflowIdPromise =
                null;
        });

        it('первый processVision → list chatflows → найти по name → cache id', async () => {
            flowise.request
                .mockResolvedValueOnce([
                    { id: 'other-id', name: 'other-flow' },
                    { id: TEST_CHATFLOW_ID, name: VISION_CHATFLOW_NAME },
                ])
                .mockResolvedValueOnce({ text: JSON.stringify(SAMPLE_VISION_OUTPUT_RAW) });

            await service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]);

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

            await expect(
                service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]),
            ).rejects.toThrow(/not found/);

            // retry на следующем request
            const result = await service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]);
            expect(result.isRelevant).toBe(true);
        });
    });

    describe('error propagation', () => {
        it('Flowise vision call упал → ошибка пробрасывается', async () => {
            flowise.request.mockRejectedValueOnce(
                new FlowiseError('Internal Server Error', 500),
            );

            await expect(
                service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]),
            ).rejects.toBeInstanceOf(FlowiseError);
        });
    });

    describe('logger', () => {
        it('chatflow lookup success → debug message с id', async () => {
            const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
            (service as unknown as { chatflowIdPromise: Promise<string> | null }).chatflowIdPromise =
                null;
            flowise.request
                .mockResolvedValueOnce([{ id: TEST_CHATFLOW_ID, name: VISION_CHATFLOW_NAME }])
                .mockResolvedValueOnce({ text: JSON.stringify(SAMPLE_VISION_OUTPUT_RAW) });

            await service.processVision([{ base64: SAMPLE_IMAGE_BASE64, mime: SAMPLE_MIME }]);

            expect(debugSpy).toHaveBeenCalledWith(
                expect.stringContaining(VISION_CHATFLOW_NAME),
            );
            debugSpy.mockRestore();
        });
    });
});
