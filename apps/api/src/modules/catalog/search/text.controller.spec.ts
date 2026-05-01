import { Test, type TestingModule } from '@nestjs/testing';
import type { SearchTextResponseDto } from './dto/search-text.response.dto';
import { TextSearchController } from './text.controller';
import { TextSearchService } from './text.service';

type TTextSearchServiceMock = {
    search: jest.Mock<Promise<SearchTextResponseDto>, [string, number?]>;
};

const SAMPLE_RESPONSE: SearchTextResponseDto = {
    count: 1,
    timeTakenMs: 312,
    docs: [
        {
            id: 'chunk-42',
            pageContent: 'Товар: Аквафор DWM-101S',
            metadata: { externalId: 'mu-1' },
            imageUrls: ['https://signed/url1'],
        },
    ],
};

describe('TextSearchController', () => {
    let controller: TextSearchController;
    let service: TTextSearchServiceMock;

    beforeEach(async () => {
        service = {
            search: jest.fn<Promise<SearchTextResponseDto>, [string, number?]>(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [TextSearchController],
            providers: [{ provide: TextSearchService, useValue: service }],
        }).compile();

        controller = module.get(TextSearchController);
    });

    it('делегирует в service.search с query + topK', async () => {
        service.search.mockResolvedValue(SAMPLE_RESPONSE);

        const result = await controller.search({ query: 'фильтр', topK: 5 });

        expect(service.search).toHaveBeenCalledWith('фильтр', 5);
        expect(result).toBe(SAMPLE_RESPONSE);
    });

    it('topK undefined — service сам подставит default', async () => {
        service.search.mockResolvedValue(SAMPLE_RESPONSE);

        await controller.search({ query: 'фильтр' });

        expect(service.search).toHaveBeenCalledWith('фильтр', undefined);
    });

    it('возвращает ровно то что отдал service', async () => {
        service.search.mockResolvedValue(SAMPLE_RESPONSE);

        const result = await controller.search({ query: 'тест' });

        expect(result).toEqual(SAMPLE_RESPONSE);
    });

    it('пробрасывает ошибки из service', async () => {
        service.search.mockRejectedValue(new Error('Flowise down'));

        await expect(controller.search({ query: 'тест' })).rejects.toThrow('Flowise down');
    });
});
