/**
 * TURNUVA DONGUSU -- takvim ile sonuclar arasindaki halka.
 *
 * Eksik olan buydu: takvim zamani ayiriyordu, turnuva modelleri eslesmeyi
 * kurabiliyordu, ama kazananlari toplayip bir sonraki turu acan kimse yoktu.
 * Kupa 1. turu oynaniyor, 2. tur hic kurulmuyordu.
 *
 * Ayrica: `milli_mac_sayisi` ve `kupa_sayisi` tanimliydi ama HICBIR SEY
 * yazmiyordu. `progression.json` ikisini de sohret hesabina katiyor
 * (kupa x25, milli mac x1.5), yani sayaclar 0 kaldigi surece kupa kazanmak
 * ve milli formayi giymek kariyere hic etki etmiyordu.
 */

import { describe, expect, it } from 'vitest';
import { buildSeasonSchedule } from '../src/simulation/SeasonCalendar.js';
import { SeasonRunner } from '../src/simulation/SeasonRunner.js';
import { LeagueModel } from '../src/simulation/LeagueModel.js';
import {
  ContinentalCompetition,
  qualify,
} from '../src/simulation/competitions/ContinentalCompetition.js';
import {
  buildNationalTeams,
  buildNationalFixtures,
  isCalledUp,
} from '../src/simulation/competitions/NationalTeamModel.js';
import type { ClubInfo, LeagueInfo } from '../src/domain/roster.js';
import { Rng } from '../src/selection/Rng.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';

function world(count: number): { clubs: ClubInfo[]; leagues: LeagueInfo[] } {
  const clubs: ClubInfo[] = Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    name: `Club ${i}`,
    city: '',
    stadium: '',
    tier: 'mid' as const,
    league: 'L1',
    // Itibar farkli olsun: penalti egilimi ve ucuz cozum bunu okuyor.
    reputation: 30 + ((i * 7) % 60),
    foreignRatio: 0,
  }));
  return { clubs, leagues: [{ id: 'L1', label: 'L1', level: 1, promoted: 0, relegated: 0 }] };
}

// ------------------------------------------------------------------ kupa

describe('kupa dongusu', () => {
  it('turlar SONUCLARA gore acilir ve tek bir sampiyon cikar', () => {
    const { clubs, leagues } = world(16);
    const schedule = buildSeasonSchedule({ weeks: 40, clubs, leagues }, new Rng(5));
    const league = new LeagueModel(clubs, leagues);
    const runner = new SeasonRunner({ schedule, league });

    const before = schedule.fixtures.length;
    const rng = new Rng(11);
    for (let week = 1; week <= 40; week += 1) runner.playWeek(week, undefined, rng);

    // Rezerve turlar dolmus olmali -- fikstur sayisi BUYUDU.
    expect(schedule.fixtures.length).toBeGreaterThan(before);

    const champion = runner.cupChampion('cup');
    expect(champion).toBeDefined();
    expect(clubs.map((c) => c.id)).toContain(champion!);
  });

  it('sampiyon MAC OYNAYARAK gelir -- kura degil', () => {
    // Onceki surumde final sezon basinda belliydi ve finalistler hic mac
    // oynamamisti.
    const { clubs, leagues } = world(8);
    const schedule = buildSeasonSchedule({ weeks: 40, clubs, leagues }, new Rng(3));
    const league = new LeagueModel(clubs, leagues);
    const runner = new SeasonRunner({ schedule, league });

    const rng = new Rng(9);
    for (let week = 1; week <= 40; week += 1) runner.playWeek(week, undefined, rng);

    const champion = runner.cupChampion('cup')!;
    const played = schedule.fixtures.filter(
      (f) => f.competitionId === 'cup' && (f.homeId === champion || f.awayId === champion),
    );
    // Sampiyon en az bir kupa maci oynamis olmali.
    expect(played.length).toBeGreaterThan(0);
  });

  it('turun TAMAMI oynanmadan sonraki tur acilmaz', () => {
    const { clubs, leagues } = world(8);
    const schedule = buildSeasonSchedule({ weeks: 40, clubs, leagues }, new Rng(3));
    const league = new LeagueModel(clubs, leagues);
    const runner = new SeasonRunner({ schedule, league });

    // Bir kulubu atlarsak o kulubun maci cozulmez -> tur eksik kalir.
    const rng = new Rng(4);
    for (let week = 1; week <= 40; week += 1) runner.playWeek(week, 'c0', rng);

    expect(runner.cupChampion('cup')).toBeUndefined();
  });
});

// ------------------------------------------------------------------ Avrupa

describe('kita turnuvasi', () => {
  it('gruplar bitince eleme acilir ve sampiyona kadar gider', () => {
    // 20 kulup -> 38 lig turu. Ustune 6 grup + 3 eleme = 47 mac; 33 uygun
    // hafta x kapasite 2 = 66 slot. Sigar. (40 kulupluk tek lig 78 tur eder
    // ve takvim -- dogru davranarak -- reddeder.)
    const { clubs, leagues } = world(20);
    const qualified = clubs.slice(0, 16).map((c) => c.id);

    const schedule = buildSeasonSchedule(
      {
        weeks: 40,
        clubs,
        leagues,
        cup: false,
        continental: { id: 'ucl', clubIds: qualified, groupSize: 4, advancePerGroup: 2 },
      },
      new Rng(21),
    );

    const cl = schedule.continental!;
    expect(cl.groupRoundCount).toBe(6); // 4'lu grup, cift devre
    expect(cl.knockoutRoundCount).toBe(3); // 8 kulup -> ceyrek, yari, final

    const league = new LeagueModel(clubs, leagues);
    const runner = new SeasonRunner({
      schedule,
      league,
      continental: cl,
      continentalId: 'ucl',
    });

    const rng = new Rng(33);
    for (let week = 1; week <= 40; week += 1) runner.playWeek(week, undefined, rng);

    const champion = runner.continentalChampion();
    expect(champion).toBeDefined();
    expect(qualified).toContain(champion!);
  });

  it('gruptan cikanlar TABLOYA gore belirlenir', () => {
    const cl = new ContinentalCompetition(
      {
        id: 'x',
        clubIds: ['a', 'b', 'c', 'd'],
        groupSize: 4,
        advancePerGroup: 2,
        window: { start: 3, end: 40 },
      },
      new Rng(1),
    );
    cl.seed();

    // 'a' herkesi yenerse tablonun basinda olmali.
    for (const other of ['b', 'c', 'd']) cl.recordGroup('a', other, 3, 0);
    const table = cl.standings(0);
    expect(table[0]!.clubId).toBe('a');
    expect(table[0]!.points).toBe(9);
  });

  it('katilimcilar itibara gore secilir', () => {
    const byLeague = new Map([
      ['L1', [
        { id: 'x', reputation: 90 },
        { id: 'y', reputation: 50 },
        { id: 'z', reputation: 70 },
      ]],
    ]);
    expect(qualify(byLeague, 2, 10)).toEqual(['x', 'z']);
  });
});

// ------------------------------------------------------------------ milli

describe('milli takim', () => {
  const names = new Map([
    [1, 'Albion'],
    [2, 'Anadolu'],
  ]);

  it('kadro uyruktan kurulur, esik 23. oyuncudur', () => {
    const players = [
      ...Array.from({ length: 30 }, (_, i) => ({ countryId: 1, quality: 90 - i })),
      ...Array.from({ length: 10 }, (_, i) => ({ countryId: 2, quality: 70 - i })),
    ];
    const teams = buildNationalTeams(players, names);

    const albion = teams.get(1)!;
    expect(albion.squadSize).toBe(23);
    expect(albion.threshold).toBe(90 - 22); // 23. oyuncu

    // Kadrosu 23'ten az olan ulkede esik 0 -- herkes cagrilir.
    expect(teams.get(2)!.threshold).toBe(0);
  });

  it('ZAYIF milli takima girmek daha kolay', () => {
    // Sabit bir esik (ornegin quality>=75) kucuk ulkelerde kimseyi cagirmazdi.
    // Guclu ulkenin 23. oyuncusu 73, zayif olaninki 48.
    const players = [
      ...Array.from({ length: 30 }, (_, i) => ({ countryId: 1, quality: 95 - i })),
      ...Array.from({ length: 30 }, (_, i) => ({ countryId: 2, quality: 70 - i })),
    ];
    const teams = buildNationalTeams(players, names);
    expect(teams.get(1)!.threshold).toBe(73);
    expect(teams.get(2)!.threshold).toBe(48);

    const quality = 70;

    expect(isCalledUp(teams.get(1), quality)).toBe(false); // guclu ulke: yetmez
    expect(isCalledUp(teams.get(2), quality)).toBe(true); // zayif ulke: yeter
  });

  it('cifte vatandas IKI takima birden adaydir', () => {
    // Kaynakta "France  Nigeria" gercekten var; cagiran oyuncuyu iki satirla
    // gecer ve iki milli takim da onu gorur.
    const teams = buildNationalTeams(
      [
        { countryId: 1, quality: 88 },
        { countryId: 2, quality: 88 },
      ],
      names,
    );
    expect(teams.get(1)!.squadSize).toBe(1);
    expect(teams.get(2)!.squadSize).toBe(1);
  });

  it('milli maclar YALNIZCA milli ara haftalarinda', () => {
    const teams = buildNationalTeams(
      [1, 2, 3, 4].map((countryId) => ({ countryId, quality: 80 })),
      new Map([1, 2, 3, 4].map((i) => [i, `U${i}`])),
    );
    const windows = [5, 11, 17];
    const fixtures = buildNationalFixtures(teams, windows, new Rng(2));

    expect(fixtures.length).toBe(windows.length * 2); // 4 takim -> 2 mac/pencere
    for (const f of fixtures) expect(windows).toContain(f.week);
  });
});

// ------------------------------------------------------------------ motor kancasi

describe('reportWorldEvent -- host motora dis dunyayi bildirir', () => {
  async function engine(): Promise<GameEngine> {
    const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
    const e = new GameEngine(loaded.registry!, { seed: 4242 });
    e.start('street');
    return e;
  }

  it('milli mac sayaci ARTAR -- icerik bu flage yazamaz, motor yazar', async () => {
    // `milli_mac_sayisi` bir `derived` flag; ReadOnlyFlagRule iceriklerin
    // yazmasini yasaklar. Ama hicbir sey de yazmiyordu: kariyer boyunca 0
    // kaliyor ve progression.json'daki 1.5 agirligi hic devreye girmiyordu.
    const e = await engine();
    expect(e.snapshot().flags['milli_mac_sayisi']).toBe(0);

    e.reportWorldEvent({ kind: 'national_call', matches: 2 });
    e.reportWorldEvent({ kind: 'national_call', matches: 3 });

    expect(e.snapshot().flags['milli_mac_sayisi']).toBe(5);
  });

  it('milli davet national_duty hayat durumunu acar', async () => {
    const e = await engine();
    e.reportWorldEvent({ kind: 'national_call', matches: 2 });
    expect(e.snapshot().lifeState).toBe('national_duty');
  });

  it('kupa sayaci artar ve SOHRETE islenir', async () => {
    // progression.json: kupa_sayisi agirligi 25 -- tek kupa sohreti gorunur
    // olcude yukseltmeli.
    const e = await engine();
    const before = e.snapshot().stature;
    expect(e.snapshot().flags['kupa_sayisi']).toBe(0);

    for (let i = 0; i < 8; i += 1) e.reportWorldEvent({ kind: 'trophy', competitionId: 'cup' });

    expect(e.snapshot().flags['kupa_sayisi']).toBe(8);
    // 8 kupa x 25 = 200 puan; sohret esikleri 60/130/220... yukselmeli.
    expect(e.snapshot().stature).not.toBe(before);
  });
});
