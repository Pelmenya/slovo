import { Intent } from '@prisma/client';

export const INTENT_CLASSIFIER = Symbol('INTENT_CLASSIFIER');

export type TClassifyResult = {
    intent: Intent;
    /** Токены LLM для модели себестоимости (фаза 5). 0, если сработал keyword-путь. */
    inputTokens: number;
    outputTokens: number;
};

/**
 * Классификация реплики пациента в интент сценария.
 * Отдельный контракт — чтобы своп провайдера (YandexGPT ↔ gpt-oss ↔ Qwen в AI Studio)
 * не трогал state machine.
 *
 * TODO(slovo-backend): это первая LLM-фича в проекте. Кандидат на переезд в libs/llm
 * как первый OpenAI-провайдер (AI Studio OpenAI-совместим). Пока живёт в libs/voice
 * своим fetch — не расширяю чужой lib без координации по AGENT-STATUS.
 */
export type TIntentClassifier = {
    classify(text: string): Promise<TClassifyResult>;
};
