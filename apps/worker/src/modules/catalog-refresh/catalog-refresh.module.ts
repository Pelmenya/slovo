import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { FlowiseClient, type TFlowiseClientConfig } from '@slovo/flowise-client';
import type { TAppEnv } from '@slovo/common';
import { StorageModule } from '@slovo/storage';
import { FLOWISE_CLIENT_TOKEN, REDIS_CLIENT_TOKEN } from './catalog-refresh.constants';
import { CatalogRefreshService } from './catalog-refresh.service';
import { VisionAugmenterService } from './vision-augmenter.service';

// Defensive guard для useFactory — env.schema.ts уже валидирует
// FLOWISE_API_KEY условно (когда FLOWISE_API_URL задан в production), но в
// dev FLOWISE_API_URL может быть optional. Этот throw гарантирует что service
// не стартует с garbage config — fail-fast при некорректной конфигурации worker'а.
function assertEnv(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`${name} is required for catalog-refresh worker`);
    }
    return value;
}

// Refresh синхронен — POST /document-store/refresh ждёт пока Flowise re-embed
// все loader'ы (см. tech-debt секция C). На 155 items сейчас ~5 сек, на 1000+
// items может занимать минуты. 5min ceiling — потолок для самого долгого
// разумного refresh; если превысит — лучше abort'нуть и переоткрыть, чем
// висеть бесконечно с занятым lock'ом до TTL=30min.
const REFRESH_FLOWISE_TIMEOUT_MS = 300_000;

@Module({
    imports: [
        // Worker читает latest.json из bucket S3_CATALOG_BUCKET (slovo-datasets)
        // — отдельно от knowledge S3_BUCKET (slovo-sources). См. PR6.5
        // (slovo-orchestrate ingest) и ADR-007.
        // PR9.5: DatabaseModule удалён — RecordManager теперь управляет lifecycle
        // chunks (incremental cleanup), TRUNCATE через Prisma больше не нужен.
        StorageModule.forFeature({ bucketEnvKey: 'S3_CATALOG_BUCKET' }),
    ],
    providers: [
        CatalogRefreshService,
        VisionAugmenterService,
        {
            provide: FLOWISE_CLIENT_TOKEN,
            useFactory: (config: ConfigService<TAppEnv>): FlowiseClient => {
                const clientConfig: TFlowiseClientConfig = {
                    apiUrl: assertEnv(config.get('FLOWISE_API_URL', { infer: true }), 'FLOWISE_API_URL'),
                    apiKey: assertEnv(config.get('FLOWISE_API_KEY', { infer: true }), 'FLOWISE_API_KEY'),
                    requestTimeoutMs: REFRESH_FLOWISE_TIMEOUT_MS,
                };
                return new FlowiseClient(clientConfig);
            },
            inject: [ConfigService],
        },
        {
            provide: REDIS_CLIENT_TOKEN,
            useFactory: (config: ConfigService<TAppEnv>): Redis => {
                const host = assertEnv(config.get('REDIS_HOST', { infer: true }), 'REDIS_HOST');
                const port = config.get('REDIS_PORT', { infer: true });
                if (!port) {
                    throw new Error('REDIS_PORT is required for catalog-refresh worker');
                }
                const password = config.get('REDIS_PASSWORD', { infer: true });
                return new Redis({
                    host,
                    port,
                    password: password || undefined,
                    lazyConnect: false,
                    maxRetriesPerRequest: 3,
                    // 5s connectTimeout vs ioredis default ~10-15s. При
                    // недоступном Valkey worker не виснет на ETIMEDOUT,
                    // быстрее переходит к fallback / restart.
                    connectTimeout: 5_000,
                    // Lock acquire/release должен быть мгновенным — 3s
                    // ceiling ловит slowlog events и сетевые blip'ы.
                    commandTimeout: 3_000,
                });
            },
            inject: [ConfigService],
        },
    ],
})
export class CatalogRefreshModule {}
