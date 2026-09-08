/**
 * Puan durumunu OYNANAN maclardan doner.
 *
 * `MockWorldProvider` tabloyu kulup itibarindan TURETIYORDU: her sezon aynı
 * siralama, oynanan maclarla ilgisiz. Bu surum `LeagueModel`in canli tablosunu
 * okur, dolayisiyla `{world.title_race_leader}` gibi tokenler gercek bir
 * sampiyonluk yarisini anlatir.
 *
 * `MockWorldFeed` degismeden calisir: o zaten `world.standings()` okuyordu.
 */

import { clubTierIndex, type ClubTier } from '../domain/axes.js';
import type { ClubInfo, StandingRow, WorldProvider } from '../domain/roster.js';
import type { LeagueModel } from './LeagueModel.js';

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

export class SimulatedWorldProvider implements WorldProvider {
  constructor(private readonly league: LeagueModel) {}

  standings(league: string): readonly StandingRow[] {
    return this.league.standings(league);
  }

  clubsByTier(tier: ClubTier): readonly ClubInfo[] {
    return this.league.clubs().filter((c) => c.tier === tier);
  }

  transferTargets(fromTier: ClubTier, stature: string): readonly ClubInfo[] {
    const reach = REACH_BY_STATURE[stature] ?? 0;
    const from = clubTierIndex(fromTier);
    return this.league.clubs().filter((c) => {
      const delta = clubTierIndex(c.tier) - from;
      return delta >= -1 && delta <= reach;
    });
  }
}
