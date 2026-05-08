import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '@slovo/database';
import { FlowiseClient, type TFlowiseClientConfig } from '@slovo/flowise-client';
import type { TAppEnv } from '@slovo/common';
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
import { createWaterAnalysisRedisProvider } from './_shared';
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
function assertEnv(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`${name} is required for water-analysis module`);
    }
    return value;
}

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

// 7 Redis instances для 7 endpoints через `_shared/redis-provider.ts` factory.
// Раньше каждый был копипастой 18 строк (`useFactory` + Redis config) — ~125 LOC
// устранено. Per-feature isolation через separate ioredis instances осталась
// (review-агент 8 мая 2026 проголосовал что overhead на TCP-pools мизерный
// для current scale — менее значим чем DRY).
const redisProviders: Provider[] = [
    HEATMAP_REDIS_TOKEN,
    PREDICT_REDIS_TOKEN,
    DEPTH_MAP_REDIS_TOKEN,
    DEPTH_PREDICT_REDIS_TOKEN,
    POINTS_REDIS_TOKEN,
    EQUIPMENT_SUGGEST_REDIS_TOKEN,
    AQUIFER_STATS_REDIS_TOKEN,
].map(createWaterAnalysisRedisProvider);

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
        ...redisProviders,
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
