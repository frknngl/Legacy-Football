/**
 * GERCEK DUNYA -- world.db'den kadro + lig + takvim + simulator.
 *
 * `testing/simulatedWorld.ts`in birebir karsiligi; tek fark verinin nereden
 * geldigi. Ikisi de ayni arayuzu doldurdugu icin CLI'lar tek satirla gecis
 * yapar ve motorun hicbir katmani degismez.
 *
 * KOMPOZISYON KOKU:
 *   `simulation` motoru bilmez, `runtime` simulasyonu bilmez. Ikisini burada
 *   -- ve yalnizca burada -- birlestiriyoruz. `testing/simulatedWorld.ts` ile
 *   ayni desen.
 *
 * TAKVIM FARKI (onemli):
 *   Mock dunyada mac sayisi cift devre VARSAYILIR. Burada `competition`
 *   tablosundaki `matches_per_club` OKUNUR ve takvime acikca gecilir --
 *   Premier League 38, Championship 46, Super Lig 36. Bu, gercek veriyle
 *   calismanin tek sebebi.
 */

import type { ContentRegistry } from '../loading/ContentRegistry.js';
import type { RosterProvider, WorldFeed, WorldProvider } from '../domain/roster.js';
import { Rng } from '../selection/Rng.js';
import { LeagueModel } from '../simulation/LeagueModel.js';
import { MatchSimulator } from '../simulation/MatchSimulator.js';
import {
  buildSeasonSchedule,
  type BuiltSeason,
  type CompetitionShape,
} from '../simulation/SeasonCalendar.js';
import { SimulatedWorldProvider } from '../simulation/SimulatedWorldProvider.js';
import { SeasonRunner } from '../simulation/SeasonRunner.js';
import { RefereeAssigner } from '../simulation/RefereeAssigner.js';
import { TransferMarket, type MarketPlayer } from '../simulation/TransferMarket.js';
import { TransferOverlay, type Transfer } from '../domain/transfer.js';
import type { Referee } from '../domain/referee.js';
import type { Fixture } from '../domain/calendar.js';
import { qualify } from '../simulation/competitions/ContinentalCompetition.js';
import {
  buildNationalFixtures,
  buildNationalTeams,
  isCalledUp,
  type NationalFixture,
  type NationalTeam,
} from '../simulation/competitions/NationalTeamModel.js';
import { MockWorldFeed } from '../testing/MockWorldFeed.js';
import { DbRosterProvider } from './DbRosterProvider.js';
import { DatabaseSync, type DatabaseSyncType } from './sqlite.js';

export interface DbWorld {
  readonly roster: RosterProvider;
  readonly world: WorldProvider;
  readonly worldFeed: WorldFeed;
  readonly league: LeagueModel;
  readonly simulator: MatchSimulator;
  readonly schedule: BuiltSeason;
  readonly runner: SeasonRunner;
  readonly market: TransferMarket;
  readonly overlay: TransferOverlay;
  /** O haftanin NPC transferlerini isler. Pencere kapaliysa bos doner. */
  runTransferWeek(week: number): readonly Transfer[];
  readonly db: DatabaseSyncType;
  /** Bu fikstüre atanan hakem -- anlati ve maç oncesi sahneler icin. */
  refereeFor(fixture: Fixture): Referee | undefined;
  /** Bir kulubun ezeli rakibi. */
  rivalOf(clubId: string): string | undefined;
  /** Milli takimlar, ulke kimligine gore. */
  readonly nationalTeams: ReadonlyMap<number, NationalTeam>;
  readonly nationalFixtures: readonly NationalFixture[];
  /** Bir kulubun ulkesi -- Hero'nun milli takimi buradan cikar. */
  countryOfClub(clubId: string): number | undefined;
  /** Bu kalitedeki bir oyuncu o ulkenin kadrosuna girer mi. */
  calledUp(countryId: number | undefined, quality: number): boolean;
  advanceWeek(week: number, heroClubId: string): readonly string[];
  recordHeroMatch(): void;
  finishSeason(): ReturnType<LeagueModel['finishSeason']>;
  close(): void;
}

export interface DbWorldOptions {
  readonly dbPath: string;
  readonly registry: ContentRegistry;
  readonly seed: number;
  readonly heroName?: string;
  readonly weeks?: number;
}

export function createDbWorld(options: DbWorldOptions): DbWorld {
  const db = new DatabaseSync(options.dbPath, { readOnly: true });

  // TRANSFER ORTUSU -- world.db degismez, kariyer durumu uzerine serilir.
  const overlay = new TransferOverlay();

  const roster = new DbRosterProvider({
    db,
    names: options.registry.names,
    slots: [...options.registry.slots.values()],
    seed: options.seed,
    overlay,
  });

  const clubs = roster.clubs();
  const leagues = roster.leagues();
  if (clubs.length === 0) {
    db.close();
    throw new Error(
      `${options.dbPath} icinde kulup yok.\n` +
        `  Once veriyi iceri alin:  npm run roster -- import --data=<klasor>`,
    );
  }

  // Mac sayisi VERIDEN gelir -- formulle hesaplanmaz.
  const shapes: CompetitionShape[] = (
    db
      .prepare('SELECT id, matches_per_club FROM competition')
      .all() as unknown as { id: number; matches_per_club: number | null }[]
  )
    .map((row) => {
      const id = String(row.id);
      const clubIds = clubs.filter((c) => c.league === id).map((c) => c.id);
      return {
        id,
        clubIds,
        window: { start: 1, end: 38 },
        ...(row.matches_per_club === null ? {} : { matchesPerClub: row.matches_per_club }),
      };
    })
    .filter((s) => s.clubIds.length >= 2);

  // ULKE BASINA BIR KUPA.
  //
  // Tek bir kupaya 303 kulubu sokmak futbol degil: 9 turluk bir "dunya
  // kupasi" cikiyor ve Premier League kulubu ilk turda Portekiz 2. Lig
  // takimiyla eslesiyor. Gercek yapiya sadik olan, her ulkenin kendi kupasi
  // -- ve bu ayni zamanda "dev yikan amator" anlatisini korur, cunku bir
  // ulkenin TUM basamaklari ayni kurada.
  const countryOf = new Map(
    (
      db.prepare('SELECT id, country_id FROM club').all() as unknown as {
        id: number;
        country_id: number;
      }[]
    ).map((r) => [String(r.id), r.country_id]),
  );
  const byCountry = new Map<number, string[]>();
  for (const club of clubs) {
    const country = countryOf.get(club.id);
    if (country === undefined) continue;
    const list = byCountry.get(country);
    if (list) list.push(club.id);
    else byCountry.set(country, [club.id]);
  }
  const cups = [...byCountry.entries()]
    .map(([country, clubIds]) => ({ id: `cup_${country}`, clubIds }))
    .filter((c) => c.clubIds.length >= 4);

  // SAMPIYONLAR LIGI: her 1. seviye ligin ilk 4'u, en fazla 32 kulup.
  // Ilk sezonda siralama yok -- itibar kullanilir (bkz. `qualify`).
  const topFlight = new Map<string, { id: string; reputation: number }[]>();
  for (const league of leagues.filter((l) => l.level === 1)) {
    topFlight.set(
      league.id,
      clubs.filter((c) => c.league === league.id).map((c) => ({ id: c.id, reputation: c.reputation })),
    );
  }
  const clQualified = qualify(topFlight, 4, 32);

  const weeks = options.weeks ?? 40;
  const schedule = buildSeasonSchedule(
    {
      weeks,
      clubs,
      leagues,
      competitions: shapes,
      cups,
      ...(clQualified.length >= 8
        ? { continental: { id: 'ucl', clubIds: clQualified, groupSize: 4, advancePerGroup: 2 } }
        : {}),
    },
    new Rng(options.seed),
  );

  // HAKEMLER -- world.db'den okunur, atayici fikstur bazinda karar verir.
  const referees: Referee[] = (
    db
      .prepare(
        `SELECT id, name_masked, country_id, badge, strictness, card_tendency,
                penalty_courage, var_reliance, consistency, home_bias, reputation
         FROM referee`,
      )
      .all() as unknown as {
      id: number;
      name_masked: string;
      country_id: number | null;
      badge: string;
      strictness: number;
      card_tendency: number;
      penalty_courage: number;
      var_reliance: number;
      consistency: number;
      home_bias: number;
      reputation: number;
    }[]
  ).map((r) => ({
    id: r.id,
    name: r.name_masked,
    countryId: r.country_id ?? undefined,
    badge: r.badge as Referee['badge'],
    reputation: r.reputation,
    attributes: {
      strictness: r.strictness,
      cardTendency: r.card_tendency,
      penaltyCourage: r.penalty_courage,
      varReliance: r.var_reliance,
      consistency: r.consistency,
      homeBias: r.home_bias,
    },
  }));

  const budgetOf = new Map(
    (
      db.prepare('SELECT id, budget_transfer FROM club').all() as unknown as {
        id: number;
        budget_transfer: number;
      }[]
    ).map((r) => [String(r.id), r.budget_transfer]),
  );

  // EZELI RAKIPLIK -- transferde fahis fiyat, anlatida en degerli tetik.
  const rivalOf = new Map(
    (
      db
        .prepare('SELECT id, rival_club_id FROM club WHERE rival_club_id IS NOT NULL')
        .all() as unknown as { id: number; rival_club_id: number }[]
    ).map((r) => [String(r.id), String(r.rival_club_id)]),
  );

  const levelByCompetition = new Map(leagues.map((l) => [l.id, l.level]));
  const assigner = new RefereeAssigner({
    referees,
    countryOfClub: (clubId) => countryOf.get(clubId),
    leagueLevelOf: (competitionId) => levelByCompetition.get(competitionId) ?? 2,
  });

  // Fikstür basina atama ONBELLEKLENIR: ayni maca iki kez sorulunca ayni
  // hakem donmeli, yoksa mac ici tutarlilik bozulur.
  const assigned = new Map<string, Referee | undefined>();
  const refereeRng = new Rng((options.seed ^ 0x517cc1b7) >>> 0);
  const refereeFor = (fixture: Parameters<RefereeAssigner['assign']>[0]): Referee | undefined => {
    const key = `${fixture.competitionId}:${fixture.roundIndex ?? 0}:${fixture.homeId}:${fixture.awayId}`;
    if (!assigned.has(key)) assigned.set(key, assigner.assign(fixture, refereeRng));
    return assigned.get(key);
  };

  const league = new LeagueModel(clubs, leagues);
  const simulator = new MatchSimulator({
    clubs,
    squadOf: (id) => roster.squad(id),
    schedule,
    seed: options.seed,
    heroName: options.heroName ?? 'Sen',
    refereeFor,
  });

  const runner = new SeasonRunner({
    schedule,
    league,
    ...(schedule.continental === undefined ? {} : { continental: schedule.continental }),
    ...(schedule.continentalId === undefined ? {} : { continentalId: schedule.continentalId }),
  });

  // MILLI TAKIMLAR -- uyruktan kurulur, cifte vatandas iki takima birden aday.
  const countryIdByName = new Map(
    (
      db.prepare('SELECT id, name_real FROM country').all() as unknown as {
        id: number;
        name_real: string;
      }[]
    ).map((r) => [r.name_real, r.id]),
  );
  const countryNames = new Map(
    (
      db.prepare('SELECT id, name_masked FROM country').all() as unknown as {
        id: number;
        name_masked: string;
      }[]
    ).map((r) => [r.id, r.name_masked]),
  );

  const nationalPool: { countryId: number; quality: number }[] = [];
  for (const row of db
    .prepare(
      `SELECT p.nationality, p.second_nationality, a.overall
       FROM player p JOIN player_attributes a ON a.player_id = p.id`,
    )
    .all() as unknown as {
    nationality: string;
    second_nationality: string | null;
    overall: number;
  }[]) {
    for (const name of [row.nationality, row.second_nationality]) {
      if (name === null || name === '') continue;
      const countryId = countryIdByName.get(name);
      if (countryId !== undefined) nationalPool.push({ countryId, quality: row.overall });
    }
  }

  const nationalTeams = buildNationalTeams(nationalPool, countryNames);
  const nationalFixtures = buildNationalFixtures(
    nationalTeams,
    schedule.internationalWindows,
    new Rng((options.seed ^ 0x1b873593) >>> 0),
  );

  // TRANSFER PIYASASI -- NPC kulupleri kendi aralarinda transfer yapar.
  const marketPlayers: MarketPlayer[] = (
    db
      .prepare(
        `SELECT p.id, p.club_id, p.position, p.birth_year, p.market_value,
                p.contract_expires, a.overall, a.potential
         FROM player p JOIN player_attributes a ON a.player_id = p.id
         WHERE p.club_id IS NOT NULL`,
      )
      .all() as unknown as {
      id: number;
      club_id: number;
      position: string;
      birth_year: number | null;
      market_value: number;
      contract_expires: string | null;
      overall: number;
      potential: number;
    }[]
  ).map((r) => ({
    id: r.id,
    clubId: String(r.club_id),
    position: r.position as MarketPlayer['position'],
    overall: r.overall,
    potential: r.potential,
    age: r.birth_year === null ? 26 : new Date().getFullYear() - r.birth_year,
    baseValue: r.market_value,
    // Sozlesme yili kaynakta metin; cozulemezse ortalama 2 sezon varsayilir.
    seasonsLeft: contractSeasonsLeft(r.contract_expires),
  }));

  const market = new TransferMarket({
    clubs: clubs.map((c) => ({
      id: c.id,
      reputation: c.reputation,
      budget: budgetOf.get(c.id) ?? 0,
      ...(rivalOf.get(c.id) === undefined ? {} : { rivalId: rivalOf.get(c.id)! }),
    })),
    players: marketPlayers,
    overlay,
  });
  const marketRng = new Rng((options.seed ^ 0x2545f491) >>> 0);

  const world = new SimulatedWorldProvider(league);
  // Diger fiksturlerin cozumu ayri bir RNG akisindan: mac simulasyonunun
  // determinizmini bozmasin.
  const leagueRng = new Rng((options.seed ^ 0x9e3779b9) >>> 0);

  return {
    roster,
    world,
    worldFeed: new MockWorldFeed(world, clubs, options.seed),
    league,
    simulator,
    schedule,
    db,
    runner,
    market,
    overlay,
    runTransferWeek: (week) => {
      const done = market.runWeek(week, marketRng);
      // Kadro onbellegi bayatlamasin: transfer olan iki kulubu de temizle.
      for (const t of done) {
        roster.invalidate(t.fromClubId);
        roster.invalidate(t.toClubId);
      }
      return done;
    },
    advanceWeek: (week, heroClubId) => {
      // Artik yalnizca lig degil TURNUVALAR da ilerliyor: kupa turu bitince
      // kazananlar toplaniyor ve bir sonraki tur rezerve slota yaziliyor.
      const report = runner.playWeek(week, heroClubId, leagueRng);
      // Hero'nun kulubu bu hafta bir kupa kaldirdiysa host'a soyle.
      // Bu bilgi zaten uretiliyordu ama atiliyordu.
      return report.champions
        .filter((c) => c.clubId === heroClubId)
        .map((c) => c.competitionId);
    },
    recordHeroMatch: () => {
      const fixture = simulator.currentFixture();
      const score = simulator.finalScore();
      if (fixture && score) {
        runner.recordHeroFixture(fixture, {
          homeGoals: score.homeGoals,
          awayGoals: score.awayGoals,
        });
      }
    },
    finishSeason: () => {
      simulator.resetSeason();
      return league.finishSeason();
    },
    refereeFor,
    rivalOf: (clubId: string) => rivalOf.get(clubId),
    nationalTeams,
    nationalFixtures,
    countryOfClub: (clubId) => countryOf.get(clubId),
    calledUp: (countryId, quality) =>
      countryId === undefined ? false : isCalledUp(nationalTeams.get(countryId), quality),
    close: () => db.close(),
  };
}

/**
 * Sozlesme bitisine kac sezon kaldi.
 *
 * Kaynak "2027-06-30" bicimli metin veriyor; cozulemezse iki sezon varsayilir
 * -- degerleme formulunde sozlesme en sert etkiye sahip oldugu icin
 * bilinmeyen durumda notr bir deger secmek onemli.
 */
function contractSeasonsLeft(expires: string | null): number {
  if (expires === null || expires === '') return 2;
  const year = Number(expires.slice(0, 4));
  if (!Number.isFinite(year)) return 2;
  return Math.max(0, Math.min(6, year - new Date().getFullYear()));
}
