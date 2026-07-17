import { pcmToWav, wavToPcm } from "./wav";

describe("pcmToWav", () => {
  const pcm = Buffer.alloc(160, 1); // 10 мс речи в 8 кГц/16 бит

  it("ставит RIFF/WAVE-сигнатуры, иначе Asterisk не признает файл", () => {
    const wav = pcmToWav(pcm, 8000);

    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.toString("ascii", 36, 40)).toBe("data");
  });

  it("описывает моно 16 бит на заявленной частоте", () => {
    const wav = pcmToWav(pcm, 8000);

    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // моно
    expect(wav.readUInt32LE(24)).toBe(8000);
    expect(wav.readUInt16LE(34)).toBe(16);
  });

  it("считает byteRate и blockAlign под 8 кГц", () => {
    const wav = pcmToWav(pcm, 8000);

    expect(wav.readUInt32LE(28)).toBe(16000); // 8000 * 1 * 16 / 8
    expect(wav.readUInt16LE(32)).toBe(2);
  });

  it("переносит частоту в заголовок, а не хардкодит 8 кГц", () => {
    const wav = pcmToWav(pcm, 48000);

    expect(wav.readUInt32LE(24)).toBe(48000);
    expect(wav.readUInt32LE(28)).toBe(96000);
  });

  it("прописывает размеры чанков и сохраняет сэмплы без потерь", () => {
    const wav = pcmToWav(pcm, 8000);

    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(44)).toEqual(pcm);
  });

  it("переваривает пустой PCM, не ломая заголовок", () => {
    const wav = pcmToWav(Buffer.alloc(0), 8000);

    expect(wav.length).toBe(44);
    expect(wav.readUInt32LE(40)).toBe(0);
  });
});

describe("wavToPcm", () => {
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

  it("возвращает ровно те сэмплы, что упаковали", () => {
    expect(wavToPcm(pcmToWav(pcm, 8000))).toEqual(pcm);
  });

  it("пропускает лишние чанки перед data, а не режет 44 байта вслепую", () => {
    const base = pcmToWav(pcm, 8000);
    // LIST-чанк из 4 байт между fmt и data — так пишут многие инструменты.
    const list = Buffer.alloc(12);
    list.write("LIST", 0, "ascii");
    list.writeUInt32LE(4, 4);
    const withList = Buffer.concat([
      base.subarray(0, 36),
      list,
      base.subarray(36),
    ]);

    expect(wavToPcm(withList)).toEqual(pcm);
  });

  it("не читает за пределы буфера, если размер чанка врёт (обрыв записи)", () => {
    const wav = pcmToWav(pcm, 8000);
    wav.writeUInt32LE(9999, 40); // data якобы длиннее файла

    expect(wavToPcm(wav)).toEqual(pcm);
  });

  it("отвергает файл без сигнатуры RIFF", () => {
    expect(() => wavToPcm(Buffer.alloc(64))).toThrow(/RIFF/);
  });

  it("отвергает WAV без чанка data", () => {
    const header = Buffer.alloc(12);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(4, 4);
    header.write("WAVE", 8, "ascii");

    expect(() => wavToPcm(header)).toThrow(/data/);
  });
});
