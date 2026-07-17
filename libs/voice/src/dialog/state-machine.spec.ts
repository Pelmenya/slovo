import { CallOutcome, Intent } from '@prisma/client';
import {
  DialogState,
  MAX_RE_ASKS,
  initialContext,
  nextStep,
} from "./state-machine";

const PHRASE = "Напоминаем о приёме";

describe("nextStep: приветствие", () => {
  it("начинает с фразы напоминания и переходит в ожидание ответа", () => {
    const step = nextStep(initialContext(), undefined, PHRASE);

    expect(step.phrase).toBe(PHRASE);
    expect(step.context.state).toBe(DialogState.LISTEN);
    expect(step.outcome).toBeUndefined();
  });

  it("не слушает интент на приветствии — говорить нам, а не пациенту", () => {
    const step = nextStep(initialContext(), Intent.cancel, PHRASE);

    expect(step.phrase).toBe(PHRASE);
    expect(step.outcome).toBeUndefined();
  });
});

describe("nextStep: исходы диалога", () => {
  const listening = { state: DialogState.LISTEN, reAsks: 0 };

  it("«да» закрывает звонок как CONFIRMED", () => {
    const step = nextStep(listening, Intent.confirm, PHRASE);

    expect(step.outcome).toBe(CallOutcome.confirmed);
    expect(step.context.state).toBe(DialogState.DONE);
    expect(step.phrase).toMatch(/ждём вас/i);
  });

  it("«нет» закрывает звонок как CANCELED", () => {
    const step = nextStep(listening, Intent.cancel, PHRASE);

    expect(step.outcome).toBe(CallOutcome.canceled);
    expect(step.context.state).toBe(DialogState.DONE);
  });

  it("просьба перенести обещает передать администратору", () => {
    const step = nextStep(listening, Intent.reschedule, PHRASE);

    expect(step.outcome).toBe(CallOutcome.reschedule_requested);
    expect(step.phrase).toMatch(/администратору/i);
  });
});

describe("nextStep: переспросы", () => {
  it("на непонятный ответ переспрашивает, а не завершает", () => {
    const step = nextStep(
      { state: DialogState.LISTEN, reAsks: 0 },
      Intent.unclear,
      PHRASE,
    );

    expect(step.outcome).toBeUndefined();
    expect(step.context.state).toBe(DialogState.RE_ASK);
    expect(step.context.reAsks).toBe(1);
    expect(step.phrase).toMatch(/да или нет/i);
  });

  it("на молчание (интента нет) тоже переспрашивает", () => {
    const step = nextStep(
      { state: DialogState.LISTEN, reAsks: 0 },
      undefined,
      PHRASE,
    );

    expect(step.context.reAsks).toBe(1);
    expect(step.outcome).toBeUndefined();
  });

  it("сдаётся с UNCLEAR, когда лимит переспросов исчерпан", () => {
    const step = nextStep(
      { state: DialogState.RE_ASK, reAsks: MAX_RE_ASKS },
      Intent.unclear,
      PHRASE,
    );

    expect(step.outcome).toBe(CallOutcome.unclear);
    expect(step.context.state).toBe(DialogState.DONE);
    expect(step.phrase).toMatch(/перезвонит/i);
  });

  it("переспрашивает ровно MAX_RE_ASKS раз и не зацикливается", () => {
    const context = initialContext();
    let step = nextStep(context, undefined, PHRASE); // приветствие
    let iterations = 0;

    while (!step.outcome && iterations < 10) {
      step = nextStep(step.context, Intent.unclear, PHRASE);
      iterations += 1;
    }

    expect(step.outcome).toBe(CallOutcome.unclear);
    expect(iterations).toBe(MAX_RE_ASKS + 1);
  });

  it("после переспроса всё ещё принимает нормальный ответ", () => {
    const step = nextStep(
      { state: DialogState.RE_ASK, reAsks: 1 },
      Intent.confirm,
      PHRASE,
    );

    expect(step.outcome).toBe(CallOutcome.confirmed);
  });
});

describe("nextStep: защита от неправильного использования", () => {
  it("не даёт продолжать завершённый диалог", () => {
    expect(() =>
      nextStep({ state: DialogState.DONE, reAsks: 0 }, Intent.confirm, PHRASE),
    ).toThrow(/завершён/);
  });

  it("не мутирует переданный контекст", () => {
    const context = initialContext();
    nextStep(context, undefined, PHRASE);

    expect(context).toEqual({ state: DialogState.GREETING, reAsks: 0 });
  });
});
