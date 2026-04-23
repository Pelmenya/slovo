// Ручная интеграционная проверка StorageService против живого MinIO.
// Не заменяет unit-тесты — просто «дымовой тест» что SDK и compose-стек
// реально видят друг друга.
//
// Запуск:  npx ts-node scripts/check-storage.ts

import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import 'dotenv/config';
import { StorageService } from '../libs/storage/src/storage.service';

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
    try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        console.log(`[check] bucket "${bucket}" exists`);
    } catch {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        console.log(`[check] bucket "${bucket}" created`);
    }
}

async function main(): Promise<void> {
    const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9010';
    const region = process.env.S3_REGION ?? 'us-east-1';
    const accessKeyId = process.env.S3_ACCESS_KEY ?? 'minioadmin';
    const secretAccessKey = process.env.S3_SECRET_KEY;
    const bucket = process.env.S3_BUCKET ?? 'slovo-sources';

    if (!secretAccessKey) {
        throw new Error('S3_SECRET_KEY is required — load .env before running');
    }

    const client = new S3Client({
        endpoint,
        region,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
    });

    await ensureBucket(client, bucket);

    const storage = new StorageService(client, bucket);
    const key = `check/${Date.now()}.txt`;
    const payload = `slovo storage check — ${new Date().toISOString()}`;

    await storage.putObject({
        key,
        body: Buffer.from(payload, 'utf8'),
        contentType: 'text/plain; charset=utf-8',
        metadata: { test: 'true' },
    });
    console.log(`[check] put ${key} (${payload.length} bytes)`);

    const head = await storage.headObject(key);
    console.log(`[check] head contentLength=${head.contentLength} contentType=${head.contentType}`);

    const stream = await storage.getObjectStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream.body) {
        chunks.push(chunk as Buffer);
    }
    const downloaded = Buffer.concat(chunks).toString('utf8');
    console.log(`[check] get: "${downloaded}"`);

    if (downloaded !== payload) {
        throw new Error(`payload mismatch: expected "${payload}", got "${downloaded}"`);
    }

    const presigned = await storage.getPresignedDownloadUrl(key, { expiresInSeconds: 120 });
    console.log(`[check] presigned: ${presigned.slice(0, 120)}...`);

    await storage.deleteObject(key);
    console.log(`[check] deleted ${key}`);

    const exists = await storage.objectExists(key);
    if (exists) {
        throw new Error('object still exists after delete');
    }
    console.log('[check] objectExists after delete = false ✓');

    console.log('[check] OK');
}

main().catch((err) => {
    console.error('[check] FAIL', err);
    process.exit(1);
});
