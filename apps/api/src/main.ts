import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { Logger as PinoLogger } from 'nestjs-pino';
import { parseCorsOrigin, type TAppEnv } from '@slovo/common';
import { AppModule } from './app.module';

// Per-route body limits — НЕ глобально 40MB.
//
// Глобальный высокий limit на весь API расширил бы DoS-вектор: knowledge
// text-source принимает rawText ≤500KB по DTO `MaxLength`, но Express
// парсер выделил бы 40MB RAM ещё ДО ValidationPipe. Без auth-guard'а
// any anonymous IP мог бы burst-RAM атаку.
//
// Решение: high limit ТОЛЬКО для catalog search route (image upload до 5
// фото × 5MB декодированных ≈ 35MB base64 + JSON overhead → 40MB cap);
// глобальный default — стандартный 600KB (с запасом на knowledge 500KB).
// Express маршрутит middleware по path: /catalog/search первый match'ит
// 40MB-парсер, остальные fall-through к 600KB.
const BODY_PARSER_LIMIT_DEFAULT = '600kb';
const BODY_PARSER_LIMIT_CATALOG_SEARCH = '40mb';
const CATALOG_SEARCH_ROUTE = '/catalog/search';

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bufferLogs: true,
    });

    app.useLogger(app.get(PinoLogger));

    // Per-route order matters: первый matching middleware парсит body
    // и заполняет req.body — последующие парсеры видят что body уже есть
    // и пропускают (no-op).
    app.use(CATALOG_SEARCH_ROUTE, json({ limit: BODY_PARSER_LIMIT_CATALOG_SEARCH }));
    app.use(json({ limit: BODY_PARSER_LIMIT_DEFAULT }));
    app.use(urlencoded({ extended: true, limit: BODY_PARSER_LIMIT_DEFAULT }));

    const configService = app.get<ConfigService<TAppEnv, true>>(ConfigService);
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
