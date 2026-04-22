import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        bufferLogs: true,
    });

    app.useLogger(app.get(PinoLogger));

    const configService = app.get(ConfigService);
    const logger = new Logger('Bootstrap');

    // CORS
    const corsOrigin = configService
        .getOrThrow<string>('CORS_ORIGIN')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    app.enableCors({ origin: corsOrigin, credentials: true });

    // Global validation
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            transformOptions: { enableImplicitConversion: true },
        }),
    );

    // Global serialization (class-transformer)
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

    // Swagger (только вне production)
    const isProd = configService.get<string>('NODE_ENV') === 'production';
    if (!isProd) {
        const swaggerConfig = new DocumentBuilder()
            .setTitle('Slovo AI Platform')
            .setDescription('Universal LLM backend — RAG, agents, multi-feature')
            .setVersion('0.1.0')
            .addBearerAuth()
            .build();

        const document = SwaggerModule.createDocument(app, swaggerConfig);
        SwaggerModule.setup('api/docs', app, document, {
            swaggerOptions: { persistAuthorization: true },
        });
    }

    // Graceful shutdown
    app.enableShutdownHooks();

    const port = configService.get<number>('API_PORT', 3101);
    await app.listen(port);

    logger.log(`🚀 API listening on http://localhost:${port}`);
    if (!isProd) {
        logger.log(`📚 Swagger docs at http://localhost:${port}/api/docs`);
    }
}

void bootstrap();
