import { Logger } from '@nestjs/common';
import { buildReminderPhrase, TtsService } from '@slovo/voice';
import { Command, CommandRunner, Option } from 'nest-commander';

type TSynthOptions = {
    name: string;
    clinic: string;
    at: Date;
    out: string;
    text?: string;
};

@Command({ name: 'synth', description: 'Синтезировать фразу напоминания в media/sounds' })
export class SynthCommand extends CommandRunner {
    private readonly logger = new Logger(SynthCommand.name);

    constructor(private readonly tts: TtsService) {
        super();
    }

    async run(_args: string[], options: TSynthOptions): Promise<void> {
        const text =
            options.text ??
            buildReminderPhrase({
                patientName: options.name,
                clinicName: options.clinic,
                appointmentAt: options.at,
            });

        const result = await this.tts.synthesizeToFile(text, options.out);

        this.logger.log(`Текст: ${text}`);
        this.logger.log(`Файл: ${result.path} (${result.chars} симв.)`);
    }

    @Option({ flags: '-t, --text <text>', description: 'Произвольный текст вместо шаблона' })
    parseText(value: string): string {
        return value;
    }

    @Option({
        flags: '-o, --out <name>',
        description: 'Имя файла без расширения',
        defaultValue: 'reminder-static',
    })
    parseOut(value: string): string {
        if (!/^[a-z0-9-]+$/i.test(value)) {
            throw new Error(`Имя "${value}" не годится: только латиница, цифры и дефис`);
        }
        return value;
    }

    @Option({ flags: '-n, --name <name>', description: 'Имя пациента', defaultValue: 'Иван' })
    parseName(value: string): string {
        return value;
    }

    @Option({
        flags: '-c, --clinic <clinic>',
        description: 'Название клиники',
        defaultValue: 'Эстетик Стом',
    })
    parseClinic(value: string): string {
        return value;
    }

    @Option({
        flags: '-a, --at <datetime>',
        description: 'Дата и время приёма в ISO',
        defaultValue: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    parseAt(value: string): Date {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            throw new Error(`Дата "${value}" не распознана (ожидается ISO)`);
        }
        return parsed;
    }
}
