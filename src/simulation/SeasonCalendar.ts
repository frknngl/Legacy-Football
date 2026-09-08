/**
 * SEZON TAKVIMI -- iki asamali kurulum.
 *
 *   1. Turnuvalar TUR TALEBI uretir (hafta bilmezler)
 *   2. `placeRounds` tek hakem olarak talepleri slotlara dagitir
 *
 * Onceki surumun olculen hatalari ve nasil kapandiklari:
 *
 *   Farkli lig, farkli ritim   -> oransal yayilim (RoundPlacer)
 *   65 sessizce dusen fikstur  -> FixtureIndex + fixturesFor()
 *   Kurayla belirlenen kupa    -> durumlu CupCompetition
 *   Milli ara yok              -> internationalWindows, kulup fiksturune kapali
 *
 * GERIYE DONUK UYUM:
 *   `buildSeasonSchedule(options, rng)` imzasi ve `Fixture` / `SeasonSchedule`
 *   tipleri korunuyor; `forClub` hala calisiyor ama artik BIRINCIL maci
 *   donduruyor ve `fixturesFor` hepsini veriyor.
 */

import {
  DEFAULT_CONSTRAINTS,
  type CalendarConstraints,
  type Fixture,
  type ReservedRound,
  type Tie,
  type RoundRequest,
  type SeasonSchedule,
  type SlotKind,
} from '../domain/calendar.js';
import type { ClubInfo, LeagueInfo } from '../domain/roster.js';
import type { Rng } from '../selection/Rng.js';
import { buildLeagueRounds } from './competitions/LeagueCompetition.js';
import { CupCompetition, roundCount } from './competitions/CupCompetition.js';
import { ContinentalCompetition } from './competitions/ContinentalCompetition.js';
import { placeRounds } from './RoundPlacer.js';
import type { FixtureIndex } from './FixtureIndex.js';

export type { Fixture, SeasonSchedule, SlotKind } from '../domain/calendar.js';
export { CalendarError } from '../domain/calendar.js';

/** Bir turnuvanin takvim sekli. `world.db.competition` satiriyla birebir. */
export interface CompetitionShape {
  readonly id: string;
  readonly clubIds: readonly string[];
  /** Kulup basina mac sayisi -- VERIDEN gelir, formulle hesaplanmaz. */
  readonly matchesPerClub?: number;
  readonly window?: { readonly start: number; readonly end: number };
  readonly prefer?: SlotKind;
}

/** Bir kupa turnuvasi. Gercek dunyada ULKE BASINA bir tane olur. */
export interface CupShape {
  readonly id: string;
  readonly clubIds: readonly string[];
  readonly startWeek?: number;
}

export interface CalendarOptions {
  readonly weeks: number;
  readonly clubs: readonly ClubInfo[];
  readonly leagues: readonly LeagueInfo[];
  /**
   * Ligleri acikca tanimlar. Verilmezse `clubs`/`leagues`ten cift devre
   * varsayimiyla turetilir -- mock dunya boyle calisiyor.
   */
  readonly competitions?: readonly CompetitionShape[];
  readonly cupStartWeek?: number;
  readonly constraints?: Partial<CalendarConstraints>;
  /** Kupayi tamamen kapatmak icin false. */
  readonly cup?: boolean;
  /**
   * Kupalar. Verilmezse TUM kuluplerden tek bir kupa kurulur -- mock dunyanin
   * davranisi budur ve oyle kalir. Gercek dunyada ulke basina bir kupa
   * gecilir; 303 kulubu tek kuraya sokmak futbol degil.
   */
  readonly cups?: readonly CupShape[];
  /** Kita turnuvasi (Sampiyonlar Ligi). Verilmezse kurulmaz. */
  readonly continental?: ContinentalShape;
}

/** Kita turnuvasinin sekli. Katilimcilar `qualify()` ile secilir. */
export interface ContinentalShape {
  readonly id: string;
  readonly clubIds: readonly string[];
  readonly groupSize?: number;
  readonly advancePerGroup?: number;
  readonly window?: { readonly start: number; readonly end: number };
}

export interface BuiltSeason extends SeasonSchedule {
  /** Kupa durumu -- eslesmeler mac sonuclariyla acilir. */
  readonly cupState: CupCompetition | undefined;
  /** Tum kupalar, id'ye gore. Gercek dunyada ulke basina bir tane. */
  readonly cups: ReadonlyMap<string, CupCompetition>;
  /** Kita turnuvasi durumu -- gruplar bitince eleme buradan acilir. */
  readonly continental: ContinentalCompetition | undefined;
  readonly continentalId: string | undefined;
  /**
   * Rezerve edilmis bir turu GERCEK eslesmelerle doldurur.
   *
   * Mimarinin ikinci yarisi: takvim zamani sezon basinda ayirdi, kim
   * oynayacagi ancak onceki tur bitince belli oldu. `CupCompetition.advance()`
   * kazananlari verir, burasi onlari o hafta ve slota yazar.
   *
   * Bilinmeyen tur icin cagrilirsa bos donulur -- rezervasyonu olmayan bir
   * tura fikstur yazmak takvimin kapasitesini asardi.
   */
  materializeRound(competitionId: string, roundIndex: number, ties: readonly Tie[]): readonly Fixture[];
}

/** Lig penceresi: sezonun tamamina yayilir, son iki hafta finaller icin serbest. */
const LEAGUE_WINDOW = { start: 1, end: 38 };

export function buildSeasonSchedule(options: CalendarOptions, rng: Rng): BuiltSeason {
  const constraints: CalendarConstraints = {
    ...DEFAULT_CONSTRAINTS,
    weeks: options.weeks,
    ...options.constraints,
  };

  const shapes = options.competitions ?? deriveShapes(options);
  const requests: RoundRequest[] = [];

  // 1) Ligler once -- hafta sonu slotunu kaparlar.
  for (const shape of shapes) {
    requests.push(
      ...buildLeagueRounds(
        {
          id: shape.id,
          clubIds: shape.clubIds,
          window: shape.window ?? LEAGUE_WINDOW,
          ...(shape.matchesPerClub === undefined ? {} : { matchesPerClub: shape.matchesPerClub }),
          ...(shape.prefer === undefined ? {} : { prefer: shape.prefer }),
        },
        rng,
      ),
    );
  }

  // 2) Kupalar -- tum basamaklar ayni kurada, hafta ici slotlara duser.
  const cups = new Map<string, CupCompetition>();
  if (options.cup !== false) {
    const shapes =
      options.cups ?? [{ id: 'cup', clubIds: options.clubs.map((c) => c.id) }];

    for (const shape of shapes) {
      if (shape.clubIds.length < 4) continue;
      const start = shape.startWeek ?? options.cupStartWeek ?? 4;
      const cup = new CupCompetition(
        {
          id: shape.id,
          clubIds: shape.clubIds,
          window: { start, end: constraints.weeks },
          prefer: 'midweek',
          // ARALIK UYARLANIR: sabit 4 hafta, 9 turluk bir kupada (303 kulup)
          // pencereye sigmiyor ve takvim hakli olarak hata atiyordu. Aralik
          // artik tur sayisindan turer.
          minGapWeeks: adaptiveGap(start, constraints, roundCount(shape.clubIds.length)),
        },
        rng,
      );
      cups.set(shape.id, cup);
      requests.push(...cup.requests(cup.seed()));
    }
  }

  // 3) Kita turnuvasi -- EN SON, cunku hafta ici slotlarin kalanina yerlesir.
  //    Once gelseydi lig turlarini hafta ici slota iterdi ve sezon uzardi.
  let continental: ContinentalCompetition | undefined;
  const continentalId = options.continental?.id;
  if (options.continental !== undefined && options.continental.clubIds.length >= 4) {
    const shape = options.continental;
    continental = new ContinentalCompetition(
      {
        id: shape.id,
        clubIds: shape.clubIds,
        groupSize: shape.groupSize ?? 4,
        advancePerGroup: shape.advancePerGroup ?? 2,
        window: shape.window ?? { start: 3, end: constraints.weeks },
        prefer: 'midweek',
      },
      rng,
    );
    continental.seed();
    requests.push(...continental.requests());
  }

  const { index, reserved } = placeRounds(requests, constraints);
  return toSchedule(index, reserved, constraints, cups, continental, continentalId);
}

/**
 * `clubs` + `leagues`ten lig sekli turetir.
 *
 * Mac sayisi verilmedigi icin cift devre varsayilir -- mock dunyanin davranisi
 * budur ve oyle kalir. Gercek dunyada (`world.db`) sayi VERIDEN gelir ve
 * cagiran `competitions` ile acikca gecer.
 */
function deriveShapes(options: CalendarOptions): CompetitionShape[] {
  return options.leagues
    .map((league) => ({
      id: league.id,
      clubIds: options.clubs.filter((c) => c.league === league.id).map((c) => c.id),
      window: LEAGUE_WINDOW,
      prefer: 'weekend' as SlotKind,
    }))
    .filter((s) => s.clubIds.length >= 2);
}

/**
 * Tur araligi: pencereye sigacak en genis aralik.
 *
 * Sabit bir sayi (eski hali: 4) tur sayisi buyudukce sigmaz. 303 kuluplu bir
 * kupa 9 tur eder; 32 uygun haftaya 4'er aralikla 9 tur girmez ve takvim --
 * dogru davranarak -- hata atar. Aralik tur sayisindan turerse hem sigar hem
 * turlar sezona yayilir.
 */
function adaptiveGap(
  start: number,
  constraints: CalendarConstraints,
  rounds: number,
): number {
  const blocked = new Set(constraints.internationalWindows);
  let available = 0;
  for (let w = start; w <= constraints.weeks; w += 1) if (!blocked.has(w)) available += 1;
  if (rounds <= 1) return 0;
  return Math.max(1, Math.floor(available / rounds));
}

function toSchedule(
  index: FixtureIndex,
  reserved: readonly ReservedRound[],
  constraints: CalendarConstraints,
  cups: ReadonlyMap<string, CupCompetition>,
  continental: ContinentalCompetition | undefined,
  continentalId: string | undefined,
): BuiltSeason {
  const internationalWindows = [...constraints.internationalWindows].filter(
    (w) => w >= 1 && w <= constraints.weeks,
  );
  const blocked = new Set(internationalWindows);

  return {
    weeks: constraints.weeks,
    // Getter: materialize sonrasi liste BUYUR. Sabit bir kopya donmek
    // "kupa maclari gorunmuyor" hatasini uretirdi.
    get fixtures() {
      return index.fixtures();
    },
    reservedRounds: reserved,
    internationalWindows,
    cups,
    cupState: [...cups.values()][0],
    continental,
    continentalId,
    byWeek: (week) => index.weekOf(week),
    fixturesFor: (clubId, week) => index.forClub(clubId, week),
    forClub: (clubId, week) => index.forClub(clubId, week)[0],
    isInternationalWeek: (week) => blocked.has(week),
    materializeRound: (competitionId, roundIndex, ties) => {
      const slot = reserved.find(
        (r) => r.competitionId === competitionId && r.roundIndex === roundIndex,
      );
      if (!slot) return [];

      const added: Fixture[] = [];
      for (const tie of ties) {
        const fixture: Fixture = {
          week: slot.slot.week,
          slot: slot.slot.kind,
          homeId: tie.home,
          awayId: tie.away,
          importance: slot.importance,
          competitionId,
          round: slot.roundLabel,
          roundIndex,
        };
        index.add(fixture);
        added.push(fixture);
      }
      return added;
    },
  };
}

/**
 * Bir kulubun sezon boyunca oynadigi mac sayisi -- denetim ve test icin.
 * Ayni ligdeki her kulup icin AYNI olmali; degilse fikstur bozuktur.
 */
export function matchCountFor(schedule: SeasonSchedule, clubId: string): number {
  return schedule.fixtures.filter((f) => f.homeId === clubId || f.awayId === clubId).length;
}
