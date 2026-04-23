import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { Module, type Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { TAppEnv } from '@slovo/common';
import { STORAGE_BUCKET, STORAGE_S3_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';

const s3ClientProvider: Provider = {
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

const bucketProvider: Provider = {
    provide: STORAGE_BUCKET,
    inject: [ConfigService],
    useFactory: (config: ConfigService<TAppEnv, true>): string =>
        config.getOrThrow('S3_BUCKET', { infer: true }),
};

// StorageModule намеренно НЕ @Global(). Импортируется в каждый feature-модуль
// которому нужен S3 (knowledge-module, в будущем — avatars/exports). Плюсы:
// (a) границы зависимостей явные в графе модулей; (b) когда появится split
// public vs private bucket — каждый feature сможет инстанцировать StorageModule
// со своим BUCKET-токеном. Минус — 1 строка импорта в каждом модуле, ок.
@Module({
    imports: [ConfigModule],
    providers: [s3ClientProvider, bucketProvider, StorageService],
    exports: [StorageService, STORAGE_S3_CLIENT, STORAGE_BUCKET],
})
export class StorageModule {}
