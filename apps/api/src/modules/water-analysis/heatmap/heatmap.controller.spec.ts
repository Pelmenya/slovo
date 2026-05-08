import { Test, type TestingModule } from '@nestjs/testing';
import {
    HEATMAP_THROTTLE_LIMIT,
    HEATMAP_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import type { HeatmapQueryDto } from './dto/heatmap.request.dto';
import type { HeatmapResponseDto } from './dto/heatmap.response.dto';
import { HeatmapController } from './heatmap.controller';
import { HeatmapService } from './heatmap.service';

// =============================================================================
// HeatmapController unit-тесты — тонкий слой:
//   1. delegation на service.query
//   2. возврат результата as-is
//   3. presence of @Throttle metadata (smoke check через Reflect.getMetadata)
//
// DTO-валидация проверяется в e2e (ValidationPipe + class-validator). В unit
// проверяем только подачу DTO в service.
// =============================================================================

describe('HeatmapController', () => {
    let controller: HeatmapController;
    let serviceMock: { query: jest.Mock };

    beforeEach(async () => {
        serviceMock = { query: jest.fn() };
        const moduleRef: TestingModule = await Test.createTestingModule({
            controllers: [HeatmapController],
            providers: [{ provide: HeatmapService, useValue: serviceMock }],
        }).compile();
        controller = moduleRef.get(HeatmapController);
    });

    function buildDto(overrides: Partial<HeatmapQueryDto> = {}): HeatmapQueryDto {
        return {
            param: overrides.param ?? 'iron_total',
            west: overrides.west ?? 36.5,
            south: overrides.south ?? 54.8,
            east: overrides.east ?? 39.0,
            north: overrides.north ?? 56.5,
            grid: overrides.grid,
        } as HeatmapQueryDto;
    }

    it('делегирует на service.query и возвращает результат as-is', async () => {
        const expected: HeatmapResponseDto = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [37.625, 55.755] },
                    properties: {
                        param: 'iron_total',
                        count: 23,
                        mean: 0.42,
                        median: 0.31,
                        p75: 0.65,
                        exceedsCount: 12,
                        exceedsPct: 52,
                        status: 'mid',
                    },
                },
            ],
            param: 'iron_total',
            pdk: 0.3,
            grid: 0.05,
            timeTakenMs: 87,
            cached: false,
        };
        serviceMock.query.mockResolvedValueOnce(expected);
        const dto = buildDto();

        const result = await controller.heatmap(dto);

        expect(serviceMock.query).toHaveBeenCalledTimes(1);
        expect(serviceMock.query).toHaveBeenCalledWith(dto);
        expect(result).toBe(expected);
    });

    it('пробрасывает ошибки service наружу (BadRequestException / Prisma error)', async () => {
        serviceMock.query.mockRejectedValueOnce(
            new Error('bbox.west (40) должен быть < bbox.east (40)'),
        );

        await expect(controller.heatmap(buildDto({ west: 40, east: 40 }))).rejects.toThrow(
            /bbox.west/,
        );
    });

    it('@Throttle metadata присутствует с правильными лимитами', () => {
        // @nestjs/throttler хранит метаданные через Reflect под ключами вида
        // `THROTTLER:LIMIT<scope>` и `THROTTLER:TTL<scope>` (см. throttler.decorator.js).
        // Scope для нашего декоратора = 'default'.
        const handler = controller.heatmap;
        const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handler) as unknown;
        const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', handler) as unknown;

        expect(limit).toBe(HEATMAP_THROTTLE_LIMIT);
        expect(ttl).toBe(HEATMAP_THROTTLE_TTL_MS);
    });

    it('возвращает Promise (async signature)', () => {
        serviceMock.query.mockResolvedValueOnce({
            type: 'FeatureCollection',
            features: [],
            param: 'risk',
            pdk: 50,
            grid: 0.05,
            timeTakenMs: 10,
            cached: false,
        });
        const result = controller.heatmap(buildDto({ param: 'risk' }));
        expect(result).toBeInstanceOf(Promise);
    });
});
