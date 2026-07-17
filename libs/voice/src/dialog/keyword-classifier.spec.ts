import { Intent } from '@prisma/client';
import { classifyByKeywords } from "./keyword-classifier";

describe("classifyByKeywords: очевидные согласия", () => {
  it.each([
    "да",
    "Да",
    "ДА",
    "да.",
    "Да!",
    " да ",
    "ага",
    "угу",
    "конечно",
    "приду",
    "подтверждаю",
  ])("«%s» → CONFIRM без обращения к LLM", (text) => {
    expect(classifyByKeywords(text)).toBe(Intent.confirm);
  });
});

describe("classifyByKeywords: очевидные отказы", () => {
  it.each([
    "нет",
    "Нет.",
    "не приду",
    "нет, не смогу",
    "не смогу",
    "отмените",
    "отмените пожалуйста",
    "отказываюсь",
  ])("«%s» → CANCEL", (text) => {
    expect(classifyByKeywords(text)).toBe(Intent.cancel);
  });
});

describe("classifyByKeywords: очевидные переносы", () => {
  it.each([
    "перенесите",
    "перенесите пожалуйста",
    "можно перенести на другой день",
    "хочу перенести",
  ])("«%s» → RESCHEDULE", (text) => {
    expect(classifyByKeywords(text)).toBe(Intent.reschedule);
  });

  it("«перенесите» не путается с отказом, хотя пациент говорит «нет»", () => {
    expect(classifyByKeywords("можно перенести на другой день")).toBe(
      Intent.reschedule,
    );
  });
});

describe("classifyByKeywords: отдаёт неоднозначное в LLM", () => {
  it.each([
    "ну не знаю, может быть",
    "а можно попозже, часов в 6",
    "что? кто это говорит",
    "у меня сейчас неудобно разговаривать",
    "да я вообще-то не записывался никуда",
    "",
    "   ",
  ])("«%s» → undefined, решать модели", (text) => {
    expect(classifyByKeywords(text)).toBeUndefined();
  });

  it("«да я не записывался» не считает согласием — тут нужна модель", () => {
    expect(
      classifyByKeywords("да я вообще-то не записывался никуда"),
    ).toBeUndefined();
  });
});

describe("classifyByKeywords: нормализация", () => {
  it("не спотыкается на ё", () => {
    expect(classifyByKeywords("перенесите")).toBe(Intent.reschedule);
  });

  it("игнорирует хвостовую пунктуацию распознавания", () => {
    expect(classifyByKeywords("да!!!")).toBe(Intent.confirm);
    expect(classifyByKeywords("нет...")).toBe(Intent.cancel);
  });
});
