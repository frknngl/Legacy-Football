/**
 * Dakika dakika mac akisi.
 *
 * Timeline SONUC URETMEZ; yalnizca "bu dakikada kim, ne tur bir pozisyon
 * buldu" sorusuna cevap verir. Pozisyonun gole donup donmedigi
 * `ChanceResolver`in isidir. Bu ayrim Flick Shoot'un girebilmesi icin sart:
 * mini-oyun sutu cozer, akisi degil.
 *
 * Tohumlu ve DETERMINISTIK: ayni tohum + ayni takimlar = ayni dakikalar.
 */

import type { ChanceKind } from '../domain/chance.js';
import type { Rng } from '../selection/Rng.js';
import type { TacticProfile } from './Tactics.js';
import type { TeamLines } from './TeamModel.js';

export type TimelineEventKind = 'chance' | 'foul' | 'injury_risk';

export interface TimelineEvent {
  readonly minute: number;
  readonly kind: TimelineEventKind;
  /** Pozisyonu bulan taraf. */
  readonly side: 'home' | 'away';
  /** `chance` icin pozisyonun turu. */
  readonly chanceKind?: ChanceKind;
  readonly distance?: number;
  readonly angle?: number;
  readonly pressure?: number;
}

export interface TimelineInput {
  readonly home: { readonly lines: TeamLines; readonly tactic: TacticProfile };
  readonly away: { readonly lines: TeamLines; readonly tactic: TacticProfile };
}

/** Ev sahibi avantaji -- gercek liglerde ~%55 puan payi uretir. */
const HOME_ADVANTAGE = 4;

/**
 * Dakika basina taban sans olasiligi.
 *
 * Gercek futbolda takim basina ~12 sut/mac duser; ortalama 0.11 xG ile bu
 * ~1.3 gol eder. 0.055 ile takim basina yalnizca 5 sut cikiyor ve maclar
 * 0.5 golde kaliyordu.
 */
const BASE_CHANCE_RATE = 0.132;

/** Acik oyun pozisyonlarinin tur dagilimi. */
const OPEN_PLAY_MIX: readonly { kind: ChanceKind; weight: number }[] = [
  { kind: 'open_play', weight: 46 },
  { kind: 'header', weight: 18 },
  { kind: 'long_range', weight: 16 },
  { kind: 'one_on_one', weight: 11 },
  { kind: 'free_kick', weight: 9 },
];

/**
 * 90 dakikalik akisi uretir.
 *
 * Iki takimin hat gucleri ve taktikleri, dakika basina sans olasiligini ve
 * pozisyonun kalitesini belirler. Guclu takim daha COK ve daha IYI pozisyon
 * bulur; ikisi ayri eksendir.
 */
export function buildTimeline(input: TimelineInput, rng: Rng): readonly TimelineEvent[] {
  const events: TimelineEvent[] = [];

  const homeAttack = input.home.lines.attack + HOME_ADVANTAGE;
  const awayAttack = input.away.lines.attack;

  // Hucum gucu ile rakip savunmasinin FARKI sans uretimini belirler.
  const homeEdge = (homeAttack - input.away.lines.defence) / 100;
  const awayEdge = (awayAttack - input.home.lines.defence) / 100;

  const homeRate =
    BASE_CHANCE_RATE * input.home.tactic.tempo * input.away.tactic.exposure * (1 + homeEdge);
  const awayRate =
    BASE_CHANCE_RATE * input.away.tactic.tempo * input.home.tactic.exposure * (1 + awayEdge);

  const foulRate =
    0.012 * ((input.home.lines.aggression + input.away.lines.aggression) / 100) *
    ((input.home.tactic.aggression + input.away.tactic.aggression) / 2);

  for (let minute = 1; minute <= 90; minute += 1) {
    // Son on dakika aciliyeti: geriye dusen taraf bilinmedigi icin iki tarafa
    // da uygulanir; maclarin son bolumu daha bol pozisyonlu olur.
    const urgency = minute > 80 ? 1.25 : 1;

    if (rng.next() < homeRate * urgency) {
      events.push(makeChance(minute, 'home', input.home.tactic, rng));
    }
    if (rng.next() < awayRate * urgency) {
      events.push(makeChance(minute, 'away', input.away.tactic, rng));
    }
    if (rng.next() < foulRate) {
      events.push({ minute, kind: 'foul', side: rng.next() < 0.5 ? 'home' : 'away' });
    }
    if (rng.next() < 0.0035) {
      events.push({ minute, kind: 'injury_risk', side: rng.next() < 0.5 ? 'home' : 'away' });
    }
  }

  return events.sort((a, b) => a.minute - b.minute);
}

function makeChance(
  minute: number,
  side: 'home' | 'away',
  tactic: TacticProfile,
  rng: Rng,
): TimelineEvent {
  const pick = rng.weighted(OPEN_PLAY_MIX, (m) => m.weight) ?? OPEN_PLAY_MIX[0]!;
  const kind = pick.kind;

  // Riskli taktik daha yakin ve daha temiz pozisyon uretir.
  const closeness = tactic.risk;
  const distance = geometryFor(kind, rng) / closeness;
  const angle = 12 + rng.next() * 60;
  const pressure = Math.max(0, Math.min(100, 30 + rng.next() * 60 - (closeness - 1) * 25));

  return { minute, kind: 'chance', side, chanceKind: kind, distance, angle, pressure };
}

function geometryFor(kind: ChanceKind, rng: Rng): number {
  switch (kind) {
    case 'one_on_one':
      return 8 + rng.next() * 6;
    case 'header':
      return 5 + rng.next() * 6;
    case 'long_range':
      return 24 + rng.next() * 12;
    case 'free_kick':
      return 18 + rng.next() * 10;
    default:
      return 9 + rng.next() * 10;
  }
}
