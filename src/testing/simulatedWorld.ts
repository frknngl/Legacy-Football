/**
 * Simule edilen dunya -- tek cagriyla kadro + lig + fikstur + simulator.
 *
 * `createMockWorld`dan farki: puan durumu kulup itibarindan TURETILMEZ,
 * oynanan maclardan olusur. Hero'nun maci dakika dakika simule edilir, ayni
 * haftanin diger fiksturleri `LeagueModel` tarafindan ucuz cozulur.
 *
 * KOMPOZISYON KOKU: `simulation` katmani motoru bilmez, `runtime` simulasyonu
 * bilmez. Ikisini burada -- ve yalnizca burada -- birlestiriyoruz.
 */

import type { ContentRegistry } from '../loading/ContentRegistry.js';
import type { RosterProvider, WorldFeed, WorldProvider } from '../domain/roster.js';
import { Rng } from '../selection/Rng.js';
import { LeagueModel } from '../simulation/LeagueModel.js';
import { MatchSimulator } from '../simulation/MatchSimulator.js';
import { buildSeasonSchedule, type SeasonSchedule } from '../simulation/SeasonCalendar.js';
import { SimulatedWorldProvider } from '../simulation/SimulatedWorldProvider.js';
import { loadMockClubs, loadMockLeagues } from './loadMockClubs.js';
import { MockRosterProvider } from './MockRosterProvider.js';
import { MockWorldFeed } from './MockWorldFeed.js';

export interface SimulatedWorld {
  readonly roster: RosterProvider;
  readonly world: WorldProvider;
  readonly worldFeed: WorldFeed;
  readonly league: LeagueModel;
  readonly simulator: MatchSimulator;
  readonly schedule: SeasonSchedule;
  /** Takimin canli lig baglami (sira, lig buyuklugu, dusme hatti). */
  leagueContextForClub(clubId: string):
    | {
        readonly position: number;
        readonly size: number;
        readonly relegationLine: number;
        readonly inRelegationZone: boolean;
      }
    | undefined;
  /** Hero'nun maci disindaki fiksturleri cozer ve tabloya isler. */
  advanceWeek(week: number, heroClubId: string): readonly string[];
  /** Hero'nun macinin skorunu tabloya isler. */
  recordHeroMatch(): void;
  /** Sezonu kapatir: sampiyon, yukselme, dusme. */
  finishSeason(): ReturnType<LeagueModel['finishSeason']>;
}

export async function createSimulatedWorld(
  contentDir: string,
  registry: ContentRegistry,
  seed: number,
  heroName = 'Sen',
): Promise<SimulatedWorld> {
  const clubs = await loadMockClubs(contentDir);
  const leagues = await loadMockLeagues(contentDir);

  const roster = new MockRosterProvider({
    clubs,
    names: registry.names,
    slots: [...registry.slots.values()],
    seed,
  });

  const schedule = buildSeasonSchedule({ weeks: 40, clubs, leagues }, new Rng(seed));
  const league = new LeagueModel(clubs, leagues);
  const relegatedByLeague = new Map(leagues.map((l) => [l.id, Math.max(0, l.relegated)]));
  const leagueContextForClub = (clubId: string):
    | {
        readonly position: number;
        readonly size: number;
        readonly relegationLine: number;
        readonly inRelegationZone: boolean;
      }
    | undefined => {
    const leagueId = league.leagueFor(clubId) ?? roster.club(clubId)?.league;
    if (!leagueId) return undefined;
    const table = league.standings(leagueId);
    if (table.length === 0) return undefined;
    const row = table.find((r) => r.clubId === clubId);
    if (!row) return undefined;
    const size = table.length;
    const relegated = relegatedByLeague.get(leagueId) ?? 0;
    const relegationLine = relegated > 0 ? Math.max(1, size - relegated + 1) : size + 1;
    return {
      position: row.position,
      size,
      relegationLine,
      inRelegationZone: relegated > 0 && row.position >= relegationLine,
    };
  };
  const simulator = new MatchSimulator({
    clubs,
    squadOf: (id) => roster.squad(id),
    schedule,
    seed,
    heroName,
    tableContextForClub: leagueContextForClub,
  });

  const world = new SimulatedWorldProvider(league);
  // Diger fiksturlerin cozumu icin ayri bir RNG akisi: mac simulasyonunun
  // determinizmini bozmasin.
  const leagueRng = new Rng((seed ^ 0x9e3779b9) >>> 0);

  return {
    roster,
    world,
    worldFeed: new MockWorldFeed(world, clubs, seed),
    league,
    simulator,
    schedule,
    leagueContextForClub,
    advanceWeek: (week, heroClubId) => {
      league.playWeek(schedule.byWeek(week), heroClubId, leagueRng);
      // Mock dunyada kupa yok: tek lig var, sezon sonu `finishSeason`
      // ile kapaniyor ve turnuva katmani hic kurulmuyor. Bos donmek
      // dogru -- uydurma kupa vermek stature'i yalanci sisirir.
      return [];
    },
    recordHeroMatch: () => {
      const fixture = simulator.currentFixture();
      const score = simulator.finalScore();
      if (fixture && score) {
        league.record(fixture, { homeGoals: score.homeGoals, awayGoals: score.awayGoals });
      }
    },
    finishSeason: () => {
      simulator.resetSeason();
      return league.finishSeason();
    },
  };
}
