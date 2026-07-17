import { Inject, Logger } from '@nestjs/common';
import { INTENT_CLASSIFIER, TIntentClassifier } from '@slovo/voice';
import { Command, CommandRunner } from 'nest-commander';

@Command({
    name: 'classify',
    arguments: '<text...>',
    description: 'Классифицировать реплику пациента в интент (проба мозга)',
})
export class ClassifyCommand extends CommandRunner {
    private readonly logger = new Logger(ClassifyCommand.name);

    constructor(@Inject(INTENT_CLASSIFIER) private readonly classifier: TIntentClassifier) {
        super();
    }

    async run(args: string[]): Promise<void> {
        const text = args.join(' ');
        const result = await this.classifier.classify(text);
        this.logger.log(`Интент: ${result.intent}`);
    }
}
