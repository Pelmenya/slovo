import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
    BudgetService,
    VISION_COST_PER_IMAGE_USD,
} from '../../budget';
import { SearchRequestDto } from './dto/search.request.dto';
import {
    SearchResponseDto,
    type VisionOutputDto,
} from './dto/search.response.dto';
import { ImageSearchService } from './image.service';
import { TextSearchService } from './text.service';
import { VisionCacheService } from './vision-cache.service';

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
    private readonly logger = new Logger(CatalogSearchService.name);

    constructor(
        private readonly imageSearch: ImageSearchService,
        private readonly textSearch: TextSearchService,
        private readonly budget: BudgetService,
        private readonly visionCache: VisionCacheService,
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

        // Embedding budget — всегда (text search делает 1 embedding query).
        // Vision budget — только если был image AND cache miss (см. ниже).
        await this.budget.assertEmbeddingBudget();

        // Vision pass — только если были images. SHA256-кэш отвечающий за
        // повторные image-запросы (#66): клиент сфоткал тот же фильтр →
        // hash совпал → пропускаем Vision call ($0). При cache hit budget
        // не дёргается (фактически не тратим деньги — assertion и record
        // не нужны).
        let visionOutput: VisionOutputDto | undefined;
        if (hasImages) {
            const cacheHash = VisionCacheService.computeImageHash(dto.images!);
            const cached = await this.visionCache.get(cacheHash);

            if (cached !== null) {
                this.logger.debug(`vision cache HIT (hash=${cacheHash.slice(0, 12)}…)`);
                visionOutput = cached;
            } else {
                // Cache miss → full Vision pass + budget assertion/record.
                await this.budget.assertVisionBudget();
                visionOutput = await this.imageSearch.processVision(dto.images!);
                // VISION_COST_PER_IMAGE_USD = $0.007 conservative (Sonnet 4.6
                // worst case). Multi-image cost линейный.
                await this.budget.recordVisionCall(dto.images!.length * VISION_COST_PER_IMAGE_USD);
                // Кэшируем независимо от is_relevant — повторное «оно нерелевантно»
                // тоже бесплатно отдаём, не дёргая Vision.
                await this.visionCache.set(cacheHash, visionOutput);
            }

            if (!visionOutput.isRelevant) {
                throw new BadRequestException({
                    message: 'Image not relevant — Vision не распознал оборудование на фото',
                    visionOutput,
                });
            }
        }

        const effectiveQuery = buildEffectiveQuery(dto.query, visionOutput?.descriptionRu);
        const textResults = await this.textSearch.search(effectiveQuery, dto.topK);

        // Embedding cost approximate — query length / 4 chars-per-token.
        // Реальный counter в OpenAI billing, эта запись для cap'а.
        await this.budget.recordEmbeddingTokens(
            BudgetService.approximateTokensFromText(effectiveQuery),
        );

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
