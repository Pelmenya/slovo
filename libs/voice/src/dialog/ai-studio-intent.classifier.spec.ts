import { Intent } from '@prisma/client';
import { parseIntent } from "./ai-studio-intent.classifier";

describe("parseIntent", () => {
  it("берёт ярлык из content", () => {
    expect(
      parseIntent({ choices: [{ message: { content: "RESCHEDULE" } }] }),
    ).toBe(Intent.reschedule);
  });

  it("терпит болтовню вокруг ярлыка", () => {
    expect(
      parseIntent({
        choices: [{ message: { content: "Ответ: CONFIRM." } }],
      }),
    ).toBe(Intent.confirm);
  });

  it("достаёт ярлык из reasoning_content, если content пуст (reasoning-модели)", () => {
    expect(
      parseIntent({
        choices: [
          {
            message: {
              content: "",
              reasoning_content: "Пациент отказывается... итог: CANCEL",
            },
          },
        ],
      }),
    ).toBe(Intent.cancel);
  });

  it("возвращает UNCLEAR на пустой ответ", () => {
    expect(parseIntent({ choices: [{ message: { content: "" } }] })).toBe(
      Intent.unclear,
    );
  });

  it("возвращает UNCLEAR на мусор без ярлыка", () => {
    expect(parseIntent({ choices: [{ message: { content: "Париж" } }] })).toBe(
      Intent.unclear,
    );
  });

  it("возвращает UNCLEAR, если choices вообще нет", () => {
    expect(parseIntent({})).toBe(Intent.unclear);
  });

  it("берёт первый ярлык, если модель назвала несколько", () => {
    expect(
      parseIntent({
        choices: [{ message: { content: "RESCHEDULE или CANCEL" } }],
      }),
    ).toBe(Intent.reschedule);
  });
});
