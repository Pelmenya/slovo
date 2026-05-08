import { Test, type TestingModule } from '@nestjs/testing';
import {
    DEPTH_MAP_THROTTLE_LIMIT,
    DEPTH_MAP_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import { DepthMapController } from './depth-map.controller';
import { DepthMapService } from './depth-map.service';
import type { DepthMapQueryDto } from './dto/depth-map.request.dto';
import type { DepthMapResponseDto } from './dto/depth-map.response.dto';

// =============================================================================
// DepthMapController unit-тесты — тонкий слой:
//   1. delegation на service.query
//   2. возврат результата as-is
//   3. presence of @Throttle metadata (smoke check через Reflect.getMetadata)
//   4. async signature
//
// DTO-валидация проверяется в e2e (ValidationPipe + class-validator). В unit
// проверяем только подачу DTO в service.
// =============================================================================

describe('DepthMapController', () => {
    let controller: DepthMapController;
    let serviceMock: { query: jest.Mock };

    beforeEach(async () => {
        serviceMock = { query: jest.fn() };
        const moduleRef: TestingModule = await Test.createTestingModule({
            controllers: [DepthMapController],
            providers: [{ provide: DepthMapService, useValue: serviceMock }],
        }).compile();
        controller = moduleRef.get(DepthMapController);
    });

    function buildDto(overrides: Partial<DepthMapQueryDto> = {}): DepthMapQueryDto {
        return {
            intakeType: overrides.intakeType,
            west: overrides.west ?? 36.5,
            south: overrides.south ?? 54.8,
            east: overrides.east ?? 39.0,
            north: overrides.north ?? 56.5,
            grid: overrides.grid,
        } as DepthMapQueryDto;
    }

    it('делегирует на service.query и возвращает результат as-is', async () => {
        const expected: DepthMapResponseDto = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [37.625, 55.755] },
                    properties: {
                        count: 23,
                        median: 47.5,
                        p25: 32.0,
                        p75: 71.0,
                        minDepth: 12,
                        maxDepth: 145,
                        aquiferLayers: [
                            { id: 'top_water', label: '0-15m / Верховодка', count: 1, pct: 4 },
                            { id: 'sandy', label: '15-50m / Песчаный', count: 12, pct: 52 },
                            {
                                id: 'sandy_limestone',
                                label: '50-100m / Песчано-известняковый',
                                count: 8,
                                pct: 35,
                            },
                            { id: 'limestone', label: '100-200m / Известняковый', count: 2, pct: 9 },
                            { id: 'artesian', label: '200m+ / Артезианский', count: 0, pct: 0 },
                        ],
                        dominantLayerId: 'sandy',
                        pctWell: 87,
                    },
                },
            ],
            intakeType: 'all',
            grid: 0.05,
            timeTakenMs: 87,
            cached: false,
        };
        serviceMock.query.mockResolvedValueOnce(expected);
        const dto = buildDto();

        const result = await controller.depthMap(dto);

        expect(serviceMock.query).toHaveBeenCalledTimes(1);
        expect(serviceMock.query).toHaveBeenCalledWith(dto);
        expect(result).toBe(expected);
    });

    it('пробрасывает ошибки service наружу (BadRequestException / Prisma error)', async () => {
        serviceMock.query.mockRejectedValueOnce(
            new Error('bbox.west (40) должен быть < bbox.east (40)'),
        );

        await expect(controller.depthMap(buildDto({ west: 40, east: 40 }))).rejects.toThrow(
            /bbox.west/,
        );
    });

    it('@Throttle metadata присутствует с правильными лимитами', () => {
        // @nestjs/throttler хранит метаданные через Reflect под ключами вида
        // `THROTTLER:LIMIT<scope>` и `THROTTLER:TTL<scope>` (см. throttler.decorator.js).
        // Scope для нашего декоратора = 'default'.
        const handler = controller.depthMap;
        const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handler) as unknown;
        const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', handler) as unknown;

        expect(limit).toBe(DEPTH_MAP_THROTTLE_LIMIT);
        expect(ttl).toBe(DEPTH_MAP_THROTTLE_TTL_MS);
    });

    it('возвращает Promise (async signature)', () => {
        serviceMock.query.mockResolvedValueOnce({
            type: 'FeatureCollection',
            features: [],
            intakeType: 'well',
            grid: 0.05,
            timeTakenMs: 10,
            cached: false,
        });
        const result = controller.depthMap(buildDto({ intakeType: 'well' }));
        expect(result).toBeInstanceOf(Promise);
    });
});
