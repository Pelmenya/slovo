import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { validateEnv } from '@slovo/common';
import { CatalogRefreshService } from '../modules/catalog-refresh/catalog-refresh.service';
import { WorkerModule } from '../worker.module';

// =============================================================================
// One-shot CLI для catalog-refresh — запускает один цикл refresh и завершается.
//
// Use cases:
// - Manual trigger после деплоя (ручной refresh без ожидания cron)
// - Live verify в dev: поднять весь worker NestJS context, прогнать реальный
//   pipeline (Vision augmentation, RecordManager, REMOVED-sweep), увидеть
//   counters в логе.
// - Bootstrap при старте app (см. tech-debt #37 — webhook-trigger
//   architecture тоже использует тот же service.refresh()).
//
// Запуск:
//   npm run refresh:once
//
// или явно:
//   ts-node apps/worker/src/cli/refresh-once.ts
//
// Exit codes:
//   0 — success (даже при kind=skipped)
//   1 — failure (в kind=failure)
//   2 — bootstrap error (config/Nest module init)
// =============================================================================

// Bootstrap-time stderr writer — NestJS Logger ещё не инициализирован,
// pino-logger тоже. Используем canonical Node.js stderr вместо console
// (eslint позволяет, но process.stderr — более явно про "это критическая
// ошибка инициализации, не runtime лог").
function writeBootstrapError(prefix: string, error: unknown): void {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`[refresh-once] ${prefix}: ${message}\n`);
}

async function main(): Promise<number> {
    const logger = new Logger('RefreshOnce');

    try {
        validateEnv(process.env);
    } catch (error) {
        writeBootstrapError('env validation failed', error);
        return 2;
    }

    // createApplicationContext — standalone (без HTTP / RMQ listener'а),
    // только DI graph + service instances. Идеально для CLI tasks.
    const app = await NestFactory.createApplicationContext(WorkerModule, {
        bufferLogs: true,
    });
    app.useLogger(app.get(PinoLogger));

    try {
        const service = app.get(CatalogRefreshService);
        const result = await service.refresh();

        if (result.kind === 'success') {
            logger.log(
                `✅ refresh completed: total=${result.itemsTotal} ` +
                    `upserted=${result.itemsUpserted} skipped=${result.itemsSkipped} ` +
                    `failed=${result.itemsFailed} removed=${result.itemsRemoved} ` +
                    `elapsed=${(result.elapsedMs / 1000).toFixed(1)}s`,
            );
            return 0;
        }

        if (result.kind === 'skipped') {
            logger.warn(`⏭️  skipped: ${result.reason}${result.error ? ` (${result.error})` : ''}`);
            return 0;
        }

        // failure
        logger.error(`❌ failed: stage=${result.stage} ${result.error}`);
        return 1;
    } finally {
        await app.close();
    }
}

void main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
        writeBootstrapError('fatal', err);
        process.exit(2);
    });
