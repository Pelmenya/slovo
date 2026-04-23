// Ручная интеграционная проверка StorageService против живого MinIO.
// Не заменяет unit-тесты — просто «дымовой тест» что SDK и compose-стек
// реально видят друг друга.
//
// Запуск:  npx ts-node scripts/check-storage.ts

import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { validateEnv } from '@slovo/common';
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

function redactUrl(url: string): string {
    try {
        const u = new URL(url);
        return `${u.origin}${u.pathname}`;
    } catch {
        return '[invalid-url]';
    }
}

async function main(): Promise<void> {
    // Единая точка валидации env — не дублируем схему и дефолты из env.schema.ts.
    const env = validateEnv(process.env);

    const client = new S3Client({
        endpoint: env.S3_ENDPOINT || undefined,
        region: env.S3_REGION,
        credentials: {
            accessKeyId: env.S3_ACCESS_KEY,
            secretAccessKey: env.S3_SECRET_KEY,
        },
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });

    await ensureBucket(client, env.S3_BUCKET);

    const storage = new StorageService(client, env.S3_BUCKET);
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
    // Redact signature — показываем только origin+path, X-Amz-Signature не попадёт в лог.
    console.log(`[check] presigned (redacted): ${redactUrl(presigned)}`);

    await storage.deleteObject(key);
    console.log(`[check] deleted ${key}`);

    const exists = await storage.objectExists(key);
    if (exists) {
        throw new Error('object still exists after delete');
    }
    console.log('[check] objectExists after delete = false OK');

    console.log('[check] done');
}

main().catch((err) => {
    console.error('[check] FAIL', err);
    process.exit(1);
});
