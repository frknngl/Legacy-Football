/**
 * HAKEM -- nitelikler, kokart hiyerarsisi ve maca etkisi.
 *
 * NEDEN DOMAIN:
 *   Hem `simulation` (atama, kart/penalti carpanlari) hem `runtime`
 *   (Hero'nun hakem hafizasi, kin) okuyor. Katman kurali
 *   `simulation -> runtime` importunu yasakladigi icin ortak sozlesme
 *   taban katmanda durmak zorunda.
 *
 * VERI KAYNAGI NOTU:
 *   Transfermarkt kaziminda hakem verisi YOK. Kulup ve oyuncudan farkli
 *   olarak hakemler TOHUMDAN uretilir (`tools/roster/pipeline/referees.ts`)
 *   ve `world.db`ye yazilir. Bu bilincli: hakem kadrosu dunyanin parcasidir,
 *   kariyerden bagimsizdir.
 */

import type { MatchImportance } from './match.js';

/**
 * Kokart -- hangi seviyedeki maci yonetebilir.
 *
 * Sira ONEMLI: `badgeRank` bu diziden turer ve atama algoritmasi
 * "en az su kokart" karsilastirmasini onunla yapar.
 */
export const REFEREE_BADGES = ['regional', 'national', 'elite', 'fifa'] as const;
export type RefereeBadge = (typeof REFEREE_BADGES)[number];

export function badgeRank(badge: RefereeBadge): number {
  return REFEREE_BADGES.indexOf(badge);
}

/**
 * Hakem nitelikleri (0-100).
 *
 * Hepsi maca somut bir sekilde giriyor; "sadece isimden ibaret olmasin"
 * gereksinimi tam olarak burada karsilaniyor.
 */
export interface RefereeAttributes {
  /** Faul calma esigi. Yuksek = her temasa duduk. */
  readonly strictness: number;
  /** Faulu KARTA cevirme egilimi. Sertlikten ayri: cok calip az kart veren hakem vardir. */
  readonly cardTendency: number;
  /** Kritik anda nokta gosterebilme cesareti. */
  readonly penaltyCourage: number;
  /** VAR'a gitme sikligi. */
  readonly varReliance: number;
  /** Dusukse mac ici kararlar savrulur -- ayni faule farkli tepki. */
  readonly consistency: number;
  /** 50 = notr. Ustu ev sahibine egilim. */
  readonly homeBias: number;
}

export interface Referee {
  readonly id: number;
  readonly name: string;
  readonly countryId: number | undefined;
  readonly badge: RefereeBadge;
  readonly attributes: RefereeAttributes;
  readonly reputation: number;
}

/**
 * Mac onemine gore GEREKEN en dusuk kokart.
 *
 * `referee_eligibility` tablosu bunu turnuva bazinda EZEBILIR; bu yalnizca
 * tablo bir sey soylemediginde kullanilan taban.
 */
export function requiredBadge(importance: MatchImportance, leagueLevel: number): RefereeBadge {
  switch (importance) {
    case 'national':
      return 'fifa';
    case 'european':
    case 'cup_final':
    case 'derby':
      return 'elite';
    case 'cup':
      return 'national';
    case 'league':
      return leagueLevel <= 1 ? 'national' : 'regional';
    default:
      return 'regional';
  }
}

// --------------------------------------------------------------- mac etkisi

/**
 * Tutarsizlik bandi -- ayni faule farkli tepki.
 *
 * `consistency` 100 ise carpan tam 1; 40 ise +/-%24 savrulur. Bu, "hakem
 * bugun kotu bir gununde" hissini uretir ve tek bir maca ozgudur.
 */
export function consistencyJitter(consistency: number, roll: number): number {
  const band = (100 - clamp(consistency, 0, 100)) / 250;
  return 1 + (roll * 2 - 1) * band;
}

/**
 * Faulun karta donusme carpani.
 *
 * Uc bilesenin carpimi: hakemin kart egilimi, ev sahibi kayirmasi ve o
 * macki tutarsizligi.
 */
export function cardFactor(
  referee: RefereeAttributes,
  isHomeOffender: boolean,
  roll: number,
): number {
  const tendency = 0.6 + clamp(referee.cardTendency, 0, 100) / 125; // 0.60 .. 1.40
  // homeBias 50 notr. 70 ise ev sahibine 0.6, deplasmana 1.4 carpan.
  const bias = isHomeOffender
    ? 2 - clamp(referee.homeBias, 0, 100) / 50
    : clamp(referee.homeBias, 0, 100) / 50;
  return tendency * bias * consistencyJitter(referee.consistency, roll);
}

/**
 * Ceza sahasindaki faulun penaltiya donusme olasiligi.
 *
 * Buyuk macta hakem nokta gostermekte daha cekingen -- gercek egilim.
 */
export function penaltyChance(
  referee: RefereeAttributes,
  importance: MatchImportance,
): number {
  const base = 0.35 + clamp(referee.penaltyCourage, 0, 100) / 250;
  const bigMatch = importance === 'cup_final' || importance === 'european' ? -0.08 : 0;
  return clamp(base + bigMatch, 0.05, 0.95);
}

/** VAR incelemesi olasiligi. */
export function varChance(referee: RefereeAttributes): number {
  return clamp(referee.varReliance, 0, 100) / 400; // 0 .. 0.25
}

/**
 * VAR incelemesi kararı DUZELTIR mi.
 *
 * Tutarli hakem VAR'a bakip dogru karara doner; tutarsiz hakem bakar ve yine
 * de yanlis karar verir. Bu, `var_controversial` momentinin gercek zeminidir.
 */
export function varCorrects(consistency: number): boolean {
  return consistency > 70;
}

// --------------------------------------------------------------- kin

/** Hero'nun bir hakemle gecmisi. Yalnizca Hero icin tutulur. */
export interface RefereeMemory {
  refereeId: number;
  matches: number;
  yellows: number;
  reds: number;
  penaltiesFor: number;
  penaltiesAgainst: number;
  /**
   * -100..+100. NEGATIFI SONUMLENMEZ -- `mem_*` izleriyle ayni ilke, tersine:
   * seni kiran hakemi sen unutmazsin.
   */
  grudge: number;
  lastMetTurn: number;
}

export function emptyRefereeMemory(refereeId: number, turn: number): RefereeMemory {
  return {
    refereeId,
    matches: 0,
    yellows: 0,
    reds: 0,
    penaltiesFor: 0,
    penaltiesAgainst: 0,
    grudge: 0,
    lastMetTurn: turn,
  };
}

/** Kin esikleri -- icerik ve moment frekansi bunlari okur. */
export const GRUDGE_HOSTILE = -40;
export const GRUDGE_FAVOURED = 30;

/**
 * Kinin kart olasiligina etkisi.
 *
 * Dusman hakem daha cabuk kart cikarir, kayiran hakem toleransli. Etki
 * DAR (+/-%25): hakem taraf tutar ama maci tek basina belirlemez.
 */
export function grudgeCardFactor(grudge: number): number {
  if (grudge <= GRUDGE_HOSTILE) return 1.25;
  if (grudge >= GRUDGE_FAVOURED) return 0.9;
  return 1;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
