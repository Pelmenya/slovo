import {
    BadGatewayException,
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
import { CatalogImageItemDto } from './dto/search.request.dto';
import { VisionOutputDto } from './dto/search.response.dto';

// =============================================================================
// ImageSearchService — Claude Vision describer для catalog images.
//
// Refactored в universal-search rewrite: больше не делает downstream search
// (это responsibility CatalogSearchService orchestrator'а). Только:
// 1. Resolve VISION_CHATFLOW_ID by name (lazy + single-flight + retry on
//    failure — паттерн из text.service:resolveStoreId).
// 2. POST /prediction/<chatflowId> с base64 image upload.
// 3. Defensive parse response.text как JSON (со strip markdown wrapper
//    ```json...``` если LLM завернёт).
// 4. Sanitize free-form LLM output (control chars + HTML strip).
// 5. Returns VisionOutputDto — каллер решает что делать (если is_relevant=
//    false — UX-friendly 400, иначе orchestrate downstream search).
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
    ) {}

    async processVision(images: CatalogImageItemDto[]): Promise<VisionOutputDto> {
        if (images.length === 0) {
            throw new Error('processVision: empty images array — should be caught upstream');
        }

        const chatflowId = await this.resolveChatflowId();

        // Multi-image upload: Anthropic Vision принимает все картинки в
        // одном request (uploads array). Vision-describer prompt v1 умеет
        // обрабатывать множественные кадры — возвращает one combined
        // description_ru объединяющее все ракурсы. mime прошёл
        // IsIn(VISION_ALLOWED_MIME_TYPES) на ValidationPipe per-item.
        const uploads = images.map((img, idx) => {
            const ext = img.mime.split('/')[1] ?? 'bin';
            return {
                data: `data:${img.mime};base64,${img.base64}`,
                type: 'file' as const,
                name: `image-${idx}.${ext}`,
                mime: img.mime,
            };
        });

        const visionResponse = await this.flowise.request<TFlowisePredictionResponse>(
            ENDPOINTS.prediction(chatflowId),
            {
                method: 'POST',
                body: { question: '', uploads },
            },
        );

        return this.parseVisionResponse(visionResponse);
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

function stripMarkdownWrapper(text: string): string {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function isValidConfidence(value: unknown): value is 'high' | 'medium' | 'low' {
    return value === 'high' || value === 'medium' || value === 'low';
}

const ASCII_CONTROL_CHAR_MAX_CODE = 31;
const ASCII_DEL_CHAR_CODE = 127;
const SANITIZE_FREE_FORM_MAX_LENGTH = 2000;

function sanitizeFreeFormText(value: string): string {
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
