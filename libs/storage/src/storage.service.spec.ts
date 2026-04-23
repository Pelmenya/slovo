import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    NotFound,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { sdkStreamMixin } from '@smithy/util-stream';
import { mockClient } from 'aws-sdk-client-mock';
import { Readable } from 'node:stream';
import { StorageService } from './storage.service';

const TEST_BUCKET = 'test-only-bucket';

const s3Mock = mockClient(S3Client);

describe('StorageService', () => {
    let service: StorageService;

    beforeEach(() => {
        s3Mock.reset();
        const client = new S3Client({
            region: 'us-east-1',
            credentials: { accessKeyId: 'test-only-ak', secretAccessKey: 'test-only-sk' },
        });
        service = new StorageService(client, TEST_BUCKET);
    });

    describe('putObject', () => {
        it('кладёт объект и возвращает ETag/VersionId', async () => {
            s3Mock.on(PutObjectCommand).resolves({ ETag: '"abc123"', VersionId: 'v1' });

            const result = await service.putObject({
                key: 'sources/a/original',
                body: Buffer.from('hello'),
                contentType: 'text/plain',
            });

            expect(result).toEqual({
                key: 'sources/a/original',
                etag: '"abc123"',
                versionId: 'v1',
            });
            const call = s3Mock.commandCalls(PutObjectCommand)[0];
            expect(call.args[0].input).toMatchObject({
                Bucket: TEST_BUCKET,
                Key: 'sources/a/original',
                ContentType: 'text/plain',
            });
        });

        it('прокидывает metadata и contentLength', async () => {
            s3Mock.on(PutObjectCommand).resolves({});

            await service.putObject({
                key: 'k',
                body: Buffer.from('x'),
                contentLength: 1,
                metadata: { 'user-id': 'u1' },
            });

            const input = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
            expect(input.ContentLength).toBe(1);
            expect(input.Metadata).toEqual({ 'user-id': 'u1' });
        });

        it('пробрасывает ошибки S3', async () => {
            s3Mock.on(PutObjectCommand).rejects(new Error('SlowDown'));
            await expect(
                service.putObject({ key: 'k', body: Buffer.from('x') }),
            ).rejects.toThrow('SlowDown');
        });
    });

    describe('getObjectStream', () => {
        it('возвращает stream и метаданные', async () => {
            // sdkStreamMixin добавляет SDK-методы (transformToString и т.д.) к Readable —
            // именно этот тип AWS SDK v3 возвращает в Body в Node-рантайме.
            const body = sdkStreamMixin(Readable.from(['chunk1', 'chunk2']));
            s3Mock.on(GetObjectCommand).resolves({
                Body: body,
                ContentType: 'text/plain',
                ContentLength: 12,
                LastModified: new Date('2026-04-23'),
            });

            const result = await service.getObjectStream('sources/a/original');

            expect(result.key).toBe('sources/a/original');
            expect(result.contentType).toBe('text/plain');
            expect(result.contentLength).toBe(12);
            expect(result.body).toBe(body);
        });

        it('InternalServerErrorException если Body не Readable', async () => {
            // Имитируем runtime где SDK вернул WebStream вместо Readable (маловероятно,
            // но если SDK major-update поменяет поведение — падаем явной ошибкой).
            const fakeNonReadable = { on: () => undefined } as unknown as never;
            s3Mock.on(GetObjectCommand).resolves({ Body: fakeNonReadable });
            await expect(service.getObjectStream('k')).rejects.toBeInstanceOf(
                InternalServerErrorException,
            );
        });

        it('NotFoundException если объекта нет (NoSuchKey)', async () => {
            s3Mock
                .on(GetObjectCommand)
                .rejects(Object.assign(new Error('not found'), { name: 'NoSuchKey' }));

            await expect(service.getObjectStream('missing')).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });

        it('NotFoundException если NotFound от SDK', async () => {
            s3Mock.on(GetObjectCommand).rejects(
                new NotFound({ message: 'not found', $metadata: {} }),
            );

            await expect(service.getObjectStream('missing')).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });

        it('NotFoundException при пустом Body', async () => {
            s3Mock.on(GetObjectCommand).resolves({});
            await expect(service.getObjectStream('k')).rejects.toBeInstanceOf(NotFoundException);
        });

        it('прочие ошибки пробрасываются как есть', async () => {
            s3Mock.on(GetObjectCommand).rejects(new Error('AccessDenied'));
            await expect(service.getObjectStream('k')).rejects.toThrow('AccessDenied');
        });
    });

    describe('headObject', () => {
        it('возвращает метаданные', async () => {
            s3Mock.on(HeadObjectCommand).resolves({
                ContentType: 'video/mp4',
                ContentLength: 1024,
                ETag: '"xyz"',
                LastModified: new Date('2026-04-23'),
                Metadata: { 'user-id': 'u1' },
            });

            const meta = await service.headObject('k');
            expect(meta).toEqual({
                key: 'k',
                contentType: 'video/mp4',
                contentLength: 1024,
                etag: '"xyz"',
                lastModified: new Date('2026-04-23'),
                metadata: { 'user-id': 'u1' },
            });
        });

        it('NotFoundException если отсутствует', async () => {
            s3Mock
                .on(HeadObjectCommand)
                .rejects(Object.assign(new Error('x'), { name: 'NotFound' }));
            await expect(service.headObject('k')).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('objectExists', () => {
        it('true если headObject успешен', async () => {
            s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1 });
            await expect(service.objectExists('k')).resolves.toBe(true);
        });

        it('false при NotFoundException', async () => {
            s3Mock
                .on(HeadObjectCommand)
                .rejects(Object.assign(new Error('x'), { name: 'NotFound' }));
            await expect(service.objectExists('k')).resolves.toBe(false);
        });

        it('пробрасывает не-NotFound ошибки', async () => {
            s3Mock.on(HeadObjectCommand).rejects(new Error('AccessDenied'));
            await expect(service.objectExists('k')).rejects.toThrow('AccessDenied');
        });
    });

    describe('deleteObject', () => {
        it('удаляет объект', async () => {
            s3Mock.on(DeleteObjectCommand).resolves({});
            await service.deleteObject('sources/a/original');

            const call = s3Mock.commandCalls(DeleteObjectCommand)[0];
            expect(call.args[0].input).toEqual({
                Bucket: TEST_BUCKET,
                Key: 'sources/a/original',
            });
        });

        it('пробрасывает ошибки S3 (AccessDenied и пр.)', async () => {
            s3Mock.on(DeleteObjectCommand).rejects(new Error('AccessDenied'));
            await expect(service.deleteObject('k')).rejects.toThrow('AccessDenied');
        });
    });

    describe('getPresignedDownloadUrl', () => {
        it('возвращает HTTPS URL с подписью', async () => {
            const url = await service.getPresignedDownloadUrl('sources/a/original');

            expect(url).toMatch(/^https?:\/\//);
            expect(url).toContain('test-only-bucket');
            expect(url).toContain('sources/a/original');
            expect(url).toMatch(/X-Amz-Signature=/);
        });

        it('использует кастомный TTL', async () => {
            const url = await service.getPresignedDownloadUrl('k', { expiresInSeconds: 60 });
            expect(url).toContain('X-Amz-Expires=60');
        });

        it('дефолтный TTL 600 секунд', async () => {
            const url = await service.getPresignedDownloadUrl('k');
            expect(url).toContain('X-Amz-Expires=600');
        });
    });

    describe('getPresignedUploadUrl', () => {
        it('возвращает HTTPS URL под PutObject', async () => {
            const url = await service.getPresignedUploadUrl('sources/b/original');
            expect(url).toMatch(/^https?:\/\//);
            expect(url).toContain('sources/b/original');
            expect(url).toMatch(/X-Amz-Signature=/);
        });

        it('разная contentType → разные подписи', async () => {
            // SigV4 presigner подписывает опции в header-canon, поэтому URLs
            // с разными contentType дают разные X-Amz-Signature.
            const urlMp4 = await service.getPresignedUploadUrl('k', {
                contentType: 'video/mp4',
            });
            const urlPdf = await service.getPresignedUploadUrl('k', {
                contentType: 'application/pdf',
            });
            const sigMp4 = new URL(urlMp4).searchParams.get('X-Amz-Signature');
            const sigPdf = new URL(urlPdf).searchParams.get('X-Amz-Signature');
            expect(sigMp4).toBeTruthy();
            expect(sigPdf).toBeTruthy();
            expect(sigMp4).not.toBe(sigPdf);
        });

        it('использует кастомный TTL', async () => {
            const url = await service.getPresignedUploadUrl('k', { expiresInSeconds: 30 });
            expect(url).toContain('X-Amz-Expires=30');
        });
    });
});
