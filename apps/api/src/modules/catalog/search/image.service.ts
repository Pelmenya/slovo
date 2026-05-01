import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { sanitizeError } from '@slovo/common';
import {
    ENDPOINTS,
    type FlowiseClient,
    type TFlowiseChatflow,
    type TFlowisePredictionResponse,
} from '@slovo/flowise-client';
import { FLOWISE_CLIENT_TOKEN, VISION_CHATFLOW_NAME } from '../catalog.constants';
import { VisionOutputDto, SearchImageResponseDto } from './dto/search-image.response.dto';
import { TextSearchService } from './text.service';

// =============================================================================
// ImageSearchService — vision-каталог поиск через Claude Vision + reuse PR7
// text search.
//
// Pipeline:
// 1. Resolve VISION_CHATFLOW_ID by name (lazy + single-flight + retry on
//    failure — тот же паттерн что storeId в TextSearchService).
// 2. POST /prediction/<chatflowId> с base64 image upload.
// 3. Parse response.text как JSON (Vision-describer возвращает structured
//    output). Если parse fails — defensive throw.
// 4. Если is_relevant=false → throw BadRequestException с visionOutput как
//    hint в response (UX: «AI распознал кота, не оборудование»).
// 5. Reuse TextSearchService.search(descriptionRu, topK) — downstream
//    pipeline идентичен PR7 (storeId resolve → vectorstoreQuery → presigned URLs).
// 6. Возвращаем shape с docs + timeTakenMs + visionOutput.
//
// Cost: ~$0.005-0.007 за Vision-вызов (Claude Sonnet 4.6) + ~$0.0000004 за
// downstream embedding для description_ru. Vision доминирует cost.
// =============================================================================

// Schema из vision-catalog-describer-v1 prompt (Phase 0). Validation
// defensive: feeder может расширить prompt с новыми полями, но критичные
// для нашего pipeline — стабильны.
type TVisionRawOutput = {
    is_relevant: boolean;
    category?: string | null;
    brand?: string | null;
    model_hint?: string | null;
    description_ru: string;
    confidence?: 'high' | 'medium' | 'low';
    // features / condition есть в prompt но мы их не используем.
    [key: string]: unknown;
};

@Injectable()
export class ImageSearchService {
    private readonly logger = new Logger(ImageSearchService.name);

    // Lazy-resolved chatflowId — first search триггерит lookup,
    // остальные ждут ту же Promise (single-flight). При ошибке —
    // promise обнуляется, следующий request делает retry.
    private chatflowIdPromise: Promise<string> | null = null;

    constructor(
        @Inject(FLOWISE_CLIENT_TOKEN) private readonly flowise: FlowiseClient,
        private readonly textSearch: TextSearchService,
    ) {}

    async search(
        imageBase64: string,
        mime: string,
        topK?: number,
    ): Promise<SearchImageResponseDto> {
        const chatflowId = await this.resolveChatflowId();

        // Vision pass — Flowise prediction с image upload.
        // `name` обязателен в TFlowisePredictionUpload — генерим
        // human-readable из mime для Flowise / Anthropic logs.
        const ext = mime.split('/')[1] ?? 'bin';
        const visionResponse = await this.flowise.request<TFlowisePredictionResponse>(
            ENDPOINTS.prediction(chatflowId),
            {
                method: 'POST',
                body: {
                    question: '',
                    uploads: [
                        {
                            data: `data:${mime};base64,${imageBase64}`,
                            type: 'file',
                            name: `image.${ext}`,
                            mime,
                        },
                    ],
                },
            },
        );

        const visionOutput = this.parseVisionResponse(visionResponse);

        // Если Vision не распознал оборудование — UX-friendly 400 с hint.
        // Не failure, не 500 — клиент должен показать «попробуй другое фото».
        if (!visionOutput.isRelevant) {
            throw new BadRequestException({
                message: 'Image not relevant — Vision не распознал оборудование на фото',
                visionOutput,
            });
        }

        // Reuse PR7 pipeline — TextSearchService сам делает storeId lookup +
        // vectorstoreQuery + presigned URLs + metadata whitelist.
        const textResults = await this.textSearch.search(visionOutput.descriptionRu, topK);

        return {
            count: textResults.count,
            docs: textResults.docs,
            timeTakenMs: textResults.timeTakenMs,
            visionOutput,
        };
    }

    private resolveChatflowId(): Promise<string> {
        if (!this.chatflowIdPromise) {
            this.chatflowIdPromise = this.lookupChatflowId().catch((err: unknown) => {
                // Reset чтобы следующий request попробовал заново. Без
                // этого временный network-blip намертво сломал бы service.
                this.chatflowIdPromise = null;
                throw err;
            });
        }
        return this.chatflowIdPromise;
    }

    private async lookupChatflowId(): Promise<string> {
        const chatflows = await this.flowise.request<TFlowiseChatflow[]>(
            ENDPOINTS.chatflows,
        );
        const chatflow = chatflows.find((c) => c.name === VISION_CHATFLOW_NAME);
        if (!chatflow) {
            throw new Error(
                `Vision chatflow "${VISION_CHATFLOW_NAME}" not found in Flowise — ` +
                    `проверь что Phase 0 chatflow создан и не переименован`,
            );
        }
        this.logger.log(`vision chatflow "${VISION_CHATFLOW_NAME}" → id=${chatflow.id}`);
        return chatflow.id;
    }

    private parseVisionResponse(response: TFlowisePredictionResponse): VisionOutputDto {
        // Vision-describer возвращает structured JSON в `response.text`.
        // Если Structured Output Parser в chatflow настроен на JSON-mode —
        // получим raw JSON-string, иначе LLM может обернуть в markdown
        // ```json ... ```. Defensive: пытаемся parse прямо, потом strip
        // markdown wrapper.
        const rawText = response.text ?? '';
        if (rawText.length === 0) {
            throw new Error('Vision response empty — chatflow returned no text');
        }

        let parsed: TVisionRawOutput;
        try {
            parsed = JSON.parse(stripMarkdownWrapper(rawText)) as TVisionRawOutput;
        } catch (error) {
            this.logger.warn(
                `Vision output not parseable as JSON: ${sanitizeError(error)}. Raw: ${rawText.slice(0, 200)}`,
            );
            throw new Error(`Vision output is not valid JSON: ${sanitizeError(error)}`, {
                cause: error,
            });
        }

        if (typeof parsed.is_relevant !== 'boolean') {
            throw new Error('Vision output missing required field "is_relevant"');
        }

        // description_ru обязателен только когда is_relevant=true (для
        // downstream search). При false → пусто допустимо.
        const descriptionRu =
            typeof parsed.description_ru === 'string' ? parsed.description_ru : '';
        if (parsed.is_relevant && descriptionRu.length === 0) {
            throw new Error(
                'Vision is_relevant=true but description_ru empty — search невозможен',
            );
        }

        return {
            isRelevant: parsed.is_relevant,
            category: typeof parsed.category === 'string' ? parsed.category : null,
            brand: typeof parsed.brand === 'string' ? parsed.brand : null,
            modelHint: typeof parsed.model_hint === 'string' ? parsed.model_hint : null,
            descriptionRu,
            confidence: isValidConfidence(parsed.confidence) ? parsed.confidence : 'low',
        };
    }
}

// =============================================================================
// Helpers
// =============================================================================

// LLM иногда оборачивает JSON в markdown-fence: ```json\n{...}\n```.
// Strip wrapper если найден; иначе вернуть as-is.
function stripMarkdownWrapper(text: string): string {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function isValidConfidence(value: unknown): value is 'high' | 'medium' | 'low' {
    return value === 'high' || value === 'medium' || value === 'low';
}
