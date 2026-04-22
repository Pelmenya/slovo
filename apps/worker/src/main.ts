import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function bootstrap() {
    const tempApp = await NestFactory.createApplicationContext(WorkerModule);
    const configService = tempApp.get(ConfigService);
    const rabbitmqUrl = configService.get<string>('RABBITMQ_URL', 'amqp://localhost:5672');
    await tempApp.close();

    const app = await NestFactory.createMicroservice<MicroserviceOptions>(WorkerModule, {
        bufferLogs: true,
        transport: Transport.RMQ,
        options: {
            urls: [rabbitmqUrl],
            queue: 'slovo-worker',
            queueOptions: { durable: true },
            prefetchCount: 5,
        },
    });

    app.useLogger(app.get(Logger));
    app.enableShutdownHooks();

    await app.listen();
}

void bootstrap();
