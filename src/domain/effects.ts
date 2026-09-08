/**
 * Efektler: bir secimin dunyayi degistirme bicimi.
 */

import type { ClubTier, Stature } from './axes.js';

/**
 * Olceklenen deger -- icerik cogaltmadan derinlik.
 *
 * Ayni rusvet olayi 2. Lig'de 10.000 TL, ikon seviyesinde 730.000 TL eder.
 * Tek dosya, 7 seviye. Ayni senaryonun 5 kopyasini yazma ihtiyaci ortadan kalkar.
 *
 *   deger = base + perTier * eksenIndeksi
 */
export interface ScalableValue {
  readonly scaleBy: 'stature' | 'clubTier' | 'season';
  readonly base: number;
  readonly perTier: number;
  /** Opsiyonel guvenlik siniri -- ScalableValueRule bunlari denetler. */
  readonly clampMin?: number;
  readonly clampMax?: number;
}

export function isScalableValue(v: unknown): v is ScalableValue {
  return typeof v === 'object' && v !== null && 'scaleBy' in v && 'base' in v && 'perTier' in v;
}

/**
 * BAYRAKTAN OKUNAN DEGER -- efektin buyuklugu OYUN SIRASINDA belli olur.
 *
 * NEDEN GEREKLI (olculdu): efekt degerleri ya sabitti ya da `ScalableValue`
 * ile yalnizca `stature`/`clubTier`/`season` eksenlerinde olcekleniyordu.
 * Yani "yatirdigin kadar kaybet" cumlesi efekt dilinde KURULAMIYORDU --
 * cunku yatirilan miktari oyuncu secer, yazar degil.
 *
 * Bu tek ilkel yalnizca kumari acmiyor:
 *   { "flag": "servet", "op": "add",
 *     "value": { "ref": "son_bahis_tutari", "mul": 35 } }   <- 35'e 1 rulet
 *   { "ref": "kredi_taksit", "mul": -1 }                     <- kredi taksiti
 *   { "ref": "haftalik_gelir", "mul": 4 }                    <- bir aylik prim
 *   { "ref": "borc", "mul": -0.5 }                           <- borcun yarisi
 *
 * Deger: `flags[ref] * (mul ?? 1) + (add ?? 0)`, sonra kirpma.
 *
 * Okunan bayrak sayisal olmalidir; tanimsiz ya da sayisal olmayan bir
 * referans `0` verir ve `ValueRefRule` bunu build zamaninda hata olarak
 * yakalar -- sessiz sifir en kotu sonuc olurdu.
 */
export interface ValueRef {
  readonly ref: string;
  readonly mul?: number;
  readonly add?: number;
  readonly clampMin?: number;
  readonly clampMax?: number;
}

export function isValueRef(v: unknown): v is ValueRef {
  return typeof v === 'object' && v !== null && 'ref' in v;
}

export type EffectValue = number | boolean | string | ScalableValue | ValueRef;

export const FLAG_EFFECT_OPS = ['set', 'add', 'mul', 'unset'] as const;
export type FlagEffectOp = (typeof FLAG_EFFECT_OPS)[number];

/** Bir flag'i degistiren efekt. */
export interface FlagEffect {
  readonly flag: string;
  readonly op: FlagEffectOp;
  readonly value?: EffectValue;
}

/**
 * Zamanlanmis olay efekti.
 *
 * priority "forced" agirlikli secimi BYPASS eder:
 * "TFF'ye salladin, 2 hafta sonra PFDK'dasin."
 * PFDK sevki kacinilmaz olmali; sansa birakilamaz.
 */
export interface ScheduleEffect {
  readonly op: 'schedule';
  readonly event: string;
  readonly inTurns: number;
  readonly priority: 'forced' | 'weighted';
  /**
   * Vade geldiginde olay uygun degilse (ornegin oyuncu hapse girdi) ne olacak?
   *  - defer  : uygun olana kadar ertele (varsayilan), maxDeferTurns ile sinirli
   *  - fire   : uygunluk kapilarini yok say, yine de calistir
   *  - cancel : iptal et -- bu durumda replaceWith ZORUNLUDUR,
   *             boylece hikaye ipi sessizce kopmaz
   */
  readonly onIneligible?: 'defer' | 'fire' | 'cancel';
  readonly maxDeferTurns?: number;
  readonly replaceWith?: string;
}

/** Hayat durumunu degistiren efekt (hapis, rehab, kiralik...). */
export interface LifeStateEffect {
  readonly op: 'lifeState';
  readonly to: string;
  /** Kac tur surecek? Verilmezse suresiz (baska bir olay cikarana kadar). */
  readonly forTurns?: number;
}

/**
 * Kulup seviyesini degistirir (transfer, kume dusme, tahliye sonrasi dusus).
 *
 * `club_tier` turetilmis bir degerdir ve icerik ona DOGRUDAN yazamaz; bu gecis
 * motorun sahibi oldugu bir olaydir. Icerik onu ancak bu efektle TALEP eder --
 * `lifeState` ve `suspend` ile ayni desen.
 */
export interface ClubTierEffect {
  readonly op: 'clubTier';
  readonly to: string;
}

/** Oyuncuyu N mac cezali yapar; motor host'a PlayerAvailability bildirir. */
export interface SuspendEffect {
  readonly op: 'suspend';
  readonly matches: number;
  readonly reason: string;
}

/**
 * MAC SOZLESMESININ GERI DONUS AYAGI.
 *
 * Oyuncunun mac ici karari skoru GERCEKTEN degistirir. Bu efekt motorun
 * host'a donduracegi `MatchOutcomeDelta’ya birikir; host onu skora uygular.
 *
 * Motor yoktan gol icat etmez: bu efekt yalnizca host'un sundugu bir
 * `PendingMoment’e karsilik gelen olay icinde anlamlidir.
 */
export interface MatchDeltaEffect {
  readonly op: 'match';
  readonly goals?: number;
  readonly assists?: number;
  readonly yellowCards?: number;
  readonly redCard?: boolean;
  readonly injuryWeeks?: number;
  readonly rating?: number;
  /** Mac sonrasi acilacak `inc_*` flag'i -- roportaj penceresini acar. */
  readonly incident?: string;
}

export type Effect =
  | FlagEffect
  | ScheduleEffect
  | LifeStateEffect
  | SuspendEffect
  | ClubTierEffect
  | MatchDeltaEffect;

export function isFlagEffect(e: Effect): e is FlagEffect {
  return 'flag' in e;
}

export function isScheduleEffect(e: Effect): e is ScheduleEffect {
  return 'op' in e && e.op === 'schedule';
}

export function isLifeStateEffect(e: Effect): e is LifeStateEffect {
  return 'op' in e && e.op === 'lifeState';
}

export function isSuspendEffect(e: Effect): e is SuspendEffect {
  return 'op' in e && e.op === 'suspend';
}

export function isClubTierEffect(e: Effect): e is ClubTierEffect {
  return 'op' in e && e.op === 'clubTier';
}

export function isMatchDeltaEffect(e: Effect): e is MatchDeltaEffect {
  return 'op' in e && e.op === 'match';
}

/** ScalableValueResolver icin gereken baglam. */
export interface ScaleContext {
  readonly stature: Stature;
  readonly clubTier: ClubTier;
  readonly season: number;
}
