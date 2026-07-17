import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readFile } from "node:fs/promises";
import { wavToPcm } from "./wav";

const STT_ENDPOINT = "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize";
const SAMPLE_RATE_HERTZ = 8000;

export type TRecognizeResult = {
  text: string;
  /** Для модели себестоимости (Фаза 5): STT тарифицируется за секунды аудио. */
  seconds: number;
}

@Injectable()
export class SttService {
  private readonly logger = new Logger(SttService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Распознаёт реплику из WAV-файла записи ARI.
   * Синхронный режим v1: до 30 секунд и 1 МБ — реплики пациента укладываются.
   */
  async recognizeFile(path: string): Promise<TRecognizeResult> {
    const wav = await readFile(path);
    return this.recognizePcm(wavToPcm(wav));
  }

  async recognizePcm(pcm: Buffer): Promise<TRecognizeResult> {
    const apiKey = this.config.getOrThrow<string>("YANDEX_API_KEY");
    const folderId = this.config.getOrThrow<string>("YANDEX_FOLDER_ID");

    const query = new URLSearchParams({
      lang: "ru-RU",
      format: "lpcm",
      sampleRateHertz: String(SAMPLE_RATE_HERTZ),
      folderId,
    });

    const response = await fetch(`${STT_ENDPOINT}?${query}`, {
      method: "POST",
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(pcm),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `SpeechKit STT вернул ${response.status}: ${details.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as { result?: string };
    const seconds = pcmSeconds(pcm);

    this.logger.log(
      `Распознано за ${seconds.toFixed(1)}с: «${payload.result ?? ""}»`,
    );

    return { text: payload.result ?? "", seconds };
  }
}

/** 8 кГц × 16 бит моно = 16000 байт на секунду. */
function pcmSeconds(pcm: Buffer): number {
  return pcm.length / ((SAMPLE_RATE_HERTZ * 16) / 8);
}
