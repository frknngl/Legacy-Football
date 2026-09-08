/**
 * SORU SORUCU -- TTY'de de boruda da calisan.
 *
 * SORUN:
 *   `readline/promises`in `question()` metodu TTY DISINDA guvenilir degil.
 *   Boru (`printf ... | npm run play`), dosya yonlendirmesi ya da CI'da tum
 *   girdi tek seferde gelir; ilk soru cozulur, akis kapanir ve IKINCI soru
 *   sonsuza kadar bekler.
 *
 *   Tek soru varken gorunmuyordu. Kariyer basina "mevkin ne?" ve "ilk imzayi
 *   kime atiyorsun?" sorulari eklenince ortaya cikti.
 *
 * COZUM:
 *   TTY degilse girdinin TAMAMINI once oku, sorulari kuyruktan besle. Kuyruk
 *   bitince `:q` don -- betik yarim kalirsa oyun temiz kapansin, asili
 *   kalmasin.
 *
 * YAN FAYDA:
 *   `play` betikle surulebilir hale gelir. Bu yalnizca test kolayligi degil:
 *   CI'da bir kariyeri bastan sona oynatip cokme olmadigini dogrulamanin tek
 *   yolu budur.
 */

import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

export type Ask = (question: string) => Promise<string>;

export interface PromptHandle {
  readonly ask: Ask;
  close(): void;
}

/** Girdi bittiginde donulecek komut -- oyun temiz kapansin. */
const EXIT = ':q';

export async function createPrompt(
  input: Readable & { isTTY?: boolean },
  output: Writable,
): Promise<PromptHandle> {
  const interactive = input.isTTY === true;
  const rl = createInterface({ input, output });

  if (interactive) {
    return { ask: (q) => rl.question(q), close: () => rl.close() };
  }

  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(chunk as Buffer);
  const queue = splitLines(Buffer.concat(chunks).toString('utf-8'));

  const ask: Ask = async (question) => {
    const line = queue.shift() ?? EXIT;
    // Betik modunda da ekrana yaz: cikti gercek bir oturum gibi okunsun.
    output.write(`${question}${line}\n`);
    return line;
  };

  return { ask, close: () => rl.close() };
}

/** CRLF ve LF'i birlikte karsilar; sondaki bos satir atilir. */
export function splitLines(text: string): string[] {
  const lines = text.split(String.fromCharCode(10)).map((line) => {
    const last = line.charCodeAt(line.length - 1);
    return last === 13 ? line.slice(0, -1) : line;
  });
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
