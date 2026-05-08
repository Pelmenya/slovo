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
    DEPTH_MAP_THROTTLE_LIMIT,
    DEPTH_MAP_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import { DepthMapQueryDto } from './dto/depth-map.request.dto';
import { DepthMapResponseDto } from './dto/depth-map.response.dto';
import { DepthMapService } from './depth-map.service';

@ApiTags('water-analysis')
@Controller('water-analysis')
export class DepthMapController {
    constructor(private readonly service: DepthMapService) {}

    @Get('depth-map')
    @Throttle({
        default: {
            limit: DEPTH_MAP_THROTTLE_LIMIT,
            ttl: DEPTH_MAP_THROTTLE_TTL_MS,
        },
    })
    @ApiOperation({
        summary: 'Карта глубин скважин и колодцев по grid (USP-4 для бурильщиков/гидрогеологов)',
        description:
            'Возвращает GeoJSON FeatureCollection с агрегированными ячейками глубин по заданному ' +
            'bbox + grid. Per cell: count, median, P25/P75, min, max + bucket-распределение по 5 ' +
            'водоносным горизонтам (верховодка/песчаный/песчано-известняковый/известняковый/артезианский) + ' +
            'dominantLayerId + pctWell.\n\n' +
            'Audience: B2B бурильщики / копатели колодцев / гидрогеологи / девелоперы. Coverage: ' +
            'well 76.7% (7 884 точек), well_dug 41.2% (742 точек). Связка «координаты + глубина + ' +
            'химия» — уникальный dataset, не имеет аналогов на 8 мая 2026.',
    })
    @ApiOkResponse({ type: DepthMapResponseDto })
    @ApiBadRequestResponse({
        description: 'ValidationPipe — невалидные intakeType / bbox / grid',
    })
    @ApiTooManyRequestsResponse({
        description: `Throttle ${DEPTH_MAP_THROTTLE_LIMIT}/min/IP превышен`,
    })
    depthMap(@Query() dto: DepthMapQueryDto): Promise<DepthMapResponseDto> {
        return this.service.query(dto);
    }
}
