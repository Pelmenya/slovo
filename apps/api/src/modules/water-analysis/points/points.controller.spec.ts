import { Test, type TestingModule } from '@nestjs/testing';
import {
    POINTS_THROTTLE_LIMIT,
    POINTS_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import { PointsController } from './points.controller';
import { PointsService } from './points.service';
import type { PointsQueryDto } from './dto/points.request.dto';
import type { PointsResponseDto } from './dto/points.response.dto';

// =============================================================================
// PointsController unit-тесты — тонкий слой:
//   1. delegation на service.query
//   2. возврат результата as-is
//   3. presence of @Throttle metadata (smoke check через Reflect.getMetadata)
//   4. async signature
//
// DTO-валидация проверяется в e2e (ValidationPipe + class-validator). В unit
// проверяем только подачу DTO в service.
// =============================================================================

describe('PointsController', () => {
    let controller: PointsController;
    let serviceMock: { query: jest.Mock };

    beforeEach(async () => {
        serviceMock = { query: jest.fn() };
        const moduleRef: TestingModule = await Test.createTestingModule({
            controllers: [PointsController],
            providers: [{ provide: PointsService, useValue: serviceMock }],
        }).compile();
        controller = moduleRef.get(PointsController);
    });

    function buildDto(overrides: Partial<PointsQueryDto> = {}): PointsQueryDto {
        return {
            west: overrides.west ?? 36.5,
            south: overrides.south ?? 54.8,
            east: overrides.east ?? 39.0,
            north: overrides.north ?? 56.5,
            limit: overrides.limit,
        } as PointsQueryDto;
    }

    it('делегирует на service.query и возвращает результат as-is', async () => {
        const expected: PointsResponseDto = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [37.625, 55.755] },
                    properties: {
                        orderNumber: 'A-12345',
                        intakeType: 'well',
                        depthMeters: 45,
                        sampleDate: '2024-06-15',
                        region: 'Московская область',
                        locality: 'Раменское',
                        params: { iron_total: 0.42, hardness_total: 7.8 },
                        risk: 67,
                    },
                },
            ],
            count: 1,
            truncated: false,
            limit: 200,
            timeTakenMs: 34,
            cached: false,
        };
        serviceMock.query.mockResolvedValueOnce(expected);
        const dto = buildDto();

        const result = await controller.points(dto);

        expect(serviceMock.query).toHaveBeenCalledTimes(1);
        expect(serviceMock.query).toHaveBeenCalledWith(dto);
        expect(result).toBe(expected);
    });

    it('пробрасывает ошибки service наружу (BadRequestException / Prisma error)', async () => {
        serviceMock.query.mockRejectedValueOnce(
            new Error('bbox.west (40) должен быть < bbox.east (40)'),
        );

        await expect(controller.points(buildDto({ west: 40, east: 40 }))).rejects.toThrow(
            /bbox.west/,
        );
    });

    it('@Throttle metadata присутствует с правильными лимитами (120/min)', () => {
        // @nestjs/throttler хранит метаданные через Reflect под ключами вида
        // `THROTTLER:LIMIT<scope>` и `THROTTLER:TTL<scope>` (см. throttler.decorator.js).
        // Scope для нашего декоратора = 'default'.
        const handler = controller.points;
        const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handler) as unknown;
        const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', handler) as unknown;

        expect(limit).toBe(POINTS_THROTTLE_LIMIT);
        expect(ttl).toBe(POINTS_THROTTLE_TTL_MS);
        // Sanity — числа из задачи (120/60_000), а не из stale копий констант.
        expect(limit).toBe(120);
        expect(ttl).toBe(60_000);
    });

    it('возвращает Promise (async signature)', () => {
        serviceMock.query.mockResolvedValueOnce({
            type: 'FeatureCollection',
            features: [],
            count: 0,
            truncated: false,
            limit: 200,
            timeTakenMs: 5,
            cached: false,
        });
        const result = controller.points(buildDto({ limit: 50 }));
        expect(result).toBeInstanceOf(Promise);
    });
});
