import { Module } from '@nestjs/common';
import { SttService } from './stt.service';
import { TtsService } from './tts.service';

@Module({
    providers: [TtsService, SttService],
    exports: [TtsService, SttService],
})
export class SpeechModule {}
