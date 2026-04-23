import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    NotFound,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { DEFAULT_PRESIGNED_TTL_SECONDS, STORAGE_BUCKET, STORAGE_S3_CLIENT } from './storage.constants';
import type {
    TGetObjectStreamResult,
    TObjectMetadata,
    TPresignedUploadOptions,
    TPresignedUrlOptions,
    TPutObjectInput,
    TPutObjectResult,
} from './t-storage';

@Injectable()
export class StorageService {
    private readonly logger = new Logger(StorageService.name);

    constructor(
        @Inject(STORAGE_S3_CLIENT) private readonly client: S3Client,
        @Inject(STORAGE_BUCKET) private readonly bucket: string,
    ) {}

    async putObject(input: TPutObjectInput): Promise<TPutObjectResult> {
        const result = await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: input.key,
                Body: input.body,
                ContentType: input.contentType,
                ContentLength: input.contentLength,
                Metadata: input.metadata,
            }),
        );
        return {
            key: input.key,
            etag: result.ETag,
            versionId: result.VersionId,
        };
    }

    async getObjectStream(key: string): Promise<TGetObjectStreamResult> {
        try {
            const result = await this.client.send(
                new GetObjectCommand({ Bucket: this.bucket, Key: key }),
            );
            if (!result.Body) {
                throw new NotFoundException(`Object ${key} not found or has empty body`);
            }
            // AWS SDK v3 типизирует Body как union (Readable | ReadableStream | Blob)
            // ради runtime-агностичности. В Node.js всегда приходит IncomingMessage,
            // наследник Readable. Narrow через instanceof — если SDK когда-то вернёт
            // WebStream, упадём с внятной ошибкой, а не молча cast'нем.
            if (!(result.Body instanceof Readable)) {
                throw new InternalServerErrorException(
                    `S3 GetObject returned non-Readable body type; expected Node.js Readable`,
                );
            }
            return {
                key,
                body: result.Body,
                contentType: result.ContentType,
                contentLength: result.ContentLength,
                lastModified: result.LastModified,
            };
        } catch (err) {
            if (err instanceof NotFound || isNoSuchKey(err)) {
                throw new NotFoundException(`Object ${key} not found`);
            }
            throw err;
        }
    }

    async headObject(key: string): Promise<TObjectMetadata> {
        try {
            const result = await this.client.send(
                new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
            );
            return {
                key,
                contentType: result.ContentType,
                contentLength: result.ContentLength,
                etag: result.ETag,
                lastModified: result.LastModified,
                metadata: result.Metadata,
            };
        } catch (err) {
            if (err instanceof NotFound || isNoSuchKey(err)) {
                throw new NotFoundException(`Object ${key} not found`);
            }
            throw err;
        }
    }

    async objectExists(key: string): Promise<boolean> {
        try {
            await this.headObject(key);
            return true;
        } catch (err) {
            if (err instanceof NotFoundException) {
                return false;
            }
            throw err;
        }
    }

    async deleteObject(key: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
        this.logger.debug(`Object ${key} deleted from ${this.bucket}`);
    }

    async getPresignedDownloadUrl(
        key: string,
        options: TPresignedUrlOptions = {},
    ): Promise<string> {
        const expiresIn = options.expiresInSeconds ?? DEFAULT_PRESIGNED_TTL_SECONDS;
        return getSignedUrl(
            this.client,
            new GetObjectCommand({ Bucket: this.bucket, Key: key }),
            { expiresIn },
        );
    }

    async getPresignedUploadUrl(
        key: string,
        options: TPresignedUploadOptions = {},
    ): Promise<string> {
        const expiresIn = options.expiresInSeconds ?? DEFAULT_PRESIGNED_TTL_SECONDS;
        // signableHeaders заставляет presigner включить content-type в
        // SigV4-подпись. Без этого клиент может при PUT подменить content-type
        // (SDK его не подпишет, S3 примет любой). Для нас это защита от
        // MIME-swap: выдали presigned для video/mp4 — клиент не сможет
        // залить application/x-executable.
        const signableHeaders = options.contentType ? new Set(['content-type']) : undefined;
        return getSignedUrl(
            this.client,
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                ContentType: options.contentType,
                ContentLength: options.contentLength,
                Metadata: options.metadata,
            }),
            { expiresIn, signableHeaders },
        );
    }
}

// MinIO и AWS S3 по-разному сериализуют «не найдено»:
// - GetObjectCommand → error.name === 'NoSuchKey' (и может быть Code: 'NoSuchKey')
// - HeadObjectCommand → NotFound class из @aws-sdk/client-s3 (ловится через instanceof выше)
// В edge-случаях SDK может не десериализовать в NotFound-класс (версионные рассинхроны
// middleware) — fallback на name === 'NotFound' оставлен как страховка.
function isNoSuchKey(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) {
        return false;
    }
    const name = (err as { name?: unknown }).name;
    const code = (err as { Code?: unknown }).Code;
    return name === 'NoSuchKey' || code === 'NoSuchKey' || name === 'NotFound';
}
