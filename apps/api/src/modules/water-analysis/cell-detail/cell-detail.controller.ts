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
    CELL_DETAIL_THROTTLE_LIMIT,
    CELL_DETAIL_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import { CellDetailService } from './cell-detail.service';
import { CellDetailRequestDto } from './dto/cell-detail.request.dto';
import { CellDetailResponseDto } from './dto/cell-detail.response.dto';

@ApiTags('water-analysis')
@Controller('water-analysis/heatmap')
export class CellDetailController {
    constructor(private readonly service: CellDetailService) {}

    @Post('cell')
    @HttpCode(HttpStatus.OK)
    @Throttle({
        default: {
            limit: CELL_DETAIL_THROTTLE_LIMIT,
            ttl: CELL_DETAIL_THROTTLE_TTL_MS,
        },
    })
    @ApiOperation({
        summary: 'Детали cell для popup на карте — топ проблем + что в норме',
        description:
            'Принимает координаты центра cell (из feature.geometry на карте) + grid step. ' +
            'Возвращает breakdown 22 параметров: топ N с превышениями (отсорт. по exceedsPct desc) + ' +
            'список paramCode которые в cell measured но не превышают ПДК.\n\n' +
            'Сценарий: юзер тапает на cell heatmap-а → frontend POST с координатами → попап с ' +
            '«6 анализов с превышением Железа max 1.5 при ПДК 0.3, 5 с Марганцем max 0.18, ' +
            'остальное в норме». Cheap — single cell aggregation, ~50мс.',
    })
    @ApiOkResponse({ type: CellDetailResponseDto })
    @ApiBadRequestResponse({
        description: 'ValidationPipe — невалидные lat/lon/grid (out of range или missing)',
    })
    @ApiTooManyRequestsResponse({
        description: `Throttle ${CELL_DETAIL_THROTTLE_LIMIT}/min/IP превышен`,
    })
    cell(@Body() dto: CellDetailRequestDto): Promise<CellDetailResponseDto> {
        return this.service.detail(dto);
    }
}
