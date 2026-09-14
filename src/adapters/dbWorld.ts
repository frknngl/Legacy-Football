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
import { buildTeam } from '../simulation/TeamModel.js';
import {
  buildSeasonSchedule,
  type BuiltSeason,
  type CompetitionShape,
} from '../simulation/SeasonCalendar.js';
import { SimulatedWorldProvider } from '../simulation/SimulatedWorldProvider.js';
import { SeasonRunner } from '../simulation/SeasonRunner.js';
import { RefereeAssigner } from '../simulation/RefereeAssigner.js';
import { TransferMarket, type MarketPlayer } from '../simulation/TransferMarket.js';
import { ClubFinance } from '../simulation/ClubFinance.js';
import { TransferOverlay, type Transfer } from '../domain/transfer.js';
import type { Referee } from '../domain/referee.js';
import type { StaffAttributes } from '../domain/actors.js';
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
  leagueContextForClub(clubId: string):
    | {
        readonly position: number;
        readonly size: number;
        readonly relegationLine: number;
        readonly inRelegationZone: boolean;
      }
    | undefined;
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
  /**
   * GOREVDEKI TEKNIK DIREKTORU BILDIRIR.
   *
   * Host, kulup -> hocanin `sourceId` cozucusunu verir. Kovulma KARIYER
   * katmaninda olur; dunya katmani kimin gorevde oldugunu baska turlu
   * bilemez ve takim gucune kovulan hocayi beslemeye devam ederdi.
   * `MatchSimulator.useChemistrySource` ile ayni gec baglama kalibi.
   */
  useManagerSource(resolve: (clubId: string) => string | undefined): void;
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

  const weeks = options.weeks ?? 40;

  /**
   * BIR SEZONUN TAKVIMINI KURAR -- her sezon YENIDEN.
   *
   * OLCULEN SORUN: takvim kariyer basina BIR KEZ kuruluyordu ve bu,
   * dunyanin en buyuk yapisal sinirlamasiydi:
   *
   *   - Kupa bracket'i bitince bir daha kurulmuyordu; bir kupa kariyer
   *     basina YALNIZCA BIR KEZ oynanabiliyordu (20 kariyerde kupa
   *     kaynagi: league 389, cup 0).
   *   - Fikstur listesi birinci sezonun lig uyeliklerini tasiyordu.
   *     Terfi/dusme sonrasi kulup baska ligde oluyor ama fiksturu eski
   *     ligi gosteriyordu; `LeagueModel.record()` onu reddediyor ve
   *     oynanan mac sayisi 38'den 32'ye dusuyordu.
   *
   * Artik her sezon sonunda GUNCEL uyeliklerle yeni bir takvim kuruluyor.
   *
   * `seasonIndex` tohuma karisir: ayni dunyada her sezon FARKLI bir
   * fikstur sirasi cikar. Karismasaydi yirmi sezon boyunca ayni haftada
   * ayni eslesme oynanirdi.
   */
  const buildFor = (seasonIndex: number, standings?: ReadonlyMap<string, readonly string[]>) => {
    // Lig uyelikleri LeagueModel'den okunur -- terfi/dusme sonrasi
    // `clubs` dizisindeki `league` alani BAYATTIR.
    const leagueOf = (clubId: string): string =>
      leagueModel?.leagueFor(clubId) ?? clubs.find((c) => c.id === clubId)?.league ?? '';

    const seasonShapes: CompetitionShape[] = shapes.map((shape) => ({
      ...shape,
      clubIds: clubs.filter((c) => leagueOf(c.id) === shape.id).map((c) => c.id),
    })).filter((shape) => shape.clubIds.length >= 2);

    // SAMPIYONLAR LIGI: her 1. seviye ligin ilk 4'u, en fazla 32 kulup.
    // Ilk sezonda siralama yok -- itibar kullanilir. Sonraki sezonlarda
    // GECEN SEZONUN puan durumu gecilir (`qualify` bunu zaten destekliyor).
    const topFlight = new Map<string, { id: string; reputation: number }[]>();
    for (const league of leagues.filter((l) => l.level === 1)) {
      topFlight.set(
        league.id,
        clubs
          .filter((c) => leagueOf(c.id) === league.id)
          .map((c) => ({ id: c.id, reputation: c.reputation })),
      );
    }
    const clQualified = qualify(topFlight, 4, 32, standings);

    return buildSeasonSchedule(
      {
        weeks,
        clubs,
        leagues,
        competitions: seasonShapes,
        cups,
        ...(clQualified.length >= 8
          ? { continental: { id: 'ucl', clubIds: clQualified, groupSize: 4, advancePerGroup: 2 } }
          : {}),
      },
      new Rng((options.seed + seasonIndex * 0x9e3779b1) >>> 0),
    );
  };

  let leagueModel: LeagueModel | undefined;
  /** Kacinci sezondayiz -- takvim tohumuna karisir. */
  let seasonIndex = 0;
  /** Bu sezon kupa/kita sampiyonu olan kulupler -- sezon sonunda prim alirlar. */
  const seasonTrophyWinners = new Set<string>();
  let schedule = buildFor(0);

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

  // TURNUVA BAZLI KOKART ZORUNLULUGU.
  //
  // OLCULEN SORUN: `referee_eligibility` tablosu semada vardi ama
  // `requiredBadgeOf` callback'i HIC gecirilmiyordu. `RefereeAssigner`
  // her seferinde `undefined` aliyor ve taban `requiredBadge()`
  // fonksiyonuna dusuyordu -- yani tablo tamamen oluydu ve "yeni bir
  // turnuva eklendiginde kod degismez, satir eklenir" vaadi calismiyordu.
  const minBadge = new Map(
    (
      db
        .prepare('SELECT competition_id, min_badge FROM referee_eligibility')
        .all() as unknown as { competition_id: number; min_badge: string }[]
    ).map((r) => [String(r.competition_id), r.min_badge as Referee['badge']]),
  );

  const assigner = new RefereeAssigner({
    referees,
    countryOfClub: (clubId) => countryOf.get(clubId),
    leagueLevelOf: (competitionId) => levelByCompetition.get(competitionId) ?? 2,
    requiredBadgeOf: (competitionId) => minBadge.get(competitionId),
  });

  // TEKNIK DIREKTOR ETKISI.
  //
  // Kadro saglayicisi heyeti zaten onbellekliyor; burada yalnizca 'manager'
  // rolunu suzup simulatore veriyoruz. Kulubun hocasi yoksa (eski world.db,
  // nitelik tasimayan satir) `undefined` doner ve carpan 1 kalir.
  //
  // GOREVDEKI HOCA, VERITABANINDAKI HOCA DEGIL.
  //
  // OLCULEN SORUN: burasi her zaman `staff` tablosundaki satiri okuyordu.
  // Teknik direktor kovulunca anlati yeni bir hoca tanitiyor ama takim
  // gucu KOVULAN hocanin niteliklerinde kaliyordu -- kariyerin sonuna
  // kadar. 12 kariyerde 17 kovulma olcusuldu ve hicbirinde takim gucune
  // giren hoca degismedi.
  //
  // Cozum gec baglama: kimin gorevde oldugunu KARIYER KATMANI bilir
  // (`GameEngine` kadrolamasi), dunya katmani degil. `useManagerSource`
  // ile host o bilgiyi buraya verir; verilmezse tablo okunur ve eski
  // davranis aynen surer.
  let managerSource: ((clubId: string) => string | undefined) | undefined;
  const useManagerSource = (resolve: (clubId: string) => string | undefined): void => {
    managerSource = resolve;
    strengthCache.clear();
    managerSeen.clear();
  };

  const managerOf = (clubId: string) => {
    const sourceId = managerSource?.(clubId);
    if (sourceId !== undefined) {
      const person = roster.lookup(sourceId);
      if (person && 'role' in person && person.role === 'manager') return person;
    }
    return roster.staff(clubId).find((p) => p.role === 'manager');
  };

  const coachOf = (
    clubId: string,
  ): { attributes?: StaffAttributes; preferredFormation?: string } | undefined => {
    const manager = managerOf(clubId);
    if (!manager?.attributes) return undefined;
    return { attributes: manager.attributes };
  };

  // KADRO GUCU COZUCUSU -- lig maci artik kadroyu GORUYOR.
  //
  // OLCULEN SORUN: `LeagueModel.strength()` yalnizca `club.reputation`
  // okuyordu ve itibar kariyer boyunca sabitti. Transferler ve teknik
  // direktor etkisi lig sonucuna HIC girmiyordu; 100 sezonluk olcumde
  // bir kulup ligi %99-100 kazaniyordu.
  //
  // ONBELLEK ZORUNLU: `resolveCheap` her hafta her fikstur icin cagrilir
  // (252 kulup x 40 hafta). Her cagride kadro kurmak kabul edilemez.
  // Onbellek yalnizca transferde temizlenir -- kadro baska turlu degismez.
  const strengthCache = new Map<string, number>();
  // Onbellegi hoca degisiminde de tazelemek gerekir -- yoksa kovulma takim
  // gucune hicbir zaman yansimaz. Disaridan cagrilacak bir gecersiz kilma
  // kancasi yerine, kimin gorevde oldugu onbellekle birlikte tutuluyor:
  // kendi kendini onaran ve cagiranin bir sey hatirlamasini gerektirmeyen
  // bicim.
  const managerSeen = new Map<string, string>();
  const squadOverallOf = (clubId: string): number | undefined => {
    const current = managerSource?.(clubId) ?? '';
    const hit = strengthCache.get(clubId);
    if (hit !== undefined && managerSeen.get(clubId) === current) return hit;
    managerSeen.set(clubId, current);
    const club = roster.club(clubId);
    if (!club) return undefined;
    const squad = roster.squad(clubId);
    if (squad.length === 0) return undefined;
    const overall = buildTeam(clubId, club.name, squad, undefined, undefined, coachOf(clubId))
      .lines.overall;
    strengthCache.set(clubId, overall);
    return overall;
  };

  const league = new LeagueModel(clubs, leagues, squadOverallOf);
  // `buildFor` guncel lig uyeliklerini buradan okur.
  leagueModel = league;
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

  // Fikstür basina atama ONBELLEKLENIR: ayni maca iki kez sorulunca ayni
  // hakem donmeli, yoksa mac ici tutarlilik bozulur.
  const assigned = new Map<string, Referee | undefined>();
  const refereeRng = new Rng((options.seed ^ 0x517cc1b7) >>> 0);
  const refereeFor = (fixture: Parameters<RefereeAssigner['assign']>[0]): Referee | undefined => {
    const key = `${fixture.competitionId}:${fixture.roundIndex ?? 0}:${fixture.homeId}:${fixture.awayId}`;
    if (!assigned.has(key)) assigned.set(key, assigner.assign(fixture, refereeRng));
    return assigned.get(key);
  };

  const simulator = new MatchSimulator({
    clubs,
    squadOf: (id) => roster.squad(id),
    coachOf,
    schedule,
    seed: options.seed,
    heroName: options.heroName ?? 'Sen',
    refereeFor,
    tableContextForClub: leagueContextForClub,
  });

  let runner = new SeasonRunner({
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

  // KADRO DEGERI -- ekonominin girdisi. Gucten (overall) AYRI bir eksen:
  // gelir ve maas para birimiyle olculur, hat gucuyle degil.
  //
  // Transfer ortusunu okur, yani kariyer ici transferlerden SONRAKI gercek
  // kadroyu fiyatlar. Onbellek transferde temizlenir.
  const valueCache = new Map<string, number>();
  const squadValueOf = (clubId: string): number => {
    const hit = valueCache.get(clubId);
    if (hit !== undefined) return hit;
    let total = 0;
    for (const p of marketPlayers) {
      if (overlay.clubOf(p.id, p.clubId) === clubId) total += p.baseValue;
    }
    valueCache.set(clubId, total);
    return total;
  };

  const leagueRepOf = new Map(
    (
      db.prepare('SELECT id, reputation FROM competition').all() as unknown as {
        id: number;
        reputation: number;
      }[]
    ).map((r) => [String(r.id), r.reputation]),
  );

  const finance = new ClubFinance({
    clubs: clubs.map((c) => ({
      id: c.id,
      budgetTransfer: budgetOf.get(c.id) ?? 0,
      reputation: c.reputation,
    })),
    squadValueOf,
    leagueReputationOf: (clubId) =>
      leagueRepOf.get(league.leagueFor(clubId) ?? roster.club(clubId)?.league ?? '') ?? 40,
  });

  // OYUNCU -> MENAJERLIK SIRKETI -> PAZARLIK GUCU.
  //
  // `player_agency` tablosu 2.697 gercek iliski tasiyor ama motor onu HIC
  // okumuyordu (denetim: UNUSED). Artik satis fiyatina giriyor: guclu bir
  // sirket kulubun oyuncuyu tutma gucunu zayiflatir.
  const agencyPower = new Map(
    (
      db
        .prepare(
          `SELECT pa.player_id, a.negotiation_power
           FROM player_agency pa JOIN agency a ON a.id = pa.agency_id
           WHERE pa.is_current = 1`,
        )
        .all() as unknown as { player_id: number; negotiation_power: number }[]
    ).map((r) => [r.player_id, r.negotiation_power]),
  );

  const market = new TransferMarket({
    finance,
    agencyPowerOf: (playerId) => agencyPower.get(playerId),
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
    // GETTER: sezon devrinde takvim DEGISIR. Sabit bir deger donmek
    // host'a birinci sezonun fiksturlerini gostermeye devam ederdi.
    get schedule() {
      return schedule;
    },
    leagueContextForClub,
    useManagerSource,
    db,
    get runner() {
      return runner;
    },
    market,
    overlay,
    runTransferWeek: (week) => {
      const done = market.runWeek(week, marketRng);
      // Kadro onbellegi bayatlamasin: transfer olan iki kulubu de temizle.
      for (const t of done) {
        roster.invalidate(t.fromClubId);
        roster.invalidate(t.toClubId);
        // Kadro degisti -> lig gucu de degisti. Onbellek bayatlamasin.
        strengthCache.delete(t.fromClubId);
        strengthCache.delete(t.toClubId);
        valueCache.delete(t.fromClubId);
        valueCache.delete(t.toClubId);
      }
      return done;
    },
    advanceWeek: (week, heroClubId) => {
      // Artik yalnizca lig degil TURNUVALAR da ilerliyor: kupa turu bitince
      // kazananlar toplaniyor ve bir sonraki tur rezerve slota yaziliyor.
      const report = runner.playWeek(week, heroClubId, leagueRng);
      // EKONOMI: kupa/kita sampiyonlugu prim getirir. Hero'nunki degil
      // BUTUN kuluplerinki toplanir -- dunyanin ekonomisi Hero'ya bagli
      // degildir.
      for (const c of report.champions) seasonTrophyWinners.add(c.clubId);
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
      // TRANSFER PIYASASI DA SIFIRLANIR.
      //
      // OLCULEN SORUN: `TransferMarket.resetSeason()` yazilmis ve
      // dokumantasyonu "sezon donusunde cagrilir" diyordu -- ama HICBIR
      // YERDEN cagrilmiyordu. Iki sonucu vardi:
      //   1. `movedThisSeason` hicbir zaman temizlenmiyor; bir oyuncu
      //      dunya omru boyunca YALNIZCA BIR KEZ transfer olabiliyordu.
      //   2. Butceler hicbir zaman tazelenmiyor; harcanan para geri
      //      gelmiyordu.
      // 100 sezonluk olcumde piyasa ilk on sezonda 79,5 transfer/sezon
      // yapip sonra KALICI OLARAK oluyordu (son on sezon: 0,0).
      market.resetSeason();
      // GECEN SEZONUN PUAN DURUMU -- Sampiyonlar Ligi elemesi icin.
      // Tabloyu `league.finishSeason()` sifirladigi icin ONCE okunur.
      const standings = new Map<string, readonly string[]>();
      for (const l of leagues) {
        const rows = league.standings(l.id);
        if (rows.length > 0) standings.set(l.id, rows.map((r) => r.clubId));
      }

      // EKONOMI: prim sezon sonu SIRASINDAN gelir, yani tablo
      // sifirlanmadan ONCE kapanmali.
      finance.closeSeason({ standings, trophyWinners: [...seasonTrophyWinners] });
      seasonTrophyWinners.clear();

      const outcome = league.finishSeason();
      seasonIndex += 1;

      // SEZON DEVRI: takvim GUNCEL uyeliklerle yeniden kurulur.
      //
      // Terfi/dusme `league.finishSeason()` icinde uygulandi; `buildFor`
      // lig uyeliklerini `LeagueModel`den okudugu icin yeni takvim dogru
      // kadrolarla cikar. Kupa bracket'leri de sifirdan kurulur -- kupalar
      // artik her sezon oynanir.
      schedule = buildFor(seasonIndex, standings);
      runner = new SeasonRunner({
        schedule,
        league,
        ...(schedule.continental === undefined ? {} : { continental: schedule.continental }),
        ...(schedule.continentalId === undefined ? {} : { continentalId: schedule.continentalId }),
      });
      simulator.useSchedule(schedule);

      return outcome;
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
