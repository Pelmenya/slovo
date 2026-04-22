import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { HealthModule } from './modules/health/health.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: ['.env'],
        }),
        LoggerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                pinoHttp: {
                    level: config.get<string>('LOG_LEVEL', 'info'),
                    transport:
                        config.get<string>('NODE_ENV') === 'development'
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
        }),
        ThrottlerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => [
                {
                    ttl: config.get<number>('THROTTLE_TTL', 60) * 1000,
                    limit: config.get<number>('THROTTLE_LIMIT', 100),
                },
            ],
        }),
        HealthModule,
    ],
})
export class AppModule {}
