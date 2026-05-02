import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { sanitizeError, type TAppEnv } from '@slovo/common';
import {
    ENDPOINTS,
    type FlowiseClient,
    type TFlowiseChatflow,
    type TFlowisePredictionResponse,
} from '@slovo/flowise-client';
import { StorageService } from '@slovo/storage';
import {
    FLOWISE_CLIENT_TOKEN,
    REDIS_CLIENT_TOKEN,
    VISION_AUGMENT_MAX_IMAGE_BYTES,
    VISION_AUGMENT_MAX_IMAGES,
    VISION_AUGMENT_REDIS_KEY,
} from './catalog-refresh.constants';

// =============================================================================
// VisionAugmenterService — обогащение товарного contentForEmbedding
// визуальным описанием от Claude Vision (#70 / #71).
//
// Архитектура:
// - Download images товара из MinIO (StorageService)
// - SHA256 hash от sorted concat(image bytes) — stable fingerprint
// - Redis HASH `slovo:catalog:vision-augment:<externalId>` →
//   `{imageHash, visualDescription}`
// - Hash совпал с stored → reuse cached visualDescription (skip Vision)
// - Hash отличается / нет записи → Flowise predict → save → return
// - REMOVED-sweep делает CatalogRefreshService по аналогии с loader mapping
//
// Любая ошибка → return null + warn (refresh продолжается без augmentation
// для этого товара — graceful degradation, не валит pipeline).
//
// Idempotency: один и тот же набор фото → один и тот же augmentation text →
// один embedding → cache hit при дублирующих refresh'ах. Temperature=0 в
// chatflow обеспечивает детерминизм Vision output'а.
// =============================================================================

type TAugmentMappingEntry = {
    imageHash: string;
    visualDescription: string;
};

@Injectable()
export class VisionAugmenterService {
    private readonly logger = new Logger(VisionAugmenterService.name);
    private chatflowIdPromise: Promise<string> | null = null;

    constructor(
        @Inject(FLOWISE_CLIENT_TOKEN) private readonly flowise: FlowiseClient,
        @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
        private readonly storage: StorageService,
        private readonly config: ConfigService<TAppEnv, true>,
    ) {}

    // Главный API. Возвращает visual description или null если:
    // - imageUrls пуст (нечего augment'ить)
    // - не удалось скачать картинки (MinIO fail)
    // - Vision call упал
    // - chatflow не найден в Flowise
    //
    // Не throw'ит — refresh должен идти даже если augmentation сломалось.
    async augmentItem(
        externalId: string,
        imageUrls: ReadonlyArray<string>,
    ): Promise<string | null> {
        if (imageUrls.length === 0) {
            return null;
        }

        try {
            // 1. Download images (cap MAX_IMAGES, MAX_IMAGE_BYTES per file)
            const downloaded = await this.downloadImages(imageUrls);
            if (downloaded.length === 0) {
                this.logger.warn(
                    `augmentItem: externalId=${externalId} — все картинки skip'нуты (size cap / download fail)`,
                );
                return null;
            }

            // 2. Compute hash для idempotency (от raw bytes, без mime —
            // mime может варьироваться, но bytes детерминированы).
            const imageHash = computeImageHash(downloaded.map((d) => d.buffer));

            // 3. Check Redis mapping
            const cached = await this.getCachedAugmentation(externalId);
            if (cached !== null && cached.imageHash === imageHash) {
                this.logger.debug(
                    `augmentItem: externalId=${externalId} cache HIT (hash=${imageHash.slice(0, 12)}…)`,
                );
                return cached.visualDescription;
            }

            // 4. Cache miss → Flowise Vision augmenter
            const description = await this.callVisionAugmenter(downloaded);
            if (description === null) {
                return null; // Vision fail logged внутри
            }

            // 5. Save mapping (новый hash + description)
            await this.setCachedAugmentation(externalId, {
                imageHash,
                visualDescription: description,
            });
            this.logger.debug(
                `augmentItem: externalId=${externalId} cache MISS → Vision call → saved (${description.length} chars)`,
            );

            return description;
        } catch (error) {
            // Любая неожиданная ошибка — graceful, refresh не валится.
            this.logger.warn(
                `augmentItem failed: externalId=${externalId} error=${sanitizeError(error)}`,
            );
            return null;
        }
    }

    // REMOVED-sweep API — вызывается из CatalogRefreshService при удалении
    // товаров из payload. Возвращает количество удалённых entries.
    async removeStaleAugmentations(externalIds: ReadonlyArray<string>): Promise<number> {
        if (externalIds.length === 0) return 0;
        try {
            const removed = await this.redis.hdel(VISION_AUGMENT_REDIS_KEY, ...externalIds);
            return removed;
        } catch (error) {
            this.logger.warn(
                `removeStaleAugmentations failed: ${sanitizeError(error)}`,
            );
            return 0;
        }
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    private async downloadImages(
        imageUrls: ReadonlyArray<string>,
    ): Promise<Array<{ buffer: Buffer; mime: string }>> {
        const limited = imageUrls.slice(0, VISION_AUGMENT_MAX_IMAGES);
        const results: Array<{ buffer: Buffer; mime: string }> = [];
        for (const key of limited) {
            try {
                const downloaded = await this.downloadOneImage(key);
                if (downloaded !== null) results.push(downloaded);
            } catch (error) {
                // Per-image fail не валит остальные — продолжаем с тем что есть
                this.logger.warn(
                    `downloadImages: skip ${key} — ${sanitizeError(error)}`,
                );
            }
        }
        return results;
    }

    private async downloadOneImage(
        key: string,
    ): Promise<{ buffer: Buffer; mime: string } | null> {
        const stream = await this.storage.getObjectStream(key);
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        for await (const chunk of stream.body) {
            let buf: Buffer;
            if (typeof chunk === 'string') {
                buf = Buffer.from(chunk, 'utf8');
            } else if (Buffer.isBuffer(chunk)) {
                buf = chunk;
            } else if (chunk instanceof Uint8Array) {
                buf = Buffer.from(chunk);
            } else {
                this.logger.warn(`downloadOneImage: unexpected stream chunk type for ${key}`);
                return null;
            }
            totalBytes += buf.length;
            if (totalBytes > VISION_AUGMENT_MAX_IMAGE_BYTES) {
                this.logger.warn(
                    `downloadOneImage: ${key} exceeds ${VISION_AUGMENT_MAX_IMAGE_BYTES} bytes — skip`,
                );
                return null;
            }
            chunks.push(buf);
        }
        const buffer = Buffer.concat(chunks);
        // MIME-type: приоритет contentType от MinIO, fallback на extension,
        // фоллбэк-fallback на jpeg. Anthropic API строго проверяет соответствие
        // mime declared vs actual bytes — неверный mime → 400.
        const mime = stream.contentType ?? mimeFromKey(key);
        return { buffer, mime };
    }

    private async callVisionAugmenter(
        images: ReadonlyArray<{ buffer: Buffer; mime: string }>,
    ): Promise<string | null> {
        let chatflowId: string;
        try {
            chatflowId = await this.resolveChatflowId();
        } catch (error) {
            this.logger.warn(
                `callVisionAugmenter: cannot resolve chatflow — ${sanitizeError(error)}`,
            );
            return null;
        }

        const uploads = images.map(({ buffer, mime }, idx) => {
            const ext = mime.split('/')[1] ?? 'jpg';
            return {
                data: `data:${mime};base64,${buffer.toString('base64')}`,
                type: 'file' as const,
                name: `image-${idx}.${ext}`,
                mime,
            };
        });

        try {
            const response = await this.flowise.request<TFlowisePredictionResponse>(
                ENDPOINTS.prediction(chatflowId),
                {
                    method: 'POST',
                    body: { question: '', uploads },
                },
            );
            const text = (response.text ?? '').trim();
            if (text.length === 0) {
                this.logger.warn('callVisionAugmenter: empty Vision response');
                return null;
            }
            // Augmenter chatflow возвращает plain text. Если LLM завернёт в markdown
            // (```text...```) — strip wrapper. JSON-обёртку не ожидаем (промпт это
            // запрещает), но на всякий случай очистим тройные кавычки если попадутся.
            return stripMarkdownWrapper(text);
        } catch (error) {
            this.logger.warn(
                `callVisionAugmenter: Flowise predict failed — ${sanitizeError(error)}`,
            );
            return null;
        }
    }

    private resolveChatflowId(): Promise<string> {
        if (!this.chatflowIdPromise) {
            this.chatflowIdPromise = this.lookupChatflowId().catch((err: unknown) => {
                // Reset cache на failure — следующий вызов попробует заново
                this.chatflowIdPromise = null;
                throw err;
            });
        }
        return this.chatflowIdPromise;
    }

    private async lookupChatflowId(): Promise<string> {
        const targetName = this.config.get('VISION_AUGMENTER_CHATFLOW_NAME', { infer: true });
        const chatflows = await this.flowise.request<TFlowiseChatflow[]>(ENDPOINTS.chatflows);
        const match = chatflows.find((c) => c.name === targetName);
        if (!match) {
            throw new Error(
                `Vision augmenter chatflow "${targetName}" не найден в Flowise. ` +
                    `Создай через experiments/create-augmenter-chatflow.mjs.`,
            );
        }
        this.logger.debug(`vision augmenter chatflow "${targetName}" → id=${match.id}`);
        return match.id;
    }

    private async getCachedAugmentation(externalId: string): Promise<TAugmentMappingEntry | null> {
        try {
            const raw = await this.redis.hget(VISION_AUGMENT_REDIS_KEY, externalId);
            if (raw === null) return null;
            return JSON.parse(raw) as TAugmentMappingEntry;
        } catch (error) {
            // Corrupt JSON / Redis fail — cache miss, не throw
            this.logger.warn(
                `getCachedAugmentation: externalId=${externalId} — ${sanitizeError(error)}`,
            );
            return null;
        }
    }

    private async setCachedAugmentation(
        externalId: string,
        entry: TAugmentMappingEntry,
    ): Promise<void> {
        try {
            await this.redis.hset(
                VISION_AUGMENT_REDIS_KEY,
                externalId,
                JSON.stringify(entry),
            );
        } catch (error) {
            // Cache write fail не валит pipeline — следующий refresh повторит
            this.logger.warn(
                `setCachedAugmentation: externalId=${externalId} — ${sanitizeError(error)}`,
            );
        }
    }
}

// =============================================================================
// Helpers (pure)
// =============================================================================

// Stable hash от content всех картинок товара. Order-independent через sort.
// Per-image: sha256(bytes). Затем sort(hex strings) + join → final sha256.
// Один и тот же набор картинок (в любом порядке в imageUrls) → один hash.
function computeImageHash(buffers: ReadonlyArray<Buffer>): string {
    const perImageHashes = buffers
        .map((buf) => createHash('sha256').update(buf).digest('hex'))
        .sort();
    return createHash('sha256').update(perImageHashes.join(':')).digest('hex');
}

function stripMarkdownWrapper(text: string): string {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/^```(?:[a-z]+)?\s*\n?([\s\S]*?)\n?```$/);
    return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

// MIME-fallback по расширению S3-key. Аnthropic API принимает только
// image/jpeg, image/png, image/gif, image/webp. Если расширение неизвестно —
// jpeg conservative default (большинство товарных фото в каталоге).
function mimeFromKey(key: string): string {
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    switch (ext) {
        case 'png':
            return 'image/png';
        case 'gif':
            return 'image/gif';
        case 'webp':
            return 'image/webp';
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        default:
            return 'image/jpeg';
    }
}
