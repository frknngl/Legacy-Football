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

/**
 * EPILOG KODASI -- kariyerin biraktigi izin sondaki karsiligi.
 *
 * NEDEN VAR: motor yirmi kadar `mem_*` izi yaziyordu (evlilik, ayrilik,
 * borsa vurgunu, turnuva sampiyonlugu, gol kralligi, kumar, rakibe
 * transfer) ve HICBIRI hicbir yerde okunmuyordu. Yani otuz sezonda
 * verdigin kararlarin cogu, kariyerin son ekraninda hic gorunmuyordu.
 *
 * Koda bunu tek noktada cozer: her sonlanma metnine, kosulu tutan
 * cumleler eklenir. On sekiz sonlanma x elli koda yazmak yerine
 * kodalar SONLANMADAN BAGIMSIZ durur ve hepsine uygulanir.
 *
 * `requires` bir OKUMADIR: `OrphanMemoryFlagRule` bunu sayar, yani bir
 * izin kodasi varsa o iz artik olu kelebek degildir.
 */
export interface EpilogueCoda {
  readonly id: string;
  readonly requires: Condition;
  /** Epiloga eklenecek cumle(ler). Enterpolasyon uygulanir. */
  readonly text: string;
  /** Buyuk olan once yazilir: evlilik, kumar borcundan onemlidir. */
  readonly priority: number;
}

/** Cozulmus sonlanma + doldurulmus epilog. */
export interface ResolvedEnding {
  readonly id: string;
  readonly title: string;
  readonly epilogue: string;
}
