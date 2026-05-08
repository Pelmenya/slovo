import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '@slovo/database';
import { FlowiseClient, type TFlowiseClientConfig } from '@slovo/flowise-client';
import type { TAppEnv } from '@slovo/common';
import Redis from 'ioredis';
import { FLOWISE_CLIENT_TOKEN, HEATMAP_REDIS_TOKEN } from './water-analysis.constants';
import { HeatmapController } from './heatmap/heatmap.controller';
import { HeatmapService } from './heatmap/heatmap.service';
import { SimilarSearchController } from './similar/similar.controller';
import { SimilarSearchService } from './similar/similar.service';

// Defensive guard для useFactory — env.schema валидирует FLOWISE_API_KEY
// условно (требует только в production). В dev оба могут быть пустыми.
// WaterAnalysisModule стартует только когда обе настройки заданы — fail-fast
// при некорректной конфигурации.
function assertEnv(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`${name} is required for water-analysis module`);
    }
    return value;
}

// Search hot-path timeout. Flowise vectorstoreQuery норма ~300-700мс
// (1 OpenAI text-embedding-3-large embed + pgvector cosine на 15 504 chunks).
// 10s — потолок при загрузке Flowise/OpenAI. Превышение → fail-fast чем
// висеть на ETIMEDOUT (default Node ~120s).
const WATER_ANALYSIS_FLOWISE_TIMEOUT_MS = 10_000;

const flowiseClientProvider: Provider = {
    provide: FLOWISE_CLIENT_TOKEN,
    inject: [ConfigService],
    useFactory: (config: ConfigService<TAppEnv, true>): FlowiseClient => {
        const clientConfig: TFlowiseClientConfig = {
            apiUrl: assertEnv(config.get('FLOWISE_API_URL', { infer: true }), 'FLOWISE_API_URL'),
            apiKey: assertEnv(config.get('FLOWISE_API_KEY', { infer: true }), 'FLOWISE_API_KEY'),
            requestTimeoutMs: WATER_ANALYSIS_FLOWISE_TIMEOUT_MS,
        };
        return new FlowiseClient(clientConfig);
    },
};

// Redis провайдер для heatmap-cache. Дублирует паттерн из BudgetModule, но
// держим отдельный instance — у heatmap другой command-timeout (heatmap кеш
// допускает чуть больший latency, ответ всё равно отдадим из SQL при miss).
const heatmapRedisProvider: Provider = {
    provide: HEATMAP_REDIS_TOKEN,
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
            maxRetriesPerRequest: 2,
            connectTimeout: 5_000,
            // Cache GET/SET ≤5ms typically. 3s ceiling — fail-soft на slowlog,
            // service просто пойдёт в SQL.
            commandTimeout: 3_000,
        });
    },
};

@Module({
    imports: [DatabaseModule],
    controllers: [SimilarSearchController, HeatmapController],
    providers: [flowiseClientProvider, heatmapRedisProvider, SimilarSearchService, HeatmapService],
})
export class WaterAnalysisModule {}
