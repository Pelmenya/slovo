import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { TAppEnv } from '../config/env.schema';

// Paths для pino redact. Дёшево добавить сейчас, пока известны все точки.
// req.headers.* — pino-http автоматически логирует заголовки. Важно скрыть
// authorization (будущий JWT), cookie, x-user-id (Phase 1 auth-заглушка,
// UUID сам по себе не PII, но трекинг пользователя через логи — риск).
// req.body.* — тело в stock конфиге не логируется, но если когда-нибудь
// включим — rawText/extractedText могут содержать user-generated PII.
const REDACT_PATHS = [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-user-id"]',
    'req.headers["x-api-key"]',
    'req.body.password',
    'req.body.rawText',
    'req.body.extractedText',
    // PR8 — image upload base64. Если когда-то включим req.body
    // в pino-http serializers — 5MB base64 не должно засорять log store.
    'req.body.imageBase64',
    // Phase 4 water-analysis (8 мая 2026): координаты юзера попадают в pino-http
    // access logs через req.url (query params) и req.body (для POST). При scaling
    // на DE/US это нарушение 152-ФЗ — house-level точность позволяет идентифицировать
    // субъекта данных. Redact ловит лимитированно (only known paths) — но для
    // /water-analysis/predict, /depth-predict, /equipment-suggest, /points все 4
    // координатных поля учтены. Полная защита через custom serializer.req если
    // потребуется (см. tech-debt).
    'req.body.lat',
    'req.body.lon',
    'req.query.lat',
    'req.query.lon',
    'req.query.west',
    'req.query.south',
    'req.query.east',
    'req.query.north',
    '*.apiKey',
    '*.secret',
];

export function createAppLoggerModule() {
    return LoggerModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService<TAppEnv, true>) => ({
            pinoHttp: {
                level: config.get('LOG_LEVEL', { infer: true }),
                redact: {
                    paths: REDACT_PATHS,
                    censor: '[REDACTED]',
                },
                transport:
                    config.get('NODE_ENV', { infer: true }) === 'development'
                        ? {
                              target: 'pino-pretty',
                              options: {
                                  singleLine: true,
                                  colorize: true,
                                  translateTime: 'HH:MM:ss',
                              },
                          }
                        : undefined,
            },
        }),
    });
}
