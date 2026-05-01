import { BadRequestException, Injectable } from '@nestjs/common';
import { SearchRequestDto } from './dto/search.request.dto';
import {
    SearchResponseDto,
    type VisionOutputDto,
} from './dto/search.response.dto';
import { ImageSearchService } from './image.service';
import { TextSearchService } from './text.service';

// =============================================================================
// CatalogSearchService — universal search orchestrator (PR9 refactor).
//
// Заменил отдельные `/text` и `/image` endpoint'ы (PR7+PR8) на один
// universal `/catalog/search` с поддержкой трёх режимов:
//
// 1. **Text only**: dto.query → vector search.
// 2. **Image only**: dto.imageBase64+mime → Vision describe → search.
// 3. **Combined**: оба → Vision describe → effectiveQuery = userText + " " +
//    description_ru → search. UX: клиент уточняет намерение текстом +
//    добавляет visual context, оба сигнала идут в embedding.
//
// Внутри:
// - ImageSearchService.processVision (Vision pass + parse + sanitize) —
//   вызывается только если был image
// - TextSearchService.search (vector search + presigned URLs + metadata
//   whitelist) — вызывается всегда
// =============================================================================

@Injectable()
export class CatalogSearchService {
    constructor(
        private readonly imageSearch: ImageSearchService,
        private readonly textSearch: TextSearchService,
    ) {}

    async search(dto: SearchRequestDto): Promise<SearchResponseDto> {
        // At-least-one validation. DTO-level "at least one" через class-validator
        // custom decorator неудобен — runtime check проще + явная error message.
        const hasImages = dto.images !== undefined && dto.images.length > 0;
        if (!dto.query && !hasImages) {
            throw new BadRequestException(
                'At least one of "query" or "images" must be provided',
            );
        }

        // Vision pass — только если были images. Все фото идут в один
        // Vision call (multi-image describe). Если is_relevant=false →
        // 400 с visionOutput hint (UX: «AI распознал кота»).
        let visionOutput: VisionOutputDto | undefined;
        if (hasImages) {
            visionOutput = await this.imageSearch.processVision(dto.images!);
            if (!visionOutput.isRelevant) {
                throw new BadRequestException({
                    message: 'Image not relevant — Vision не распознал оборудование на фото',
                    visionOutput,
                });
            }
        }

        const effectiveQuery = buildEffectiveQuery(dto.query, visionOutput?.descriptionRu);
        const textResults = await this.textSearch.search(effectiveQuery, dto.topK);

        return {
            count: textResults.count,
            docs: textResults.docs,
            timeTakenMs: textResults.timeTakenMs,
            visionOutput,
        };
    }
}

// Combine user text + Vision-extracted description.
// - Both → конкатенация через space (embedding модель сама взвесит сигналы).
// - Only one → этот один.
// - Neither → throw (должен был быть пойман в service.search).
function buildEffectiveQuery(userText?: string, descriptionRu?: string): string {
    if (userText !== undefined && descriptionRu !== undefined) {
        return `${userText} ${descriptionRu}`;
    }
    if (userText !== undefined) {
        return userText;
    }
    if (descriptionRu !== undefined) {
        return descriptionRu;
    }
    throw new Error('buildEffectiveQuery: invariant violated — neither query nor description');
}
