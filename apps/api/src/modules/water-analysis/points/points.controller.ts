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
    POINTS_THROTTLE_LIMIT,
    POINTS_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import { PointsQueryDto } from './dto/points.request.dto';
import { PointsResponseDto } from './dto/points.response.dto';
import { PointsService } from './points.service';

@ApiTags('water-analysis')
@Controller('water-analysis')
export class PointsController {
    constructor(private readonly service: PointsService) {}

    @Get('points')
    @Throttle({
        default: {
            limit: POINTS_THROTTLE_LIMIT,
            ttl: POINTS_THROTTLE_TTL_MS,
        },
    })
    @ApiOperation({
        summary: 'Отдельные анализы воды в bbox для high-zoom детализации карты',
        description:
            'GeoJSON FeatureCollection с individual точками анализов. Каждая Feature содержит ' +
            '22 параметра + risk + meta (orderNumber, intakeType, depthMeters, sampleDate, region, locality). ' +
            'Координаты обезличены до 0.005° (~500м) для PII protection.\n\n' +
            'Сценарий: фронт zoom\'ит карту до уровня района — heatmap aggregation становится coarser ' +
            'чем нужно для UX, отдаём individual points с popup\'ами. ORDER BY sample_date DESC LIMIT N — ' +
            'свежие первыми. truncated=true сигнализирует «увеличь zoom для полной детализации».',
    })
    @ApiOkResponse({ type: PointsResponseDto })
    @ApiBadRequestResponse({
        description: 'ValidationPipe — невалидные bbox / limit',
    })
    @ApiTooManyRequestsResponse({
        description: `Throttle ${POINTS_THROTTLE_LIMIT}/min/IP превышен`,
    })
    points(@Query() dto: PointsQueryDto): Promise<PointsResponseDto> {
        return this.service.query(dto);
    }
}
