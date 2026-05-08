import { BadRequestException } from '@nestjs/common';
import { type TBboxQuery, validateBbox } from './bbox-validator';

// =============================================================================
// Изолированные тесты bbox-validator. Раньше дублировались в 4 service-spec'ах
// (heatmap/depth-map/points/aquifer-stats), теперь shared — testим один раз.
// =============================================================================

describe('_shared/bbox-validator', () => {
    function buildBbox(overrides: Partial<TBboxQuery> = {}): TBboxQuery {
        return {
            west: 36.5,
            south: 54.8,
            east: 39.0,
            north: 56.5,
            ...overrides,
        };
    }

    describe('happy path', () => {
        it('valid МО bbox — не throws', () => {
            expect(() => validateBbox(buildBbox())).not.toThrow();
        });

        it('узкий bbox (1°×1°) — не throws', () => {
            expect(() => validateBbox(buildBbox({ west: 37, east: 38, south: 55, north: 56 }))).not.toThrow();
        });

        it('boundary lonSpan=60° / latSpan=30° — не throws (включительно)', () => {
            // 60° lon × 30° lat — exactly на cap.
            expect(() => validateBbox({ west: 0, east: 60, south: 0, north: 30 })).not.toThrow();
        });

        it('точно соседние границы (минимальный bbox) — не throws', () => {
            expect(() =>
                validateBbox({ west: 37.0, east: 37.0001, south: 55, north: 55.0001 }),
            ).not.toThrow();
        });
    });

    describe('400 — west >= east', () => {
        it('west === east (zero span)', () => {
            expect(() => validateBbox(buildBbox({ west: 38, east: 38 }))).toThrow(BadRequestException);
        });

        it('west > east (обратный диапазон)', () => {
            expect(() => validateBbox(buildBbox({ west: 39, east: 37 }))).toThrow(BadRequestException);
        });

        it('error message упоминает west/east', () => {
            expect(() => validateBbox(buildBbox({ west: 39, east: 37 }))).toThrow(/west.*east/);
        });
    });

    describe('400 — south >= north', () => {
        it('south === north (zero span)', () => {
            expect(() => validateBbox(buildBbox({ south: 55, north: 55 }))).toThrow(BadRequestException);
        });

        it('south > north (обратный)', () => {
            expect(() => validateBbox(buildBbox({ south: 56, north: 55 }))).toThrow(BadRequestException);
        });

        it('error message упоминает south/north', () => {
            expect(() => validateBbox(buildBbox({ south: 56, north: 55 }))).toThrow(/south.*north/);
        });
    });

    describe('400 — bbox слишком большой (DoS guard)', () => {
        it('lonSpan > 60° → throws', () => {
            expect(() =>
                validateBbox({ west: 0, east: 70, south: 0, north: 10 }),
            ).toThrow(BadRequestException);
        });

        it('latSpan > 30° → throws', () => {
            expect(() =>
                validateBbox({ west: 0, east: 10, south: 0, north: 35 }),
            ).toThrow(BadRequestException);
        });

        it('оба превышают (весь земной шар) → throws', () => {
            expect(() =>
                validateBbox({ west: -180, east: 180, south: -90, north: 90 }),
            ).toThrow(BadRequestException);
        });

        it('error message упоминает «слишком большой» + цифры span', () => {
            expect(() =>
                validateBbox({ west: 0, east: 70, south: 0, north: 10 }),
            ).toThrow(/слишком большой|70/);
        });
    });

    describe('boundaries — exact cap', () => {
        it('lonSpan ровно 60° + latSpan ровно 30° → ok (cap inclusive)', () => {
            expect(() =>
                validateBbox({ west: -30, east: 30, south: -15, north: 15 }),
            ).not.toThrow();
        });

        it('lonSpan чуть больше 60° → fails', () => {
            expect(() =>
                validateBbox({ west: 0, east: 60.01, south: 0, north: 10 }),
            ).toThrow(BadRequestException);
        });
    });
});
