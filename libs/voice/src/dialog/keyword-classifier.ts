import { Intent } from '@prisma/client';

/**
 * Дешёвый путь до LLM: очевидные «да»/«нет» не стоят ни токенов, ни задержки.
 * Возвращает undefined, если реплика неочевидна — тогда решает модель.
 */

const CONFIRM_PATTERNS = [
  /^да$/,
  /^ага$/,
  /^угу$/,
  /^конечно$/,
  /^да,? конечно/,
  /^да,? приду/,
  /^приду$/,
  /^буду$/,
  /^да,? буду/,
  /^хорошо$/,
  /^подтверждаю$/,
];

const CANCEL_PATTERNS = [
  /^нет$/,
  /^не приду$/,
  /^нет,? не приду/,
  /^нет,? не смогу/,
  /^не смогу$/,
  /^отмени(те)?$/,
  /^отмени(те)? (пожалуйста|запись)$/,
  /^отказываюсь$/,
];

const RESCHEDULE_PATTERNS = [
  /^перенеси(те)?$/,
  /^перенеси(те)? (пожалуйста|на другой день|на другое время)$/,
  /^можно перенести/,
  /^хочу перенести/,
];

export function classifyByKeywords(text: string): Intent | undefined {
  const normalized = normalize(text);
  if (!normalized) return undefined;

  // Перенос проверяем раньше отмены: «нет, перенесите» — это перенос, не отказ.
  if (RESCHEDULE_PATTERNS.some((p) => p.test(normalized))) {
    return Intent.reschedule;
  }
  if (CONFIRM_PATTERNS.some((p) => p.test(normalized))) {
    return Intent.confirm;
  }
  if (CANCEL_PATTERNS.some((p) => p.test(normalized))) {
    return Intent.cancel;
  }

  return undefined;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.!?]+$/g, "")
    .trim();
}
