import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { validateEnv } from '@slovo/common';
import { WorkerModule } from './worker.module';

async function bootstrap() {
    const env = validateEnv(process.env);

    const app = await NestFactory.createMicroservice<MicroserviceOptions>(WorkerModule, {
        bufferLogs: true,
        transport: Transport.RMQ,
        options: {
            urls: [env.RABBITMQ_URL],
            queue: 'slovo-worker',
            queueOptions: { durable: true },
            prefetchCount: env.WORKER_CONCURRENCY,
        },
    });

    app.useLogger(app.get(Logger));
    app.enableShutdownHooks();

    await app.listen();
}

void bootstrap();
