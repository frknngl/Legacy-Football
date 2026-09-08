/**
 * TRANSFER -- pencereler, degerleme ve teklif sozlesmesi.
 *
 * NEDEN DOMAIN:
 *   Degerleme hem `simulation` (NPC transferleri) hem ileride `runtime`
 *   (menajer teklifleri, Hero'nun piyasa degeri) tarafindan okunacak. Ortak
 *   matematik taban katmanda.
 *
 * NEDEN OVERLAY:
 *   `world.db` SALT OKUNUR ve kariyer boyunca degismez. Transfer ise kariyer
 *   durumudur. Bu yuzden transferler veritabanini DEGISTIRMEZ; uzerine bir
 *   ortu (`TransferOverlay`) serilir ve kadro sorgulari onu okur. Ayni
 *   world.db ile yirmi farkli kariyer oynanabilir.
 */

import type { Position } from './actors.js';

/** Transfer penceresi -- 40 haftalik sezonda iki tane. */
export interface TransferWindow {
  readonly kind: 'summer' | 'winter';
  readonly start: number;
  readonly end: number;
}

/**
 * Varsayilan pencereler.
 *
 * Yaz penceresi sezon basinda (1-3), kis penceresi ortada (20-22). Gercek
 * takvimde yaz penceresi sezon ONCESINDE acilir ama 40 haftalik model sezon
 * disini tasimadigi icin ilk uc hafta bu isi goruyor.
 */
export const DEFAULT_WINDOWS: readonly TransferWindow[] = [
  { kind: 'summer', start: 1, end: 3 },
  { kind: 'winter', start: 20, end: 22 },
];

export function windowAt(
  week: number,
  windows: readonly TransferWindow[] = DEFAULT_WINDOWS,
): TransferWindow | undefined {
  return windows.find((w) => week >= w.start && week <= w.end);
}

// --------------------------------------------------------------- degerleme

export interface ValuationInput {
  /** Kaynaktan gelen taban piyasa degeri. */
  readonly baseValue: number;
  readonly age: number;
  readonly overall: number;
  readonly potential: number;
  /** 0-100. Son maclarin reyting ortalamasi. */
  readonly form: number;
  /** Sozlesmesinin bitmesine kac sezon kaldi. */
  readonly seasonsLeft: number;
}

/**
 * Guncel piyasa degeri.
 *
 * Taban degeri dort eksende duzeltiyoruz. Hicbiri tek basina baskin degil;
 * carpimlari en fazla ~2.5x, en az ~0.25x eder.
 *
 * SOZLESME EN SERT ETKI:
 *   Sozlesmesi biten oyuncu bedava gider. Son yilinda degeri yariya iner --
 *   gercek piyasanin en gorunur kurali ve "sat ya da kaybet" baskisini
 *   ureten sey.
 */
export function valuePlayer(input: ValuationInput): number {
  const base = Math.max(10_000, input.baseValue);

  // Yas: 24-27 zirve. Gencte potansiyel primi, yaslida sert dusus.
  const age =
    input.age <= 21
      ? 1 + (input.potential - input.overall) * 0.02
      : input.age <= 27
        ? 1
        : Math.max(0.2, 1 - (input.age - 27) * 0.13);

  // Form: +/-%25 bant.
  const form = 0.75 + (Math.max(0, Math.min(100, input.form)) / 100) * 0.5;

  // Sozlesme: son yil yarim fiyat, uzun sozlesme prim.
  const contract =
    input.seasonsLeft <= 0
      ? 0.15
      : input.seasonsLeft === 1
        ? 0.5
        : Math.min(1.15, 0.8 + input.seasonsLeft * 0.1);

  return Math.round(base * age * form * contract);
}

/**
 * Satis fiyati -- kulubun oyuncuyu TUTMA istegi primi.
 *
 * Kadrosunun en iyisini satmak istemeyen kulup fahis fiyat ister; yedek
 * oyuncu icin piyasa degerine razi olur. Bu, "para verirsen herkesi alirsin"
 * durumunu engelleyen tek mekanizma.
 */
export function askingPrice(value: number, keepDesire: number, toRival = false): number {
  // keepDesire 0-100. 0 -> %85 (satmak istiyor), 100 -> %220 (satmak istemiyor)
  const premium = 0.85 + (Math.max(0, Math.min(100, keepDesire)) / 100) * 1.35;
  // EZELI RAKIP PRIMI: gercek futbolda kulup en buyuk rakibine oyuncu SATMAZ.
  // Satarsa da fahis fiyata ve taraftar ayaklanir. Bu carpan olmadan piyasa
  // "en iyi teklif kazanir"a doner ve derbi anlamini yitirir.
  return Math.round(value * premium * (toRival ? RIVAL_PREMIUM : 1));
}

/**
 * Ezeli rakibe satis carpani.
 *
 * 2.2 kasitli olarak SERT: rakibe transfer imkansiz degil ama olaganustu
 * olmali. Bu deger dusuk olsaydi ("1.3" gibi) zengin kulup rakibinin
 * yildizini rutin olarak alirdi; cok yuksek olsaydi ("5") hic olmazdi ve
 * anlati firsati kaybolurdu. Nadir ama mumkun -- dogru yer burasi.
 */
export const RIVAL_PREMIUM = 2.2;

// --------------------------------------------------------------- transfer

export interface Transfer {
  readonly week: number;
  readonly playerId: number;
  readonly fromClubId: string;
  readonly toClubId: string;
  readonly fee: number;
  readonly position: Position;
  /** Oyuncunun o anki gucu -- rapor ve anlati icin. */
  readonly overall: number;
  /**
   * EZELI RAKIBE transfer mi.
   *
   * Anlatinin en degerli tetigi: taraftar ihaneti, soyunma odasi tepkisi,
   * ilk derbide islik. Bayrak burada tasinir ki icerik `mem_*` izine
   * cevirebilsin.
   */
  readonly toRival?: boolean;
}

/**
 * TRANSFER ORTUSU -- world.db'nin uzerine serilen kariyer durumu.
 *
 * `playerId -> clubId`. Bos ortu = kaynak veriyle birebir dunya.
 */
export class TransferOverlay {
  private readonly moved = new Map<number, string>();
  private readonly history: Transfer[] = [];

  clubOf(playerId: number, original: string | undefined): string | undefined {
    return this.moved.get(playerId) ?? original;
  }

  apply(transfer: Transfer): void {
    this.moved.set(transfer.playerId, transfer.toClubId);
    this.history.push(transfer);
  }

  /** Bu kulube gelen ve bu kulupten giden oyuncular. */
  movesFor(clubId: string): { in: Transfer[]; out: Transfer[] } {
    return {
      in: this.history.filter((t) => t.toClubId === clubId),
      out: this.history.filter((t) => t.fromClubId === clubId),
    };
  }

  all(): readonly Transfer[] {
    return this.history;
  }

  get size(): number {
    return this.moved.size;
  }
}
