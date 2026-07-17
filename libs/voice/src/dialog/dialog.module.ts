import { Module } from '@nestjs/common';
import { AiStudioIntentClassifier } from './ai-studio-intent.classifier';
import { INTENT_CLASSIFIER } from './intent-classifier.type';

@Module({
    providers: [{ provide: INTENT_CLASSIFIER, useClass: AiStudioIntentClassifier }],
    exports: [INTENT_CLASSIFIER],
})
export class DialogModule {}
