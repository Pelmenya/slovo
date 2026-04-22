import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { AppEnv } from '../config/env.schema';

export function createAppLoggerModule() {
    return LoggerModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService<AppEnv, true>) => ({
            pinoHttp: {
                level: config.get('LOG_LEVEL', { infer: true }),
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
