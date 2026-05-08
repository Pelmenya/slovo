import { HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
    EQUIPMENT_SUGGEST_THROTTLE_LIMIT,
    EQUIPMENT_SUGGEST_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import type { EquipmentSuggestRequestDto } from './dto/equipment-suggest.request.dto';
import type { EquipmentSuggestResponseDto } from './dto/equipment-suggest.response.dto';
import { EquipmentSuggestController } from './equipment-suggest.controller';
import { EquipmentSuggestService } from './equipment-suggest.service';

// =============================================================================
// EquipmentSuggestController — тонкий слой:
//   1. delegation на service.suggest
//   2. возврат результата as-is (Promise<EquipmentSuggestResponseDto>)
//   3. @Throttle metadata (limit=10, ttl=60_000)
//   4. @HttpCode(HttpStatus.OK = 200) metadata
//
// Валидация DTO (lat/lon/topK) проверяется в e2e через ValidationPipe.
// =============================================================================

describe('EquipmentSuggestController', () => {
    let controller: EquipmentSuggestController;
    let serviceMock: { suggest: jest.Mock };

    beforeEach(async () => {
        serviceMock = { suggest: jest.fn() };
        const moduleRef: TestingModule = await Test.createTestingModule({
            controllers: [EquipmentSuggestController],
            providers: [{ provide: EquipmentSuggestService, useValue: serviceMock }],
        }).compile();
        controller = moduleRef.get(EquipmentSuggestController);
    });

    function buildDto(
        overrides: Partial<EquipmentSuggestRequestDto> = {},
    ): EquipmentSuggestRequestDto {
        return {
            lat: overrides.lat ?? 55.7558,
            lon: overrides.lon ?? 37.6173,
            topK: overrides.topK,
        } as EquipmentSuggestRequestDto;
    }

    it('делегирует на service.suggest и возвращает результат as-is', async () => {
        const expected: EquipmentSuggestResponseDto = {
            problems: [
                {
                    paramCode: 'iron_total',
                    severity: 'unsafe',
                    interval: { lower: 0.5, upper: 1.5, confidence: 80 },
                    pdk: 0.3,
                    n: 18,
                },
            ],
            recommendations: [
                {
                    sku: 'OZ-15',
                    name: 'Аквафор ОС-15',
                    relevance: 0.84,
                    description: 'Колонна для удаления железа.',
                    matchedProblem: 'iron_total',
                    reason: 'Решает явное превышение «Железо (Fe, суммарно)»',
                },
            ],
            searchQuery: 'Подобрать оборудование для воды с проблемами: ...',
            nNeighbors: 18,
            medianDistKm: 4.2,
            insufficientData: false,
            timeTakenMs: 187,
            cached: false,
        };
        serviceMock.suggest.mockResolvedValueOnce(expected);
        const dto = buildDto();

        const result = await controller.suggest(dto);

        expect(serviceMock.suggest).toHaveBeenCalledTimes(1);
        expect(serviceMock.suggest).toHaveBeenCalledWith(dto);
        expect(result).toBe(expected);
    });

    it('пробрасывает ошибки service наружу', async () => {
        serviceMock.suggest.mockRejectedValueOnce(new Error('catalog store missing'));
        await expect(controller.suggest(buildDto())).rejects.toThrow(/catalog store missing/);
    });

    it('@Throttle metadata: limit=EQUIPMENT_SUGGEST_THROTTLE_LIMIT, ttl=EQUIPMENT_SUGGEST_THROTTLE_TTL_MS', () => {
        // throttler хранит метаданные через Reflect под ключами `THROTTLER:LIMIT<scope>` /
        // `THROTTLER:TTL<scope>` (см. throttler.decorator.js). Scope для дефолтного
        // декоратора — 'default'.
        const handler = controller.suggest;
        const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handler) as unknown;
        const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', handler) as unknown;

        expect(limit).toBe(EQUIPMENT_SUGGEST_THROTTLE_LIMIT);
        // Hardcoded sanity — security-auditor 2026-05-08: 30→10 для budget cap
        // на Flowise×3 fanout. Смена константы должна осознанно сломать тест.
        expect(limit).toBe(10);
        expect(ttl).toBe(EQUIPMENT_SUGGEST_THROTTLE_TTL_MS);
        expect(ttl).toBe(60_000);
    });

    it('@HttpCode(200) metadata присутствует (POST по умолчанию 201, явно понижено до 200)', () => {
        // NestJS @HttpCode пишет в metadata через ключ '__httpCode__'.
        const httpCode = Reflect.getMetadata('__httpCode__', controller.suggest) as unknown;
        expect(httpCode).toBe(HttpStatus.OK);
        expect(httpCode).toBe(200);
    });

    it('возвращает Promise (async signature)', () => {
        serviceMock.suggest.mockResolvedValueOnce({
            problems: [],
            recommendations: [],
            searchQuery: '',
            nNeighbors: 0,
            medianDistKm: 0,
            insufficientData: true,
            timeTakenMs: 5,
            cached: false,
        });
        const result = controller.suggest(buildDto());
        expect(result).toBeInstanceOf(Promise);
    });
});
