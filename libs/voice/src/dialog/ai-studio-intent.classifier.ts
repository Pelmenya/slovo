import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Intent } from '@prisma/client';
import { classifyByKeywords } from './keyword-classifier';
import { TClassifyResult, TIntentClassifier } from './intent-classifier.type';

const BASE_URL = 'https://ai.api.cloud.yandex.net/v1';

/**
 * Победитель бенча 2026-07-17 (research 5.2): 7/7 на живых репликах, ~380 мс.
 * Альтернатива с тем же результатом — gpt-oss-20b (тоже в AI Studio).
 * Меняется через LLM_CLASSIFIER_MODEL без правки кода.
 */
const DEFAULT_MODEL = 'yandexgpt-5-lite/latest';

/**
 * Запас на случай reasoning-модели: у них ответ рождается ПОСЛЕ рассуждений,
 * и с малым лимитом content приходит пустым (см. research 5.2).
 */
const MAX_TOKENS = 700;

const SYSTEM_PROMPT = `Ты классифицируешь ответ пациента стоматологической клиники на звонок-напоминание о приёме.

Робот спросил: «Вам удобно прийти на приём?». Определи намерение пациента:
CONFIRM — подтверждает, что придёт
CANCEL — отказывается, не придёт, просит отменить
RESCHEDULE — хочет перенести на другое время или дату
UNCLEAR — непонятно, не по теме, не расслышал, ответ не про приём

Текст пришёл из распознавания речи по телефону: возможны обрывки и ошибки.
Ответь ровно одним словом: CONFIRM, CANCEL, RESCHEDULE или UNCLEAR. Без рассуждений.`;

type TChatCompletionResponse = {
    choices?: Array<{
        message?: { content?: string; reasoning_content?: string };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
};

@Injectable()
export class AiStudioIntentClassifier implements TIntentClassifier {
    private readonly logger = new Logger(AiStudioIntentClassifier.name);

    constructor(private readonly config: ConfigService) {}

    async classify(text: string): Promise<TClassifyResult> {
        // Дешёвый путь: очевидные «да»/«нет» не стоят ни токенов, ни задержки в звонке.
        const byKeyword = classifyByKeywords(text);
        if (byKeyword) {
            this.logger.log(`«${text}» → ${byKeyword} (по ключевым словам)`);
            return { intent: byKeyword, inputTokens: 0, outputTokens: 0 };
        }

        const apiKey = this.config.getOrThrow<string>('YANDEX_LLM_API_KEY');
        const folderId = this.config.getOrThrow<string>('YANDEX_FOLDER_ID');
        const model = this.config.get<string>('LLM_CLASSIFIER_MODEL') ?? DEFAULT_MODEL;

        const startedAt = performance.now();
        const response = await fetch(`${BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: `gpt://${folderId}/${model}`,
                max_tokens: MAX_TOKENS,
                temperature: 0,
                // Глушим размышления там, где модель это уважает (gpt-oss); yandexgpt игнорирует.
                reasoning_effort: 'low',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: `Ответ пациента: «${text}»` },
                ],
            }),
        });

        if (!response.ok) {
            const details = await response.text();
            throw new Error(`AI Studio вернул ${response.status}: ${details.slice(0, 200)}`);
        }

        const payload = (await response.json()) as TChatCompletionResponse;
        const intent = parseIntent(payload);
        const ms = Math.round(performance.now() - startedAt);

        this.logger.log(
            `«${text}» → ${intent} (${model}, ${ms} мс, ${payload.usage?.prompt_tokens ?? 0}/${payload.usage?.completion_tokens ?? 0} токенов)`,
        );

        return {
            intent,
            inputTokens: payload.usage?.prompt_tokens ?? 0,
            outputTokens: payload.usage?.completion_tokens ?? 0,
        };
    }
}

/** Модель отвечает UPPER-словами (так задано в промпте) — маппим на lowercase-энум slovo. */
const LABEL_TO_INTENT: Record<string, Intent> = {
    CONFIRM: Intent.confirm,
    CANCEL: Intent.cancel,
    RESCHEDULE: Intent.reschedule,
    UNCLEAR: Intent.unclear,
};

/** Экспортирован ради unit-тестов: разбор ответа не должен требовать сети. */
export function parseIntent(payload: TChatCompletionResponse): Intent {
    const message = payload.choices?.[0]?.message;
    // Модель могла спрятать ярлык в конец рассуждений — ищем и там.
    const haystack = `${message?.content ?? ''}\n${message?.reasoning_content ?? ''}`;
    const match = haystack.match(/CONFIRM|CANCEL|RESCHEDULE|UNCLEAR/);
    return match ? LABEL_TO_INTENT[match[0]] : Intent.unclear;
}
