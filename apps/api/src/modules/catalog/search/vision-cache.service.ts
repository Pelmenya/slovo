import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sanitizeError } from '@slovo/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT_TOKEN } from '../catalog.constants';
import type { VisionOutputDto } from './dto/search.response.dto';

// =============================================================================
// VisionCacheService — SHA256-кэш ответов Claude Vision (#66 / tech-debt #35).
//
// Mотивация: открытый каталог prostor-app, клиент сфотографировал свой
// картридж → search → не нашёл, нажимает «обновить» / возвращается через
// минуту с тем же фото → второй раз тот же Vision call ($0.005-0.007).
// При 30% повторов от 50 image-search/день экономим ~$0.10/день = ~3 ₽/мес.
// При 1000 image-search/день — ~$2/день = ~60 ₽/мес.
//
// Ключ кэша: `slovo:vision:cache:<sha256>`. Hash вычисляется от content
// всех картинок (отсортированных, order-independent). TTL 24 часа —
// баланс между частотой повторов и cache pollution. Cache miss / corrupt
// JSON / Redis fail — graceful fallback на Vision call (не блокирует UX).
//
// Cache hit пропускает: Vision call, BudgetService.assertVisionBudget(),
// BudgetService.recordVisionCall(). Это feature: при cache hit мы
// фактически не тратим деньги, поэтому budget-cap не применяется.
// =============================================================================

const VISION_CACHE_KEY_PREFIX = 'slovo:vision:cache';
const VISION_CACHE_TTL_SEC = 86400; // 24 часа

@Injectable()
export class VisionCacheService {
    private readonly logger = new Logger(VisionCacheService.name);

    constructor(
        @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
    ) {}

    // Stable hash для multi-image set'а. Order-independent через sort.
    // Per-image: sha256(base64-decoded bytes) — детерминированный, защищён
    // от EXIF-меняющих манипуляций (ну, к сожалению — но это правильно:
    // если клиент крутанул фото на 90°, это другая картинка с т.з.
    // Vision, нужен новый ответ).
    static computeImageHash(images: ReadonlyArray<{ base64: string }>): string {
        const perImageHashes = images
            .map((img) =>
                createHash('sha256')
                    .update(Buffer.from(img.base64, 'base64'))
                    .digest('hex'),
            )
            .sort();
        return createHash('sha256').update(perImageHashes.join(':')).digest('hex');
    }

    async get(hash: string): Promise<VisionOutputDto | null> {
        try {
            const raw = await this.redis.get(this.cacheKey(hash));
            if (raw === null) return null;
            return JSON.parse(raw) as VisionOutputDto;
        } catch (error) {
            // Redis network blip / corrupt JSON — log + fall through на Vision
            // call. Клиент получит свежий ответ, не 500.
            this.logger.warn(
                `vision cache read failed (hash=${hash.slice(0, 12)}…): ${sanitizeError(error)}`,
            );
            return null;
        }
    }

    async set(hash: string, output: VisionOutputDto): Promise<void> {
        try {
            await this.redis.setex(
                this.cacheKey(hash),
                VISION_CACHE_TTL_SEC,
                JSON.stringify(output),
            );
        } catch (error) {
            // Redis fail — не критично, просто следующий запрос пойдёт в Vision.
            this.logger.warn(
                `vision cache write failed (hash=${hash.slice(0, 12)}…): ${sanitizeError(error)}`,
            );
        }
    }

    private cacheKey(hash: string): string {
        return `${VISION_CACHE_KEY_PREFIX}:${hash}`;
    }
}
