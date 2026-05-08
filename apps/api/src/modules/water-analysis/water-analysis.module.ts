import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '@slovo/database';
import { FlowiseClient, type TFlowiseClientConfig } from '@slovo/flowise-client';
import type { TAppEnv } from '@slovo/common';
import Redis from 'ioredis';
import {
    AQUIFER_STATS_REDIS_TOKEN,
    DEPTH_MAP_REDIS_TOKEN,
    DEPTH_PREDICT_REDIS_TOKEN,
    EQUIPMENT_SUGGEST_REDIS_TOKEN,
    FLOWISE_CLIENT_TOKEN,
    HEATMAP_REDIS_TOKEN,
    POINTS_REDIS_TOKEN,
    PREDICT_REDIS_TOKEN,
} from './water-analysis.constants';
import { AquiferStatsController } from './aquifer-stats/aquifer-stats.controller';
import { AquiferStatsService } from './aquifer-stats/aquifer-stats.service';
import { DepthMapController } from './depth-map/depth-map.controller';
import { DepthMapService } from './depth-map/depth-map.service';
import { DepthPredictController } from './depth-predict/depth-predict.controller';
import { DepthPredictService } from './depth-predict/depth-predict.service';
import { EquipmentSuggestController } from './equipment-suggest/equipment-suggest.controller';
import { EquipmentSuggestService } from './equipment-suggest/equipment-suggest.service';
import { HeatmapController } from './heatmap/heatmap.controller';
import { HeatmapService } from './heatmap/heatmap.service';
import { PointsController } from './points/points.controller';
import { PointsService } from './points/points.service';
import { PredictController } from './predict/predict.controller';
import { PredictService } from './predict/predict.service';
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

// Predict использует свой Redis instance — TTL 5мин vs heatmap 24ч, command-timeout
// тот же. Можно было shared instance, но раздельные провайдеры дают per-feature
// observability (отдельные slowlog'и и connection pool isolation).
const predictRedisProvider: Provider = {
    provide: PREDICT_REDIS_TOKEN,
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
            commandTimeout: 3_000,
        });
    },
};

// Depth-map Redis instance — те же параметры что heatmap (TTL 24ч, command-timeout
// 3s). Раздельный provider для per-feature observability (slowlog + connection pool
// isolation). При scale можно переехать на shared instance с TTL по key-prefix.
const depthMapRedisProvider: Provider = {
    provide: DEPTH_MAP_REDIS_TOKEN,
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
            commandTimeout: 3_000,
        });
    },
};

// Depth-predict Redis instance — те же параметры что predict (TTL 5 мин,
// command-timeout 3s).
const depthPredictRedisProvider: Provider = {
    provide: DEPTH_PREDICT_REDIS_TOKEN,
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
            commandTimeout: 3_000,
        });
    },
};

// Points Redis instance — TTL 1ч, такой же command-timeout. Per-feature
// observability + connection pool isolation.
const pointsRedisProvider: Provider = {
    provide: POINTS_REDIS_TOKEN,
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
            commandTimeout: 3_000,
        });
    },
};

// Equipment-suggest Redis instance — TTL 10мин, command-timeout 3s.
const equipmentSuggestRedisProvider: Provider = {
    provide: EQUIPMENT_SUGGEST_REDIS_TOKEN,
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
            commandTimeout: 3_000,
        });
    },
};

// Aquifer-stats Redis instance — TTL 24ч (стабильные данные), command-timeout 3s.
const aquiferStatsRedisProvider: Provider = {
    provide: AQUIFER_STATS_REDIS_TOKEN,
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
            commandTimeout: 3_000,
        });
    },
};

@Module({
    imports: [DatabaseModule],
    controllers: [
        SimilarSearchController,
        HeatmapController,
        PredictController,
        DepthMapController,
        DepthPredictController,
        PointsController,
        EquipmentSuggestController,
        AquiferStatsController,
    ],
    providers: [
        flowiseClientProvider,
        heatmapRedisProvider,
        predictRedisProvider,
        depthMapRedisProvider,
        depthPredictRedisProvider,
        pointsRedisProvider,
        equipmentSuggestRedisProvider,
        aquiferStatsRedisProvider,
        SimilarSearchService,
        HeatmapService,
        PredictService,
        DepthMapService,
        DepthPredictService,
        PointsService,
        EquipmentSuggestService,
        AquiferStatsService,
    ],
})
export class WaterAnalysisModule {}
