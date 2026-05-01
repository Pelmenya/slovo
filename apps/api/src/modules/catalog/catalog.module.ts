import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { FlowiseClient, type TFlowiseClientConfig } from '@slovo/flowise-client';
import type { TAppEnv } from '@slovo/common';
import { StorageService } from '@slovo/storage';
import {
    CATALOG_STORAGE_SERVICE_TOKEN,
    FLOWISE_CLIENT_TOKEN,
    REDIS_CLIENT_TOKEN,
} from './catalog.constants';
import { TextSearchController } from './search/text.controller';
import { TextSearchService } from './search/text.service';

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

// Catalog StorageService — bound к S3_CATALOG_BUCKET (slovo-datasets), не
// к S3_BUCKET (slovo-sources, knowledge module). Отдельный bucket per
// ADR-007 (feeder'ы пишут в catalogs/aquaphor/, knowledge — другие keys).
//
// TODO(libs/storage): когда появится 3-й feature с ещё одним bucket'ом —
// extract в `StorageModule.forFeature({ bucketEnvKey: ... })`. Сейчас два
// bucket'а — самый минимум inline-факторинга, full module pattern overkill.
const catalogStorageProvider: Provider = {
    provide: CATALOG_STORAGE_SERVICE_TOKEN,
    inject: [ConfigService],
    useFactory: (config: ConfigService<TAppEnv, true>): StorageService => {
        const endpoint = config.get('S3_ENDPOINT', { infer: true });
        const region = config.getOrThrow('S3_REGION', { infer: true });
        const accessKeyId = config.getOrThrow('S3_ACCESS_KEY', { infer: true });
        const secretAccessKey = config.getOrThrow('S3_SECRET_KEY', { infer: true });
        const forcePathStyle = config.get('S3_FORCE_PATH_STYLE', { infer: true });
        const bucket = config.getOrThrow('S3_CATALOG_BUCKET', { infer: true });

        const clientConfig: S3ClientConfig = {
            region,
            credentials: { accessKeyId, secretAccessKey },
            forcePathStyle,
        };
        if (endpoint && endpoint.length > 0) {
            clientConfig.endpoint = endpoint;
        }
        const s3 = new S3Client(clientConfig);
        return new StorageService(s3, bucket);
    },
};

@Module({
    controllers: [TextSearchController],
    providers: [
        flowiseClientProvider,
        redisClientProvider,
        catalogStorageProvider,
        TextSearchService,
    ],
})
export class CatalogModule {}
