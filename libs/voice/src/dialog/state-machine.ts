import { CallOutcome, Intent } from '@prisma/client';

export enum DialogState {
  GREETING = "GREETING",
  LISTEN = "LISTEN",
  RE_ASK = "RE_ASK",
  DONE = "DONE",
}

/** Сколько раз переспрашиваем, прежде чем сдаться и закрыть звонок как UNCLEAR. */
export const MAX_RE_ASKS = 2;

export type TDialogContext = {
  state: DialogState;
  /** Сколько раз уже переспросили. */
  reAsks: number;
}

export type TDialogStep = {
  context: TDialogContext;
  /** Что робот произносит на этом шаге. */
  phrase: string;
  /** Заполняется, когда диалог завершён. */
  outcome?: CallOutcome;
}

export function initialContext(): TDialogContext {
  return { state: DialogState.GREETING, reAsks: 0 };
}

/**
 * Чистая функция перехода: (контекст, интент) → следующий шаг.
 * Интент `undefined` = реплики ещё не было (старт диалога).
 */
export function nextStep(
  context: TDialogContext,
  intent: Intent | undefined,
  reminderPhrase: string,
): TDialogStep {
  if (context.state === DialogState.DONE) {
    throw new Error("Диалог уже завершён: nextStep вызывать нельзя");
  }

  if (context.state === DialogState.GREETING) {
    return {
      context: { state: DialogState.LISTEN, reAsks: context.reAsks },
      phrase: reminderPhrase,
    };
  }

  switch (intent) {
    case Intent.confirm:
      return done(
        context,
        CallOutcome.confirmed,
        "Спасибо, ждём вас. До свидания!",
      );

    case Intent.cancel:
      return done(
        context,
        CallOutcome.canceled,
        "Хорошо, отменяем запись. Администратор свяжется с вами. До свидания!",
      );

    case Intent.reschedule:
      return done(
        context,
        CallOutcome.reschedule_requested,
        "Поняла, передам администратору — вам перезвонят, чтобы подобрать время. До свидания!",
      );

    case Intent.unclear:
    case undefined:
      return reAskOrGiveUp(context);
  }
}

function reAskOrGiveUp(context: TDialogContext): TDialogStep {
  if (context.reAsks >= MAX_RE_ASKS) {
    return done(
      context,
      CallOutcome.unclear,
      "Извините, не расслышала. Администратор перезвонит вам. До свидания!",
    );
  }

  return {
    context: { state: DialogState.RE_ASK, reAsks: context.reAsks + 1 },
    phrase:
      "Извините, не расслышала. Вам удобно прийти на приём? Ответьте, пожалуйста, да или нет.",
  };
}

function done(
  context: TDialogContext,
  outcome: CallOutcome,
  phrase: string,
): TDialogStep {
  return {
    context: { state: DialogState.DONE, reAsks: context.reAsks },
    phrase,
    outcome,
  };
}
