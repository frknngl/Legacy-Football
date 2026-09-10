/**
 * DUNYA SECICI -- mock mu, gercek mi.
 *
 * Katman notu: bu dosya `cli` altinda, cunku iki kompozisyon kokunu
 * (`testing/simulatedWorld` ve `adapters/dbWorld`) birlestiren tek yer CLI'dir.
 * `adapters`in `testing`i, `testing`in `adapters`i import etmesi yon kuralini
 * tersine cevirirdi.
 *
 * Ikisi de ayni yuzeyi doldurur: motor hangisiyle calistigini BILMEZ.
 */

import type { ContentRegistry } from '../loading/ContentRegistry.js';
import type {
  HeroProfile,
  MatchContext,
  MatchImportance,
  PlayerAvailability,
} from '../domain/match.js';
import type { RosterProvider, WorldFeed, WorldProvider } from '../domain/roster.js';
import type { LeagueModel } from '../simulation/LeagueModel.js';
import type { MatchSimulator } from '../simulation/MatchSimulator.js';
import type { SeasonSchedule } from '../domain/calendar.js';
import { createSimulatedWorld } from '../testing/simulatedWorld.js';
import { createDbWorld } from '../adapters/dbWorld.js';

/** Motorun bir dunyadan bekledigi her sey. */
export interface GameWorld {
  readonly roster: RosterProvider;
  readonly world: WorldProvider;
  readonly worldFeed: WorldFeed;
  readonly league: LeagueModel;
  readonly simulator: MatchSimulator;
  readonly schedule: SeasonSchedule;
  leagueContextForClub(clubId: string):
    | {
        readonly position: number;
        readonly size: number;
        readonly relegationLine: number;
        readonly inRelegationZone: boolean;
      }
    | undefined;
  /**
   * Haftayi ilerletir ve HERO'NUN KULUBUNUN bu hafta kazandigi kupalari
   * dondurur.
   *
   * Eskiden `void` idi ve `SeasonRunner`in zaten urettigi sampiyon
   * bilgisi atiliyordu. Sonuc: `kupa_sayisi` her kariyerde 0 kaldi --
   * oysa stature formulunde agirligi 25, en agiri. Uc kademe
   * (`superstar` 330, `icon` 460, `legend` 620) normal oyunda
   * ULASILAMAZ hale gelmisti ve o kademelere kapili icerik hic
   * cikmiyordu.
   */
  advanceWeek(week: number, heroClubId: string): readonly string[];
  recordHeroMatch(): void;
  finishSeason(): ReturnType<LeagueModel['finishSeason']>;
  /** Gercek dunyada veritabanini kapatir; mock'ta bir sey yapmaz. */
  close?(): void;

  /**
   * MILLI TAKIM -- yalnizca gercek dunyada var.
   *
   * Mock dunyada uyruk verisi yok (kadrolar tohumdan uretiliyor), bu yuzden
   * opsiyonel. Cagiran varligini kontrol eder; olmadiginda milli ara sadece
   * bos bir hafta olur -- zarif bozulma.
   */
  countryOfClub?(clubId: string): number | undefined;
  calledUp?(countryId: number | undefined, quality: number): boolean;
}

export interface WorldChoice {
  readonly registry: ContentRegistry;
  readonly seed: number;
  readonly heroName?: string;
  /** Bos ise mock dunya kullanilir. */
  readonly dbPath?: string;
  readonly contentDir?: string;
}

export async function selectWorld(choice: WorldChoice): Promise<GameWorld> {
  if (choice.dbPath !== undefined && choice.dbPath !== '') {
    return createDbWorld({
      dbPath: choice.dbPath,
      registry: choice.registry,
      seed: choice.seed,
      ...(choice.heroName === undefined ? {} : { heroName: choice.heroName }),
    });
  }
  return createSimulatedWorld(
    choice.contentDir ?? 'content',
    choice.registry,
    choice.seed,
    choice.heroName ?? 'Sen',
  );
}

/** CLI ciktisinin ust satiri -- hangi dunyada oynadigimiz gorunur olmali. */
export function describeWorld(world: GameWorld, dbPath?: string): string {
  const clubs = world.roster.clubs().length;
  const source = dbPath !== undefined && dbPath !== '' ? dbPath : 'mock (content/mock/clubs.json)';
  return `${source} | ${clubs} kulup`;
}

export interface WeeklySelectionContextInput {
  readonly season: number;
  readonly week: number;
  readonly clubId: string;
  readonly availability: PlayerAvailability;
  readonly hero: HeroProfile;
}

const MATCH_IMPORTANCE_PRIORITY: Readonly<Record<MatchImportance, number>> = {
  cup_final: 6,
  european: 5,
  derby: 4,
  cup: 3,
  league: 2,
  national: 1,
};

function primaryFixtureSlot(schedule: SeasonSchedule, clubId: string, week: number): number | undefined {
  const fixtures = schedule.fixturesFor(clubId, week);
  if (fixtures.length === 0) return undefined;

  let best = 0;
  let score = -1;
  for (let i = 0; i < fixtures.length; i += 1) {
    const weight = MATCH_IMPORTANCE_PRIORITY[fixtures[i]!.importance] ?? 0;
    if (weight > score) {
      score = weight;
      best = i;
    }
  }
  return best;
}

/**
 * Haftalik secimden once kullanilan "yaklasan mac" baglami.
 *
 * Ayni haftada birden fazla fikstur varsa en yuksek onemdeki mac secilir.
 */
export function weeklySelectionMatchContext(
  world: GameWorld,
  input: WeeklySelectionContextInput,
): MatchContext | undefined {
  const slot = primaryFixtureSlot(world.schedule, input.clubId, input.week);
  if (slot === undefined) return undefined;

  const preview = world.simulator.previewContext({
    availability: input.availability,
    season: input.season,
    week: input.week,
    heroClubId: input.clubId,
    hero: input.hero,
    slot,
  });
  if (preview) return preview;

  // Zarif bozulma: simulator preview veremezse asgari baglami elle kur.
  const fixture = world.schedule.fixturesFor(input.clubId, input.week)[slot];
  if (!fixture) return undefined;
  const opponentId = fixture.homeId === input.clubId ? fixture.awayId : fixture.homeId;
  const table = world.leagueContextForClub(input.clubId);
  const teamContext =
    table === undefined
      ? {}
      : {
          teamLeaguePosition: table.position,
          teamLeagueSize: table.size,
          teamRelegationLine: table.relegationLine,
          teamInRelegationZone: table.inRelegationZone,
        };

  return {
    opponentName: world.roster.club(opponentId)?.name ?? '',
    importance: fixture.importance,
    isStarter: input.availability.available,
    ...teamContext,
  };
}
