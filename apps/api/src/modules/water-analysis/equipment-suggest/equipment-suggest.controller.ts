import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
    ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
    EQUIPMENT_SUGGEST_THROTTLE_LIMIT,
    EQUIPMENT_SUGGEST_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import { EquipmentSuggestRequestDto } from './dto/equipment-suggest.request.dto';
import { EquipmentSuggestResponseDto } from './dto/equipment-suggest.response.dto';
import { EquipmentSuggestService } from './equipment-suggest.service';

@ApiTags('water-analysis')
@Controller('water-analysis')
export class EquipmentSuggestController {
    constructor(private readonly service: EquipmentSuggestService) {}

    @Post('equipment-suggest')
    @HttpCode(HttpStatus.OK)
    @Throttle({
        default: {
            limit: EQUIPMENT_SUGGEST_THROTTLE_LIMIT,
            ttl: EQUIPMENT_SUGGEST_THROTTLE_TTL_MS,
        },
    })
    @ApiOperation({
        summary: 'Подбор фильтра по координатам адреса (USP-2 flagship cross-domain)',
        description:
            'Сквозная связка вода→каталог. Pipeline: координаты → kNN-прогноз химии (interval-aware) → ' +
            'identify problems > ПДК → vector search Аквафор-каталога → top-N рекомендаций с обоснованием.\n\n' +
            'Главный продающий аргумент для разговора с руководителем Аквафор: один API call вместо ' +
            '«сделай анализ → введи руками 21 параметр → выбери фильтр». Никто из конкурентов не имеет ' +
            'связку «вода-архив + AI-augmented каталог».',
    })
    @ApiOkResponse({ type: EquipmentSuggestResponseDto })
    @ApiBadRequestResponse({
        description: 'ValidationPipe — невалидные lat/lon/topK',
    })
    @ApiTooManyRequestsResponse({
        description: `Throttle ${EQUIPMENT_SUGGEST_THROTTLE_LIMIT}/min/IP превышен`,
    })
    suggest(@Body() dto: EquipmentSuggestRequestDto): Promise<EquipmentSuggestResponseDto> {
        return this.service.suggest(dto);
    }
}
