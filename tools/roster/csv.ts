/**
 * RFC4180 CSV okuyucu -- AKISLI ve BASLIK DOGRULAYAN.
 *
 * NEDEN KENDI PARSER:
 *   Veride tirnakli ve virgul iceren alanlar var:
 *     "Korea, South"
 *     "J1 League - Second Stage ('93-'95,'97-'04,'15-'16)"
 *   `split(',')` bunlari sessizce bozar ve hata VERMEZ -- kulup yanlis ulkeye,
 *   turnuva yanlis isme baglanir. Sessiz bozulma en pahali bozulmadir.
 *
 * NEDEN AKISLI:
 *   `player_performances.csv` 157 MB, `transfer_history.csv` 81 MB (ikisi de
 *   Git LFS arkasinda). Tamamini belege almak bu iki dosyada kabul edilemez.
 *   Satir satir uretiriz; cagiran ne kadar tuketecegine kendi karar verir.
 *
 * NEDEN BASLIK DOGRULAMA:
 *   Reponun `README_data.md` dosyasi GUNCEL DEGIL -- dokumanda `Date of birth`
 *   yaziyor, dosyada `date_of_birth`; dokumanda 196.378 satir yaziyor, dosyada
 *   58.247. Bu yuzden beklenen kolonlar dokumandan DEGIL, calisma aninda
 *   dosyanin kendisinden dogrulanir. Kolon kaybolursa import BASLAMADAN durur.
 */

import { createReadStream } from 'node:fs';

/** Bir CSV satiri: kolon adi -> ham metin. Bos hucre '' olur, undefined degil. */
export type CsvRow = Readonly<Record<string, string>>;

export class CsvError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(`${file}: ${message}`);
    this.name = 'CsvError';
  }
}

/**
 * Ham metni RFC4180'e gore alanlara boler.
 *
 * Durum makinesi tirnak icini takip eder: tirnak icindeki virgul ve satir sonu
 * VERIDIR, ayirici degildir. Ikilenen tirnak ("") tek tirnak uretir.
 */
class RowSplitter {
  private field = '';
  private row: string[] = [];
  private inQuotes = false;
  /** Tirnak icinde bir tirnak gordukse: kapanis mi, kacis mi -- bir sonraki karakter soyler. */
  private quotePending = false;

  /** Bir metin parcasini yutar; tamamlanan satirlari doner. */
  push(chunk: string): string[][] {
    const done: string[][] = [];

    for (const ch of chunk) {
      if (this.quotePending) {
        this.quotePending = false;
        if (ch === '"') {
          // "" -> kacirilmis tirnak
          this.field += '"';
          continue;
        }
        this.inQuotes = false;
        // Devam et: bu karakter tirnak DISINDA islenecek.
      }

      if (this.inQuotes) {
        if (ch === '"') this.quotePending = true;
        else this.field += ch;
        continue;
      }

      if (ch === '"' && this.field === '') {
        this.inQuotes = true;
        continue;
      }
      if (ch === ',') {
        this.row.push(this.field);
        this.field = '';
        continue;
      }
      if (ch === '\n') {
        this.row.push(this.field);
        this.field = '';
        done.push(this.row);
        this.row = [];
        continue;
      }
      if (ch === '\r') continue; // CRLF -> LF
      this.field += ch;
    }

    return done;
  }

  /** Dosya sonu: yarim kalmis satir varsa onu da doner. */
  flush(): string[][] {
    if (this.field === '' && this.row.length === 0) return [];
    this.row.push(this.field);
    const last = this.row;
    this.row = [];
    this.field = '';
    return [last];
  }
}

export interface ReadOptions {
  /**
   * Bu kolonlarin VARLIGI zorunlu. Eksik olan varsa import baslamadan durur.
   * Fazladan kolon serbesttir -- kaynak yeni alan ekleyebilir, bu bizi bozmaz.
   */
  readonly requireColumns: readonly string[];
  /** Kac satir sonra dur (test ve onizleme icin). */
  readonly limit?: number;
}

/**
 * CSV dosyasini satir satir uretir.
 *
 * Baslik ilk satirdan okunur ve `requireColumns` ile dogrulanir. Kolon sayisi
 * basliktan farkli olan satirlar ATLANMAZ, hata olarak sayilir -- cagiran
 * `onMalformed` ile gorur. Sessizce atlamak veri kaybini gizler.
 */
export async function* readCsv(
  file: string,
  options: ReadOptions,
  onMalformed?: (line: number, got: number, want: number) => void,
): AsyncGenerator<CsvRow> {
  const splitter = new RowSplitter();
  const stream = createReadStream(file, { encoding: 'utf-8' });

  let header: string[] | undefined;
  let lineNo = 0;
  let emitted = 0;

  const handle = function* (rows: string[][]): Generator<CsvRow> {
    for (const cells of rows) {
      lineNo += 1;

      if (!header) {
        // BOM temizligi -- bazi disa aktarimlar dosyayi ﻿ ile baslatir.
        const first = cells[0] ?? '';
        header = [first.replace(/^﻿/, ''), ...cells.slice(1)];
        const missing = options.requireColumns.filter((c) => !header!.includes(c));
        if (missing.length > 0) {
          throw new CsvError(
            `beklenen kolonlar yok: ${missing.join(', ')}\n  bulunan: ${header.join(', ')}`,
            file,
          );
        }
        continue;
      }

      // Tamamen bos satir (dosya sonu newline) -- veri degil.
      if (cells.length === 1 && cells[0] === '') continue;

      if (cells.length !== header.length) {
        onMalformed?.(lineNo, cells.length, header.length);
        continue;
      }

      const row: Record<string, string> = {};
      for (let i = 0; i < header.length; i += 1) row[header[i]!] = cells[i] ?? '';
      yield row;
      emitted += 1;
    }
  };

  for await (const chunk of stream) {
    yield* handle(splitter.push(chunk as string));
    if (options.limit !== undefined && emitted >= options.limit) {
      stream.destroy();
      return;
    }
  }
  yield* handle(splitter.flush());
}

/** Kucuk dosyalari tek seferde okur. 26 MB'a kadar rahat; ustunu akisla isleyin. */
export async function readCsvAll(file: string, options: ReadOptions): Promise<CsvRow[]> {
  const rows: CsvRow[] = [];
  for await (const row of readCsv(file, options)) rows.push(row);
  return rows;
}

/** Bos hucreyi undefined'a cevirir -- '' ile 'deger yok' ayrimi icin. */
export function opt(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v === undefined || v === '' ? undefined : v;
}

/** Sayiya cevirir; bos ya da sayi olmayan icin undefined. */
export function num(value: string | undefined): number | undefined {
  const v = opt(value);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
