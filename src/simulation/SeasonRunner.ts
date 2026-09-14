/**
 * SEZON KOSUCUSU -- turnuvalari HAFTA HAFTA ilerletir.
 *
 * Eksik olan halkaydi: takvim zamani ayirdi, turnuva modelleri eslesmeyi
 * kurabiliyordu, ama ikisini birbirine baglayan kimse yoktu. Kupa 1. turu
 * oynaniyor, kazananlar hicbir yere yazilmiyor ve 2. tur hic kurulmuyordu.
 *
 * AKIS (her hafta):
 *   1. O haftanin fiksturleri cozulur (Hero'nunki haric -- onu motor oynatir)
 *   2. Lig maclari puan tablosuna, grup maclari grup tablosuna islenir
 *   3. Eleme turu tamamlandiysa kazananlar toplanir
 *   4. Kazananlardan sonraki tur kurulur ve REZERVE slota yazilir
 *
 * BERABERLIK:
 *   Ligde beraberlik sonuctur. Elemede DEGILDIR -- birinin turu gecmesi
 *   gerekir. Penalti atislari guc farkina hafifce yaslanan bir cekilisle
 *   cozulur; %50-50 yapmak elit kulubu amatore karsi ceza landirirdi,
 *   %80-20 yapmak da penaltiyi anlamsiz kilardi.
 */

import type { Fixture } from '../domain/calendar.js';
import type { Rng } from '../selection/Rng.js';
import type { BuiltSeason } from './SeasonCalendar.js';
import type { LeagueModel, MatchScore } from './LeagueModel.js';
import type { CupCompetition } from './competitions/CupCompetition.js';
import type { ContinentalCompetition } from './competitions/ContinentalCompetition.js';

export interface WeekReport {
  readonly week: number;
  readonly resolved: number;
  /** Bu hafta tamamlanan turlardan acilan yeni turlar. */
  readonly opened: readonly string[];
  /** Bu hafta belli olan sampiyonlar. */
  readonly champions: readonly { competitionId: string; clubId: string }[];
}

export interface SeasonRunnerOptions {
  readonly schedule: BuiltSeason;
  readonly league: LeagueModel;
  readonly continental?: ContinentalCompetition;
  readonly continentalId?: string;
}

export class SeasonRunner {
  /** fixtureKey -> skor. Eleme turlarinin kazananini buradan cikariyoruz. */
  private readonly results = new Map<string, MatchScore>();
  private readonly cups: ReadonlyMap<string, CupCompetition>;
  /**
   * Sezon basindan beri belli olan sampiyonlar. `cupChampion()` sorgular.
   * DIKKAT: bu KUMULATIF bir haritadir; hafta raporuna DOGRUDAN verilmez.
   */
  private readonly champions = new Map<string, string>();
  /**
   * YALNIZCA BU HAFTA tac giyenler.
   *
   * OLCULEN SORUN: hafta raporu `champions` haritasinin TAMAMINI
   * donduruyordu -- alanin kendi dokumantasyonu "Bu hafta belli olan
   * sampiyonlar" dedigi halde. Bir kupa kazanildiktan sonra sezonun kalan
   * her haftasi ayni sampiyonlugu yeniden bildiriyor, host da her
   * bildirimde `reportWorldEvent({kind:'trophy'})` cagiriyordu.
   *
   * Olculdu: tek bir kupa bir sezonda 10 KEZ sayildi; 100 kariyerde
   * `kupa_sayisi` ortancasi 82, maksimumu 618 oldu (gercekci tavan ~40).
   * Sohret formulunde kupanin agirligi 25 -- en agir girdi -- oldugu icin
   * 100 kariyerin 85'i `legend` kademesine cikti ve yedi kademeli
   * merdivenin ust ucu varsayilan hale geldi.
   */
  private crownedThisWeek: { competitionId: string; clubId: string }[] = [];
  /** Kupa basina: hangi tur indeksine kadar ilerledik. */
  private readonly cupRound = new Map<string, number>();
  private continentalPhase: 'group' | 'knockout' | 'done' = 'group';

  constructor(private readonly opts: SeasonRunnerOptions) {
    this.cups = opts.schedule.cups;
    for (const id of this.cups.keys()) this.cupRound.set(id, 0);
  }

  /**
   * Bir haftayi oynatir.
   *
   * `skipClubId` verilirse o kulubun maclari cozulmez -- Hero'nun maci dakika
   * dakika simule edilecek ve sonucu `recordHeroFixture` ile geri gelecek.
   */
  playWeek(week: number, skipClubId: string | undefined, rng: Rng): WeekReport {
    const fixtures = this.opts.schedule.byWeek(week);
    // Her hafta sifirdan: rapor YALNIZCA bu hafta tac giyenleri tasir.
    this.crownedThisWeek = [];
    let resolved = 0;

    for (const fixture of fixtures) {
      if (this.results.has(keyOf(fixture))) continue;
      if (
        skipClubId !== undefined &&
        (fixture.homeId === skipClubId || fixture.awayId === skipClubId)
      ) {
        continue;
      }
      this.apply(fixture, this.opts.league.resolveCheap(fixture, rng));
      resolved += 1;
    }

    const opened = this.advanceCompetitions(rng);
    return {
      week,
      resolved,
      opened,
      champions: this.crownedThisWeek,
    };
  }

  /**
   * Sezonu devreder -- LIG fiksturleri yeniden oynanabilir hale gelir.
   *
   * OLCULEN SORUN: `playWeek` bir fiksturu ikinci kez cozmemek icin
   * `results` haritasina bakar (`if (this.results.has(...)) continue`).
   * Bu harita sezonlar arasi HIC temizlenmiyordu. Sonuc: birinci sezonun
   * sonunda butun fikstur anahtarlari haritada oluyor ve IKINCI SEZONDAN
   * ITIBAREN DUNYADA HIC MAC OYNANMIYORDU.
   *
   * Olculdu (English Division 1):
   *   Sezon 1  West London Blue O38 G19 B9 M10 P66   <- saglikli, rekabetci
   *   Sezon 2  butun kulupler   O 0 G 0 B0 M 0 P 0   <- hic mac yok
   *   Sezon 3  ayni
   *
   * Bu ayni zamanda "sampiyonluk yogunlasmasi" olarak gorunen seyin de
   * sebebiydi: bos bir tabloda `standings()` butun kulupleri 0 puanla
   * doner ve sirali kalan ilk kulup her sezon "sampiyon" sayilir. Yani
   * bir kulubun ligi %99 kazanmasi bir denge sorunu DEGIL, hic mac
   * oynanmamasinin belirtisiydi.
   *
   * KAPSAM SINIRI: kupa ve kita turnuvasi bracket'leri burada YENIDEN
   * KURULMAZ. `materializeRound` takvim indeksine fikstur EKLER; yeniden
   * tohumlamak ayni haftalara kopya mac yazardi. Kupalar bu yuzden hala
   * kariyer basina bir kez oynanir -- ayri bir calisma konusu.
   */
  resetSeason(): void {
    this.results.clear();
    this.crownedThisWeek = [];
  }

  /** Hero'nun dakika dakika simule edilen macinin sonucunu isler. */
  recordHeroFixture(fixture: Fixture, score: MatchScore): void {
    this.apply(fixture, score);
  }

  cupChampion(cupId: string): string | undefined {
    return this.cups.get(cupId)?.champion();
  }

  continentalChampion(): string | undefined {
    return this.opts.continental?.champion();
  }

  /**
   * Bir turnuvaya sampiyon yazar -- YALNIZCA ILK KEZ.
   *
   * `advanceCup` / `advanceContinental` turnuva bittikten sonra da her
   * hafta cagrilir ve ayni sampiyonu yeniden bulur. Tekrar yazmak zararsiz
   * olurdu; tekrar RAPORLAMAK degil. Kapi burada.
   */
  private crown(competitionId: string, clubId: string | undefined): void {
    if (clubId === undefined || clubId === '') return;
    if (this.champions.has(competitionId)) return;
    this.champions.set(competitionId, clubId);
    this.crownedThisWeek.push({ competitionId, clubId });
  }

  private apply(fixture: Fixture, score: MatchScore): void {
    this.results.set(keyOf(fixture), score);
    this.opts.league.record(fixture, score);

    if (
      this.opts.continental !== undefined &&
      fixture.competitionId === this.opts.continentalId &&
      this.continentalPhase === 'group'
    ) {
      this.opts.continental.recordGroup(
        fixture.homeId,
        fixture.awayId,
        score.homeGoals,
        score.awayGoals,
      );
    }
  }

  // ------------------------------------------------------------- ilerletme

  private advanceCompetitions(rng: Rng): string[] {
    const opened: string[] = [];
    for (const [id, cup] of this.cups) opened.push(...this.advanceCup(id, cup, rng));
    opened.push(...this.advanceContinental(rng));
    return opened;
  }

  private advanceCup(id: string, cup: CupCompetition, rng: Rng): string[] {
    const round = cup.round();
    if (!round) return [];

    const played = round.ties.map((tie) =>
      this.results.get(`${id}:${round.index}:${tie.home}:${tie.away}`),
    );
    // Turun TAMAMI oynanmadan bir sonraki tur kurulamaz.
    if (played.some((s) => s === undefined)) return [];

    const winners = round.ties.map((tie, i) => this.winner(tie, played[i]!, rng));
    const next = cup.advance(winners);
    if (!next) {
      this.crown(id, cup.champion());
      return [];
    }

    const materialized = this.opts.schedule.materializeRound(id, next.index, next.ties);
    this.cupRound.set(id, next.index);
    return materialized.length > 0 ? [`${id}:${next.label}`] : [];
  }

  private advanceContinental(rng: Rng): string[] {
    const cl = this.opts.continental;
    const id = this.opts.continentalId;
    if (!cl || id === undefined || this.continentalPhase === 'done') return [];

    if (this.continentalPhase === 'group') {
      // Butun grup maclari oynandi mi.
      const groupFixtures = this.opts.schedule.fixtures.filter(
        (f) => f.competitionId === id && (f.roundIndex ?? 0) < cl.groupRoundCount,
      );
      if (groupFixtures.length === 0) return [];
      if (groupFixtures.some((f) => !this.results.has(keyOf(f)))) return [];

      const ties = cl.startKnockout();
      this.continentalPhase = 'knockout';
      const added = this.opts.schedule.materializeRound(id, cl.roundIndexFor(0), ties);
      return added.length > 0 ? [`${id}:son ${ties.length * 2}`] : [];
    }

    // Eleme: guncel turun tamami oynandi mi.
    const roundIndex = cl.roundIndexFor(cl.currentKnockoutRound);
    const current = this.opts.schedule.fixtures.filter(
      (f) => f.competitionId === id && f.roundIndex === roundIndex,
    );
    if (current.length === 0) return [];
    if (current.some((f) => !this.results.has(keyOf(f)))) return [];

    const winners = current.map((f) =>
      this.winner({ home: f.homeId, away: f.awayId }, this.results.get(keyOf(f))!, rng),
    );
    const next = cl.advance(winners);
    if (!next) {
      this.continentalPhase = 'done';
      this.crown(id, cl.champion());
      return [];
    }

    const added = this.opts.schedule.materializeRound(
      id,
      cl.roundIndexFor(cl.currentKnockoutRound),
      next,
    );
    return added.length > 0 ? [`${id}:tur ${cl.currentKnockoutRound + 1}`] : [];
  }

  /**
   * Eleme macinin galibi. Beraberlikte penalti.
   *
   * Guc farki penaltilara HAFIFCE yansir: tamamen adil bir yazi-tura elit
   * kulubu cezalandirirdi, guclu bir egilim ise penaltiyi anlamsiz kilardi.
   */
  private winner(tie: { home: string; away: string }, score: MatchScore, rng: Rng): string {
    if (score.homeGoals > score.awayGoals) return tie.home;
    if (score.awayGoals > score.homeGoals) return tie.away;

    const home = this.opts.league.strength(tie.home);
    const away = this.opts.league.strength(tie.away);
    // 40 puanlik itibar farki penaltida ~%60-40 eder.
    const edge = 0.5 + (home - away) / 400;
    return rng.next() < Math.max(0.25, Math.min(0.75, edge)) ? tie.home : tie.away;
  }
}

function keyOf(fixture: Fixture): string {
  return `${fixture.competitionId}:${fixture.roundIndex ?? 0}:${fixture.homeId}:${fixture.awayId}`;
}
