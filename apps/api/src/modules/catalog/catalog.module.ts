import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { FlowiseClient, type TFlowiseClientConfig } from '@slovo/flowise-client';
import type { TAppEnv } from '@slovo/common';
import { StorageModule } from '@slovo/storage';
import { FLOWISE_CLIENT_TOKEN, REDIS_CLIENT_TOKEN } from './catalog.constants';
import { ImageSearchService } from './search/image.service';
import { CatalogSearchController } from './search/search.controller';
import { CatalogSearchService } from './search/search.service';
import { TextSearchService } from './search/text.service';
import { VisionCacheService } from './search/vision-cache.service';

// Defensive guard для useFactory — env.schema валидирует FLOWISE_API_KEY условно
// (требует только если NODE_ENV=production + FLOWISE_API_URL задан). В dev оба
// могут быть пустыми. CatalogModule стартует только когда обе настройки заданы —
// fail-fast при некорректной конфигурации API runtime'а.
function assertEnv(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`${name} is required for catalog module`);
    }
    return value;
}

// Search hot-path — 10s timeout. Flowise vectorstoreQuery норма ~300-500мс
// (1 OpenAI embed + pgvector cosine). 10s — потолок при загрузке (ругательно
// но не фатально для UX), при превышении лучше fail-fast чем висеть на ETIMEDOUT
// (default Node ~120s). Worker (catalog-refresh) использует более высокий
// timeout — refresh синхронен, на 1000+ items может занимать минуты.
const SEARCH_FLOWISE_TIMEOUT_MS = 10_000;

const flowiseClientProvider: Provider = {
    provide: FLOWISE_CLIENT_TOKEN,
    inject: [ConfigService],
    useFactory: (config: ConfigService<TAppEnv, true>): FlowiseClient => {
        const clientConfig: TFlowiseClientConfig = {
            apiUrl: assertEnv(config.get('FLOWISE_API_URL', { infer: true }), 'FLOWISE_API_URL'),
            apiKey: assertEnv(config.get('FLOWISE_API_KEY', { infer: true }), 'FLOWISE_API_KEY'),
            requestTimeoutMs: SEARCH_FLOWISE_TIMEOUT_MS,
        };
        return new FlowiseClient(clientConfig);
    },
};

const redisClientProvider: Provider = {
    provide: REDIS_CLIENT_TOKEN,
    inject: [ConfigService],
    useFactory: (config: ConfigService<TAppEnv, true>): Redis => {
        const host = config.getOrThrow('REDIS_HOST', { infer: true });
        const port = config.getOrThrow('REDIS_PORT', { infer: true });
        const password = config.get('REDIS_PASSWORD', { infer: true });
        return new Redis({
            host,
            port,
            password: password || undefined,
            lazyConnect: false,
            maxRetriesPerRequest: 3,
            // 5s connectTimeout vs ioredis default ~10-15s. При недоступном
            // Valkey health-endpoint отдаст 503 быстрее, deploy не висит.
            connectTimeout: 5_000,
            // Отдельный command timeout — защита от зависших команд на
            // healthy connection (network blip, slowlog event).
            commandTimeout: 3_000,
        });
    },
};

// Catalog images живут в bucket S3_CATALOG_BUCKET (slovo-datasets), отдельно
// от knowledge S3_BUCKET (slovo-sources) — feeder'ы (CRM, 1С) пишут в
// catalogs/<feeder>/ префикс с другим IAM-scope (см. ADR-007).
//
// `StorageModule.forFeature(...)` создаёт scope-isolated StorageService для
// этого модуля — knowledge module всё ещё импортирует обычный StorageModule
// и получает свой StorageService на S3_BUCKET. Два независимых instance'а
// в одной NestJS-app.
@Module({
    imports: [StorageModule.forFeature({ bucketEnvKey: 'S3_CATALOG_BUCKET' })],
    controllers: [CatalogSearchController],
    providers: [
        flowiseClientProvider,
        redisClientProvider,
        TextSearchService,
        ImageSearchService,
        VisionCacheService,
        CatalogSearchService,
    ],
})
export class CatalogModule {}
