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
