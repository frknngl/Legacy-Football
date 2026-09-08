/**
 * KITA TURNUVASI -- grup asamasi + eleme. (Sampiyonlar Ligi yapisi.)
 *
 * IKI FAZLI, ve fazlarin takvimle iliskisi FARKLI:
 *
 *   GRUP  : eslesmeler kurada belli olur -> takvim hem zamani hem eslesmeyi alir
 *   ELEME : eslesmeler gruplar bitince belli olur -> takvim yalnizca ZAMANI alir
 *
 * Bu ayrim kupadakiyle ayni ilkeden gelir ve ayni sebeple sart: eleme
 * haftalarini sezon basinda ayirmazsak lig fiksturu onlari doldurur ve
 * turnuva sezona sigmaz.
 *
 * KATILIM:
 *   Onceki sezonun lig siralamasindan gelir. Ilk sezonda siralama yoktur;
 *   kulup itibari kullanilir. `qualify()` bu iki durumu da karsilar.
 *
 * NEDEN GRUP BASI IKI:
 *   16 kulup eleme = 4 tur (son 16, ceyrek, yari, final). 8 grup x 4 kulup =
 *   32 katilimci, 6 grup maci. Toplam 10 tur -- elit kulubun 38 lig + 6 kupa
 *   maci ustune sigar (olculdu: 54 mac / 35 uygun hafta, kapasite 70).
 */

import type { RoundRequest, SlotKind, Tie } from '../../domain/calendar.js';
import type { MatchImportance } from '../../domain/match.js';
import type { Rng } from '../../selection/Rng.js';
import { roundRobin } from './LeagueCompetition.js';

export interface ContinentalSpec {
  readonly id: string;
  readonly clubIds: readonly string[];
  /** Grup basina kulup. 4 -> cift devre 6 mac. */
  readonly groupSize: number;
  /** Her gruptan kac kulup elemeye kalir. */
  readonly advancePerGroup: number;
  readonly window: { readonly start: number; readonly end: number };
  readonly prefer?: SlotKind;
  readonly minGapWeeks?: number;
}

export interface GroupRow {
  clubId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

/**
 * Kulup itibarina gore katilimci secer.
 *
 * `standings` verilirse (ikinci sezondan itibaren) lig siralamasi kullanilir:
 * her ligin ilk `perLeague` kulubu. Yoksa itibar siralamasi -- ilk sezonda
 * baska bir olcut yok.
 */
export function qualify(
  clubsByLeague: ReadonlyMap<string, readonly { id: string; reputation: number }[]>,
  perLeague: number,
  total: number,
  order?: ReadonlyMap<string, readonly string[]>,
): string[] {
  const picked: { id: string; reputation: number }[] = [];

  for (const [league, clubs] of clubsByLeague) {
    const ranked = order?.get(league);
    const top =
      ranked === undefined
        ? [...clubs].sort((a, b) => b.reputation - a.reputation)
        : ranked
            .map((id) => clubs.find((c) => c.id === id))
            .filter((c): c is { id: string; reputation: number } => c !== undefined);
    picked.push(...top.slice(0, perLeague));
  }

  // Kontenjan asilirsa en itibarlilar kalir -- gercek katsayi sisteminin
  // kaba ama dogru yonlu karsiligi.
  return picked
    .sort((a, b) => b.reputation - a.reputation)
    .slice(0, total)
    .map((c) => c.id);
}

export class ContinentalCompetition {
  private readonly groups: string[][] = [];
  private readonly tables = new Map<string, Map<string, GroupRow>>();
  private readonly groupRounds: Tie[][] = [];
  private knockoutRounds = 0;
  private knockoutIndex = -1;
  private championId: string | undefined;

  constructor(
    private readonly spec: ContinentalSpec,
    private readonly rng: Rng,
  ) {}

  /** Grup kurasi + fikstur. Eleme turlarinin SAYISI da burada belli olur. */
  seed(): void {
    const ids = this.rng.shuffle([...this.spec.clubIds]);
    const groupCount = Math.max(1, Math.floor(ids.length / this.spec.groupSize));

    for (let g = 0; g < groupCount; g += 1) this.groups.push([]);
    // Yilan dagitimi degil duz dagitim: torba sistemi yok, itibar zaten
    // katilimci secerken kullanildi.
    ids.slice(0, groupCount * this.spec.groupSize).forEach((id, i) => {
      this.groups[i % groupCount]!.push(id);
    });

    for (const [index, group] of this.groups.entries()) {
      const table = new Map<string, GroupRow>();
      for (const clubId of group) table.set(clubId, emptyRow(clubId));
      this.tables.set(groupKey(index), table);
    }

    // Her grup ayni sayida tur oynar; turlar gruplar arasinda BIRLESTIRILIR
    // ki takvimde tek bir "Avrupa haftasi" olsun.
    const perGroup = this.groups.map((g) => roundRobin(g));
    const singleLength = perGroup[0]?.length ?? 0;

    for (let leg = 0; leg < 2; leg += 1) {
      for (let r = 0; r < singleLength; r += 1) {
        const ties: Tie[] = [];
        for (const rounds of perGroup) {
          const round = rounds[r];
          if (!round) continue;
          for (const tie of round) {
            ties.push(leg === 0 ? tie : { home: tie.away, away: tie.home });
          }
        }
        this.groupRounds.push(ties);
      }
    }

    const advancing = this.groups.length * this.spec.advancePerGroup;
    this.knockoutRounds = advancing < 2 ? 0 : Math.ceil(Math.log2(advancing));
  }

  get groupRoundCount(): number {
    return this.groupRounds.length;
  }

  get knockoutRoundCount(): number {
    return this.knockoutRounds;
  }

  /**
   * Takvim talepleri.
   *
   * Grup turlari eslesmeleriyle, eleme turlari eslesmesiz gider. Toplam tur
   * sayisi `totalRounds`ta birlesir ki oransal yayilim turnuvanin TAMAMINI
   * pencereye dagitsin -- gruplar basa, eleme sona.
   */
  requests(): RoundRequest[] {
    const total = this.groupRounds.length + this.knockoutRounds;
    const participants = this.groups.flat();
    const prefer = this.spec.prefer ?? 'midweek';
    const out: RoundRequest[] = [];

    this.groupRounds.forEach((ties, i) => {
      out.push({
        competitionId: this.spec.id,
        roundIndex: i,
        totalRounds: total,
        roundLabel: `grup ${i + 1}`,
        importance: 'european',
        window: this.spec.window,
        prefer,
        participants,
        ties,
        ...(this.spec.minGapWeeks === undefined ? {} : { minGapWeeks: this.spec.minGapWeeks }),
      });
    });

    for (let k = 0; k < this.knockoutRounds; k += 1) {
      const index = this.groupRounds.length + k;
      const remaining = this.knockoutRounds - k;
      out.push({
        competitionId: this.spec.id,
        roundIndex: index,
        totalRounds: total,
        roundLabel: knockoutLabel(remaining),
        importance: (remaining === 1 ? 'cup_final' : 'european') as MatchImportance,
        window: this.spec.window,
        prefer,
        // Kim kalacagi gruplar bitmeden bilinmez -- takvim yalnizca zamani ayirir.
        participants: [],
        ...(this.spec.minGapWeeks === undefined ? {} : { minGapWeeks: this.spec.minGapWeeks }),
      });
    }

    return out;
  }

  /** Grup macinin skorunu tabloya isler. Eleme maclari tabloyu etkilemez. */
  recordGroup(homeId: string, awayId: string, homeGoals: number, awayGoals: number): void {
    const index = this.groups.findIndex((g) => g.includes(homeId) && g.includes(awayId));
    if (index < 0) return;
    const table = this.tables.get(groupKey(index));
    const home = table?.get(homeId);
    const away = table?.get(awayId);
    if (!home || !away) return;

    home.played += 1;
    away.played += 1;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;

    if (homeGoals > awayGoals) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (homeGoals < awayGoals) {
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

  standings(groupIndex: number): readonly GroupRow[] {
    const table = this.tables.get(groupKey(groupIndex));
    if (!table) return [];
    return [...table.values()].sort(
      (a, b) =>
        b.points - a.points ||
        b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
        b.goalsFor - a.goalsFor,
    );
  }

  /**
   * Gruplari kapatir ve ilk eleme turunu kurar.
   *
   * Kura: gruptan birinci cikanlar ikincilerle eslesir -- gercek turnuvanin
   * kurali ve grup basariligini anlamli kilan sey.
   */
  startKnockout(): Tie[] {
    const winners: string[] = [];
    const runners: string[] = [];

    this.groups.forEach((_, index) => {
      const rows = this.standings(index);
      rows.slice(0, this.spec.advancePerGroup).forEach((row, position) => {
        (position === 0 ? winners : runners).push(row.clubId);
      });
    });

    const shuffledRunners = this.rng.shuffle([...runners]);
    const ties: Tie[] = [];
    for (let i = 0; i < winners.length; i += 1) {
      const away = shuffledRunners[i];
      if (away === undefined) break;
      // Grup birincisi rovans avantaji yerine EV SAHIBI olur (tek maclik yapi).
      ties.push({ home: winners[i]!, away });
    }

    this.knockoutIndex = 0;
    return ties;
  }

  /** Kazananlardan bir sonraki eleme turunu kurar. */
  advance(winners: readonly string[]): Tie[] | undefined {
    if (winners.length <= 1) {
      this.championId = winners[0];
      return undefined;
    }

    const shuffled = this.rng.shuffle([...winners]);
    const ties: Tie[] = [];
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      ties.push({ home: shuffled[i]!, away: shuffled[i + 1]! });
    }

    this.knockoutIndex += 1;
    return ties;
  }

  /** Eleme turunun takvimdeki tur indeksi. */
  roundIndexFor(knockoutRound: number): number {
    return this.groupRounds.length + knockoutRound;
  }

  get currentKnockoutRound(): number {
    return this.knockoutIndex;
  }

  champion(): string | undefined {
    return this.championId;
  }

  participants(): readonly string[] {
    return this.groups.flat();
  }
}

function emptyRow(clubId: string): GroupRow {
  return {
    clubId,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
  };
}

function groupKey(index: number): string {
  return String.fromCharCode(65 + index);
}

function knockoutLabel(remaining: number): string {
  if (remaining === 1) return 'final';
  if (remaining === 2) return 'yari final';
  if (remaining === 3) return 'ceyrek final';
  return `son ${2 ** remaining}`;
}
