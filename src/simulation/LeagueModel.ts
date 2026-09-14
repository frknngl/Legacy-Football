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

/**
 * EV SAHIBI AVANTAJI -- `Timeline.HOME_ADVANTAGE` ile AYNI deger.
 *
 * OLCULEN SORUN: bu ucuz cozucu NPC maclarini (yani lig tablosunun
 * tamamini) belirler; `MatchSimulator` ise yalnizca Hero'nun macini. Ikisi
 * AYRI kalibre edilmisti:
 *
 *   ucuz cozucu   : 1.60 / 1.35 -> 2.95 gol/mac · ev payi %54.2
 *   simulator     : 0.94 / 0.90 -> 1.85 gol/mac · ev payi %51
 *
 * Yani Hero'nun macinda bir futbol, ligin geri kalaninda baska bir futbol
 * oynaniyordu. Hero'nun takimi tabloya simulator skoruyla, rakipleri ucuz
 * cozucu skoruyla yaziliyordu -- ayni ligde iki ayri gol rejimi.
 *
 * Ikisi de artik ayni hedefe kalibre: takim basi 1.33 gol, ev/deplasman
 * +/-%14 (bkz. `Timeline.HOME_ADVANTAGE` analitik tablosu).
 */
const HOME_EDGE = 0.14;

/** Denk takimlarda TAKIM BASI beklenen gol. Toplam ~2.66 -- gercek ~2.7. */
const BASE_XG_PER_TEAM = 1.33;

/** Kadro gucu kaymasinin itibara donusum carpani. Bkz. `strength()`. */
const SQUAD_SHIFT_SCALE = 2.5;
/** Kaymanin ust siniri -- transfer bir kulubu dunyanin en iyisi yapamaz. */
const SQUAD_SHIFT_CAP = 20;

export class LeagueModel {
  private readonly tables = new Map<string, Map<string, TableRow>>();
  private readonly clubById = new Map<string, ClubInfo>();
  /** Kulup lig degistirebilir; canli esleme burada tutulur. */
  private readonly leagueOf = new Map<string, string>();

  /**
   * Kadro gucu cozucusu -- OPSIYONEL.
   *
   * Verilmezse kulup gucu yalnizca `reputation`tan gelir (mock dunya ve
   * testler boyle calisir). Verilirse itibar CIPA olarak kalir ve kadronun
   * baslangicina gore ne kadar degistigi uzerine binder.
   */
  private readonly squadOverallOf: ((clubId: string) => number | undefined) | undefined;
  /** Kulup basina baslangic kadro gucu -- kayma bunun uzerinden olculur. */
  private readonly baselineSquad = new Map<string, number>();

  constructor(
    clubs: readonly ClubInfo[],
    private readonly leagues: readonly LeagueInfo[],
    squadOverallOf?: (clubId: string) => number | undefined,
  ) {
    this.squadOverallOf = squadOverallOf;
    for (const c of clubs) {
      this.clubById.set(c.id, c);
      this.leagueOf.set(c.id, c.league);
      if (squadOverallOf) {
        const base = squadOverallOf(c.id);
        if (base !== undefined) this.baselineSquad.set(c.id, base);
      }
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

  /**
   * Bir kulubun gucu -- ITIBAR CIPASI + KADRO KAYMASI.
   *
   * OLCULEN SORUN: burasi yalnizca `reputation` donduruyordu ve itibar
   * kariyer boyunca SABITTI (terfi/dusmede +/-8 disinda hic degismiyor).
   * Sonucu: transferler, kadro degisimi ve teknik direktor etkisi lig
   * macina HIC girmiyordu. 100 sezonluk olcumde bir kulup ligi %99-100
   * kazaniyordu -- kadrosu ne olursa olsun.
   *
   * NEDEN CIPA + KAYMA, DOGRUDAN KADRO GUCU DEGIL:
   *   `reputation` 18-96 bandina yayilmis (kadro piyasa degerinden
   *   yuzdelikle turetilmis), kadro gucu (`lines.overall`) ise 66-90
   *   bandinda -- cok daha dar. Dogrudan kadro gucunu kullanmak guc
   *   farkini ezer ve butun ligi yaziturasina cevirirdi. Itibari cipa
   *   tutmak kalibre edilmis dagilimi korur; kayma ise kadronun
   *   BASLANGICINA GORE ne kadar degistigini tasir.
   *
   *   Carpan 2.5: itibar bandi (~78) / kadro bandi (~24) oraninin altinda
   *   secildi. Bes puanlik bir kadro iyilesmesi itibara ~12 puan katar --
   *   sirayi degistirmeye yeter, tek basina belirlemeye yetmez.
   *
   * Kayma +/-20 ile SINIRLI: transferle bir kulubun dunyanin en iyisine
   * donusmesine izin vermek, duzeltmek istedigimiz sorunun aynasi olurdu.
   */
  strength(clubId: string): number {
    const reputation = this.clubById.get(clubId)?.reputation ?? 40;
    if (!this.squadOverallOf) return reputation;

    const base = this.baselineSquad.get(clubId);
    const now = this.squadOverallOf(clubId);
    if (base === undefined || now === undefined) return reputation;

    const shift = Math.max(-SQUAD_SHIFT_CAP, Math.min(SQUAD_SHIFT_CAP, (now - base) * SQUAD_SHIFT_SCALE));
    return clampReputation(reputation + shift);
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
    // SIMETRIK ev avantaji: toplam gol sabit kalir, fark acilir.
    // Tek tarafli eklemek (eski hali) toplam golu sisiriyordu.
    const homeXg = Math.max(0.15, (BASE_XG_PER_TEAM + edge * 1.6) * (1 + HOME_EDGE));
    const awayXg = Math.max(0.15, (BASE_XG_PER_TEAM - edge * 1.6) * (1 - HOME_EDGE));
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
   * Bir basamak yukari (-1) ya da asagi (+1) komsu lig.
   *
   * Ulke bilinmiyorsa (mock dunya) eski davranis: o seviyedeki ilk lig.
   * Ulke biliniyorsa AYNI ULKEDE aranir; o ulkede o basamak yoksa terfi ya
   * da dusme OLMAZ -- kulubu baska bir ulkenin piramidine tasimaktansa
   * yerinde birakmak dogru.
   */
  private neighbour(
    byLevel: readonly LeagueInfo[],
    league: LeagueInfo,
    step: -1 | 1,
  ): LeagueInfo | undefined {
    const level = league.level + step;
    if (league.country === undefined) return byLevel.find((l) => l.level === level);
    return byLevel.find((l) => l.level === level && l.country === league.country);
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

      // KOMSU BASAMAK AYNI ULKEDE ARANIR.
      //
      // OLCULEN SORUN: burasi `byLevel.find((l) => l.level === ...)` idi ve
      // `find` o seviyedeki ILK ligi donduruyordu -- ulkeden bagimsiz. Cok
      // ulkeli bir dunyada butun 2. ligler ayni tek 1. lige terfi etti,
      // butun 1. ligler ayni tek 2. lige dustu:
      //
      //   TERFI  English Division 2 -> Dutch Division 1
      //   TERFI  French Division 2  -> Dutch Division 1
      //   DUSME  German Division 1  -> English Division 2
      //
      // Dokuz sezonda 21 ligin 19'u bosaldi (Dutch D1 30 -> 96 kulup,
      // English D2 45 -> 156, digerleri 0) ve dunya iki lige coktu.
      //
      // Mock dunyada her seviyede TEK lig oldugu icin (tr_1 / tr_2 /
      // tr_amateur) `country` tanimsizdir ve eski davranis korunur --
      // hata orada zaten gorunmuyordu, testlerin kacirma sebebi buydu.
      const above = this.neighbour(byLevel, league, -1);
      const below = this.neighbour(byLevel, league, +1);

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
