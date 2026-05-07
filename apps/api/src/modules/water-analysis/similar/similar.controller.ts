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
    SIMILAR_THROTTLE_LIMIT,
    SIMILAR_THROTTLE_TTL_MS,
} from '../water-analysis.constants';
import { SimilarSearchRequestDto } from './dto/similar.request.dto';
import { SimilarSearchResponseDto } from './dto/similar.response.dto';
import { SimilarSearchService } from './similar.service';

@ApiTags('water-analysis')
@Controller('water-analysis')
export class SimilarSearchController {
    constructor(private readonly service: SimilarSearchService) {}

    @Post('similar')
    @HttpCode(HttpStatus.OK)
    @Throttle({
        default: {
            limit: SIMILAR_THROTTLE_LIMIT,
            ttl: SIMILAR_THROTTLE_TTL_MS,
        },
    })
    @ApiOperation({
        summary: 'Найти похожие водные анализы (vector search top-K)',
        description:
            'Принимает структурированный анализ (params + intakeType + опц. depthMeters / appearance), ' +
            'строит natural language description тем же детерминированным генератором что использовался ' +
            'при ingest 15 504 анализов Аквафор-Pro 2020-2026, embedding через OpenAI text-embedding-3-large ' +
            'и возвращает top-K ближайших по cosine distance из Flowise Document Store water-analysis-aquaphor.\n\n' +
            'Сценарий применения: подбор оборудования по аналогам — для воды с похожим chemical fingerprint ' +
            'уже есть подобранное оборудование, метод эффективнее «правил по таблицам» при шуме данных.',
    })
    @ApiOkResponse({ type: SimilarSearchResponseDto })
    @ApiBadRequestResponse({
        description: 'ValidationPipe — невалидные intakeType / params / paramUnits / depthMeters / topK / filters',
    })
    @ApiTooManyRequestsResponse({
        description: `Throttle ${SIMILAR_THROTTLE_LIMIT}/min/IP превышен`,
    })
    similar(@Body() dto: SimilarSearchRequestDto): Promise<SimilarSearchResponseDto> {
        return this.service.search(dto);
    }
}
