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
    DEPTH_PREDICT_THROTTLE_LIMIT,
    DEPTH_PREDICT_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import { DepthPredictQueryDto } from './dto/depth-predict.request.dto';
import { DepthPredictResponseDto } from './dto/depth-predict.response.dto';
import { DepthPredictService } from './depth-predict.service';

@ApiTags('water-analysis')
@Controller('water-analysis')
export class DepthPredictController {
    constructor(private readonly service: DepthPredictService) {}

    @Get('depth-predict')
    @Throttle({
        default: {
            limit: DEPTH_PREDICT_THROTTLE_LIMIT,
            ttl: DEPTH_PREDICT_THROTTLE_TTL_MS,
        },
    })
    @ApiOperation({
        summary: 'Прогноз глубины бурения для нового адреса (USP-4 для drilling-домена)',
        description:
            'Interval-валюированный kNN-прогноз глубины бурения скважины/колодца. Точная глубина ' +
            'физически непредсказуема (PhD interval analysis: нондетерминированный геологический ' +
            'процесс), поэтому отдаём 3 уровня intervals — primary 80% (P10-P90 для планирования), ' +
            'IQR 50% (типичный диапазон), hardRange 100% (worst-case по соседям). + pointEstimate ' +
            'как UI marker, mostLikelyAquiferLayer + layerDistribution.\n\n' +
            'Audience: бурильщики / копатели колодцев / гидрогеологи / девелоперы.',
    })
    @ApiOkResponse({ type: DepthPredictResponseDto })
    @ApiBadRequestResponse({
        description: 'ValidationPipe — невалидные lat/lon/k/radiusKm/intakeType',
    })
    @ApiTooManyRequestsResponse({
        description: `Throttle ${DEPTH_PREDICT_THROTTLE_LIMIT}/min/IP превышен`,
    })
    depthPredict(@Query() dto: DepthPredictQueryDto): Promise<DepthPredictResponseDto> {
        return this.service.predict(dto);
    }
}
