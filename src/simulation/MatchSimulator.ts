/**
 * DURAKLAMALI 11v11 MAC SIMULATORU.
 *
 * `MatchHost` portunu doldurur ve ustune duraklama yetenegi ekler:
 *
 *   start(...)  -> maci kurar, dakika 0
 *   step()      -> bir sonraki olaya kadar ilerler ve DURUR
 *   resume(...) -> Hero'nun karari skora islenir, mac devam eder
 *
 * Hero'nun karari SKORU GERCEKTEN degistirir: 20. dakikada atilan penalti
 * golu, 70. dakikadaki momentin skor baglaminda gorunur. On-hesaplanmis bir
 * moment listesi bunu yapamaz -- duraklamanin sebebi budur.
 *
 * KATMAN: yalnizca `domain` + `selection/Rng`. Motoru (`runtime`) BILMEZ.
 */

import type { ChanceContext, ChanceResolver } from '../domain/chance.js';
import type { RosterPerson } from '../domain/actors.js';
import type {
  HeroProfile,
  HostMatch,
  MatchBuildInput,
  MatchHost,
  MatchImportance,
  MatchOutcomeDelta,
  MatchResultReport,
  MomentDelta,
  MomentType,
  PendingMoment,
} from '../domain/match.js';
import type { ClubInfo } from '../domain/roster.js';
import {
  cardFactor,
  grudgeCardFactor,
  varChance,
  varCorrects,
  GRUDGE_HOSTILE,
  type Referee,
} from '../domain/referee.js';
import { Rng } from '../selection/Rng.js';
import { MathChanceResolver } from './MathChanceResolver.js';
import { assistWeightFactor } from '../domain/chemistry.js';
import type { Fixture, SeasonSchedule } from './SeasonCalendar.js';
import { defaultTactic, tacticProfile } from './Tactics.js';
import { buildTimeline, type TimelineEvent } from './Timeline.js';
import { buildTeam, heroAsFieldPlayer, type FieldPlayer, type TeamSquad } from './TeamModel.js';

/** Simulatorun her adimda dondurdugu sey. */
export type SimStep =
  | { readonly kind: 'hero_moment'; readonly moment: PendingMoment }
  | {
      readonly kind: 'highlight';
      readonly minute: number;
      readonly text: string;
      readonly scoreline: string;
      readonly scorer?: string;
      readonly assist?: string;
    }
  | { readonly kind: 'full_time'; readonly report: MatchResultReport };

export interface SimulatorDeps {
  readonly clubs: readonly ClubInfo[];
  readonly squadOf: (clubId: string) => readonly RosterPerson[];
  readonly schedule: SeasonSchedule;
  readonly seed: number;
  readonly chanceResolver?: ChanceResolver;
  readonly heroName?: string;
  /**
   * Hero ile kimya cozucusu -- host doldurur.
   *
   * Simulator motorun flag sozlugunu GORMEZ; "kim kiminle iyi anlasiyor"u
   * bilir, "neden"i bilmez. Verilmezse kimya yok sayilir (zarif bozulma) ve
   * mevcut davranis aynen surer.
   */
  readonly chemistryOf?: (sourceId: string) => number | undefined;
  /**
   * Bu fikstüre atanan hakem. Verilmezse hakem etkisi YOK sayilir ve
   * mevcut sabit davranis surer (zarif bozulma).
   */
  readonly refereeFor?: (fixture: Fixture) => Referee | undefined;
  /** Hero'nun bu hakemle kini (-100..+100). Motor doldurur. */
  readonly grudgeFor?: (refereeId: number) => number;
}

interface LiveMatch {
  readonly fixture: Fixture;
  readonly home: TeamSquad;
  readonly away: TeamSquad;
  readonly heroSide: 'home' | 'away';
  readonly hero: FieldPlayer;
  readonly events: readonly TimelineEvent[];
  cursor: number;
  homeGoals: number;
  awayGoals: number;
  heroGoals: number;
  heroAssists: number;
  heroYellow: number;
  heroRed: boolean;
  heroInjuryWeeks: number;
  heroRating: number;
  /** Bu macta hangi moment tipleri sunuldu -- ayni ani iki kez sormamak icin. */
  readonly usedMoments: Set<MomentType>;
  /** Bu macin hakemi -- kart, penalti ve VAR carpanlarini besler. */
  readonly referee: Referee | undefined;
  /** Hero'nun bu hakemle kini. */
  readonly grudge: number;
  finished: boolean;
}

/**
 * Bir sansin Hero karar anina donusme olasiligi.
 *
 * Moment, sansi TUKETIR: o pozisyon artik normal yoldan cozulmez, sonucunu
 * oyuncunun karari belirler. Oran yuksek olursa hem mac durmadan kesilir hem
 * de takimin gol uretimi Hero'nun kararlarina asiri baglanir.
 * ~12 sans/mac x 0.12 = mac basina ~1.4 karar ani.
 */
const HERO_MOMENT_RATE = 0.12;

/**
 * Mevkiye gore hangi mac anlari gelebilir.
 *
 * Santrfor kendi cizgisinde el ile gol kurtarmaz, kaleci penalti kullanmaz.
 * Bu kapilama iceriktekinden DAHA DAR olursa yazilan olay hic sahneye gelmez;
 * daha genis olursa mevkiye aykiri sahne cikar. Ikisi de sessizce bozar,
 * bu yuzden liste `MOMENT_TYPES` ile birlikte guncellenir.
 */
const MOMENTS_BY_POSITION: Readonly<Record<string, readonly MomentType[]>> = {
  FW: [
    'penalty_for',
    'one_on_one',
    'last_minute_chance',
    'celebration_choice',
    'dive_opportunity',
    'offside_marginal',
    'ghost_goal',
    'free_kick',
  ],
  MF: [
    'penalty_for',
    'one_on_one',
    'free_kick',
    'celebration_choice',
    'ghost_goal',
    'offside_marginal',
    'last_minute_chance',
    'dive_opportunity',
  ],
  DF: ['handball_on_line', 'penalty_against', 'free_kick', 'offside_marginal'],
  GK: ['penalty_against', 'handball_on_line'],
};

/**
 * Mevkiden bagimsiz, her oyuncunun basina gelebilecek anlar.
 *
 * Hakemle tartismak, tribunden cisim yemek ya da takim arkadasiyla kapismak
 * mevki tanimaz. Bunlari `MOMENTS_BY_POSITION` icine dagitmak, her listede
 * tekrarlamak demek olurdu ve bir tanesini unutmak o icerigi o mevkide OLU
 * birakirdi.
 */
const UNIVERSAL_MOMENTS: readonly MomentType[] = [
  'var_review_against',
  'var_review_for',
  'var_controversial',
  'injury_in_match',
  'racist_abuse',
  'captain_armband',
  'substituted_off',
  'red_card_provocation',
  'object_thrown',
  'ref_dispute',
  'teammate_feud',
];

/** Itibarin ilk 11 sansina katkisi. Yildiz kotu formda bile oynar. */
const STATURE_WEIGHT: Record<string, number> = {
  nobody: 0.15,
  local_talent: 0.3,
  starter: 0.55,
  star: 0.75,
  superstar: 0.88,
  icon: 0.95,
  legend: 1,
};

export class MatchSimulator implements MatchHost {
  private readonly resolver: ChanceResolver;
  private live: LiveMatch | undefined;
  /** Kac mac oynandi -- fikstur basina tohum uretiminde kullanilir. */
  private playedCount = 0;
  private seasonGoals = 0;
  private seasonAssists = 0;
  private seasonApps = 0;
  private unbeaten = 0;
  private scoreless = 0;

  /**
   * Kimya cozucusu -- GEC baglanir.
   *
   * Kompozisyon sirasi boyle: dunya (ve simulator) motordan ONCE kurulur,
   * cunku motor `roster`/`world` portlarini disaridan alir. Kimya ise
   * motorun durumunda yasar. Dolayisiyla bagi kurmanin tek dogru yeri
   * ikisi de var olduktan SONRASI.
   */
  private chemistrySource: ((sourceId: string) => number | undefined) | undefined;

  constructor(private readonly deps: SimulatorDeps) {
    this.resolver = deps.chanceResolver ?? new MathChanceResolver();
    this.chemistrySource = deps.chemistryOf;
  }

  /** Motor kurulduktan sonra kimya kaynagini baglar. */
  useChemistrySource(source: (sourceId: string) => number | undefined): void {
    this.chemistrySource = source;
  }

  // ----------------------------------------------------------- MatchHost portu

  /**
   * Fikstur takvimine bakar. O hafta mac yoksa ya da oyuncu cikamiyorsa
   * `undefined` doner -- bos hafta gercektir.
   *
   * `pendingMoments` BOS doner: anlar duraklamali akista `step()` ile gelir.
   * Duraklayamayan bir cagiran icin bu, momentsiz ama gecerli bir mactir.
   */
  buildMatch(input: MatchBuildInput): HostMatch | undefined {
    if (!input.availability.available) return undefined;

    // Haftanin BELIRTILEN maci. Eski `forClub` yalnizca birincisini
    // donuyordu ve ikinci mac hic oynanmiyordu.
    const fixture = this.deps.schedule.fixturesFor(input.heroClubId, input.week)[input.slot ?? 0];
    if (!fixture) return undefined;

    this.start(fixture, input.hero, input.heroClubId);
    const opponentId = fixture.homeId === input.heroClubId ? fixture.awayId : fixture.homeId;

    // ILK 11 KARARI -- eskiden sabit `true` idi.
    //
    // Hero her hafta oynuyordu: yedek kalma, rotasyon, "bu hafta
    // kadroda yoksun" gerilimi hic yasanmiyordu. `tactics` kategorisi
    // bu temayi anlatiyor ama MEKANIK karsiligi yoktu -- yani hoca
    // seni mevkinden alsa bile sahada hicbir sey degismiyordu.
    //
    // Ve gelisim sistemi (`GameEngine.develop`) "kac mac oynadin"a
    // bakiyor. Herkes her mac oynarsa forma sansi bir KARAR olmaktan
    // cikar; ikisi birlikte anlam kazanir.
    const starter = this.decideStarter(input.hero);
    this.seasonApps += 1;
    return {
      context: {
        opponentName: this.clubName(opponentId),
        importance: fixture.importance,
        isStarter: starter,
        unbeatenStreak: this.unbeaten,
        scorelessStreak: this.scoreless,
        seasonGoals: this.seasonGoals,
        seasonAssists: this.seasonAssists,
        seasonApps: this.seasonApps,
      },
      pendingMoments: [],
    };
  }

  /**
   * Hero bu mac ilk 11'de mi.
   *
   * Uc girdi:
   *   FORM     -- son bes macin reytingi. Kotu oynayan yedege duser.
   *   TAZELIK  -- yorgun oyuncu rotasyona girer.
   *   ITIBAR   -- yildiz oyuncu kotu formda bile daha cok sans bulur;
   *               `stature` bunu tasiyor.
   *
   * ESIK 0.48 -- olcerek secildi.
   *
   * Ilk denemede 0.35 verildi ve matris gosterdi ki `nobody` disinda
   * herkes her mac oynuyordu; yani mekanik yoktu. 0.48'de tablo su:
   *
   *   nobody        form 30-50 YEDEK, 70+ oynar
   *   local_talent  form 30 YEDEK, 50+ oynar
   *   starter       form 30 sinirda, 50+ oynar
   *   star ve ustu  kotu formda bile oynar
   *
   * Yani yildiz olmak seni korur, cirak olmak korumaz -- gercek futbol
   * boyle. Ve form dusunce yedege dusmek, formu bir SONUC olmaktan
   * cikarip bir RISK yapiyor.
   *
   * Olum sarmali riski yok: oynamayan oyuncunun `form`u DUSMEZ
   * (reyting gecmisi guncellenmez), yalnizca sabit kalir. Yani yedege
   * dusen oyuncu orada cakili kalmaz.
   */
  private decideStarter(hero: HeroProfile): boolean {
    const form = hero.form / 100;
    const fresh = hero.stamina / 100;
    const fame = STATURE_WEIGHT[hero.stature] ?? 0.4;
    const score = form * 0.45 + fresh * 0.25 + fame * 0.3;
    return score >= 0.48;
  }

  /** O hafta Hero'nun kulubunun kac maci var. */
  matchCount(input: MatchBuildInput): number {
    return this.deps.schedule.fixturesFor(input.heroClubId, input.week).length;
  }

  applyDelta(_match: HostMatch, delta: MatchOutcomeDelta): MatchResultReport {
    const live = this.live;
    if (!live) {
      return { result: 'draw', rating: 0, goals: 0, assists: 0, minutes: 0, cards: 0 };
    }
    // Duraklamali akista delta zaten adim adim islendi; burada yalnizca
    // isletilmemis bir kalinti varsa (duraklayamayan cagiran) uygulanir.
    if (!live.finished) {
      this.applyMomentDelta({
        goals: delta.goalsDelta,
        assists: delta.assistsDelta,
        yellowCards: delta.yellowCards,
        redCard: delta.redCard,
        injuryWeeks: delta.injuryWeeks,
        ratingModifier: delta.ratingModifier,
        incidents: delta.incidents,
      });
      this.runToEnd();
    }
    return this.report();
  }

  resetSeason(): void {
    this.seasonGoals = 0;
    this.seasonAssists = 0;
    this.seasonApps = 0;
  }

  // ----------------------------------------------------------- duraklamali akis

  /** Maci kurar ve dakika 0'a alir. */
  start(fixture: Fixture, hero: HeroProfile, heroClubId: string): void {
    const rng = this.rngFor(fixture);
    const heroSide: 'home' | 'away' = fixture.homeId === heroClubId ? 'home' : 'away';
    const heroPlayer = heroAsFieldPlayer(hero, this.deps.heroName ?? 'Sen');

    // Kimya YALNIZCA Hero'nun takiminda anlamli: rakip kadronun kendi ic
    // kimyasi modellenmiyor (bu bir futbolcu kariyeri simulasyonu).
    const home = buildTeam(
      fixture.homeId,
      this.clubName(fixture.homeId),
      this.deps.squadOf(fixture.homeId),
      heroSide === 'home' ? heroPlayer : undefined,
      heroSide === 'home' ? this.chemistrySource : undefined,
    );
    const away = buildTeam(
      fixture.awayId,
      this.clubName(fixture.awayId),
      this.deps.squadOf(fixture.awayId),
      heroSide === 'away' ? heroPlayer : undefined,
      heroSide === 'away' ? this.chemistrySource : undefined,
    );

    const referee = this.deps.refereeFor?.(fixture);
    const gap = home.lines.overall - away.lines.overall;
    const events = buildTimeline(
      {
        home: { lines: home.lines, tactic: tacticProfile(defaultTactic(gap)) },
        away: { lines: away.lines, tactic: tacticProfile(defaultTactic(-gap)) },
      },
      rng,
    );

    this.live = {
      fixture,
      home,
      away,
      heroSide,
      hero: heroPlayer,
      events,
      cursor: 0,
      homeGoals: 0,
      awayGoals: 0,
      heroGoals: 0,
      heroAssists: 0,
      heroYellow: 0,
      heroRed: false,
      heroInjuryWeeks: 0,
      heroRating: 6,
      usedMoments: new Set(),
      referee,
      grudge: referee ? (this.deps.grudgeFor?.(referee.id) ?? 0) : 0,
      finished: false,
    };
    this.rng = rng;
  }

  private rng: Rng = new Rng(1);

  /**
   * Bir sonraki olaya kadar ilerler.
   *
   * `hero_moment` dondugunde AKIS DURUR: cagiran motora sorup `resume()` ile
   * geri donene kadar bir sonraki `step()` ayni yerde bekler.
   */
  step(): SimStep {
    const live = this.live;
    if (!live) return { kind: 'full_time', report: this.report() };

    while (live.cursor < live.events.length) {
      const event = live.events[live.cursor]!;
      live.cursor += 1;

      if (event.kind === 'foul') {
        const card = this.resolveFoul(event, live);
        if (card) return card;
        continue;
      }

      if (event.kind === 'injury_risk') {
        const injury = this.resolveInjuryRisk(event, live);
        if (injury) return injury;
        continue;
      }

      // Hero'nun takiminin pozisyonu ve Hero sahadaysa, bu bir karar ani olabilir.
      const moment = this.maybeHeroMoment(event, live);
      if (moment) return { kind: 'hero_moment', moment };

      const highlight = this.resolveChance(event, live);
      if (highlight) return highlight;
    }

    live.finished = true;
    return { kind: 'full_time', report: this.report() };
  }

  /** Hero'nun kararinin sonucunu skora isler ve mac devam eder. */
  resume(delta: MomentDelta): void {
    this.applyMomentDelta(delta);
  }

  /** Mac bitene kadar ilerletir -- duraklamayan cagiranlar icin. */
  runToEnd(): MatchResultReport {
    for (let guard = 0; guard < 400; guard += 1) {
      const step = this.step();
      if (step.kind === 'full_time') return step.report;
      // Duraklamayan cagiranda hero momenti karsiliksiz gecilir.
    }
    return this.report();
  }

  /** Su anki skor, "1-0" bicimi (Hero'nun takimi ONCE). */
  scoreline(): string {
    const live = this.live;
    if (!live) return '0-0';
    return live.heroSide === 'home'
      ? `${live.homeGoals}-${live.awayGoals}`
      : `${live.awayGoals}-${live.homeGoals}`;
  }

  currentFixture(): Fixture | undefined {
    return this.live?.fixture;
  }

  /** Mac sonucu -- lig tablosuna islenecek skor. */
  finalScore(): { homeId: string; awayId: string; homeGoals: number; awayGoals: number } | undefined {
    const live = this.live;
    if (!live) return undefined;
    return {
      homeId: live.fixture.homeId,
      awayId: live.fixture.awayId,
      homeGoals: live.homeGoals,
      awayGoals: live.awayGoals,
    };
  }

  // ----------------------------------------------------------- ic isleyis

  private applyMomentDelta(delta: MomentDelta): void {
    const live = this.live;
    if (!live) return;

    if (delta.goals !== 0) {
      live.heroGoals += delta.goals;
      this.addGoals(live, live.heroSide, delta.goals);
    }
    live.heroAssists += delta.assists;
    live.heroYellow += delta.yellowCards;
    if (delta.redCard) live.heroRed = true;
    live.heroInjuryWeeks = Math.max(live.heroInjuryWeeks, delta.injuryWeeks);
    live.heroRating += delta.ratingModifier;

    // Kirmizi kart ya da sakatlik Hero'yu sahadan alir: kalan momentler gelmez.
    if (live.heroRed || delta.injuryWeeks > 0) live.usedMoments.add('substituted_off');
  }

  private addGoals(live: LiveMatch, side: 'home' | 'away', count: number): void {
    if (side === 'home') live.homeGoals = Math.max(0, live.homeGoals + count);
    else live.awayGoals = Math.max(0, live.awayGoals + count);
  }

  /**
   * Bu sans bir Hero karar anina donusuyor mu?
   *
   * Uc kapi: Hero sahada mi, pozisyon onun takiminin mi, ve mevkisi bu ani
   * gorur mu. Stoper penalti kullanmaz, kaleci gol sevinci secmez.
   */
  private maybeHeroMoment(event: TimelineEvent, live: LiveMatch): PendingMoment | undefined {
    const team = live.heroSide === 'home' ? live.home : live.away;
    if (!team.heroOnPitch) return undefined;
    if (live.heroRed) return undefined;
    if (event.side !== live.heroSide) return undefined;
    if (this.rng.next() > HERO_MOMENT_RATE) return undefined;

    const byPosition = MOMENTS_BY_POSITION[live.hero.position] ?? [];
    const pool = [...byPosition, ...UNIVERSAL_MOMENTS].filter((m) => !live.usedMoments.has(m));
    if (pool.length === 0) return undefined;

    // 1v1 pozisyonunda 1v1 momenti gelmeli; tur eslesirse oncelik onda.
    const matching = pool.filter((m) => momentMatchesChance(m, event));
    let chosen = matching.length > 0 && this.rng.next() < 0.7
      ? matching[this.rng.int(matching.length)]!
      : pool[this.rng.int(pool.length)]!;

    // HAKEM MOMENT FREKANSINI EGER.
    //
    // Icerik DEGISMEZ -- 21 moment tipinin metni aynen kalir. Degisen
    // yalnizca hangisinin ne siklikta sahneye geldigi: VAR'a duskun hakem
    // tartismali VAR anini, sert hakem hakem tartismasini daha sik uretir.
    // Kinli bir gecmis varsa tartisma olasiligi iki katina cikar.
    const referee = live.referee;
    if (referee !== undefined) {
      const biased = this.refereeBiasedMoment(pool, referee, live.grudge);
      if (biased !== undefined) chosen = biased;
    }

    live.usedMoments.add(chosen);
    return {
      type: chosen,
      minute: event.minute,
      scoreline: this.scoreline(),
      opponent: this.opponentName(live),
      importance: live.fixture.importance,
    };
  }

  /**
   * Hakemin egilimine gore moment tipini kaydirir.
   *
   * `undefined` donerse cagiran kendi secimini korur -- egilim bir ZORLAMA
   * degil, bir agirliktir.
   */
  private refereeBiasedMoment(
    pool: readonly MomentType[],
    referee: Referee,
    grudge: number,
  ): MomentType | undefined {
    const varPool = pool.filter(
      (m) => m === 'var_controversial' || m === 'var_review_against' || m === 'var_review_for',
    );
    if (varPool.length > 0 && this.rng.next() < varChance(referee.attributes)) {
      // Tutarsiz hakem VAR'a bakip yine de yanlis karar verir -- tartismali
      // an tam olarak budur.
      const type = varCorrects(referee.attributes.consistency)
        ? varPool[this.rng.int(varPool.length)]!
        : (varPool.find((m) => m === 'var_controversial') ?? varPool[0]!);
      return type;
    }

    if (pool.includes('ref_dispute')) {
      const strict = referee.attributes.strictness / 100;
      const hostile = grudge <= GRUDGE_HOSTILE ? 2 : 1;
      if (this.rng.next() < strict * 0.18 * hostile) return 'ref_dispute';
    }

    return undefined;
  }

  private resolveChance(event: TimelineEvent, live: LiveMatch): SimStep | undefined {
    const attacking = event.side === 'home' ? live.home : live.away;
    const defending = event.side === 'home' ? live.away : live.home;

    const shooter = this.pickShooter(attacking);
    const context: ChanceContext = {
      kind: event.chanceKind ?? 'open_play',
      minute: event.minute,
      scoreline: this.scoreline(),
      distance: event.distance ?? 12,
      angle: event.angle ?? 40,
      pressure: event.pressure ?? 50,
      keeperQuality: defending.lines.keeper,
      shooter: {
        shooting: shooter.attributes.shooting,
        composure: shooter.quality,
        isHero: shooter.isHero,
      },
      importance: live.fixture.importance,
    };

    const result = this.resolver.resolve(context, this.rng.next());
    if (result.outcome !== 'goal') return undefined;

    this.addGoals(live, event.side, 1);
    const assister = this.pickAssister(attacking, shooter);
    if (shooter.isHero) {
      live.heroGoals += 1;
      live.heroRating += result.playerRating ?? 1;
    }
    if (assister?.isHero) {
      live.heroAssists += 1;
      live.heroRating += 0.6;
    }

    return {
      kind: 'highlight',
      minute: event.minute,
      text: `${attacking.name} golu -- ${shooter.name}`,
      scoreline: this.scoreline(),
      scorer: shooter.name,
      ...(assister ? { assist: assister.name } : {}),
    };
  }

  private resolveFoul(event: TimelineEvent, live: LiveMatch): SimStep | undefined {
    const team = event.side === 'home' ? live.home : live.away;
    const offender = team.eleven[this.rng.int(team.eleven.length)];
    if (!offender) return undefined;

    // Sert oyuncu daha sik kart gorur -- ama HAKEM belirler.
    //
    // Eskiden sabit bir esikti: her hakem ayni kadar kart cikariyordu.
    // Artik uc bilesen carpiyor: hakemin kart egilimi, ev sahibi kayirmasi
    // ve o macki tutarsizligi. Hero soz konusuysa KIN de devreye girer.
    let threshold = offender.aggression / 220;
    if (live.referee) {
      threshold *= cardFactor(
        live.referee.attributes,
        event.side === 'home',
        this.rng.next(),
      );
      if (offender.isHero) threshold *= grudgeCardFactor(live.grudge);
    }
    if (this.rng.next() > threshold) return undefined;

    if (offender.isHero) {
      live.heroYellow += 1;
      live.heroRating -= 0.3;
      if (live.heroYellow >= 2) live.heroRed = true;
    }
    return {
      kind: 'highlight',
      minute: event.minute,
      text: `Sari kart -- ${offender.name}`,
      scoreline: this.scoreline(),
    };
  }

  private resolveInjuryRisk(event: TimelineEvent, live: LiveMatch): SimStep | undefined {
    const team = event.side === 'home' ? live.home : live.away;
    const victim = team.eleven[this.rng.int(team.eleven.length)];
    if (!victim) return undefined;
    // Hero'nun sakatligi HIKAYENIN isi: simulator karar vermez, moment sunar.
    if (victim.isHero) return undefined;
    return {
      kind: 'highlight',
      minute: event.minute,
      text: `Sakatlik -- ${victim.name} oyundan cikiyor`,
      scoreline: this.scoreline(),
    };
  }

  /** Golu kim atti: hucum agirlikli, sut yetenegine gore. */
  private pickShooter(team: TeamSquad): FieldPlayer {
    const weight = (p: FieldPlayer): number => {
      const positional = p.position === 'FW' ? 3 : p.position === 'MF' ? 1.6 : p.position === 'DF' ? 0.35 : 0.02;
      return positional * (0.4 + p.attributes.shooting / 100);
    };
    return this.rng.weighted(team.eleven, weight) ?? team.eleven[0]!;
  }

  /**
   * Golun asistini kim yapar.
   *
   * KIMYA BURADA DEVREYE GIRER: Hero gol attiysa, ona pasi veren kisi
   * rastgele degil. Uc sezon birlikte oynadigin oyuncu seni daha sik bulur.
   * Carpani dar tutuldu (0.70-1.38) -- kimya bir TERCIH sinyali, guc
   * carpani degil.
   */
  private pickAssister(team: TeamSquad, shooter: FieldPlayer): FieldPlayer | undefined {
    // Her golun asisti olmaz; tek basina gidilen goller de vardir.
    if (this.rng.next() < 0.25) return undefined;
    const others = team.eleven.filter((p) => p.sourceId !== shooter.sourceId);

    const heroInvolved = shooter.isHero;
    const weight = (p: FieldPlayer): number => {
      const base =
        (p.position === 'MF' ? 2.4 : p.position === 'FW' ? 1.6 : 0.6) *
        (0.4 + p.attributes.passing / 100);
      // Kimya yalnizca HERO'nun golunde tercihi kaydirir; iki NPC arasindaki
      // pas tercihi modellenmiyor.
      return heroInvolved ? base * assistWeightFactor(p.chemistryWithHero ?? 0) : base;
    };
    return this.rng.weighted(others, weight);
  }

  private report(): MatchResultReport {
    const live = this.live;
    if (!live) return { result: 'draw', rating: 0, goals: 0, assists: 0, minutes: 0, cards: 0 };

    const own = live.heroSide === 'home' ? live.homeGoals : live.awayGoals;
    const other = live.heroSide === 'home' ? live.awayGoals : live.homeGoals;
    const result = own > other ? 'win' : own < other ? 'loss' : 'draw';

    this.seasonGoals += live.heroGoals;
    this.seasonAssists += live.heroAssists;
    this.scoreless = live.heroGoals > 0 ? 0 : this.scoreless + 1;
    this.unbeaten = result === 'loss' ? 0 : this.unbeaten + 1;
    this.playedCount += 1;

    return {
      result,
      rating: Math.round(Math.max(1, Math.min(10, live.heroRating)) * 10) / 10,
      goals: live.heroGoals,
      assists: live.heroAssists,
      minutes: live.heroRed ? 45 + this.rng.int(40) : 90,
      cards: live.heroYellow + (live.heroRed ? 1 : 0),
    };
  }

  private opponentName(live: LiveMatch): string {
    return live.heroSide === 'home' ? live.away.name : live.home.name;
  }

  private clubName(clubId: string): string {
    return this.deps.clubs.find((c) => c.id === clubId)?.name ?? clubId;
  }

  /** Fikstur basina tohum: ayni mac her calistirmada AYNI akisi uretir. */
  private rngFor(fixture: Fixture): Rng {
    let hash = this.deps.seed ^ (this.playedCount * 2654435761);
    for (const ch of `${fixture.week}:${fixture.homeId}:${fixture.awayId}`) {
      hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
    }
    return new Rng(hash >>> 0);
  }
}

/** Sansin turu ile momentin turu ortusuyor mu. */
function momentMatchesChance(moment: MomentType, event: TimelineEvent): boolean {
  switch (event.chanceKind) {
    case 'one_on_one':
      return moment === 'one_on_one';
    case 'free_kick':
      return moment === 'free_kick';
    default:
      return moment === 'last_minute_chance' ? event.minute >= 80 : false;
  }
}

export type { MatchImportance };
