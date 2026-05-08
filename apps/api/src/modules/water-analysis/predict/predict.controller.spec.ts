import { Test, type TestingModule } from '@nestjs/testing';
import {
    PREDICT_THROTTLE_LIMIT,
    PREDICT_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import type { PredictQueryDto } from './dto/predict.request.dto';
import type { PredictResponseDto } from './dto/predict.response.dto';
import { PredictController } from './predict.controller';
import { PredictService } from './predict.service';

// =============================================================================
// PredictController unit-тесты — тонкий слой:
//   1. delegation на service.predict
//   2. возврат результата as-is
//   3. presence of @Throttle metadata (smoke check через Reflect.getMetadata)
//   4. async signature (Promise)
//
// DTO-валидация проверяется в e2e (ValidationPipe + class-validator).
// =============================================================================

describe('PredictController', () => {
    let controller: PredictController;
    let serviceMock: { predict: jest.Mock };

    beforeEach(async () => {
        serviceMock = { predict: jest.fn() };
        const moduleRef: TestingModule = await Test.createTestingModule({
            controllers: [PredictController],
            providers: [{ provide: PredictService, useValue: serviceMock }],
        }).compile();
        controller = moduleRef.get(PredictController);
    });

    function buildDto(overrides: Partial<PredictQueryDto> = {}): PredictQueryDto {
        return {
            lat: overrides.lat ?? 55.7558,
            lon: overrides.lon ?? 37.6173,
            k: overrides.k,
            radiusKm: overrides.radiusKm,
        } as PredictQueryDto;
    }

    it('делегирует на service.predict и возвращает результат as-is', async () => {
        const expected: PredictResponseDto = {
            predicted: {
                iron_total: {
                    interval: { lower: 0.18, upper: 0.72, confidence: 80 },
                    iqr: { lower: 0.25, upper: 0.55, confidence: 50 },
                    hardRange: { lower: 0.05, upper: 1.5, confidence: 100 },
                    pointEstimate: 0.42,
                    n: 18,
                    pdkStatus: 'borderline',
                },
            },
            byCategory: {
                unsafe: [],
                concerning: [],
                borderline: ['iron_total'],
                safe: [],
                unmonitored: [],
            },
            nNeighbors: 18,
            medianDistKm: 1.5,
            radiusKm: 50,
            insufficientData: false,
            timeTakenMs: 47,
            cached: false,
        };
        serviceMock.predict.mockResolvedValueOnce(expected);
        const dto = buildDto();

        const result = await controller.predict(dto);

        expect(serviceMock.predict).toHaveBeenCalledTimes(1);
        expect(serviceMock.predict).toHaveBeenCalledWith(dto);
        expect(result).toBe(expected);
    });

    it('пробрасывает ошибки service наружу', async () => {
        serviceMock.predict.mockRejectedValueOnce(new Error('SQL connection lost'));
        await expect(controller.predict(buildDto())).rejects.toThrow(/SQL connection lost/);
    });

    it('@Throttle metadata присутствует с PREDICT_THROTTLE_LIMIT/PREDICT_THROTTLE_TTL_MS', () => {
        // @nestjs/throttler хранит метаданные через Reflect под ключами вида
        // `THROTTLER:LIMIT<scope>` и `THROTTLER:TTL<scope>` (см. throttler.decorator.js).
        // Scope для нашего декоратора = 'default'.
        const handler = controller.predict;
        const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handler) as unknown;
        const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', handler) as unknown;

        expect(limit).toBe(PREDICT_THROTTLE_LIMIT);
        expect(ttl).toBe(PREDICT_THROTTLE_TTL_MS);
    });

    it('возвращает Promise (async signature)', () => {
        serviceMock.predict.mockResolvedValueOnce({
            predicted: {},
            byCategory: {
                unsafe: [],
                concerning: [],
                borderline: [],
                safe: [],
                unmonitored: [],
            },
            nNeighbors: 0,
            medianDistKm: 0,
            radiusKm: 50,
            insufficientData: true,
            timeTakenMs: 5,
            cached: false,
        });
        const result = controller.predict(buildDto());
        expect(result).toBeInstanceOf(Promise);
    });
});
