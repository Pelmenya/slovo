export type TReminderPhraseParams = {
  patientName: string;
  clinicName: string;
  appointmentAt: Date;
}

const MONTHS_GENITIVE = [
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
];

/**
 * Текст напоминания для TTS. Дату проговариваем словами: «20 июля в 14:00»
 * читается голосом естественно, «2026-07-20T14:00» — нет.
 */
export function buildReminderPhrase(params: TReminderPhraseParams): string {
  const { patientName, clinicName, appointmentAt } = params;

  return (
    `Здравствуйте, ${patientName}! Это клиника ${clinicName}. ` +
    `Напоминаем о вашем приёме ${formatAppointmentDate(appointmentAt)}. ` +
    `Скажите, пожалуйста, вам удобно прийти?`
  );
}

export function formatAppointmentDate(date: Date): string {
  const day = date.getDate();
  const month = MONTHS_GENITIVE[date.getMonth()];
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day} ${month} в ${hours}:${minutes}`;
}
