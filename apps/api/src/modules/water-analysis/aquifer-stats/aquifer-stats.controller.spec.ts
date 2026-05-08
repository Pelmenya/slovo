import { Test, type TestingModule } from '@nestjs/testing';
import {
    AQUIFER_STATS_THROTTLE_LIMIT,
    AQUIFER_STATS_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import { AquiferStatsController } from './aquifer-stats.controller';
import { AquiferStatsService } from './aquifer-stats.service';
import type { AquiferStatsQueryDto } from './dto/aquifer-stats.request.dto';
import type { AquiferStatsResponseDto } from './dto/aquifer-stats.response.dto';

// =============================================================================
// AquiferStatsController unit-тесты — тонкий слой:
//   1. delegation на service.query
//   2. возврат результата as-is
//   3. presence of @Throttle metadata (smoke check через Reflect.getMetadata)
//   4. async signature
//
// DTO-валидация проверяется в e2e (ValidationPipe + class-validator). В unit
// проверяем только подачу DTO в service.
// =============================================================================

describe('AquiferStatsController', () => {
    let controller: AquiferStatsController;
    let serviceMock: { query: jest.Mock };

    beforeEach(async () => {
        serviceMock = { query: jest.fn() };
        const moduleRef: TestingModule = await Test.createTestingModule({
            controllers: [AquiferStatsController],
            providers: [{ provide: AquiferStatsService, useValue: serviceMock }],
        }).compile();
        controller = moduleRef.get(AquiferStatsController);
    });

    function buildDto(overrides: Partial<AquiferStatsQueryDto> = {}): AquiferStatsQueryDto {
        return {
            intakeType: overrides.intakeType,
            west: overrides.west ?? 36.5,
            south: overrides.south ?? 54.8,
            east: overrides.east ?? 39.0,
            north: overrides.north ?? 56.5,
        } as AquiferStatsQueryDto;
    }

    it('делегирует на service.query и возвращает результат as-is', async () => {
        const expected: AquiferStatsResponseDto = {
            layers: [
                {
                    id: 'sandy',
                    label: '15-50m / Песчаный',
                    minDepth: 15,
                    maxDepth: 50,
                    count: 12,
                    pct: 60,
                    medianDepth: 30,
                    pctWell: 100,
                    medianChemistry: { iron_total: 0.4, hardness_total: 7 },
                },
            ],
            intakeType: 'all',
            totalWells: 20,
            samplesUsed: 20,
            dominantLayerId: 'sandy',
            timeTakenMs: 187,
            cached: false,
        };
        serviceMock.query.mockResolvedValueOnce(expected);
        const dto = buildDto();

        const result = await controller.aquiferStats(dto);

        expect(serviceMock.query).toHaveBeenCalledTimes(1);
        expect(serviceMock.query).toHaveBeenCalledWith(dto);
        expect(result).toBe(expected);
    });

    it('пробрасывает ошибки service наружу (BadRequestException / Prisma error)', async () => {
        serviceMock.query.mockRejectedValueOnce(
            new Error('bbox.west (40) должен быть < bbox.east (40)'),
        );

        await expect(
            controller.aquiferStats(buildDto({ west: 40, east: 40 })),
        ).rejects.toThrow(/bbox.west/);
    });

    it('@Throttle metadata присутствует с правильными лимитами (60/min)', () => {
        // @nestjs/throttler хранит метаданные через Reflect под ключами вида
        // `THROTTLER:LIMIT<scope>` и `THROTTLER:TTL<scope>` (см. throttler.decorator.js).
        // Scope для нашего декоратора = 'default'.
        const handler = controller.aquiferStats;
        const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handler) as unknown;
        const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', handler) as unknown;

        expect(limit).toBe(AQUIFER_STATS_THROTTLE_LIMIT);
        expect(ttl).toBe(AQUIFER_STATS_THROTTLE_TTL_MS);
        // Sanity — числа из задачи (60/60_000), а не из stale копий констант.
        expect(limit).toBe(60);
        expect(ttl).toBe(60_000);
    });

    it('возвращает Promise (async signature)', () => {
        serviceMock.query.mockResolvedValueOnce({
            layers: [],
            intakeType: 'well',
            totalWells: 0,
            samplesUsed: 0,
            dominantLayerId: null,
            timeTakenMs: 10,
            cached: false,
        });
        const result = controller.aquiferStats(buildDto({ intakeType: 'well' }));
        expect(result).toBeInstanceOf(Promise);
    });
});
