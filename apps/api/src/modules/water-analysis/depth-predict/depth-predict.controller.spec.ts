import { Test, type TestingModule } from '@nestjs/testing';
import {
    AQUIFER_LAYERS,
    DEPTH_PREDICT_THROTTLE_LIMIT,
    DEPTH_PREDICT_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import { DepthPredictController } from './depth-predict.controller';
import { DepthPredictService } from './depth-predict.service';
import type { DepthPredictQueryDto } from './dto/depth-predict.request.dto';
import type { DepthPredictResponseDto } from './dto/depth-predict.response.dto';

// =============================================================================
// DepthPredictController unit-тесты — тонкий слой:
//   1. delegation на service.predict
//   2. возврат результата as-is
//   3. presence of @Throttle metadata (smoke check через Reflect.getMetadata)
//   4. async signature (Promise)
//
// DTO-валидация проверяется в e2e (ValidationPipe + class-validator).
// =============================================================================

describe('DepthPredictController', () => {
    let controller: DepthPredictController;
    let serviceMock: { predict: jest.Mock };

    beforeEach(async () => {
        serviceMock = { predict: jest.fn() };
        const moduleRef: TestingModule = await Test.createTestingModule({
            controllers: [DepthPredictController],
            providers: [{ provide: DepthPredictService, useValue: serviceMock }],
        }).compile();
        controller = moduleRef.get(DepthPredictController);
    });

    function buildDto(overrides: Partial<DepthPredictQueryDto> = {}): DepthPredictQueryDto {
        return {
            lat: overrides.lat ?? 55.7558,
            lon: overrides.lon ?? 37.6173,
            intakeType: overrides.intakeType,
            k: overrides.k,
            radiusKm: overrides.radiusKm,
        } as DepthPredictQueryDto;
    }

    it('делегирует на service.predict и возвращает результат as-is', async () => {
        const expected: DepthPredictResponseDto = {
            predicted: {
                interval: { lower: 25, upper: 95, confidence: 80 },
                iqr: { lower: 32, upper: 71, confidence: 50 },
                hardRange: { lower: 12, upper: 145, confidence: 100 },
                pointEstimate: 47.5,
                n: 18,
            },
            layerDistribution: AQUIFER_LAYERS.map((l) => ({
                id: l.id,
                label: l.label,
                count: 0,
                pct: 0,
            })),
            nNeighbors: 18,
            medianDistKm: 4.7,
            intakeType: 'well',
            radiusKm: 50,
            insufficientData: false,
            timeTakenMs: 47,
            cached: false,
        };
        serviceMock.predict.mockResolvedValueOnce(expected);
        const dto = buildDto({ intakeType: 'well' });

        const result = await controller.depthPredict(dto);

        expect(serviceMock.predict).toHaveBeenCalledTimes(1);
        expect(serviceMock.predict).toHaveBeenCalledWith(dto);
        expect(result).toBe(expected);
    });

    it('пробрасывает ошибки service наружу', async () => {
        serviceMock.predict.mockRejectedValueOnce(new Error('SQL connection lost'));
        await expect(controller.depthPredict(buildDto())).rejects.toThrow(/SQL connection lost/);
    });

    it('@Throttle metadata присутствует с DEPTH_PREDICT_THROTTLE_LIMIT/DEPTH_PREDICT_THROTTLE_TTL_MS', () => {
        // @nestjs/throttler хранит метаданные через Reflect под ключами вида
        // `THROTTLER:LIMIT<scope>` и `THROTTLER:TTL<scope>`. Scope = 'default'.
        const handler = controller.depthPredict;
        const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handler) as unknown;
        const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', handler) as unknown;

        expect(limit).toBe(DEPTH_PREDICT_THROTTLE_LIMIT);
        expect(ttl).toBe(DEPTH_PREDICT_THROTTLE_TTL_MS);
    });

    it('возвращает Promise (async signature)', () => {
        serviceMock.predict.mockResolvedValueOnce({
            predicted: null,
            layerDistribution: AQUIFER_LAYERS.map((l) => ({
                id: l.id,
                label: l.label,
                count: 0,
                pct: 0,
            })),
            nNeighbors: 0,
            medianDistKm: 0,
            intakeType: 'well',
            radiusKm: 50,
            insufficientData: true,
            timeTakenMs: 5,
            cached: false,
        });
        const result = controller.depthPredict(buildDto());
        expect(result).toBeInstanceOf(Promise);
    });
});
