/**
 * SANS COZUCU PORTU -- Flick Shoot'un girecegi delik.
 *
 * Simulator bir sut pozisyonu urettiginde sonucu KENDI hesaplamaz; bu porta
 * sorar. Bugun matematiksel bir model cevap veriyor (`MathChanceResolver`),
 * yarin oyuncunun parmagiyla oynadigi bir mini-oyun cevap verecek
 * (`InteractiveChanceResolver`). Ikisi de ayni sozlesmeyi doldurur ve
 * SIMULATOR TEK SATIR DEGISMEZ.
 *
 * `RollResolver` ile karistirilmamali: o, hikaye `roll` node'larini cozer ve
 * `runtime`da yasar. Bu, sut fizigini cozer ve `simulation`da yasar. Iki ayri
 * eksen, iki ayri katman.
 */

/** Pozisyonun turu -- mesafe ve aci varsayilanlarini belirler. */
export const CHANCE_KINDS = [
  'open_play',
  'one_on_one',
  'penalty',
  'free_kick',
  'header',
  'long_range',
  'rebound',
] as const;
export type ChanceKind = (typeof CHANCE_KINDS)[number];

export const CHANCE_OUTCOMES = ['goal', 'saved', 'off_target', 'blocked', 'rebound'] as const;
export type ChanceOutcome = (typeof CHANCE_OUTCOMES)[number];

/** Sutoru tanimlayan asgari bilgi. Cozucu kimligi degil YETENEGI bilir. */
export interface ShooterProfile {
  readonly shooting: number;
  readonly composure: number;
  /** Hero mu, yoksa takim arkadasi mi -- etkilesimli cozucu buna bakar. */
  readonly isHero: boolean;
}

export interface ChanceContext {
  readonly kind: ChanceKind;
  readonly minute: number;
  /** Sut anindaki skor, "1-0" bicimi. Baski hesabina girer. */
  readonly scoreline: string;
  /** Kaleye uzaklik (metre). */
  readonly distance: number;
  /** Kale agzinin gorunen acisi (derece, 0-90). Dar aci = zor gol. */
  readonly angle: number;
  /** Uzerindeki baski (0-100). */
  readonly pressure: number;
  readonly keeperQuality: number;
  readonly shooter: ShooterProfile;
  readonly importance: string;
}

export interface ChanceResult {
  readonly outcome: ChanceOutcome;
  /** Pozisyonun gol beklentisi (0-1). Rapor ve test bunun uzerinden olculur. */
  readonly xG: number;
  /** Sutorun mac reytingine katki. */
  readonly playerRating?: number;
}

/**
 * `roll` [0,1) araligindan gelir ve DISARIDAN verilir.
 *
 * Cozucunun kendi RNG'si YOKTUR: tohumlu determinizm simulatorun elinde kalir,
 * boylece ayni tohum ayni maci uretir ve etkilesimli cozucu de ayni yere
 * takilir.
 */
export interface ChanceResolver {
  resolve(context: ChanceContext, roll: number): ChanceResult;
}
