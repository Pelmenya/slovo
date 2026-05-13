// =============================================================================
// WaterAnalysisModule — 9 endpoints поверх 15 504 анализов воды (Аквафор-Pro).
//
// Контроллеры (controllers + services per feature, общий FlowiseClient + per-feature Redis):
//   - POST /water-analysis/similar          — semantic search через Flowise vectorstore
//   - GET  /water-analysis/heatmap          — агрегированная тепловая карта 22 paramCodes
//   - GET  /water-analysis/predict          — kNN-прогноз химии для нового адреса (USP-1)
//   - GET  /water-analysis/depth-map        — карта глубин + 5 aquifer-buckets (USP-4 base)
//   - GET  /water-analysis/depth-predict    — kNN-прогноз глубины бурения (USP-4)
//   - GET  /water-analysis/points           — individual анализы high-zoom (PII roundCoord 0.005°)
//   - POST /water-analysis/equipment-suggest — cross-domain вода→каталог (USP-2 flagship)
//   - GET  /water-analysis/aquifer-stats    — стратифицированная chemistry per aquifer (USP-4 deep-dive)
//   - POST /water-analysis/heatmap/cell     — детали ячейки heatmap для popup
//
// =============================================================================
// Состояние БД (по итогам docling-migration, 2026-05-12 — 2026-05-13).
// Существующая `water_analysis` таблица содержит **два параллельных слота** —
// existing Vision-derived data + canonical Docling-merged overrides. **API ниже
// читает только existing** (Vision). Canonical чтение — отдельная задача,
// `WaterAnalysisModule` пока не переключён.
//
//   Existing колонки (читается **сейчас** всеми 9 endpoints — Vision-derived):
//     `params` (jsonb)            — paramCode → number, slovo-normalized
//     `param_units` / `param_flags` / `params_unknown`
//     `intake_type` (enum)        — Vision видел checkbox = gold truth
//     `depth_meters`              — глубина скважины/колодца
//     `lat / lon / geo_point`     — primary geo через PostGIS ST_DWithin
//     `canonical_address / fias_id / region / district / locality / dealer_location`
//     `sample_date / test_date`
//     `appearance / lab_name`
//     `embedding_text` (text)     — natural-language description для Flowise loader
//
//   Slice 3a (2026-05-13) — additive provenance columns. NULL для existing 15 504
//   были заполнены через `experiments/.../scripts/102-apply-canonical-base.ts`.
//   ⚠️ **API эти колонки не читает** — нужно явное переключение downstream
//   логики при необходимости (например, фильтр по `intake_source = 'vision'`
//   для high-confidence или `extraction_engine = 'docling-2.74'` для новых бланков).
//     `intake_source` (varchar32)  — provenance intakeType:
//                                    'vision' (15 491, gold) | 'derive_function'
//                                    | 'depth_well' | 'depth_well_dug' | 'hint_*'
//                                    | 'default_municipal'
//     `extraction_engine` (на `water_analysis_raw`) — 'vision-haiku-4.5' для 15 504,
//                                    'docling-2.74' для новых бланков через Slice 3b.
//
//   Slice 4.3 / 4.4 (2026-05-13) — re-geocode results (parallel slot, **не** перетёр
//   existing lat/lon).
//     `canonical_lat / canonical_lon / canonical_fias_id / canonical_address_new`
//                                  — 2071 ордеров (1899 от Slice 4.3 shortlist + 172
//                                    от Slice 4.4 rescue 337 no-geo).
//     `regeocoded_at`              — timestamp re-geocode.
//
//     Геo coverage: existing `lat/lon` покрывает **15 339 / 15 504 (98.9%)** после
//     Slice 4.4 (165 рядов без geo — corporate dealers/OCR mangled).
//     Heatmap/predict читают existing `lat/lon` — все API endpoints видят 98.9%.
//     `canonical_lat/lon` — backup и audit slot для долгосрочной миграции через
//     `COALESCE(lat, canonical_lat)` при необходимости.
//
//   Slice 4.2.5a / 4.2.5b (2026-05-13) — Docling values для significant param changes.
//     `params_canonical` (jsonb)  — merged best-of-three params для 2335 ордеров:
//                                   1205 Vision→Docling overrides (Vision-gall +
//                                   exceedsPdk shift) + 1423 gained_data (Vision
//                                   missed). Existing `params` НЕ перетёр.
//     `embedding_text_canonical` — natural-language через generateEmbeddingText на
//                                   params_canonical. 2335 rows.
//     `reembedded_at`            — timestamp re-embed.
//
//     **Critical:** 987 ордеров изменили exceedsPdk-статус для какого-то paramCode
//     (Vision сказал «норма», Docling — «превышение»). equipment-suggest на existing
//     `params` пока **не видит** эти 987 — нужно явное переключение либо merge
//     `COALESCE(params_canonical, params)` в SQL.
//
//     `customerName`, `customerPhone` — НЕ извлекаются в derived (152-ФЗ + Variant A
//     PII strategy). Доступны через JOIN на `water_analysis_raw.vision_payload`.
//
// =============================================================================
// Flowise vectorstore — состояние после Slice 4.2.5b cleanup (2026-05-13).
//   Document Store: `water-analysis-aquaphor` (storeId 96b809ee-...).
//   Один loader (Custom Document Loader) → 15 504 chunks в
//   `water_analysis_chunks` (Flowise-managed postgres table).
//
//   **Content в chunks** — `COALESCE(embedding_text_canonical, embedding_text)`:
//     2335 ордеров имеют canonical text (с merged Docling params, включая
//     гadded «превышение запаха 4 балл» для тех 987 critical case).
//     13 169 — original Vision-based text.
//
//   Embeddings — OpenAI text-embedding-3-large 3072 dim, sync с pageContent.
//   Только **similar.service.ts** использует vectorstore (через Flowise
//   `/document-store/vectorstore/query`). Поэтому **similar уже видит canonical
//   results автоматически** — без правок кода. Остальные 8 endpoints читают
//   `water_analysis` SQL — на existing params.
//
//   Orphan chunks от старых per-order plainText loaders (от experiments
//   `09-flowise-reembed.ts`) — **удалены** в Slice 4.2.5b cleanup (469 chunks
//   через `DELETE /vectorstore/{storeId}?docId={orphanId}`). Текущий count
//   chunks/record_manager = 15 504 (clean state).
//
// =============================================================================
// Что НЕ ломать.
//
//   1. **Existing колонки** `params / lat / lon / intake_type / canonical_address`
//      — single source of truth для **существующих** 8 endpoints. UPDATE на них
//      без миграции data в canonical-слот = breaking change для downstream.
//
//   2. **Flowise Custom Document Loader** — единственный активный loader для
//      water-analysis-aquaphor store. Удаление = потеря 15 504 chunks. При
//      необходимости рефреша используй workflow `108-flowise-vectorstore-insert.ts`
//      (`DELETE /vectorstore/{storeId}` + `POST /vectorstore/insert`) или
//      переписать `functionInputVariables` через `loader/save` (см. Slice 4.2.5b).
//
//   3. **canonical_* слоты nullable** — для new ордеров через Slice 3b ETL
//      (`03b-extract-docling.ts`) они заполняются с самого начала. Не trogai
//      без understanding pattern `result.intakeType = visionPayload?.intakeType
//      ?? deriveIntakeTypeWithSource(...)` и аналогичных для остальных полей.
//
// =============================================================================
// Migration references (для глубокого контекста при работе с этим модулем):
//   - `docs/experiments/water-analysis/2026-05-12-docling-migration.md`
//   - `docs/experiments/water-analysis/2026-05-12-docling-migration-HANDOFF.md`
//   - `docs/architecture/decisions/009-docling-as-sidecar-service.md`
//   - `libs/water-blank-extraction/src/parsers/derive-intake-type.ts` (TIntakeSource)
//   - `experiments/water-analysis-dataset/scripts/102-apply-canonical-base.ts`
//   - `experiments/water-analysis-dataset/scripts/103-apply-regeocode.ts`
//   - `experiments/water-analysis-dataset/scripts/104-rescue-no-geo.ts`
//   - `experiments/water-analysis-dataset/scripts/105-apply-canonical-params.ts`
//   - `experiments/water-analysis-dataset/scripts/106-apply-embedding-canonical.ts`
//   - `prisma/schema/water-analysis.prisma` — все колонки + indexes
// =============================================================================

import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '@slovo/database';
import { FlowiseClient, type TFlowiseClientConfig } from '@slovo/flowise-client';
import type { TAppEnv } from '@slovo/common';
import {
    AQUIFER_STATS_REDIS_TOKEN,
    CELL_DETAIL_REDIS_TOKEN,
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
import { CellDetailController } from './cell-detail/cell-detail.controller';
import { CellDetailService } from './cell-detail/cell-detail.service';
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
    CELL_DETAIL_REDIS_TOKEN,
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
        CellDetailController,
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
        CellDetailService,
    ],
})
export class WaterAnalysisModule {}
