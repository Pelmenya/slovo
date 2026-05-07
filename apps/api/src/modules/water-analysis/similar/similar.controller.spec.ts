import { Test, type TestingModule } from '@nestjs/testing';
import { SimilarSearchRequestDto } from './dto/similar.request.dto';
import { SimilarSearchResponseDto } from './dto/similar.response.dto';
import { SimilarSearchController } from './similar.controller';
import { SimilarSearchService } from './similar.service';

// =============================================================================
// SimilarSearchController unit-тесты — тонкий слой, проверяем delegation +
// shape ответа. Validation DTO покрыта e2e-тестами / class-validator
// контрактом самого DTO.
// =============================================================================

describe('SimilarSearchController', () => {
    let controller: SimilarSearchController;
    let serviceMock: { search: jest.Mock };

    beforeEach(async () => {
        serviceMock = { search: jest.fn() };
        const moduleRef: TestingModule = await Test.createTestingModule({
            controllers: [SimilarSearchController],
            providers: [{ provide: SimilarSearchService, useValue: serviceMock }],
        }).compile();
        controller = moduleRef.get(SimilarSearchController);
    });

    it('delegates на service.search и возвращает результат', async () => {
        const expectedResponse: SimilarSearchResponseDto = {
            count: 1,
            timeTakenMs: 500,
            blanks: [
                {
                    orderNumber: '14938',
                    intakeType: 'well',
                    depthMeters: 50,
                    region: 'Московская',
                    locality: 'Раменское',
                    lat: 55.6255,
                    lon: 38.1713,
                    pageContent: 'Скважина 50 м.',
                },
            ],
        };
        serviceMock.search.mockResolvedValueOnce(expectedResponse);

        const dto = new SimilarSearchRequestDto();
        dto.intakeType = 'well';
        dto.params = { ph: 7.2, iron_total: 1.5 };

        const result = await controller.similar(dto);

        expect(serviceMock.search).toHaveBeenCalledWith(dto);
        expect(result).toBe(expectedResponse);
    });

    it('пробрасывает ошибки service наружу (404 store / Flowise timeout)', async () => {
        const dto = new SimilarSearchRequestDto();
        dto.intakeType = 'municipal';
        dto.params = { ph: 7.5 };

        serviceMock.search.mockRejectedValueOnce(
            new Error('Document Store "water-analysis-aquaphor" not found in Flowise'),
        );

        await expect(controller.similar(dto)).rejects.toThrow(/not found/);
    });
});
