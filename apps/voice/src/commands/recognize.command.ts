import { Logger } from '@nestjs/common';
import { SttService } from '@slovo/voice';
import { Command, CommandRunner } from 'nest-commander';
import { resolve } from 'node:path';

@Command({
    name: 'recognize',
    arguments: '<file>',
    description: 'Распознать реплику из WAV-файла (8 кГц)',
})
export class RecognizeCommand extends CommandRunner {
    private readonly logger = new Logger(RecognizeCommand.name);

    constructor(private readonly stt: SttService) {
        super();
    }

    async run(args: string[]): Promise<void> {
        const path = resolve(args[0]);
        const result = await this.stt.recognizeFile(path);

        this.logger.log(`Файл: ${path}`);
        this.logger.log(`Текст: «${result.text}»`);
    }
}
