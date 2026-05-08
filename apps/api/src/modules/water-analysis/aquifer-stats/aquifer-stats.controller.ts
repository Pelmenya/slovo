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
    AQUIFER_STATS_THROTTLE_LIMIT,
    AQUIFER_STATS_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import { AquiferStatsQueryDto } from './dto/aquifer-stats.request.dto';
import { AquiferStatsResponseDto } from './dto/aquifer-stats.response.dto';
import { AquiferStatsService } from './aquifer-stats.service';

@ApiTags('water-analysis')
@Controller('water-analysis')
export class AquiferStatsController {
    constructor(private readonly service: AquiferStatsService) {}

    @Get('aquifer-stats')
    @Throttle({
        default: {
            limit: AQUIFER_STATS_THROTTLE_LIMIT,
            ttl: AQUIFER_STATS_THROTTLE_TTL_MS,
        },
    })
    @ApiOperation({
        summary: 'Стратифицированная статистика по водоносным горизонтам в bbox (USP-4 deep-dive)',
        description:
            'Per layer: count + pct + median depth + pctWell + **typical chemistry** (median 22 ' +
            'параметров для каждого горизонта). Это deep-dive над /depth-map: не только распределение ' +
            'счётчиков по слоям, но и **какая обычно вода на каждой глубине** в данном районе.\n\n' +
            'Audience: бурильщики / гидрогеологи которые решают целевую глубину бурения по химии ' +
            '(«если планирую обезжелезиватель — на 50-100м обычно iron 0.4, не подходит, бурим до 100-200м»).',
    })
    @ApiOkResponse({ type: AquiferStatsResponseDto })
    @ApiBadRequestResponse({
        description: 'ValidationPipe — невалидные intakeType / bbox',
    })
    @ApiTooManyRequestsResponse({
        description: `Throttle ${AQUIFER_STATS_THROTTLE_LIMIT}/min/IP превышен`,
    })
    aquiferStats(@Query() dto: AquiferStatsQueryDto): Promise<AquiferStatsResponseDto> {
        return this.service.query(dto);
    }
}
