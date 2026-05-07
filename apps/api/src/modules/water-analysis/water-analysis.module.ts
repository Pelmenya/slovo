import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FlowiseClient, type TFlowiseClientConfig } from '@slovo/flowise-client';
import type { TAppEnv } from '@slovo/common';
import { FLOWISE_CLIENT_TOKEN } from './water-analysis.constants';
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

@Module({
    controllers: [SimilarSearchController],
    providers: [flowiseClientProvider, SimilarSearchService],
})
export class WaterAnalysisModule {}
