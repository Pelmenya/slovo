import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    NotFound,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { STORAGE_BUCKET, STORAGE_S3_CLIENT } from './storage.constants';
import type {
    TGetObjectStreamResult,
    TObjectMetadata,
    TPresignedUrlOptions,
    TPutObjectInput,
    TPutObjectResult,
} from './t-storage';

const DEFAULT_PRESIGNED_TTL_SECONDS = 600;

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
            return {
                key,
                body: result.Body as Readable,
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
        await this.client.send(
            new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        this.logger.debug(`Object ${key} deleted from ${this.bucket}`);
    }

    async getPresignedDownloadUrl(key: string, options: TPresignedUrlOptions = {}): Promise<string> {
        const expiresIn = options.expiresInSeconds ?? DEFAULT_PRESIGNED_TTL_SECONDS;
        return getSignedUrl(
            this.client,
            new GetObjectCommand({ Bucket: this.bucket, Key: key }),
            { expiresIn },
        );
    }

    async getPresignedUploadUrl(key: string, options: TPresignedUrlOptions = {}): Promise<string> {
        const expiresIn = options.expiresInSeconds ?? DEFAULT_PRESIGNED_TTL_SECONDS;
        return getSignedUrl(
            this.client,
            new PutObjectCommand({ Bucket: this.bucket, Key: key }),
            { expiresIn },
        );
    }

    get bucketName(): string {
        return this.bucket;
    }
}

function isNoSuchKey(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const name = (err as { name?: unknown }).name;
    const code = (err as { Code?: unknown }).Code;
    return name === 'NoSuchKey' || code === 'NoSuchKey' || name === 'NotFound';
}
