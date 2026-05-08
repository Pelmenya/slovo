import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNumber, Max, Min } from 'class-validator';
import { GRID_MAX_DEG, GRID_MIN_DEG } from '../../water-analysis.constants';

/**
 * POST body для `/water-analysis/heatmap/cell` — popup details для одной
 * cell на тепловой карте.
 *
 * Юзер тапает на cell в карте → frontend знает её центр (lat/lon) и grid-step
 * (текущий zoom rendering). Body отдаёт эти 3 числа, backend fetch'ит все
 * анализы попадающие в cell bbox (центр ± grid/2) → агрегирует per param.
 */
export class CellDetailRequestDto {
    @ApiProperty({
        description: 'Центр cell (latitude WGS84). Обычно из feature.geometry.coordinates[1].',
        example: 55.755,
    })
    @Type(() => Number)
    @IsNumber()
    @IsLatitude()
    lat!: number;

    @ApiProperty({
        description: 'Центр cell (longitude WGS84).',
        example: 37.625,
    })
    @Type(() => Number)
    @IsNumber()
    @IsLongitude()
    lon!: number;

    @ApiProperty({
        description:
            'Grid step в градусах — тот же что использовался в /heatmap для рендера. ' +
            'Cell bbox = [lat ± grid/2, lon ± grid/2].',
        example: 0.05,
        minimum: GRID_MIN_DEG,
        maximum: GRID_MAX_DEG,
    })
    @Type(() => Number)
    @IsNumber()
    @Min(GRID_MIN_DEG)
    @Max(GRID_MAX_DEG)
    grid!: number;
}
