import { Test, type TestingModule } from '@nestjs/testing';
import type { SearchImageResponseDto } from './dto/search-image.response.dto';
import { ImageSearchController } from './image.controller';
import { ImageSearchService } from './image.service';

type TImageSearchServiceMock = {
    search: jest.Mock<Promise<SearchImageResponseDto>, [string, string, number?]>;
};

const SAMPLE_RESPONSE: SearchImageResponseDto = {
    count: 1,
    timeTakenMs: 312,
    docs: [
        {
            id: 'chunk-42',
            pageContent: 'Аквафор DWM-101S',
            metadata: { externalId: 'mu-1' },
            imageUrls: ['https://signed/img.jpg'],
        },
    ],
    visionOutput: {
        isRelevant: true,
        category: 'обратный осмос',
        brand: 'Аквафор',
        modelHint: 'DWM-101S',
        descriptionRu: 'Фильтр обратного осмоса',
        confidence: 'high',
    },
};

describe('ImageSearchController', () => {
    let controller: ImageSearchController;
    let service: TImageSearchServiceMock;

    beforeEach(async () => {
        service = {
            search: jest.fn<Promise<SearchImageResponseDto>, [string, string, number?]>(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ImageSearchController],
            providers: [{ provide: ImageSearchService, useValue: service }],
        }).compile();

        controller = module.get(ImageSearchController);
    });

    it('делегирует в service.search с base64, mime, topK', async () => {
        service.search.mockResolvedValue(SAMPLE_RESPONSE);

        const result = await controller.search({
            imageBase64: 'aGVsbG8=',
            mime: 'image/jpeg',
            topK: 5,
        });

        expect(service.search).toHaveBeenCalledWith('aGVsbG8=', 'image/jpeg', 5);
        expect(result).toBe(SAMPLE_RESPONSE);
    });

    it('topK undefined — service сам подставит default', async () => {
        service.search.mockResolvedValue(SAMPLE_RESPONSE);

        await controller.search({ imageBase64: 'aGVsbG8=', mime: 'image/png' });

        expect(service.search).toHaveBeenCalledWith('aGVsbG8=', 'image/png', undefined);
    });

    it('возвращает ровно то что отдал service', async () => {
        service.search.mockResolvedValue(SAMPLE_RESPONSE);

        const result = await controller.search({ imageBase64: 'aGVsbG8=', mime: 'image/webp' });

        expect(result).toEqual(SAMPLE_RESPONSE);
    });

    it('пробрасывает ошибки из service', async () => {
        service.search.mockRejectedValue(new Error('Vision down'));

        await expect(
            controller.search({ imageBase64: 'aGVsbG8=', mime: 'image/jpeg' }),
        ).rejects.toThrow('Vision down');
    });
});
