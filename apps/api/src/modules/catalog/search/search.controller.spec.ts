import { Test, type TestingModule } from '@nestjs/testing';
import type { SearchResponseDto } from './dto/search.response.dto';
import { CatalogSearchController } from './search.controller';
import { CatalogSearchService } from './search.service';

type TServiceMock = {
    search: jest.Mock<Promise<SearchResponseDto>, [Record<string, unknown>]>;
};

const SAMPLE_RESPONSE: SearchResponseDto = {
    count: 1,
    timeTakenMs: 312,
    docs: [
        {
            id: 'chunk-42',
            pageContent: 'Аквафор',
            metadata: { externalId: 'mu-1' },
            imageUrls: ['https://signed/url'],
        },
    ],
};

describe('CatalogSearchController', () => {
    let controller: CatalogSearchController;
    let service: TServiceMock;

    beforeEach(async () => {
        service = {
            search: jest.fn<Promise<SearchResponseDto>, [Record<string, unknown>]>(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [CatalogSearchController],
            providers: [{ provide: CatalogSearchService, useValue: service }],
        }).compile();

        controller = module.get(CatalogSearchController);
    });

    it('делегирует в service.search с полным dto', async () => {
        service.search.mockResolvedValue(SAMPLE_RESPONSE);

        const dto = { query: 'фильтр', topK: 5 };
        const result = await controller.search(dto);

        expect(service.search).toHaveBeenCalledWith(dto);
        expect(result).toBe(SAMPLE_RESPONSE);
    });

    it('пробрасывает image-only dto', async () => {
        service.search.mockResolvedValue(SAMPLE_RESPONSE);

        const dto = { images: [{ base64: 'aGVsbG8=', mime: 'image/jpeg' }] };
        await controller.search(dto);

        expect(service.search).toHaveBeenCalledWith(dto);
    });

    it('пробрасывает combined dto', async () => {
        service.search.mockResolvedValue(SAMPLE_RESPONSE);

        const dto = {
            query: 'фильтр',
            images: [{ base64: 'aGVsbG8=', mime: 'image/jpeg' }],
            topK: 3,
        };
        await controller.search(dto);

        expect(service.search).toHaveBeenCalledWith(dto);
    });

    it('пробрасывает ошибки из service', async () => {
        service.search.mockRejectedValue(new Error('Service unavailable'));

        await expect(controller.search({ query: 'тест' })).rejects.toThrow('Service unavailable');
    });
});
