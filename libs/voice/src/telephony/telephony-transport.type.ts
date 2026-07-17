/**
 * Adapter Pattern: приложение знает только этот контракт.
 * Реализация — Asterisk/ARI; смена провайдера телефонии (Novofon → Exolve → АТС
 * клиники) = правка pjsip.conf транка, а не кода.
 */

export const TELEPHONY_TRANSPORT = Symbol('TELEPHONY_TRANSPORT');

export type TOriginateParams = {
    /** Номер в формате E.164, например +79991234567. */
    phone: string;
    /** Сколько ждать снятия трубки. По умолчанию 30с. */
    timeoutSeconds?: number;
};

export type TRecordOptions = {
    /** Уникальное имя файла записи (без расширения). */
    name: string;
    /** Максимальная длительность реплики. */
    maxDurationSeconds: number;
    /** Тишина, после которой запись останавливается. */
    maxSilenceSeconds: number;
};

/** Звонок, на который уже ответили. */
export type TActiveCall = {
    readonly channelId: string;

    /** Проигрывает файл из каталога sounds Asterisk. Резолвится по окончании. */
    play(soundName: string): Promise<void>;

    /** Пишет реплику собеседника. Возвращает путь к файлу на стороне хоста. */
    record(options: TRecordOptions): Promise<string>;

    hangup(): Promise<void>;

    /** Резолвится, когда собеседник положил трубку. */
    waitForHangup(): Promise<void>;
};

export type TTelephonyTransport = {
    connect(): Promise<void>;
    disconnect(): Promise<void>;

    /**
     * Дозвон. Резолвится, когда сняли трубку.
     * @throws {NoAnswerError} если не ответили в отведённый таймаут.
     */
    originate(params: TOriginateParams): Promise<TActiveCall>;
};

/** Недозвон — штатный исход звонка (no_answer), не сбой системы. */
export class NoAnswerError extends Error {
    constructor(readonly phone: string) {
        super(`Абонент ${phone} не ответил`);
        this.name = 'NoAnswerError';
    }
}
