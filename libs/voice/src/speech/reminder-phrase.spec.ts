import { buildReminderPhrase, formatAppointmentDate } from "./reminder-phrase";

describe("formatAppointmentDate", () => {
  it("проговаривает дату словами, а не в ISO", () => {
    expect(formatAppointmentDate(new Date(2026, 6, 20, 14, 0))).toBe(
      "20 июля в 14:00",
    );
  });

  it("добивает минуты нулём — «в 9:05», а не «в 9:5»", () => {
    expect(formatAppointmentDate(new Date(2026, 0, 9, 9, 5))).toBe(
      "9 января в 09:05",
    );
  });

  it("ставит месяц в родительный падеж для каждого месяца", () => {
    const months = Array.from(
      { length: 12 },
      (_, i) =>
        formatAppointmentDate(new Date(2026, i, 1, 10, 0)).split(" ")[1],
    );

    expect(months).toEqual([
      "января",
      "февраля",
      "марта",
      "апреля",
      "мая",
      "июня",
      "июля",
      "августа",
      "сентября",
      "октября",
      "ноября",
      "декабря",
    ]);
  });

  it("не сдвигает полночь на предыдущий день", () => {
    expect(formatAppointmentDate(new Date(2026, 11, 31, 0, 0))).toBe(
      "31 декабря в 00:00",
    );
  });
});

describe("buildReminderPhrase", () => {
  const params = {
    patientName: "Иван",
    clinicName: "Эстетик Стом",
    appointmentAt: new Date(2026, 6, 20, 14, 0),
  };

  it("подставляет имя, клинику и время приёма", () => {
    const phrase = buildReminderPhrase(params);

    expect(phrase).toBe(
      "Здравствуйте, Иван! Это клиника Эстетик Стом. " +
        "Напоминаем о вашем приёме 20 июля в 14:00. " +
        "Скажите, пожалуйста, вам удобно прийти?",
    );
  });

  it("заканчивается вопросом — иначе пациент не поймёт, что ждут ответа", () => {
    expect(buildReminderPhrase(params).trim().endsWith("?")).toBe(true);
  });

  it("не оставляет незаполненных плейсхолдеров", () => {
    const phrase = buildReminderPhrase({
      patientName: "Пётр",
      clinicName: "Дента",
      appointmentAt: new Date(2026, 2, 3, 9, 30),
    });

    expect(phrase).not.toMatch(/\$\{|undefined|\[|\]/);
    expect(phrase).toContain("Пётр");
    expect(phrase).toContain("Дента");
    expect(phrase).toContain("3 марта в 09:30");
  });
});
