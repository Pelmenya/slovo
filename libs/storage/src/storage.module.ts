import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { TAppEnv } from '@slovo/common';
import { STORAGE_BUCKET, STORAGE_S3_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';

// Ключи env-переменных в которых хранится имя bucket'а. Узкий union
// (не `keyof TAppEnv`) даёт строгий type-safety на стадии компиляции:
// `forFeature({ bucketEnvKey: 'POSTGRES_HOST' })` не пройдёт TypeScript.
// Расширяется явно при добавлении нового bucket-env-var (с ревью).
type TStorageBucketEnvKey = 'S3_BUCKET' | 'S3_CATALOG_BUCKET';

function createS3ClientProvider(): Provider {
    return {
        provide: STORAGE_S3_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService<TAppEnv, true>): S3Client => {
            const endpoint = config.get('S3_ENDPOINT', { infer: true });
            const region = config.getOrThrow('S3_REGION', { infer: true });
            const accessKeyId = config.getOrThrow('S3_ACCESS_KEY', { infer: true });
            const secretAccessKey = config.getOrThrow('S3_SECRET_KEY', { infer: true });
            const forcePathStyle = config.get('S3_FORCE_PATH_STYLE', { infer: true });

            const clientConfig: S3ClientConfig = {
                region,
                credentials: { accessKeyId, secretAccessKey },
                forcePathStyle,
            };
            // S3_ENDPOINT пустая строка означает «использовать AWS S3 default endpoint
            // для региона». Непустое значение — кастомный endpoint (MinIO в dev,
            // Cloudflare R2 / DigitalOcean Spaces в prod).
            if (endpoint && endpoint.length > 0) {
                clientConfig.endpoint = endpoint;
            }
            return new S3Client(clientConfig);
        },
    };
}

function createBucketProvider(envKey: TStorageBucketEnvKey): Provider {
    return {
        provide: STORAGE_BUCKET,
        inject: [ConfigService],
        useFactory: (config: ConfigService<TAppEnv, true>): string => {
            const value = config.getOrThrow(envKey, { infer: true });
            if (typeof value !== 'string' || value.length === 0) {
                throw new Error(
                    `StorageModule.forFeature: env "${String(envKey)}" must be non-empty string, got: ${typeof value}`,
                );
            }
            return value;
        },
    };
}

// StorageModule НЕ @Global(). Импортируется в каждый feature-модуль которому
// нужен S3. Два режима использования:
//
//   1. `imports: [StorageModule]` — bucket из env S3_BUCKET. Default для
//      knowledge модуля и других user-uploads features.
//
//   2. `imports: [StorageModule.forFeature({ bucketEnvKey: 'S3_CATALOG_BUCKET' })]`
//      — bucket из произвольного env-key. Для multi-bucket setup (catalog
//      пишет в slovo-datasets, knowledge — в slovo-sources, ADR-007).
//
// DynamicModule scope изолирует providers per feature: knowledge module
// получает StorageService bound к S3_BUCKET, catalog module — к S3_CATALOG_BUCKET.
// Два отдельных DI-instance'а в одной NestJS-app, S3Client может share'иться
// (configured одинаково из тех же env), но bucket разный.
//
// ВАЖНО: один feature-модуль НЕ должен импортировать одновременно
// `StorageModule` и `StorageModule.forFeature(...)` — оба регистрируют
// один и тот же `STORAGE_BUCKET`/`STORAGE_S3_CLIENT` token и Nest схлопнет
// их в один scope с непредсказуемым «победителем» (порядок imports). Для
// одного модуля выбирай **один** вариант. Если нужны два разных bucket'а
// в одном feature — extract в отдельные sub-модули или жди когда появится
// `forFeature({ namespace })` с per-instance токенами (tech-debt #22-сосед).
@Module({
    imports: [ConfigModule],
    providers: [createS3ClientProvider(), createBucketProvider('S3_BUCKET'), StorageService],
    exports: [StorageService, STORAGE_S3_CLIENT, STORAGE_BUCKET],
})
export class StorageModule {
    static forFeature(opts: { bucketEnvKey: TStorageBucketEnvKey }): DynamicModule {
        return {
            module: StorageModule,
            imports: [ConfigModule],
            providers: [
                createS3ClientProvider(),
                createBucketProvider(opts.bucketEnvKey),
                StorageService,
            ],
            exports: [StorageService, STORAGE_S3_CLIENT, STORAGE_BUCKET],
        };
    }
}
