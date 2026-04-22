import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { parseCorsOrigin, type AppEnv } from '@slovo/common';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        bufferLogs: true,
    });

    app.useLogger(app.get(PinoLogger));

    const configService = app.get<ConfigService<AppEnv, true>>(ConfigService);
    const logger = new Logger('Bootstrap');

    const corsOrigin = parseCorsOrigin(configService.get('CORS_ORIGIN', { infer: true }));
    app.enableCors({ origin: corsOrigin, credentials: true });

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            transformOptions: { enableImplicitConversion: true },
        }),
    );

    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

    const isProd = configService.get('NODE_ENV', { infer: true }) === 'production';
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

    app.enableShutdownHooks();

    const port = configService.get('API_PORT', { infer: true });
    await app.listen(port);

    logger.log(`🚀 API listening on http://localhost:${port}`);
    if (!isProd) {
        logger.log(`📚 Swagger docs at http://localhost:${port}/api/docs`);
    }
}

void bootstrap();
