/**
 * Taktik profili -- tempo ve risk.
 *
 * Taktik skoru DOGRUDAN belirlemez; hucum/savunma agirliklarini kaydirir.
 * Defansif bir takim daha az sans uretir ama daha az da yer: toplam gol duser,
 * surpriz olasiligi artar. Amator bir kulubun elit bir kulube sans tanimasi
 * tam olarak buradan gelir.
 */

export const TACTIC_STYLES = ['attacking', 'balanced', 'defensive'] as const;
export type TacticStyle = (typeof TACTIC_STYLES)[number];

export interface TacticProfile {
  readonly style: TacticStyle;
  /** Dakika basina sans uretme egilimi. */
  readonly tempo: number;
  /** Kendi sanslarinin kalitesi (yuksek risk = daha iyi pozisyon, daha cok bosluk). */
  readonly risk: number;
  /** Rakibe verilen alan. 1'in ustu = daha cok yer. */
  readonly exposure: number;
  /** Faul egilimi -- kart ve sakatlik uretimini besler. */
  readonly aggression: number;
}

const PROFILES: Readonly<Record<TacticStyle, TacticProfile>> = {
  attacking: { style: 'attacking', tempo: 1.25, risk: 1.15, exposure: 1.3, aggression: 0.95 },
  balanced: { style: 'balanced', tempo: 1, risk: 1, exposure: 1, aggression: 1 },
  defensive: { style: 'defensive', tempo: 0.72, risk: 0.85, exposure: 0.62, aggression: 1.15 },
};

export function tacticProfile(style: TacticStyle): TacticProfile {
  return PROFILES[style];
}

/**
 * Bir kulubun varsayilan taktigi: zayif takim kapanir, guclu takim yuklenir.
 *
 * `strengthGap` = kendi gucu - rakip gucu (yaklasik -60..+60).
 */
export function defaultTactic(strengthGap: number): TacticStyle {
  if (strengthGap <= -12) return 'defensive';
  if (strengthGap >= 12) return 'attacking';
  return 'balanced';
}
