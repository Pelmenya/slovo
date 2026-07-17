import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, type Channel, type Client } from 'ari-client';
import { join, resolve } from 'node:path';
import { normalizePhoneForTrunk } from './phone';
import {
    NoAnswerError,
    TActiveCall,
    TOriginateParams,
    TRecordOptions,
    TTelephonyTransport,
} from './telephony-transport.type';

/** Подкаталог в sounds Asterisk — bind-mount на media/sounds (docker-compose.voice.yml). */
const CONTAINER_SOUNDS_SUBDIR = 'voice';
const DEFAULT_ORIGINATE_TIMEOUT_SECONDS = 30;

@Injectable()
export class AriTransport implements TTelephonyTransport {
    private readonly logger = new Logger(AriTransport.name);
    private client?: Client;

    constructor(private readonly config: ConfigService) {}

    async connect(): Promise<void> {
        const url = this.config.getOrThrow<string>('ARI_URL');
        const user = this.config.getOrThrow<string>('ARI_USER');
        const password = this.config.getOrThrow<string>('ARI_PASSWORD');
        const app = this.config.getOrThrow<string>('ARI_APP');

        this.client = await connect(url, user, password);
        // WebSocket: без start() Asterisk не отдаёт события Stasis нашему приложению.
        await this.client.start(app);
        this.logger.log(`ARI подключён: ${url}, приложение ${app}`);
    }

    async disconnect(): Promise<void> {
        if (!this.client) return;
        this.client.stop();
        this.client = undefined;
    }

    async originate(params: TOriginateParams): Promise<TActiveCall> {
        const client = this.requireClient();
        const app = this.config.getOrThrow<string>('ARI_APP');
        const callerId = this.config.getOrThrow<string>('SIP_CALLER_ID');
        const timeout = params.timeoutSeconds ?? DEFAULT_ORIGINATE_TIMEOUT_SECONDS;

        const dialNumber = normalizePhoneForTrunk(params.phone);
        const channel = client.Channel();

        // Подписываемся до originate: иначе рискуем пропустить событие быстрого ответа.
        const answered = this.waitForAnswer(client, channel, params.phone);

        await channel.originate({
            endpoint: `PJSIP/${dialNumber}@trunk`,
            app,
            callerId,
            timeout,
        });

        this.logger.log(`Дозвон на ${params.phone} (канал ${channel.id})`);
        return answered;
    }

    /**
     * Трубку сняли = канал вошёл в Stasis. Если вместо этого канал разрушен —
     * это недозвон (занято, сброс, таймаут): для сценария штатный исход.
     */
    private waitForAnswer(client: Client, channel: Channel, phone: string): Promise<TActiveCall> {
        return new Promise<TActiveCall>((resolvePromise, reject) => {
            const onStart = (): void => {
                cleanup();
                this.logger.log(`Ответили: ${phone}`);
                resolvePromise(
                    new AriActiveCall(client, channel, this.recordingsHostDir(), this.logger),
                );
            };

            const onDestroyed = (): void => {
                cleanup();
                reject(new NoAnswerError(phone));
            };

            const cleanup = (): void => {
                channel.removeListener('StasisStart', onStart);
                channel.removeListener('ChannelDestroyed', onDestroyed);
            };

            channel.once('StasisStart', onStart);
            channel.once('ChannelDestroyed', onDestroyed);
        });
    }

    private recordingsHostDir(): string {
        return resolve(this.config.get<string>('MEDIA_RECORDINGS_DIR') ?? './media/recordings');
    }

    private requireClient(): Client {
        if (!this.client) {
            throw new Error('ARI не подключён: вызовите connect() до originate()');
        }
        return this.client;
    }
}

class AriActiveCall implements TActiveCall {
    constructor(
        private readonly client: Client,
        private readonly channel: Channel,
        private readonly recordingsHostDirPath: string,
        private readonly logger: Logger,
    ) {}

    get channelId(): string {
        return this.channel.id;
    }

    async play(soundName: string): Promise<void> {
        // ari-client шлёт события на объект Playback, а не на канал,
        // поэтому создаём его заранее и передаём в play().
        const playback = this.client.Playback();

        const finished = new Promise<void>((resolvePromise, reject) => {
            playback.once('PlaybackFinished', () => resolvePromise());
            this.channel.once('StasisEnd', () =>
                reject(new Error('Собеседник положил трубку во время реплики')),
            );
        });

        await this.channel.play(
            { media: `sound:${CONTAINER_SOUNDS_SUBDIR}/${soundName}` },
            playback,
        );

        await finished;
    }

    async record(options: TRecordOptions): Promise<string> {
        const recording = this.client.LiveRecording();

        const finished = new Promise<void>((resolvePromise, reject) => {
            recording.once('RecordingFinished', () => resolvePromise());
            recording.once('RecordingFailed', () =>
                reject(new Error(`Не удалось записать реплику ${options.name}`)),
            );
        });

        await this.channel.record(
            {
                name: options.name,
                format: 'wav',
                maxDurationSeconds: options.maxDurationSeconds,
                maxSilenceSeconds: options.maxSilenceSeconds,
                beep: false,
                ifExists: 'overwrite',
            },
            recording,
        );

        await finished;
        return join(this.recordingsHostDirPath, `${options.name}.wav`);
    }

    async hangup(): Promise<void> {
        try {
            await this.channel.hangup();
        } catch {
            // Канал мог уже закрыться со стороны собеседника — это не ошибка.
            this.logger.debug(`Канал ${this.channel.id} уже завершён`);
        }
    }

    waitForHangup(): Promise<void> {
        return new Promise<void>((resolvePromise) => {
            this.channel.once('StasisEnd', () => resolvePromise());
        });
    }
}
