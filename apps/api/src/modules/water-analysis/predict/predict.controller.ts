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
    PREDICT_THROTTLE_LIMIT,
    PREDICT_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import { PredictQueryDto } from './dto/predict.request.dto';
import { PredictResponseDto } from './dto/predict.response.dto';
import { PredictService } from './predict.service';

@ApiTags('water-analysis')
@Controller('water-analysis')
export class PredictController {
    constructor(private readonly service: PredictService) {}

    @Get('predict')
    @Throttle({
        default: {
            limit: PREDICT_THROTTLE_LIMIT,
            ttl: PREDICT_THROTTLE_TTL_MS,
        },
    })
    @ApiOperation({
        summary: 'Прогноз химии воды для нового адреса БЕЗ собственного анализа (USP-1)',
        description:
            'kNN-прогноз 22 параметров химии (canonical paramCodes из СанПиН) на основе ' +
            'ближайших соседей в 6-летнем архиве 15 504 анализов воды Аквафор-Pro. ' +
            'Возвращает distance + recency-weighted average + P10/P90 percentile interval ' +
            '(80% соседних значений в этом диапазоне).\n\n' +
            'Bonus: при ≥3 соседях-скважинах с известной глубиной — `mostLikelyAquiferLayer` ' +
            '(наиболее вероятный водоносный горизонт по медиане их глубин).\n\n' +
            'Сценарий: клиент вводит координаты своего адреса до того как сделать анализ ' +
            'воды. PROSTOR за 5 секунд показывает ожидаемую картину + флаг превышения ПДК. ' +
            'Это flagship USP — никто из конкурентов / магазинов фильтров не имеет dataset ' +
            'для такого прогноза.',
    })
    @ApiOkResponse({ type: PredictResponseDto })
    @ApiBadRequestResponse({
        description:
            'ValidationPipe — невалидные lat/lon (вне -90/90, -180/180), k (вне 5-100) или radiusKm (вне 1-200)',
    })
    @ApiTooManyRequestsResponse({
        description: `Throttle ${PREDICT_THROTTLE_LIMIT}/min/IP превышен`,
    })
    predict(@Query() dto: PredictQueryDto): Promise<PredictResponseDto> {
        return this.service.predict(dto);
    }
}
