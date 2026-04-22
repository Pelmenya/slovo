import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';

export function createAppConfigModule() {
    return ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: ['.env'],
        validate: validateEnv,
    });
}
