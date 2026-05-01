import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
    ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SearchTextRequestDto } from './dto/search-text.request.dto';
import { SearchTextResponseDto } from './dto/search-text.response.dto';
import { TextSearchService } from './text.service';

// Vision-catalog text search — POST endpoint потому что body containing query
// удобнее чем query-string (длинные natural-language tokens, кавычки, кириллица).
// HTTP 200 (не 201) — это search, не creation.
@ApiTags('catalog')
@Controller('catalog/search')
export class TextSearchController {
    constructor(private readonly service: TextSearchService) {}

    @Post('text')
    @HttpCode(HttpStatus.OK)
    // Tighter лимит чем глобальный (100/min из AppModule). Каждый search =
    // 1 OpenAI embedding (cost) + 1 Flowise vectorstore round-trip + N
    // presigned signings. 30/min/IP — комфортно для dev/UI scenarios,
    // защита от burst от внутреннего скрипта-багги.
    @Throttle({ default: { limit: 30, ttl: 60_000 } })
    @ApiOperation({
        summary: 'Vector search по каталогу через Flowise Document Store',
        description:
            'Принимает natural-language query, embed-ит через OpenAI, ищет cosine top-K по pgvector. ' +
            'Каждый чанк обогащается presigned S3 URL\'ами для картинок (TTL 1ч, кэш 50м).',
    })
    @ApiOkResponse({ type: SearchTextResponseDto })
    @ApiBadRequestResponse({
        description: 'ValidationPipe — пустая query, query >500 chars, topK вне [1..50] или левые поля в body',
    })
    @ApiTooManyRequestsResponse({
        description: 'Throttle 30/min/IP превышен',
    })
    search(@Body() dto: SearchTextRequestDto): Promise<SearchTextResponseDto> {
        return this.service.search(dto.query, dto.topK);
    }
}
