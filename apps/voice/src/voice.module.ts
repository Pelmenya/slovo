import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DialogModule, SpeechModule } from '@slovo/voice';
import { ClassifyCommand } from './commands/classify.command';
import { RecognizeCommand } from './commands/recognize.command';
import { SynthCommand } from './commands/synth.command';
import { validateVoiceEnv } from './voice-env.schema';

/**
 * CLI-приложение голосового робота. Свой ConfigModule со своей voice-env-схемой —
 * НЕ slovo validateEnv (тот требует RABBITMQ/S3 и вырезает ARI/SIP/YANDEX).
 *
 * Команды спайка: synth (текст→WAV), recognize (WAV→текст), classify (реплика→интент).
 * Полный call-цикл ждёт живого транка (УКЭП) — вернём отдельной командой, без CQRS
 * (в slovo его нет; тащить зависимость ради заблокированной команды не будем).
 */
@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env', validate: validateVoiceEnv }),
        SpeechModule,
        DialogModule,
    ],
    providers: [SynthCommand, RecognizeCommand, ClassifyCommand],
})
export class VoiceModule {}
