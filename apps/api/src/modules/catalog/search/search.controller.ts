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
import { SearchRequestDto } from './dto/search.request.dto';
import { SearchResponseDto } from './dto/search.response.dto';
import { CatalogSearchService } from './search.service';

// Universal catalog search endpoint (PR9 refactor):
//   POST /catalog/search
//   Body: { query?, imageBase64?+mime?, topK? }
//
// Заменил предыдущие `/catalog/search/text` (PR7) и `/catalog/search/image`
// (PR8). Один контракт для фронта, три режима внутри (text-only / image-only
// / combined). См. search.service.ts для логики orchestration.
//
// Throttle 5/min/IP — conservative cap: даже при text-only режиме (cheap)
// ставим vision-rate, потому что endpoint один и нельзя статически знать
// будет ли image. Soft throttle через budget cap (#21) даёт более точное
// разделение по cost.
@ApiTags('catalog')
@Controller('catalog')
export class CatalogSearchController {
    constructor(private readonly service: CatalogSearchService) {}

    @Post('search')
    @HttpCode(HttpStatus.OK)
    @Throttle({
        default: {
            limit: VISION_SEARCH_THROTTLE_LIMIT,
            ttl: VISION_SEARCH_THROTTLE_TTL_MS,
        },
    })
    @ApiOperation({
        summary:
            'Universal catalog search — text / image / combined в одном endpoint',
        description:
            'Принимает любую комбинацию: только query (text vector search), только imageBase64 ' +
            '(Claude Vision describe → vector search), или оба (combined query = userText + description_ru). ' +
            'Хотя бы одно из query/imageBase64 обязательно.\n\n' +
            'Vision is_relevant=false → 400 с visionOutput hint клиенту («AI не распознал оборудование»).',
    })
    @ApiOkResponse({ type: SearchResponseDto })
    @ApiBadRequestResponse({
        description:
            'ValidationPipe (невалидные query/imageBase64/mime/topK), отсутствие хотя бы одного из query/imageBase64, ' +
            'или Vision is_relevant=false (фото не оборудование)',
    })
    @ApiTooManyRequestsResponse({
        description: `Throttle ${VISION_SEARCH_THROTTLE_LIMIT}/min/IP превышен`,
    })
    search(@Body() dto: SearchRequestDto): Promise<SearchResponseDto> {
        return this.service.search(dto);
    }
}
