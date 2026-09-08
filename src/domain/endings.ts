/**
 * Sonlanma sistemi.
 *
 * Emeklilik tek bir ekran degildir. EndingResolver kosullara gore secer;
 * epilog metni flag'ler ve 4 kimlik ekseniyle doldurulur.
 */

import type { Condition } from './conditions.js';

export interface Ending {
  readonly id: string;
  readonly title: string;
  /** Enterpolasyonlu epilog metni: {servet}, {kupa_sayisi}, {cast.elif.name}... */
  readonly epilogue: string;
  readonly requires: Condition;
  /**
   * Cakisan kosullarda buyuk oncelik kazanir.
   * "Mahkum" sonu, "sessiz veda" sonundan once gelmelidir.
   */
  readonly priority: number;
}

/** Cozulmus sonlanma + doldurulmus epilog. */
export interface ResolvedEnding {
  readonly id: string;
  readonly title: string;
  readonly epilogue: string;
}
