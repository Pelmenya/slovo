import { BadRequestException } from '@nestjs/common';

// =============================================================================
// Shared bbox validator. Дублировался ×4 (heatmap, depth-map, points,
// aquifer-stats) — все с одинаковыми bounds (60° lon × 30° lat).
//
// Cross-field invariants которые class-validator не покрывает на DTO-уровне:
// - west < east
// - south < north
// - размер bbox (защита от unbounded scan на «весь земной шар»)
// =============================================================================

const MAX_LON_SPAN = 60;
const MAX_LAT_SPAN = 30;

export type TBboxQuery = {
    west: number;
    south: number;
    east: number;
    north: number;
};

export function validateBbox(dto: TBboxQuery): void {
    if (dto.west >= dto.east) {
        throw new BadRequestException(
            `bbox.west (${dto.west}) должен быть < bbox.east (${dto.east})`,
        );
    }
    if (dto.south >= dto.north) {
        throw new BadRequestException(
            `bbox.south (${dto.south}) должен быть < bbox.north (${dto.north})`,
        );
    }
    const lonSpan = dto.east - dto.west;
    const latSpan = dto.north - dto.south;
    if (lonSpan > MAX_LON_SPAN || latSpan > MAX_LAT_SPAN) {
        throw new BadRequestException(
            `bbox слишком большой (lon ${lonSpan.toFixed(1)}°, lat ${latSpan.toFixed(1)}°). ` +
                `Максимум ${MAX_LON_SPAN}° lon × ${MAX_LAT_SPAN}° lat.`,
        );
    }
}
