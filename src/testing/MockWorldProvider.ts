/**
 * Mock dunya saglayici -- veri dosyasi YOK, her sey kulup itibarindan turetilir.
 *
 * Puan durumu tohumlu bir sarsintiyla uretilir: guclu kulup genelde ustte biter
 * ama her sezon ayni sirayla degil. DB entegrasyonunda `DbWorldProvider` gercek
 * lig tablosunu doner; arayuz degismez.
 */

import { clubTierIndex, type ClubTier } from '../domain/axes.js';
import type { ClubInfo, StandingRow, WorldProvider } from '../domain/roster.js';
import { hashString } from '../evaluation/NameForge.js';
import { Rng } from '../selection/Rng.js';

/** Sohret yukseldikce kac kademe yukari transfer olabilirsin. */
const REACH_BY_STATURE: Readonly<Record<string, number>> = {
  nobody: 0,
  local_talent: 1,
  starter: 1,
  star: 2,
  superstar: 2,
  icon: 3,
  legend: 3,
};

export class MockWorldProvider implements WorldProvider {
  constructor(
    private readonly allClubs: readonly ClubInfo[],
    private readonly seed: number,
  ) {}

  standings(league: string): readonly StandingRow[] {
    const rng = new Rng((this.seed ^ hashString(`standings:${league}`)) >>> 0);
    return this.allClubs
      .filter((c) => c.league === league)
      .map((c) => ({ club: c, score: c.reputation + (rng.next() * 30 - 15) }))
      .sort((a, b) => b.score - a.score)
      .map((row, i) => ({
        clubId: row.club.id,
        position: i + 1,
        played: 34,
        points: Math.round(row.score),
      }));
  }

  clubsByTier(tier: ClubTier): readonly ClubInfo[] {
    return this.allClubs.filter((c) => c.tier === tier);
  }

  transferTargets(fromTier: ClubTier, stature: string): readonly ClubInfo[] {
    const reach = REACH_BY_STATURE[stature] ?? 0;
    const from = clubTierIndex(fromTier);
    return this.allClubs.filter((c) => {
      const delta = clubTierIndex(c.tier) - from;
      return delta >= -1 && delta <= reach;
    });
  }
}
