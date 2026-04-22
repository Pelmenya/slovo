import { Module } from '@nestjs/common';

/**
 * Абстракция над LLM-провайдерами (Claude / OpenAI / Ollama).
 * Контракт: ILLMProvider.
 * Конкретные адаптеры будут добавлены при появлении фичей.
 */
@Module({})
export class LLMModule {}
