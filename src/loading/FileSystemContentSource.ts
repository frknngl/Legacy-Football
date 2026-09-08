/**
 * Dosya sistemi icerik kaynagi.
 *
 * `content/` altini ozyinelemeli tarar. Manifest/index dosyasina IHTIYAC DUYMAZ --
 * eski sistemin elle yazilan `index.json` listesi tam da bu yuzden bir hata
 * kaynagiydi (yeni dosya eklenip listeye yazilmayinca sessizce yok sayiliyordu).
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import { ContentError } from '../domain/errors.js';
import type { ContentSource, LoadedDocument } from './ContentSource.js';

export class FileSystemContentSource implements ContentSource {
  readonly id: string;

  constructor(private readonly rootDir: string) {
    this.id = `fs:${rootDir}`;
  }

  async load(): Promise<LoadedDocument[]> {
    const files = await this.walk(this.rootDir);
    const docs: LoadedDocument[] = [];
    for (const file of files.sort()) {
      const relPath = relative(this.rootDir, file).split(sep).join(posix.sep);
      const text = await readFile(file, 'utf-8');
      try {
        docs.push({ path: relPath, data: JSON.parse(text) });
      } catch (err) {
        throw new ContentError(
          `Gecersiz JSON: ${(err as Error).message}`,
          relPath,
        );
      }
    }
    return docs;
  }

  private async walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await this.walk(full)));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        out.push(full);
      }
    }
    return out;
  }
}
