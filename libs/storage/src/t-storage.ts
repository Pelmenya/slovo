import type { Readable } from 'node:stream';

export type TPutObjectInput = {
    key: string;
    body: Buffer | Uint8Array | string | Readable;
    contentType?: string;
    contentLength?: number;
    metadata?: Record<string, string>;
};

export type TPutObjectResult = {
    key: string;
    etag?: string;
    versionId?: string;
};

export type TObjectMetadata = {
    key: string;
    contentType?: string;
    contentLength?: number;
    etag?: string;
    lastModified?: Date;
    metadata?: Record<string, string>;
};

export type TPresignedUrlOptions = {
    expiresInSeconds?: number;
};

export type TPresignedUploadOptions = TPresignedUrlOptions & {
    contentType?: string;
    contentLength?: number;
    metadata?: Record<string, string>;
};

export type TGetObjectStreamResult = {
    key: string;
    body: Readable;
    contentType?: string;
    contentLength?: number;
    lastModified?: Date;
};
