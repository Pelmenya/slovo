import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { VoiceModule } from './voice.module';

async function bootstrap(): Promise<void> {
    await CommandFactory.run(VoiceModule, { logger: ['log', 'warn', 'error'] });
}

void bootstrap();
