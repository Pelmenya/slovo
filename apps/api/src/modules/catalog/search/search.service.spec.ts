import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BudgetService } from '../../budget';
import type { SearchResponseDto, VisionOutputDto } from './dto/search.response.dto';
import { ImageSearchService } from './image.service';
import { CatalogSearchService } from './search.service';
import { TextSearchService } from './text.service';

type TImageSearchMock = { processVision: jest.Mock };
type TTextSearchMock = { search: jest.Mock };
type TBudgetMock = {
    assertVisionBudget: jest.Mock;
    assertEmbeddingBudget: jest.Mock;
    recordVisionCall: jest.Mock;
    recordEmbeddingTokens: jest.Mock;
};

const SAMPLE_IMAGE = { base64: 'aGVsbG8=', mime: 'image/jpeg' as const };

const SAMPLE_VISION_OK: VisionOutputDto = {
    isRelevant: true,
    category: 'обратный осмос',
    brand: 'Аквафор',
    modelHint: 'DWM-101S',
    descriptionRu: 'Фильтр обратного осмоса',
    confidence: 'high',
};

const SAMPLE_VISION_IRRELEVANT: VisionOutputDto = {
    isRelevant: false,
    category: 'прочее',
    brand: null,
    modelHint: null,
    descriptionRu: 'Кот',
    confidence: 'high',
};

const SAMPLE_TEXT_RESULT: SearchResponseDto = {
    count: 1,
    timeTakenMs: 312,
    docs: [
        {
            id: 'chunk-1',
            pageContent: 'Аквафор DWM-101S',
            metadata: { externalId: 'mu-1' },
            imageUrls: ['https://signed/img.jpg'],
        },
    ],
};

describe('CatalogSearchService', () => {
    let service: CatalogSearchService;
    let imageSearch: TImageSearchMock;
    let textSearch: TTextSearchMock;
    let budget: TBudgetMock;

    beforeEach(async () => {
        imageSearch = { processVision: jest.fn() };
        textSearch = { search: jest.fn() };
        budget = {
            assertVisionBudget: jest.fn().mockResolvedValue(undefined),
            assertEmbeddingBudget: jest.fn().mockResolvedValue(undefined),
            recordVisionCall: jest.fn().mockResolvedValue(undefined),
            recordEmbeddingTokens: jest.fn().mockResolvedValue(undefined),
        };

        const moduleRef = await Test.createTestingModule({
            providers: [
                CatalogSearchService,
                { provide: ImageSearchService, useValue: imageSearch as unknown as ImageSearchService },
                { provide: TextSearchService, useValue: textSearch as unknown as TextSearchService },
                { provide: BudgetService, useValue: budget as unknown as BudgetService },
            ],
        }).compile();

        service = moduleRef.get(CatalogSearchService);
    });

    describe('text-only mode', () => {
        it('query без images → search(query) без visionOutput', async () => {
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESULT);

            const result = await service.search({ query: 'фильтр для жёсткой воды' });

            expect(textSearch.search).toHaveBeenCalledWith('фильтр для жёсткой воды', undefined);
            expect(imageSearch.processVision).not.toHaveBeenCalled();
            expect(result.count).toBe(1);
            expect(result.visionOutput).toBeUndefined();
        });

        it('передаёт topK во text search', async () => {
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESULT);

            await service.search({ query: 'тест', topK: 5 });

            expect(textSearch.search).toHaveBeenCalledWith('тест', 5);
        });
    });

    describe('image-only mode', () => {
        it('1 фото без query → vision describe → search(description_ru)', async () => {
            imageSearch.processVision.mockResolvedValueOnce(SAMPLE_VISION_OK);
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESULT);

            const result = await service.search({ images: [SAMPLE_IMAGE] });

            expect(imageSearch.processVision).toHaveBeenCalledWith([SAMPLE_IMAGE]);
            expect(textSearch.search).toHaveBeenCalledWith(SAMPLE_VISION_OK.descriptionRu, undefined);
            expect(result.visionOutput).toEqual(SAMPLE_VISION_OK);
        });

        it('5 фото → передаются все в processVision одним вызовом', async () => {
            imageSearch.processVision.mockResolvedValueOnce(SAMPLE_VISION_OK);
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESULT);

            const fiveImages = [1, 2, 3, 4, 5].map((i) => ({
                base64: `imageBase64_${i}`,
                mime: 'image/jpeg' as const,
            }));

            await service.search({ images: fiveImages });

            expect(imageSearch.processVision).toHaveBeenCalledTimes(1);
            expect(imageSearch.processVision).toHaveBeenCalledWith(fiveImages);
        });

        it('is_relevant=false → 400 с visionOutput hint, textSearch не вызывается', async () => {
            imageSearch.processVision.mockResolvedValueOnce(SAMPLE_VISION_IRRELEVANT);

            await expect(service.search({ images: [SAMPLE_IMAGE] })).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(textSearch.search).not.toHaveBeenCalled();
        });

        it('exception payload содержит visionOutput для UX hint', async () => {
            imageSearch.processVision.mockResolvedValueOnce(SAMPLE_VISION_IRRELEVANT);

            try {
                await service.search({ images: [SAMPLE_IMAGE] });
                fail('expected BadRequestException');
            } catch (err) {
                const response = (err as BadRequestException).getResponse() as Record<string, unknown>;
                expect(response.message).toContain('not relevant');
                expect(response.visionOutput).toMatchObject({ isRelevant: false });
            }
        });
    });

    describe('combined mode (query + images)', () => {
        it('query + 1 фото → effective query = "userText description_ru"', async () => {
            imageSearch.processVision.mockResolvedValueOnce(SAMPLE_VISION_OK);
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESULT);

            await service.search({
                query: 'для жёсткой воды',
                images: [SAMPLE_IMAGE],
            });

            expect(textSearch.search).toHaveBeenCalledWith(
                `для жёсткой воды ${SAMPLE_VISION_OK.descriptionRu}`,
                undefined,
            );
        });

        it('query + 3 фото → vision combine + text concat', async () => {
            imageSearch.processVision.mockResolvedValueOnce(SAMPLE_VISION_OK);
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESULT);

            const threeImages = [SAMPLE_IMAGE, SAMPLE_IMAGE, SAMPLE_IMAGE];
            const result = await service.search({
                query: 'дополнительный текст',
                images: threeImages,
                topK: 7,
            });

            expect(imageSearch.processVision).toHaveBeenCalledWith(threeImages);
            expect(textSearch.search).toHaveBeenCalledWith(
                `дополнительный текст ${SAMPLE_VISION_OK.descriptionRu}`,
                7,
            );
            expect(result.visionOutput).toEqual(SAMPLE_VISION_OK);
        });
    });

    describe('validation', () => {
        it('ни query, ни images → 400 BadRequest', async () => {
            await expect(service.search({})).rejects.toBeInstanceOf(BadRequestException);
            expect(imageSearch.processVision).not.toHaveBeenCalled();
            expect(textSearch.search).not.toHaveBeenCalled();
        });

        it('пустой images массив (length=0) тоже → 400', async () => {
            await expect(service.search({ images: [] })).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });
    });

    describe('error propagation', () => {
        it('Vision упал → ошибка пробрасывается', async () => {
            imageSearch.processVision.mockRejectedValueOnce(new Error('Vision down'));

            await expect(
                service.search({ images: [SAMPLE_IMAGE] }),
            ).rejects.toThrow('Vision down');
        });

        it('TextSearch упал → ошибка пробрасывается', async () => {
            textSearch.search.mockRejectedValueOnce(new Error('Vector store down'));

            await expect(service.search({ query: 'тест' })).rejects.toThrow('Vector store down');
        });
    });

    describe('budget cap (#21)', () => {
        it('text-only: assertEmbeddingBudget вызывается, recordEmbeddingTokens после search', async () => {
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESULT);

            await service.search({ query: 'фильтр' });

            expect(budget.assertVisionBudget).not.toHaveBeenCalled();
            expect(budget.assertEmbeddingBudget).toHaveBeenCalledTimes(1);
            expect(budget.recordVisionCall).not.toHaveBeenCalled();
            expect(budget.recordEmbeddingTokens).toHaveBeenCalledTimes(1);
        });

        it('image-only: assertVisionBudget + assertEmbeddingBudget + record оба', async () => {
            imageSearch.processVision.mockResolvedValueOnce(SAMPLE_VISION_OK);
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESULT);

            await service.search({ images: [SAMPLE_IMAGE] });

            expect(budget.assertVisionBudget).toHaveBeenCalledTimes(1);
            expect(budget.assertEmbeddingBudget).toHaveBeenCalledTimes(1);
            expect(budget.recordVisionCall).toHaveBeenCalledTimes(1);
            // 1 image × $0.007 = $0.007
            expect(budget.recordVisionCall).toHaveBeenCalledWith(0.007);
            expect(budget.recordEmbeddingTokens).toHaveBeenCalledTimes(1);
        });

        it('multi-image (5 фото): recordVisionCall с linear cost (5 × $0.007)', async () => {
            imageSearch.processVision.mockResolvedValueOnce(SAMPLE_VISION_OK);
            textSearch.search.mockResolvedValueOnce(SAMPLE_TEXT_RESULT);

            const fiveImages = Array.from({ length: 5 }, () => SAMPLE_IMAGE);
            await service.search({ images: fiveImages });

            expect(budget.recordVisionCall).toHaveBeenCalledWith(0.035); // 5 × 0.007
        });

        it('vision budget exceeded → 503 ServiceUnavailable, vision не вызывался', async () => {
            budget.assertVisionBudget.mockRejectedValueOnce(
                new ServiceUnavailableException({
                    message: 'Daily vision budget exceeded',
                    spent_usd: 5.01,
                    budget_usd: 5,
                }),
            );

            await expect(
                service.search({ images: [SAMPLE_IMAGE] }),
            ).rejects.toBeInstanceOf(ServiceUnavailableException);

            expect(imageSearch.processVision).not.toHaveBeenCalled();
            expect(budget.recordVisionCall).not.toHaveBeenCalled();
        });

        it('embedding budget exceeded → 503, downstream search не вызывался', async () => {
            budget.assertEmbeddingBudget.mockRejectedValueOnce(
                new ServiceUnavailableException({
                    message: 'Daily embedding budget exceeded',
                }),
            );

            await expect(service.search({ query: 'тест' })).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );

            expect(textSearch.search).not.toHaveBeenCalled();
            expect(budget.recordEmbeddingTokens).not.toHaveBeenCalled();
        });

        it('vision is_relevant=false → recordVisionCall ВЫЗЫВАЕТСЯ (Anthropic уже забилл)', async () => {
            // Важно: Anthropic забиллил вызов independent от is_relevant
            // outcome. Наш 400 — это OUR rejection результата, не Anthropic
            // failure. Counter должен инкрементиться.
            imageSearch.processVision.mockResolvedValueOnce(SAMPLE_VISION_IRRELEVANT);

            await expect(
                service.search({ images: [SAMPLE_IMAGE] }),
            ).rejects.toBeInstanceOf(BadRequestException);

            expect(budget.recordVisionCall).toHaveBeenCalledTimes(1);
            // Embedding не должен записываться — text search не выполнился
            expect(budget.recordEmbeddingTokens).not.toHaveBeenCalled();
        });
    });
});
