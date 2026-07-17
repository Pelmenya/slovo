/**
 * SpeechKit отдаёт «голый» PCM без заголовка, а Asterisk проигрывает файлы,
 * опираясь на заголовок WAV. Поэтому оборачиваем сами.
 * Формат телефонного канала: моно, 16 бит, 8 кГц.
 */

const HEADER_BYTES = 44;
const PCM_FORMAT = 1;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

/**
 * Достаёт сэмплы из WAV. Ищем чанк `data`, а не отрезаем 44 байта: Asterisk и
 * другие писатели вставляют доп. чанки (LIST/fact), и заголовок длиннее.
 */
export function wavToPcm(wav: Buffer): Buffer {
  if (
    wav.length < 12 ||
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Это не WAV: нет сигнатур RIFF/WAVE");
  }

  let offset = 12;
  while (offset + 8 <= wav.length) {
    const chunkId = wav.toString("ascii", offset, offset + 4);
    const chunkSize = wav.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (chunkId === "data") {
      // Заявленный размер может врать (обрыв записи) — не читаем за пределы буфера.
      return wav.subarray(body, Math.min(body + chunkSize, wav.length));
    }

    // Чанки выравниваются по чётной границе.
    offset = body + chunkSize + (chunkSize % 2);
  }

  throw new Error("В WAV нет чанка data");
}

export function pcmToWav(pcm: Buffer, sampleRateHertz: number): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  const byteRate = (sampleRateHertz * CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;

  header.write("RIFF", 0, "ascii");
  // Размер RIFF-чанка: всё, кроме первых 8 байт.
  header.writeUInt32LE(HEADER_BYTES - 8 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");

  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // длина fmt-чанка для PCM
  header.writeUInt16LE(PCM_FORMAT, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(sampleRateHertz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);

  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
