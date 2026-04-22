import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

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
                                  options: { singleLine: true, colorize: true },
                              }
                            : undefined,
                },
            }),
        }),
    ],
})
export class WorkerModule {}
