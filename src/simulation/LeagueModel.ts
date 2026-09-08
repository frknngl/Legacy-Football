/**
 * Lig modeli -- puan durumu, ucuz mac cozumu, sezon sonu yukselme/dusme.
 *
 * PERFORMANS SINIRI: yalnizca Hero'nun maci dakika dakika simule edilir. Ayni
 * haftanin diger 16 fiksturu burada Poisson benzeri ucuz bir modelle cozulur.
 * `simulate --careers 20` = 20 x 1000 tur; her turda 17 maci dakika dakika
 * kosmak kabul edilemez.
 */

import type { ClubInfo, LeagueInfo, StandingRow } from '../domain/roster.js';
import type { Rng } from '../selection/Rng.js';
import type { Fixture } from './SeasonCalendar.js';

export interface TableRow {
  clubId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface MatchScore {
  readonly homeGoals: number;
  readonly awayGoals: number;
}

export interface SeasonOutcome {
  readonly champions: Readonly<Record<string, string>>;
  readonly promoted: readonly { clubId: string; from: string; to: string }[];
  readonly relegated: readonly { clubId: string; from: string; to: string }[];
}

/** Ev sahibi avantaji -- gercek liglerde ~%55 puan payi uretir. */
const HOME_EDGE = 0.25;

export class LeagueModel {
  private readonly tables = new Map<string, Map<string, TableRow>>();
  private readonly clubById = new Map<string, ClubInfo>();
  /** Kulup lig degistirebilir; canli esleme burada tutulur. */
  private readonly leagueOf = new Map<string, string>();

  constructor(
    clubs: readonly ClubInfo[],
    private readonly leagues: readonly LeagueInfo[],
  ) {
    for (const c of clubs) {
      this.clubById.set(c.id, c);
      this.leagueOf.set(c.id, c.league);
    }
    this.resetSeason();
  }

  resetSeason(): void {
    this.tables.clear();
    for (const [clubId, league] of this.leagueOf) {
      const table = this.tables.get(league) ?? new Map<string, TableRow>();
      table.set(clubId, {
        clubId,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
      });
      this.tables.set(league, table);
    }
  }

  /** Bir kulubun gucu: itibar + kadro kalitesi yerine tek eksen (ucuz cozum icin). */
  strength(clubId: string): number {
    return this.clubById.get(clubId)?.reputation ?? 40;
  }

  leagueFor(clubId: string): string | undefined {
    return this.leagueOf.get(clubId);
  }

  /**
   * Bir fiksturu UCUZ cozer: guc farkindan beklenen gol sayisi, Poisson benzeri
   * bir cekilisle skora donusur.
   */
  resolveCheap(fixture: Fixture, rng: Rng): MatchScore {
    const home = this.strength(fixture.homeId);
    const away = this.strength(fixture.awayId);
    // Guc farki gol beklentisine logaritmik olarak yansir: 40 puanlik fark
    // maci belirler ama garanti etmez.
    const edge = (home - away) / 100;
    const homeXg = Math.max(0.15, 1.35 + edge * 1.6 + HOME_EDGE);
    const awayXg = Math.max(0.15, 1.35 - edge * 1.6);
    return { homeGoals: poisson(homeXg, rng), awayGoals: poisson(awayXg, rng) };
  }

  /** Skoru tabloya isler. Lig disi maclar (kupa/Avrupa) tabloyu etkilemez. */
  record(fixture: Fixture, score: MatchScore): void {
    if (fixture.importance !== 'league' || fixture.league === undefined) return;
    const table = this.tables.get(fixture.league);
    const home = table?.get(fixture.homeId);
    const away = table?.get(fixture.awayId);
    if (!home || !away) return;

    home.played += 1;
    away.played += 1;
    home.goalsFor += score.homeGoals;
    home.goalsAgainst += score.awayGoals;
    away.goalsFor += score.awayGoals;
    away.goalsAgainst += score.homeGoals;

    if (score.homeGoals > score.awayGoals) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (score.homeGoals < score.awayGoals) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  /** O haftanin Hero disindaki tum maclarini cozer. */
  playWeek(fixtures: readonly Fixture[], skipClubId: string | undefined, rng: Rng): void {
    for (const fixture of fixtures) {
      if (skipClubId !== undefined && (fixture.homeId === skipClubId || fixture.awayId === skipClubId)) {
        continue;
      }
      this.record(fixture, this.resolveCheap(fixture, rng));
    }
  }

  /** Puan durumu, sirali. `WorldProvider.standings` bunu doner. */
  standings(league: string): readonly StandingRow[] {
    const table = this.tables.get(league);
    if (!table) return [];
    return [...table.values()]
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
          b.goalsFor - a.goalsFor,
      )
      .map((row, i) => ({
        clubId: row.clubId,
        position: i + 1,
        played: row.played,
        points: row.points,
      }));
  }

  table(league: string): readonly TableRow[] {
    const rows = this.tables.get(league);
    if (!rows) return [];
    const order = this.standings(league);
    return order.map((s) => rows.get(s.clubId)!).filter(Boolean);
  }

  /**
   * Sezonu kapatir: sampiyonlari belirler, yukselme/dusme uygular.
   *
   * Kulubun `tier` degeri de guncellenir -- amator ligden cikan bir kulup
   * artik `lower` seviyededir ve Hero onunla birlikte tasinir.
   */
  finishSeason(): SeasonOutcome {
    const byLevel = [...this.leagues].sort((a, b) => a.level - b.level);
    const champions: Record<string, string> = {};
    const promoted: { clubId: string; from: string; to: string }[] = [];
    const relegated: { clubId: string; from: string; to: string }[] = [];

    for (const league of byLevel) {
      const order = this.standings(league.id);
      const champion = order[0]?.clubId;
      if (champion !== undefined) champions[league.id] = champion;

      const above = byLevel.find((l) => l.level === league.level - 1);
      const below = byLevel.find((l) => l.level === league.level + 1);

      if (above && league.promoted > 0) {
        for (const row of order.slice(0, league.promoted)) {
          promoted.push({ clubId: row.clubId, from: league.id, to: above.id });
        }
      }
      if (below && league.relegated > 0) {
        for (const row of order.slice(-league.relegated)) {
          relegated.push({ clubId: row.clubId, from: league.id, to: below.id });
        }
      }
    }

    // Once tasima, sonra tablo sifirlama -- sirasi onemli.
    for (const move of [...promoted, ...relegated]) {
      this.leagueOf.set(move.clubId, move.to);
      const club = this.clubById.get(move.clubId);
      const target = this.leagues.find((l) => l.id === move.to);
      if (club && target) {
        this.clubById.set(move.clubId, {
          ...club,
          league: move.to,
          tier: this.tierForLevel(target.level, club.tier),
          // Basamak degistiren kulubun itibari da kayar; aksi halde amator
          // ligden cikan kulup ertesi sezon yine dibe duser ve piramit donar.
          reputation: clampReputation(club.reputation + (target.level < levelOf(this.leagues, move.from) ? 8 : -8)),
        });
      }
    }

    this.resetSeason();
    return { champions, promoted, relegated };
  }

  clubs(): readonly ClubInfo[] {
    return [...this.clubById.values()];
  }

  club(clubId: string): ClubInfo | undefined {
    return this.clubById.get(clubId);
  }

  /**
   * Basamak seviyesinin kulup tier'i.
   *
   * Ust lig icinde elite/contender/mid birlikte yasar; yukselen kulup o ligin
   * TABAN tier'ine yerlesir, zirveye bir sezonda ciplamaz.
   */
  private tierForLevel(level: number, current: ClubInfo['tier']): ClubInfo['tier'] {
    if (level === 1) return current === 'elite' || current === 'contender' ? current : 'mid';
    if (level === 2) return 'lower';
    return 'amateur';
  }
}

function levelOf(leagues: readonly LeagueInfo[], id: string): number {
  return leagues.find((l) => l.id === id)?.level ?? 99;
}

function clampReputation(v: number): number {
  return Math.max(10, Math.min(99, v));
}

/** Knuth'un Poisson cekilisi -- tohumlu RNG ile deterministik. */
function poisson(lambda: number, rng: Rng): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng.next();
  } while (p > limit && k < 12);
  return k - 1;
}
