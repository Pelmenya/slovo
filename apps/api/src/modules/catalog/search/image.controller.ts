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
    VISION_SEARCH_THROTTLE_LIMIT,
    VISION_SEARCH_THROTTLE_TTL_MS,
} from '../catalog.constants';
import { SearchImageRequestDto } from './dto/search-image.request.dto';
import { SearchImageResponseDto } from './dto/search-image.response.dto';
import { ImageSearchService } from './image.service';

// Vision search endpoint — POST с JSON base64. Body limit в main.ts поднят
// до 10MB чтобы пропустить 5MB+ декодированной картинки (base64 + headers).
@ApiTags('catalog')
@Controller('catalog/search')
export class ImageSearchController {
    constructor(private readonly service: ImageSearchService) {}

    @Post('image')
    @HttpCode(HttpStatus.OK)
    @Throttle({
        default: {
            limit: VISION_SEARCH_THROTTLE_LIMIT,
            ttl: VISION_SEARCH_THROTTLE_TTL_MS,
        },
    })
    @ApiOperation({
        summary: 'Vision search по каталогу — фото → JSON описание → vector search',
        description:
            'Принимает base64-картинку, прогоняет через Claude Vision (Flowise vision-catalog-describer-v1), ' +
            'затем извлечённое description_ru идёт в text vector search (PR7 pipeline). ' +
            'Если Vision не распознал оборудование (is_relevant=false) → 400 с visionOutput как hint клиенту.',
    })
    @ApiOkResponse({ type: SearchImageResponseDto })
    @ApiBadRequestResponse({
        description:
            'Невалидный body (пустое imageBase64, невалидный mime, размер >5MB) или Vision is_relevant=false (фото не оборудование)',
    })
    @ApiTooManyRequestsResponse({
        description: `Throttle ${String(VISION_SEARCH_THROTTLE_LIMIT)}/min/IP превышен (Vision дороже text search)`,
    })
    search(@Body() dto: SearchImageRequestDto): Promise<SearchImageResponseDto> {
        return this.service.search(dto.imageBase64, dto.mime, dto.topK);
    }
}
