/**
 * 11v11 simulator ve lig modeli.
 *
 * Kritik ozellikler: determinizm (ayni tohum = ayni mac), guc monotonlugu
 * (elit takim amatoru yener ama her zaman degil) ve duraklat/devam tutarliligi
 * (Hero'nun karari skoru gercekten degistirir).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import { loadMockClubs, loadMockLeagues } from '../src/testing/loadMockClubs.js';
import { MockRosterProvider } from '../src/testing/MockRosterProvider.js';
import { ScriptedChanceResolver } from '../src/testing/ScriptedChanceResolver.js';
import { buildSeasonSchedule } from '../src/simulation/SeasonCalendar.js';
import { LeagueModel } from '../src/simulation/LeagueModel.js';
import { MatchSimulator } from '../src/simulation/MatchSimulator.js';
import { SimulatedWorldProvider } from '../src/simulation/SimulatedWorldProvider.js';
import { Rng } from '../src/selection/Rng.js';
import type { ClubInfo, LeagueInfo } from '../src/domain/roster.js';
import type { HeroProfile, MomentDelta } from '../src/domain/match.js';

const CONTENT_DIR = fileURLToPath(new URL('../content', import.meta.url));

let clubs: readonly ClubInfo[];
let leagues: readonly LeagueInfo[];
let roster: MockRosterProvider;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource(CONTENT_DIR)).load();
  clubs = await loadMockClubs(CONTENT_DIR);
  leagues = await loadMockLeagues(CONTENT_DIR);
  roster = new MockRosterProvider({
    clubs,
    names: loaded.registry!.names,
    slots: [...loaded.registry!.slots.values()],
    seed: 7,
  });
});

const HERO: HeroProfile = {
  position: 'FW',
  technical: 70,
  physical: 70,
  form: 60,
  stamina: 80,
  stature: 'starter',
  morale: 60,
  isCaptain: false,
};

const NO_DELTA: MomentDelta = {
  goals: 0,
  assists: 0,
  yellowCards: 0,
  redCard: false,
  injuryWeeks: 0,
  ratingModifier: 0,
  incidents: [],
};

function simulator(seed: number, resolver?: ConstructorParameters<typeof MatchSimulator>[0]['chanceResolver']) {
  const schedule = buildSeasonSchedule({ weeks: 40, clubs, leagues }, new Rng(seed));
  return {
    schedule,
    sim: new MatchSimulator({
      clubs,
      squadOf: (id) => roster.squad(id),
      schedule,
      seed,
      heroName: 'Hero',
      ...(resolver ? { chanceResolver: resolver } : {}),
    }),
  };
}

/** Bir maci sonuna kadar oynatir; Hero anlarini verilen delta ile cevaplar. */
function playThrough(
  sim: MatchSimulator,
  delta: MomentDelta = NO_DELTA,
): { goals: number; moments: number; report: ReturnType<MatchSimulator['runToEnd']> } {
  let moments = 0;
  for (let guard = 0; guard < 500; guard += 1) {
    const step = sim.step();
    if (step.kind === 'full_time') {
      return { goals: step.report.goals, moments, report: step.report };
    }
    if (step.kind === 'hero_moment') {
      moments += 1;
      sim.resume(delta);
    }
  }
  throw new Error('Mac bitmedi -- sonsuz dongu.');
}

describe('Fikstur takvimi', () => {
  it('cift devreli lig fiksturu uretir', () => {
    const { schedule } = simulator(1);
    const leagueFixtures = schedule.fixtures.filter((f) => f.league === 'tr_1');
    // 12 kulup, cift devre = 132 mac.
    expect(leagueFixtures).toHaveLength(132);

    // Her kulup 22 mac oynar, yarisi ev sahibi.
    for (const club of clubs.filter((c) => c.league === 'tr_1')) {
      const own = leagueFixtures.filter((f) => f.homeId === club.id || f.awayId === club.id);
      expect(own).toHaveLength(22);
      expect(own.filter((f) => f.homeId === club.id)).toHaveLength(11);
    }
  });

  it('kupa tum basamaklari ayni kuraya sokar', () => {
    const { schedule } = simulator(1);
    // 1. tur eslesmeleri bellidir ve tum basamaklar ayni havuzdadir:
    // "dev yikan amator" anlatisi ancak boyle mumkun.
    const cup = schedule.fixtures.filter((f) => f.importance === 'cup');
    const tiers = new Set(
      cup.flatMap((f) => [f.homeId, f.awayId]).map((id) => id.slice(0, 4)),
    );
    expect(cup.length).toBeGreaterThan(0);
    expect(tiers.size).toBeGreaterThan(0);
  });

  it('kupa finalinin ZAMANI ayrilir, finalistleri sonra belli olur', () => {
    // Onceki surumde final sezon basinda hazirdi ve iki finalist hic mac
    // oynamamisti -- kazanani kura belirliyordu. Artik takvim yalnizca hafta
    // ayirir; eslesme `materializeRound` ile, gercek kazananlardan dolar.
    const { schedule } = simulator(1);

    const final = schedule.reservedRounds.find((r) => r.importance === 'cup_final');
    expect(final).toBeDefined();
    expect(schedule.fixtures.some((f) => f.importance === 'cup_final')).toBe(false);

    const added = schedule.materializeRound('cup', final!.roundIndex, [
      { home: 'clb_yildiz', away: 'clb_sancak' },
    ]);
    expect(added).toHaveLength(1);
    expect(schedule.fixtures.some((f) => f.importance === 'cup_final')).toBe(true);
  });

  it('bos hafta gercektir -- her hafta mac yok', () => {
    const { schedule } = simulator(1);
    const club = 'clb_yildiz';
    const played = Array.from({ length: 40 }, (_, i) => schedule.forClub(club, i + 1)).filter(
      Boolean,
    );
    expect(played.length).toBeLessThan(40);
    expect(played.length).toBeGreaterThan(20);
  });
});

describe('MatchSimulator', () => {
  it('ayni tohum ayni maci uretir', () => {
    const a = simulator(42);
    const b = simulator(42);
    const fixture = a.schedule.forClub('clb_yildiz', findMatchWeek(a.schedule, 'clb_yildiz'))!;

    a.sim.start(fixture, HERO, 'clb_yildiz');
    b.sim.start(fixture, HERO, 'clb_yildiz');
    const first = playThrough(a.sim);
    const second = playThrough(b.sim);

    expect(a.sim.finalScore()).toEqual(b.sim.finalScore());
    expect(first.report).toEqual(second.report);
  });

  it('guclu takim zayifi genelde yener AMA her zaman degil', () => {
    let strongWins = 0;
    let weakWins = 0;
    const total = 60;

    for (let seed = 1; seed <= total; seed += 1) {
      const { sim } = simulator(seed);
      // Elit kulup (rep 94) amator kulube (rep ~20) karsi.
      sim.start(
        { week: 1, slot: 'weekend', homeId: 'clb_atlas', awayId: 'clb_govdeli', importance: 'cup', competitionId: 'cup' },
        HERO,
        'clb_atlas',
      );
      playThrough(sim);
      const score = sim.finalScore()!;
      if (score.homeGoals > score.awayGoals) strongWins += 1;
      if (score.awayGoals > score.homeGoals) weakWins += 1;
    }

    expect(strongWins / total).toBeGreaterThan(0.7);
    // Surpriz mumkun olmali: "dev yikan amator" anlatisi buna dayanir.
    expect(strongWins).toBeLessThan(total);
    expect(weakWins).toBeGreaterThan(0);
  });

  it('Hero karari SKORU gercekten degistirir', () => {
    const withGoals = simulator(11);
    const week = findMatchWeek(withGoals.schedule, 'clb_yildiz');
    const fixture = withGoals.schedule.forClub('clb_yildiz', week)!;

    withGoals.sim.start(fixture, HERO, 'clb_yildiz');
    const scoring = playThrough(withGoals.sim, { ...NO_DELTA, goals: 1 });

    const without = simulator(11);
    without.sim.start(fixture, HERO, 'clb_yildiz');
    const quiet = playThrough(without.sim);

    expect(scoring.moments).toBe(quiet.moments);
    expect(scoring.goals).toBe(quiet.goals + scoring.moments);
  });

  it('takas edilen cozucu skoru belirler -- port gercekten calisiyor', () => {
    // Her sut gol: skor pozisyon sayisina esitlenir.
    const { sim, schedule } = simulator(5, new ScriptedChanceResolver([], 'goal'));
    const fixture = schedule.forClub('clb_yildiz', findMatchWeek(schedule, 'clb_yildiz'))!;
    sim.start(fixture, HERO, 'clb_yildiz');
    playThrough(sim);
    const score = sim.finalScore()!;
    expect(score.homeGoals + score.awayGoals).toBeGreaterThan(6);

    // Hicbir sut gol degil: 0-0.
    const dry = simulator(5, new ScriptedChanceResolver([], 'saved'));
    const dryFixture = dry.schedule.forClub('clb_yildiz', findMatchWeek(dry.schedule, 'clb_yildiz'))!;
    dry.sim.start(dryFixture, HERO, 'clb_yildiz');
    playThrough(dry.sim);
    expect(dry.sim.finalScore()).toMatchObject({ homeGoals: 0, awayGoals: 0 });
  });

  it('mevkiye uygun mac anlari sunar -- stoper penalti kullanmaz', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 25; seed += 1) {
      const { sim, schedule } = simulator(seed);
      const week = findMatchWeek(schedule, 'clb_yildiz');
      sim.start(schedule.forClub('clb_yildiz', week)!, { ...HERO, position: 'DF' }, 'clb_yildiz');
      for (let guard = 0; guard < 500; guard += 1) {
        const step = sim.step();
        if (step.kind === 'full_time') break;
        if (step.kind === 'hero_moment') {
          seen.add(step.moment.type);
          sim.resume(NO_DELTA);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    expect(seen.has('penalty_for')).toBe(false);
    expect(seen.has('celebration_choice')).toBe(false);
  });

  it('cezaliyken takım maci oynanir ama Hero dakika almaz', () => {
    const { sim } = simulator(3);
    const base = {
      season: 1,
      week: 1,
      heroClubId: 'clb_yildiz',
      hero: HERO,
    };
    const built = sim.buildMatch({
      ...base,
      availability: { available: false, reason: 'ceza', matchesRemaining: 2 },
    });
    expect(built).toBeDefined();
    expect(built?.context.isStarter).toBe(false);

    const report = sim.applyDelta(
      built!,
      {
        goalsDelta: 0,
        assistsDelta: 0,
        yellowCards: 0,
        redCard: false,
        injuryWeeks: 0,
        ratingModifier: 0,
        incidents: [],
      },
    );
    expect(report.minutes).toBe(0);
    expect(report.rating).toBe(0);
    expect(report.goals).toBe(0);
    expect(report.assists).toBe(0);
    expect(report.cards).toBe(0);
  });

  it('fiksturu olmayan haftada mac uretmez', () => {
    const { sim } = simulator(3);
    const base = {
      season: 1,
      week: 1,
      heroClubId: 'clb_yildiz',
      hero: HERO,
    };

    // Fikstursuz bir kulup: hicbir hafta maci yok.
    expect(
      sim.buildMatch({
        ...base,
        heroClubId: 'yok_boyle_kulup',
        availability: { available: true, matchesRemaining: 0 },
      }),
    ).toBeUndefined();
  });
});

describe('LeagueModel', () => {
  it('puan matematigi tutarli', () => {
    const league = new LeagueModel(clubs, leagues);
    const fixture = {
      week: 1,
      homeId: 'clb_yildiz',
      awayId: 'clb_sancak',
      importance: 'league' as const,
      slot: 'weekend' as const,
      competitionId: 'tr_1',
      league: 'tr_1',
    };
    league.record(fixture, { homeGoals: 2, awayGoals: 1 });
    const table = league.table('tr_1');
    const home = table.find((r) => r.clubId === 'clb_yildiz')!;
    const away = table.find((r) => r.clubId === 'clb_sancak')!;

    expect(home.points).toBe(3);
    expect(away.points).toBe(0);
    expect(home.goalsFor).toBe(2);
    expect(away.goalsAgainst).toBe(2);
    expect(home.played).toBe(1);
  });

  it('kupa maci lig tablosunu ETKILEMEZ', () => {
    const league = new LeagueModel(clubs, leagues);
    league.record(
      { week: 1, slot: 'weekend', homeId: 'clb_yildiz', awayId: 'clb_sancak', importance: 'cup', competitionId: 'cup' },
      { homeGoals: 5, awayGoals: 0 },
    );
    expect(league.table('tr_1').every((r) => r.played === 0)).toBe(true);
  });

  it('sezon sonu 2 yukselen / 2 dusen uygular ve tier gunceller', () => {
    const league = new LeagueModel(clubs, leagues);
    const rng = new Rng(4);
    const { schedule } = simulator(4);
    for (let week = 1; week <= 40; week += 1) league.playWeek(schedule.byWeek(week), undefined, rng);

    const beforeTop = league.standings('tr_2').slice(0, 2).map((r) => r.clubId);
    const outcome = league.finishSeason();

    expect(Object.keys(outcome.champions)).toContain('tr_1');
    expect(outcome.promoted.filter((p) => p.from === 'tr_2')).toHaveLength(2);
    expect(outcome.relegated.filter((p) => p.from === 'tr_1')).toHaveLength(2);
    // En ust lig yukselmez, en alt lig dusmez.
    expect(outcome.promoted.some((p) => p.from === 'tr_1')).toBe(false);
    expect(outcome.relegated.some((p) => p.from === 'tr_amateur')).toBe(false);

    // Yukselen kulup gercekten tasindi ve seviyesi degisti.
    for (const clubId of beforeTop) {
      expect(league.leagueFor(clubId)).toBe('tr_1');
      expect(league.club(clubId)!.tier).not.toBe('lower');
    }
  });

  it('sezon sonu tablo sifirlanir', () => {
    const league = new LeagueModel(clubs, leagues);
    league.record(
      { week: 1, slot: 'weekend', homeId: 'clb_yildiz', awayId: 'clb_sancak', importance: 'league', competitionId: 'tr_1', league: 'tr_1' },
      { homeGoals: 3, awayGoals: 0 },
    );
    league.finishSeason();
    expect(league.table('tr_1').every((r) => r.played === 0 && r.points === 0)).toBe(true);
  });
});

describe('SimulatedWorldProvider', () => {
  it('puan durumunu OYNANAN maclardan doner', () => {
    const league = new LeagueModel(clubs, leagues);
    const world = new SimulatedWorldProvider(league);

    expect(world.standings('tr_1').every((r) => r.played === 0)).toBe(true);

    league.record(
      { week: 1, slot: 'weekend', homeId: 'clb_harran', awayId: 'clb_atlas', importance: 'league', competitionId: 'tr_1', league: 'tr_1' },
      { homeGoals: 4, awayGoals: 0 },
    );
    // Itibari dusuk kulup, oynadigi maci kazandigi icin zirvede.
    expect(world.standings('tr_1')[0]!.clubId).toBe('clb_harran');
  });

  it('sohret yukseldikce transfer menzili genisler', () => {
    const world = new SimulatedWorldProvider(new LeagueModel(clubs, leagues));
    expect(world.transferTargets('lower', 'icon').length).toBeGreaterThan(
      world.transferTargets('lower', 'nobody').length,
    );
  });
});

/** Kulubun ilk maci hangi haftada. */
function findMatchWeek(
  schedule: ReturnType<typeof buildSeasonSchedule>,
  clubId: string,
): number {
  for (let week = 1; week <= 40; week += 1) {
    if (schedule.forClub(clubId, week)) return week;
  }
  throw new Error(`${clubId} icin mac bulunamadi`);
}
