import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pcmToWav } from "./wav";

const TTS_ENDPOINT =
  "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize";
/** Телефонный канал — 8 кГц; синтезировать выше смысла нет, всё равно ужмётся. */
const SAMPLE_RATE_HERTZ = 8000;
const DEFAULT_VOICE = "alena";

export type TSynthesizeResult = {
  /** Имя без расширения — его ждёт ARI play(). */
  soundName: string;
  path: string;
  /** Для модели себестоимости (Фаза 5): SpeechKit тарифицирует символы. */
  chars: number;
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Синтезирует фразу и кладёт WAV в каталог sounds Asterisk.
   * Файл переиспользуется по имени: неизменные фразы не платим синтезировать дважды.
   */
  async synthesizeToFile(
    text: string,
    soundName: string,
  ): Promise<TSynthesizeResult> {
    const apiKey = this.config.getOrThrow<string>("YANDEX_API_KEY");
    const folderId = this.config.getOrThrow<string>("YANDEX_FOLDER_ID");

    const response = await fetch(TTS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        text,
        lang: "ru-RU",
        voice: DEFAULT_VOICE,
        format: "lpcm",
        sampleRateHertz: String(SAMPLE_RATE_HERTZ),
        folderId,
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `SpeechKit TTS вернул ${response.status}: ${details.slice(0, 200)}`,
      );
    }

    const pcm = Buffer.from(await response.arrayBuffer());
    const wav = pcmToWav(pcm, SAMPLE_RATE_HERTZ);

    const dir = this.soundsDir();
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${soundName}.wav`);
    await writeFile(path, wav);

    this.logger.log(
      `Синтезировано «${text.slice(0, 40)}…» → ${path} (${wav.length} байт, ${text.length} симв.)`,
    );

    return { soundName, path, chars: text.length };
  }

  private soundsDir(): string {
    return resolve(
      this.config.get<string>("MEDIA_SOUNDS_DIR") ?? "./media/sounds",
    );
  }
}
