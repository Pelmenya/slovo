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
        if (endpoint) {
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

@Module({
    imports: [ConfigModule],
    providers: [s3ClientProvider, bucketProvider, StorageService],
    exports: [StorageService, STORAGE_S3_CLIENT, STORAGE_BUCKET],
})
export class StorageModule {}
