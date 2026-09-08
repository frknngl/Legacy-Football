/**
 * TAKVIM DEGISMEZLERI.
 *
 * "Tutarli takvim" bir his degil, bir kapidir. Asagidaki sekiz sey her sezonda,
 * her lig boyutunda ve her tohumda dogru olmak zorunda; biri kirilirsa fikstur
 * bozuktur ve bunu ancak o sezonu oynayan oyuncu fark eder.
 *
 * Testlerin cogu ONCEKI SURUMDE OLCULEN gercek hatalari sabitliyor:
 *   - 12 kuluplu lig 1-22, 10 kuluplu lig 1-35. haftaya yayiliyordu
 *   - 65 fikstur `forClub`ta sessizce dusuyordu
 *   - kupa finali sezon basinda belliydi, iki finalist hic mac oynamamisti
 */

import { describe, expect, it } from 'vitest';
import {
  buildSeasonSchedule,
  matchCountFor,
  type BuiltSeason,
} from '../src/simulation/SeasonCalendar.js';
import { CalendarError } from '../src/domain/calendar.js';
import { CupCompetition, roundCount } from '../src/simulation/competitions/CupCompetition.js';
import { buildLeagueRounds, roundRobin } from '../src/simulation/competitions/LeagueCompetition.js';
import { placeRounds } from '../src/simulation/RoundPlacer.js';
import type { ClubInfo, LeagueInfo } from '../src/domain/roster.js';
import { Rng } from '../src/selection/Rng.js';

function club(id: string, league: string): ClubInfo {
  return {
    id,
    name: id,
    city: '',
    stadium: '',
    tier: 'mid',
    league,
    reputation: 50,
    foreignRatio: 0,
  };
}

/** Farkli boyutta ligler -- asil sinav bu. */
function world(sizes: Readonly<Record<string, number>>): {
  clubs: ClubInfo[];
  leagues: LeagueInfo[];
} {
  const clubs: ClubInfo[] = [];
  const leagues: LeagueInfo[] = [];
  let level = 1;
  for (const [id, n] of Object.entries(sizes)) {
    leagues.push({ id, label: id, level: level++, promoted: 0, relegated: 0 });
    for (let i = 0; i < n; i += 1) clubs.push(club(`${id}_${i}`, id));
  }
  return { clubs, leagues };
}

function build(sizes: Readonly<Record<string, number>>, seed = 7): BuiltSeason {
  const { clubs, leagues } = world(sizes);
  return buildSeasonSchedule({ weeks: 40, clubs, leagues }, new Rng(seed));
}

// ------------------------------------------------------------------ 1-2

describe('lig fiksturu', () => {
  it('her kulup ligin BEYAN ETTIGI kadar mac oynar -- boyut farketmez', () => {
    const sizes = { big: 20, mid: 14, small: 10 };
    const schedule = build(sizes);

    for (const [id, n] of Object.entries(sizes)) {
      const expected = 2 * (n - 1);
      for (let i = 0; i < n; i += 1) {
        const played = schedule.fixtures.filter(
          (f) => f.league === id && (f.homeId === `${id}_${i}` || f.awayId === `${id}_${i}`),
        ).length;
        expect(played, `${id}_${i}`).toBe(expected);
      }
    }
  });

  it('mac sayisi DISARIDAN verilebilir -- MLS 30 kulup / 33 mac', () => {
    // Gercek veride formul tutmuyor; sayi veriden gelir.
    const rounds = buildLeagueRounds(
      {
        id: 'mls',
        clubIds: Array.from({ length: 30 }, (_, i) => `c${i}`),
        matchesPerClub: 33,
        window: { start: 1, end: 38 },
      },
      new Rng(1),
    );
    expect(rounds).toHaveLength(33);
    // Her tur her kulube tam bir mac verir -> her kulup 33 mac.
    const counts = new Map<string, number>();
    for (const r of rounds) {
      for (const t of r.ties ?? []) {
        counts.set(t.home, (counts.get(t.home) ?? 0) + 1);
        counts.set(t.away, (counts.get(t.away) ?? 0) + 1);
      }
    }
    expect([...new Set(counts.values())]).toEqual([33]);
  });

  it('ev/deplasman dengeli', () => {
    const schedule = build({ a: 18, b: 12 });
    const ids = [...new Set(schedule.fixtures.flatMap((f) => [f.homeId, f.awayId]))];
    for (const id of ids) {
      const home = schedule.fixtures.filter((f) => f.league && f.homeId === id).length;
      const away = schedule.fixtures.filter((f) => f.league && f.awayId === id).length;
      expect(Math.abs(home - away), id).toBeLessThanOrEqual(1);
    }
  });

  it('tek sayida kulupte her tur bir takim bos gecer', () => {
    const rounds = roundRobin(['a', 'b', 'c', 'd', 'e']);
    expect(rounds).toHaveLength(5);
    for (const r of rounds) expect(r).toHaveLength(2); // 5 takim -> 2 mac + 1 bay
  });
});

// ------------------------------------------------------------------ 3-5

describe('takvim tutarliligi', () => {
  it('FARKLI BOYUTTAKI ligler AYNI araliga yayilir', () => {
    // Onceki surumde 12 kuluplu lig 1-22, 10 kuluplu lig 1-35 arasindaydi:
    // ayni dunyada iki farkli sezon.
    const schedule = build({ big: 20, mid: 14, small: 10 });

    const spans = ['big', 'mid', 'small'].map((id) => {
      const weeks = schedule.fixtures.filter((f) => f.league === id).map((f) => f.week);
      return { id, first: Math.min(...weeks), last: Math.max(...weeks) };
    });

    const firsts = spans.map((s) => s.first);
    const lasts = spans.map((s) => s.last);
    expect(Math.max(...firsts) - Math.min(...firsts)).toBeLessThanOrEqual(2);
    expect(Math.max(...lasts) - Math.min(...lasts)).toBeLessThanOrEqual(2);
  });

  it('hicbir kulup haftalik mac sinirini asmaz', () => {
    const schedule = build({ a: 20, b: 16, c: 12 });
    const ids = [...new Set(schedule.fixtures.flatMap((f) => [f.homeId, f.awayId]))];
    for (const id of ids) {
      for (let week = 1; week <= schedule.weeks; week += 1) {
        expect(schedule.fixturesFor(id, week).length, `${id} h${week}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('URETILEN her fikstur GORUNUR -- sessiz dusme yok', () => {
    // Onceki surumde `forClub` `.find()` kullaniyordu ve 65 fiksturu yutuyordu.
    const schedule = build({ a: 18, b: 14, c: 10 });
    const ids = [...new Set(schedule.fixtures.flatMap((f) => [f.homeId, f.awayId]))];

    let visible = 0;
    for (const id of ids) {
      for (let week = 1; week <= schedule.weeks; week += 1) {
        visible += schedule.fixturesFor(id, week).length;
      }
    }
    // Her fikstur iki kulup tarafindan gorulur.
    expect(visible).toBe(schedule.fixtures.length * 2);
  });

  it('sigmayan fikstur SESSIZCE dusmez, hata atar', () => {
    // 40 hafta, kulup basina 1 mac siniri, 46 turluk lig -> imkansiz.
    const { clubs, leagues } = world({ huge: 24 });
    expect(() =>
      buildSeasonSchedule(
        {
          weeks: 40,
          clubs,
          leagues,
          cup: false,
          constraints: { maxFixturesPerClubPerWeek: 1, internationalWindows: [] },
        },
        new Rng(3),
      ),
    ).toThrow(CalendarError);
  });
});

// ------------------------------------------------------------------ 6

describe('milli mac aralari', () => {
  it('milli ara haftalarinda HIC kulup maci yoktur', () => {
    const schedule = build({ a: 20, b: 12 });
    expect(schedule.internationalWindows.length).toBeGreaterThan(0);
    for (const week of schedule.internationalWindows) {
      expect(schedule.byWeek(week), `hafta ${week}`).toHaveLength(0);
      expect(schedule.isInternationalWeek(week)).toBe(true);
    }
  });

  it('milli ara kapatilirsa o haftalar kulube acilir', () => {
    const { clubs, leagues } = world({ a: 20 });
    const schedule = buildSeasonSchedule(
      { weeks: 40, clubs, leagues, cup: false, constraints: { internationalWindows: [] } },
      new Rng(5),
    );
    expect(schedule.internationalWindows).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ 7

describe('kupa', () => {
  it('tur sayisi kulup sayisindan turer', () => {
    expect(roundCount(16)).toBe(4);
    expect(roundCount(34)).toBe(6);
    expect(roundCount(2)).toBe(1);
  });

  it('takvim TUM turlarin zamanini sezon basinda ayirir', () => {
    // Ayirmazsa lig fiksturu haftalari doldurur ve kupa bir daha sigmaz.
    const schedule = build({ a: 16, b: 16 });
    // Tur basina BIR hafta -- fikstur basina degil (1. turda 16 eslesme var).
    const cupWeeks = [
      ...new Set([
        ...schedule.fixtures.filter((f) => f.competitionId === 'cup').map((f) => f.week),
        ...schedule.reservedRounds.filter((r) => r.competitionId === 'cup').map((r) => r.slot.week),
      ]),
    ];
    expect(cupWeeks.length).toBe(roundCount(32));
    // Turlar arasinda gercek bosluk var -- ust uste binmiyor.
    const sorted = [...cupWeeks].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(4);
    }
  });

  it('KAZANANI mac sonucu belirler, kura degil', () => {
    // Onceki surum her zaman ciftin ILKINI tur atlatiyordu; final sezon
    // basinda belliydi ve iki finalist hic mac oynamamisti.
    const ids = Array.from({ length: 8 }, (_, i) => `c${i}`);
    const cup = new CupCompetition(
      { id: 'cup', clubIds: ids, window: { start: 4, end: 40 } },
      new Rng(11),
    );

    let round = cup.seed();
    expect(round.ties).toHaveLength(4);

    // Her turda kasten DEPLASMAN takimini kazandir: bracket sonuclari izlemeli.
    const path: string[] = [];
    while (round.ties.length > 0) {
      const winners = round.ties.map((t) => t.away);
      path.push(...winners);
      const next = cup.advance(winners);
      if (!next) break;
      round = next;
      // Bir sonraki turdaki herkes onceki turun GERCEK kazanani olmali.
      for (const tie of round.ties) {
        expect(path).toContain(tie.home);
        expect(path).toContain(tie.away);
      }
    }
    expect(cup.champion()).toBeDefined();
    expect(path).toContain(cup.champion()!);
  });

  it('rezerve tur gercek eslesmelerle DOLDURULABILIR', () => {
    const { clubs, leagues } = world({ a: 16 });
    const schedule = buildSeasonSchedule({ weeks: 40, clubs, leagues }, new Rng(9));

    const reserved = schedule.reservedRounds.find((r) => r.competitionId === 'cup');
    expect(reserved).toBeDefined();

    const before = schedule.fixtures.length;
    const added = schedule.materializeRound('cup', reserved!.roundIndex, [
      { home: 'a_0', away: 'a_1' },
    ]);

    expect(added).toHaveLength(1);
    expect(added[0]!.week).toBe(reserved!.slot.week);
    expect(schedule.fixtures.length).toBe(before + 1);
    // Ve artik kulup uzerinden GORUNUYOR.
    expect(schedule.fixturesFor('a_0', reserved!.slot.week)).toContainEqual(added[0]);
  });

  it('bilinmeyen tur icin doldurma sessizce bos doner', () => {
    const schedule = build({ a: 16 });
    expect(schedule.materializeRound('cup', 999, [{ home: 'a_0', away: 'a_1' }])).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ 8

describe('determinizm', () => {
  it('ayni tohum ayni takvimi uretir', () => {
    const a = build({ x: 14, y: 10 }, 4242);
    const b = build({ x: 14, y: 10 }, 4242);
    expect(a.fixtures).toEqual(b.fixtures);
    expect(a.reservedRounds).toEqual(b.reservedRounds);
  });

  it('farkli tohum farkli fikstur uretir', () => {
    const a = build({ x: 14 }, 1);
    const b = build({ x: 14 }, 2);
    expect(a.fixtures).not.toEqual(b.fixtures);
    // Ama mac SAYISI degismez -- rastgelelik esitligi bozmaz.
    expect(matchCountFor(a, 'x_0')).toBe(matchCountFor(b, 'x_0'));
  });
});

// ------------------------------------------------------------------ yerlestirici

describe('yerlestirici', () => {
  it('pencerede hafta yoksa hata atar', () => {
    expect(() =>
      placeRounds(
        [
          {
            competitionId: 'x',
            roundIndex: 0,
            totalRounds: 1,
            roundLabel: 'tek',
            importance: 'league',
            window: { start: 5, end: 5 },
            prefer: 'weekend',
            participants: ['a', 'b'],
            ties: [{ home: 'a', away: 'b' }],
          },
        ],
        { weeks: 40, maxFixturesPerClubPerWeek: 2, internationalWindows: [5] },
      ),
    ).toThrow(CalendarError);
  });
});
