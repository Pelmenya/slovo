import { Controller, Get, Query } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
    ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
    HEATMAP_THROTTLE_LIMIT,
    HEATMAP_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import { HeatmapQueryDto } from './dto/heatmap.request.dto';
import { HeatmapResponseDto } from './dto/heatmap.response.dto';
import { HeatmapService } from './heatmap.service';

@ApiTags('water-analysis')
@Controller('water-analysis')
export class HeatmapController {
    constructor(private readonly service: HeatmapService) {}

    @Get('heatmap')
    @Throttle({
        default: {
            limit: HEATMAP_THROTTLE_LIMIT,
            ttl: HEATMAP_THROTTLE_TTL_MS,
        },
    })
    @ApiOperation({
        summary: 'Тепловая карта качества воды по grid (4 канонических параметра + risk)',
        description:
            'Возвращает GeoJSON FeatureCollection с агрегированными ячейками по заданному bbox + grid. ' +
            'Каждая ячейка содержит COUNT, AVG, MEDIAN, P75, exceedsCount/Pct + статус (good/mid/bad) ' +
            'относительно ПДК СанПиН 1.2.3685-21. Параметр risk — синтетический 0-100 (weighted % от ПДК ' +
            'по 4 ключевым параметрам).\n\n' +
            'Сценарий: prostor-app водо-карта переключает param через pills и подгружает heatmap layer ' +
            'из этого endpoint. PostGIS bbox-фильтр через `&&` (GIST-индекс на geo_point) — sub-100мс ' +
            'на 15 504 анализах. Cache 24ч в Redis (данные derived обновляются ручным запуском normalize).',
    })
    @ApiOkResponse({ type: HeatmapResponseDto })
    @ApiBadRequestResponse({
        description:
            'ValidationPipe — невалидные param / bbox (west>=east или south>=north) / grid (вне 0.005-0.5)',
    })
    @ApiTooManyRequestsResponse({
        description: `Throttle ${HEATMAP_THROTTLE_LIMIT}/min/IP превышен`,
    })
    heatmap(@Query() dto: HeatmapQueryDto): Promise<HeatmapResponseDto> {
        return this.service.query(dto);
    }
}
