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
    VISION_AUGMENT_ALLOWED_MIMES,
    VISION_AUGMENT_CALL_TIMEOUT_MS,
    VISION_AUGMENT_MAX_CALLS_PER_REFRESH,
    VISION_AUGMENT_MAX_DESCRIPTION_LENGTH,
    VISION_AUGMENT_MAX_IMAGE_BYTES,
    VISION_AUGMENT_MAX_IMAGES,
    VISION_AUGMENT_MODEL_VERSION,
    VISION_AUGMENT_REDIS_KEY,
} from './catalog-refresh.constants';

// =============================================================================
// VisionAugmenterService — обогащение товарного contentForEmbedding
// визуальным описанием от Claude Vision (#70 / #71).
//
// Архитектура:
// - Download images товара из MinIO (StorageService) с mime whitelist
// - SHA256 hash от sorted concat(image bytes) — stable fingerprint
// - Redis HASH `slovo:catalog:vision-augment:<externalId>` →
//   `{imageHash, visualDescription, modelVersion}`
// - Hash совпал И modelVersion match → reuse cached (skip Vision)
// - Hash отличается / modelVersion bumped → Flowise predict → save → return
// - REMOVED-sweep делает CatalogRefreshService по аналогии с loader mapping
//
// Защитные меры (после security ревью Phase 2):
// - Per-refresh batch cap (VISION_AUGMENT_MAX_CALLS_PER_REFRESH=500) защищает
//   от financial DoS при сломанной idempotency feeder'а. Cap превышен →
//   augmentItem возвращает null + warn, refresh продолжается без augment.
//   Cycle counter сбрасывается через beginRefreshCycle() перед каждым
//   refresh'ем (вызывается из CatalogRefreshService.runOrchestrate).
// - Per-call timeout (15 сек) защищает от зависшего Vision call'а съедающего
//   refresh-lock TTL (30 мин).
// - Length cap (500 chars) на description — защита от prompt injection
//   через текст на товарных фото.
// - Mime whitelist — только image/{jpeg,png,gif,webp}. Anything else skip'ается
//   до Vision call (экономит chatflow_list lookup + bytes).
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
    // Опциональный для backward-compat. Старые записи без modelVersion
    // считаются "stale" (cache miss) — будут перегенерены при следующем
    // refresh с актуальной моделью. Новые записи всегда имеют modelVersion.
    modelVersion?: string;
};

@Injectable()
export class VisionAugmenterService {
    private readonly logger = new Logger(VisionAugmenterService.name);
    private chatflowIdPromise: Promise<string> | null = null;
    // Per-refresh batch cap counter. Сбрасывается через beginRefreshCycle().
    // Без сброса между cron'ами счётчик растёт и через ~83 цикла достигнет
    // cap'а — но это правильно: значит что-то вне ожиданий, refresh останавливает
    // augmentation до перезапуска worker'а.
    private callsThisRefresh = 0;
    // Признак misconfiguration: chatflow не найден. Логируется как error
    // один раз, дальше остальные items получают warn без stack trace
    // (защита от лог-спама на 155 items).
    private chatflowMissingErrorLogged = false;

    constructor(
        @Inject(FLOWISE_CLIENT_TOKEN) private readonly flowise: FlowiseClient,
        @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
        private readonly storage: StorageService,
        private readonly config: ConfigService<TAppEnv, true>,
    ) {}

    // Сбрасывает per-refresh batch counter. Вызывается перед каждым refresh-
    // циклом из CatalogRefreshService.runOrchestrate. Без вызова счётчик
    // продолжает копить calls с предыдущего refresh — это safety, не bug
    // (defaults to "stop early" а не "spam Vision calls").
    beginRefreshCycle(): void {
        this.callsThisRefresh = 0;
        this.chatflowMissingErrorLogged = false;
    }

    // Главный API. Возвращает visual description или null при graceful fail.
    async augmentItem(
        externalId: string,
        imageUrls: ReadonlyArray<string>,
    ): Promise<string | null> {
        if (imageUrls.length === 0) {
            return null;
        }

        try {
            // 1. Download images (cap MAX_IMAGES, MAX_IMAGE_BYTES, mime whitelist)
            const downloaded = await this.downloadImages(imageUrls);
            if (downloaded.length === 0) {
                return null; // Все skip'нуты — лог уже из downloadImages
            }

            // 2. Compute hash для idempotency (от raw bytes)
            const imageHash = computeImageHash(downloaded.map((d) => d.buffer));

            // 3. Check Redis mapping — hash + modelVersion должны совпасть
            const cached = await this.getCachedAugmentation(externalId);
            if (
                cached !== null &&
                cached.imageHash === imageHash &&
                cached.modelVersion === VISION_AUGMENT_MODEL_VERSION
            ) {
                this.logger.debug(
                    `augmentItem: externalId=${externalId} cache HIT (hash=${imageHash.slice(0, 12)}…)`,
                );
                return cached.visualDescription;
            }

            // 4. Per-refresh batch cap — защита от financial DoS
            if (this.callsThisRefresh >= VISION_AUGMENT_MAX_CALLS_PER_REFRESH) {
                this.logger.warn(
                    `augmentItem: per-refresh cap (${VISION_AUGMENT_MAX_CALLS_PER_REFRESH}) ` +
                        `достигнут — externalId=${externalId} skip Vision call. ` +
                        `Возможен баг feeder idempotency или massive content update.`,
                );
                return null;
            }

            // 5. Cache miss → Flowise Vision augmenter (с timeout)
            this.callsThisRefresh++;
            const description = await this.callVisionAugmenter(downloaded);
            if (description === null) {
                return null;
            }

            // 6. Length cap (защита от prompt injection через текст на фото)
            const cappedDescription =
                description.length > VISION_AUGMENT_MAX_DESCRIPTION_LENGTH
                    ? description.slice(0, VISION_AUGMENT_MAX_DESCRIPTION_LENGTH).trimEnd() + '…'
                    : description;

            // 7. Save mapping (новый hash + description + modelVersion)
            await this.setCachedAugmentation(externalId, {
                imageHash,
                visualDescription: cappedDescription,
                modelVersion: VISION_AUGMENT_MODEL_VERSION,
            });
            this.logger.debug(
                `augmentItem: externalId=${externalId} cache MISS → Vision call → saved (${cappedDescription.length} chars)`,
            );

            return cappedDescription;
        } catch (error) {
            this.logger.warn(
                `augmentItem failed: externalId=${externalId} error=${sanitizeError(error)}`,
            );
            return null;
        }
    }

    // REMOVED-sweep API.
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
        const skips: string[] = [];
        for (const key of limited) {
            try {
                const downloaded = await this.downloadOneImage(key);
                if (downloaded === null) {
                    skips.push(`${key}: skipped (size cap / unsupported mime)`);
                    continue;
                }
                results.push(downloaded);
            } catch (error) {
                skips.push(`${key}: ${sanitizeError(error)}`);
            }
        }
        // Aggregate warn — одна строка вместо лог-спама на 5 фото
        if (skips.length > 0) {
            this.logger.warn(`downloadImages: ${skips.length} skipped — ${skips.join('; ')}`);
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
                return null;
            }
            totalBytes += buf.length;
            if (totalBytes > VISION_AUGMENT_MAX_IMAGE_BYTES) {
                return null;
            }
            chunks.push(buf);
        }
        const buffer = Buffer.concat(chunks);
        const mime = stream.contentType ?? mimeFromKey(key);
        // Mime whitelist — Anthropic API принимает только image/{jpeg,png,gif,webp}.
        // SVG/octet-stream/heic skip'аются до Vision call.
        if (!VISION_AUGMENT_ALLOWED_MIMES.has(mime)) {
            return null;
        }
        return { buffer, mime };
    }

    private async callVisionAugmenter(
        images: ReadonlyArray<{ buffer: Buffer; mime: string }>,
    ): Promise<string | null> {
        let chatflowId: string;
        try {
            chatflowId = await this.resolveChatflowId();
        } catch (error) {
            // Misconfiguration — логируем error один раз, далее silent
            // (защита от лог-спама на 155 items × stack trace).
            if (!this.chatflowMissingErrorLogged) {
                this.logger.error(
                    `callVisionAugmenter: chatflow resolve failed — Vision augmentation отключена ` +
                        `до восстановления Flowise. ${sanitizeError(error)}`,
                );
                this.chatflowMissingErrorLogged = true;
            }
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
            // Promise.race с timeout — защита от зависшего Vision call'а
            // (один зависший = съедает весь refresh lock-TTL).
            const predictPromise = this.flowise.request<TFlowisePredictionResponse>(
                ENDPOINTS.prediction(chatflowId),
                { method: 'POST', body: { question: '', uploads } },
            );
            const response = await raceWithTimeout(predictPromise, VISION_AUGMENT_CALL_TIMEOUT_MS);

            const text = (response.text ?? '').trim();
            if (text.length === 0) {
                this.logger.warn('callVisionAugmenter: empty Vision response');
                return null;
            }
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
                    `Создай через apps/worker/scripts/provision-augmenter-chatflow.ts.`,
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
            this.logger.warn(
                `setCachedAugmentation: externalId=${externalId} — ${sanitizeError(error)}`,
            );
        }
    }
}

// =============================================================================
// Helpers (pure, exported для unit-тестов)
// =============================================================================

// Stable hash от content всех картинок товара. Order-independent через sort.
// Per-image: sha256(bytes). Затем sort(hex strings) + join → final sha256.
// Один и тот же набор картинок (в любом порядке в imageUrls) → один hash.
export function computeImageHash(buffers: ReadonlyArray<Buffer>): string {
    const perImageHashes = buffers
        .map((buf) => createHash('sha256').update(buf).digest('hex'))
        .sort();
    return createHash('sha256').update(perImageHashes.join(':')).digest('hex');
}

export function stripMarkdownWrapper(text: string): string {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/^```(?:[a-z]+)?\s*\n?([\s\S]*?)\n?```$/);
    return fenceMatch && fenceMatch[1] !== undefined ? fenceMatch[1].trim() : trimmed;
}

// MIME-fallback по расширению S3-key. Anthropic API принимает только
// image/{jpeg,png,gif,webp}. Если расширение не распознано — image/jpeg
// conservative default (большинство товарных фото в каталоге).
// Реальное использование: после mimeFromKey() результат проверяется
// против VISION_AUGMENT_ALLOWED_MIMES whitelist, неподдерживаемые форматы
// skip'аются до Vision call.
export function mimeFromKey(key: string): string {
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

// Promise.race с timeout — кидает Error('timeout') если promise не завершён
// за `ms`. Используется для защиты Vision call от зависания.
async function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Vision augment timeout after ${ms}ms`)), ms);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
}
