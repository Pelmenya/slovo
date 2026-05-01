import {
    BadGatewayException,
    BadRequestException,
    Inject,
    Injectable,
    Logger,
} from '@nestjs/common';
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
// Pipeline: resolve VISION_CHATFLOW_ID → POST /prediction с base64 image
// → defensive parse JSON → if !is_relevant → 400 / else → reuse
// TextSearchService.search(description_ru). См. подробности в комментариях
// inline + commit message PR8.
// =============================================================================

type TVisionRawOutput = {
    is_relevant: boolean;
    category?: string | null;
    brand?: string | null;
    model_hint?: string | null;
    description_ru: string;
    confidence?: 'high' | 'medium' | 'low';
    [key: string]: unknown;
};

@Injectable()
export class ImageSearchService {
    private readonly logger = new Logger(ImageSearchService.name);

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

        // mime прошёл IsIn(VISION_ALLOWED_MIME_TYPES) на ValidationPipe,
        // здесь invariant — split всегда даст ext. `?? 'bin'` мёртвый код,
        // оставлен дёшево для defensive runtime.
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

        // is_relevant=false → UX-friendly 400 с hint. Не failure, не 500
        // — клиент должен показать «попробуй другое фото».
        if (!visionOutput.isRelevant) {
            throw new BadRequestException({
                message: 'Image not relevant — Vision не распознал оборудование на фото',
                visionOutput,
            });
        }

        // Reuse PR7 pipeline — TextSearchService сам делает storeId lookup
        // + vectorstoreQuery + presigned URLs + metadata whitelist.
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
        // debug-level — chatflow id не sensitive (uuid), но захламляет
        // observability traces при каждом первом cold-start request'е.
        this.logger.debug(`vision chatflow "${VISION_CHATFLOW_NAME}" → id=${chatflow.id}`);
        return chatflow.id;
    }

    private parseVisionResponse(response: TFlowisePredictionResponse): VisionOutputDto {
        // Все ошибки парсинга = upstream (Vision вернул мусор), отсюда
        // BadGatewayException 502 — семантически корректнее чем generic
        // Error 500. Проблема не в нашем коде, а в Flowise/Anthropic.
        //
        // TODO(when 7+ fields): zod schema для TVisionRawOutput. Сейчас
        // 5 полей — manual narrowing проще. Прокачается до zod когда
        // prompt расширится с features/condition/brand_family/etc.
        const rawText = response.text ?? '';
        if (rawText.length === 0) {
            throw new BadGatewayException('Vision response empty — chatflow returned no text');
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(stripMarkdownWrapper(rawText));
        } catch (error) {
            this.logger.warn(
                `Vision output not parseable as JSON: ${sanitizeError(error)}. Raw: ${rawText.slice(0, 200)}`,
            );
            throw new BadGatewayException(
                `Vision output is not valid JSON: ${sanitizeError(error)}`,
                { cause: error },
            );
        }

        // JSON.parse('null')→null, JSON.parse('[]')→[], JSON.parse('"str"')→'str'
        // — все валидный JSON, но не object с полями. Без этого guard
        // `parsed.is_relevant` упал бы с `Cannot read properties of null`.
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new BadGatewayException(
                'Vision output is not a JSON object (got null/array/primitive)',
            );
        }

        const raw = parsed as TVisionRawOutput;

        if (typeof raw.is_relevant !== 'boolean') {
            throw new BadGatewayException(
                'Vision output missing required field "is_relevant"',
            );
        }

        const descriptionRu =
            typeof raw.description_ru === 'string' ? sanitizeFreeFormText(raw.description_ru) : '';
        if (raw.is_relevant && descriptionRu.length === 0) {
            throw new BadGatewayException(
                'Vision is_relevant=true but description_ru empty — search невозможен',
            );
        }

        return {
            isRelevant: raw.is_relevant,
            category: typeof raw.category === 'string' ? sanitizeFreeFormText(raw.category) : null,
            brand: typeof raw.brand === 'string' ? sanitizeFreeFormText(raw.brand) : null,
            modelHint:
                typeof raw.model_hint === 'string' ? sanitizeFreeFormText(raw.model_hint) : null,
            descriptionRu,
            confidence: isValidConfidence(raw.confidence) ? raw.confidence : 'low',
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

// Backend sanitization free-form LLM output перед возвратом клиенту.
// Защита от adversarial input image с текстом-инструкцией внутри —
// LLM может echo HTML/JS в descriptionRu, фронт без escape → XSS.
//
// Не полная XSS-defense (front обязан escape всегда), но дешёвый barrier:
// (1) strip ASCII control chars (codes 0..31 + 127, NUL/CR/LF и т.д.);
// (2) strip HTML tags;
// (3) cap длиной 2000 chars — defensive против unbounded LLM output.
const ASCII_CONTROL_CHAR_MAX_CODE = 31;
const ASCII_DEL_CHAR_CODE = 127;
const SANITIZE_FREE_FORM_MAX_LENGTH = 2000;

function sanitizeFreeFormText(value: string): string {
    // Char-by-char filter — без regex-литералов с control chars в
    // исходнике (избегаем багов tooling'а который молча вставляет raw
    // bytes при редактировании unicode escape ranges).
    let result = '';
    for (const ch of value) {
        const code = ch.charCodeAt(0);
        if (code <= ASCII_CONTROL_CHAR_MAX_CODE || code === ASCII_DEL_CHAR_CODE) {
            continue;
        }
        result += ch;
    }
    return result.replace(/<[^>]*>/g, '').slice(0, SANITIZE_FREE_FORM_MAX_LENGTH);
}
