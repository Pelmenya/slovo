// @slovo/voice — голосовой робот для клиник (порт из спайка medods-voice).
// Домен: телефония (Asterisk/ARI), речь (SpeechKit), диалог (state machine + классификатор AI Studio).

// Телефония
export * from './telephony/telephony-transport.type';
export * from './telephony/telephony.module';
export * from './telephony/ari.transport';
export * from './telephony/phone';

// Речь
export * from './speech/wav';
export * from './speech/reminder-phrase';
export * from './speech/tts.service';
export * from './speech/stt.service';

// Диалог
export * from './dialog/state-machine';
export * from './dialog/keyword-classifier';
export * from './dialog/intent-classifier.type';
export * from './dialog/ai-studio-intent.classifier';
export * from './dialog/dialog.module';
