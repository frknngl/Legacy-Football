/**
 * Icerik kaynagi soyutlamasi (DIP).
 *
 * Motor dosya sistemini BILMEZ. Node'da klasor taranir, tarayicida manifest
 * uzerinden fetch edilir; motor ikisini de ayni arayuzden gorur.
 *
 * SIFIR BUILD ADIMI: `content/events/` altina elle atilan bir .json dosyasi,
 * hicbir derleme/indeksleme olmadan bir sonraki calistirmada taninir.
 * 3-5 yil sonra JSON'lari atip calistirma sarti buradan gelir.
 */

export interface LoadedDocument {
  /** content/ koku baz alinmis goreli yol. Hata mesajlarinda gorunur. */
  readonly path: string;
  readonly data: unknown;
}

export interface ContentSource {
  readonly id: string;
  load(): Promise<LoadedDocument[]>;
}

/** Testler ve gomulu icerik icin bellek kaynagi. */
export class MemoryContentSource implements ContentSource {
  readonly id = 'memory';

  constructor(private readonly docs: readonly LoadedDocument[]) {}

  async load(): Promise<LoadedDocument[]> {
    return [...this.docs];
  }
}
