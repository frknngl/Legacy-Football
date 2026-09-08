/**
 * OYUN MOTORU -- tek facade.
 *
 * Disariya acilan tum yuzey burasidir. UI, CLI ya da host; hepsi yalnizca bu
 * sinifi bilir. Motorun icinde UI'a dair hicbir sey yoktur: string dondurur,
 * cizim yapmaz.
 *
 * Yasam dongusu:
 *   start(archetype)
 *   -> advanceTurn()            : tur ilerler, bir olay sunulur (ya da sunulmaz)
 *   -> availableChoices()       : kilitliler SEBEBIYLE birlikte doner
 *   -> choose(id)               : efektler uygulanir, bir sonraki node sunulur
 *   -> playMatch(...)           : host mac anlarini sunar, kararlar sorulur
 *   -> finalizeMatch(...)       : sonuc yazilir, incident'ler acilir
 */

import type { Archetype, ClubTier, Era, LifeState, MediaEra, Stature } from '../domain/axes.js';
import { POSITIONS, slotBoundFlag, slotChemistryFlag, type Position } from '../domain/actors.js';
import type { RosterProvider, WorldFeed, WorldProvider } from '../domain/roster.js';
import type { ScaleContext } from '../domain/effects.js';
import {
  isClubTierEffect,
  isLifeStateEffect,
  isMatchDeltaEffect,
  isScheduleEffect,
  isSuspendEffect,
  type Effect,
  type MatchDeltaEffect,
} from '../domain/effects.js';
import type { ResolvedEnding } from '../domain/endings.js';
import { EngineStateError } from '../domain/errors.js';
import type { FlagValue } from '../domain/flags.js';
import type {
  HeroProfile,
  MatchContext,
  MomentDelta,
  MomentResolution,
  PendingDecision,
  MatchOutcomeDelta,
  MatchResultReport,
  MatchImportance,
  PendingMoment,
  PlayerAvailability,
} from '../domain/match.js';
import { emptyDelta } from '../domain/match.js';
import type { GameState, SaveEnvelope } from '../domain/state.js';
import { eventNodes, eventRoot, type Choice, type StoryEvent, type StoryNode } from '../domain/story.js';
import { ConditionEvaluator } from '../evaluation/ConditionEvaluator.js';
import { EffectApplier, type EffectSource } from '../evaluation/EffectApplier.js';
import { NameForge } from '../evaluation/NameForge.js';
import { PersonaAccumulator } from '../evaluation/PersonaAccumulator.js';
import { TextInterpolator } from '../evaluation/TextInterpolator.js';
import type { ContentRegistry } from '../loading/ContentRegistry.js';
import { EligibilityFilter, type EligibilityContext } from '../selection/EligibilityFilter.js';
import { EventSelector } from '../selection/EventSelector.js';
import { Rng } from '../selection/Rng.js';
import { CooldownTracker } from '../selection/CooldownTracker.js';
import { ScheduledEventQueue } from '../selection/ScheduledEventQueue.js';
import { ActorArchive } from './ActorArchive.js';
import { CastingDirector, type CastingContext } from './CastingDirector.js';
import { ConsequenceLedger } from './ConsequenceLedger.js';
import { EndingResolver } from './EndingResolver.js';
import { EventHistory } from './EventHistory.js';
import { IncidentLedger } from './IncidentLedger.js';
import { LifeStateMachine } from './LifeStateMachine.js';
import { MatchContextGate } from './MatchContextGate.js';
import { MatchMomentBroker, type BrokeredMoment } from './MatchMomentBroker.js';
import { MediaEraResolver } from './MediaEraResolver.js';
import { NemesisTracker } from './NemesisTracker.js';
import { ProgressionTracker } from './ProgressionTracker.js';
import { ReunionDirector } from './ReunionDirector.js';
import { RollResolver } from './RollResolver.js';
import { SaveGame } from './SaveGame.js';
import { WalletLedger } from './WalletLedger.js';
import { SuspensionTracker } from './SuspensionTracker.js';
import { TurnScheduler } from './TurnScheduler.js';
import {
  injuryRisk,
  injuryWeeks,
  matchLoad,
  weeklyInjuryChance,
  weeklyRecovery,
} from './FatigueModel.js';
import {
  applyChemistry,
  chemistryDecay,
  chemistryGain,
  dressingRoomHarmony,
  moraleTarget,
  moraleRecovery,
} from './ChemistryTracker.js';
import {
  AGENT_START_SATISFACTION,
  AGENT_WARNING_THRESHOLD,
  AGENTLESS_OFFER_FACTOR,
  NEGOTIATION_COOLDOWN,
  NEGOTIATION_REJECT_PENALTY,
  agentQuits,
  applySatisfaction,
  negotiationChance,
  newAgentSatisfaction,
  newAgentState,
  offerChance,
  terminationFee,
  type AgentProfile,
  type AgentState,
  type OfferContext,
  type SatisfactionEvent,
} from '../domain/agent.js';
import type { ActorState } from '../domain/actors.js';
import { valuePlayer } from '../domain/transfer.js';
import { STATURES, statureIndex } from '../domain/axes.js';
import { DEFAULT_THRESHOLD, latePenalty, loanOffers, type LoanOffer, type LoanState } from '../domain/loan.js';
import { pressureAfterSack, sackChance, sackPressure } from './ManagerTenure.js';
import { sponsorIncome } from '../domain/sponsor.js';

export const CONTINUE_CHOICE_ID = '__continue';

export interface PresentedChoice {
  readonly id: string;
  readonly text: string;
  readonly locked: boolean;
  readonly lockLabel?: string;
  /** Neden kilitli: "liderlik gte 70". */
  readonly lockReason?: string;
}

export interface PresentedNode {
  readonly eventId: string;
  readonly variantId?: string;
  readonly nodeId: string;
  readonly title: string;
  readonly text: string;
  readonly kind: StoryNode['kind'];
  readonly tier: string;
  readonly category: string;
  readonly choices: readonly PresentedChoice[];
  /** Mac ani karari mi (host bekliyor)? */
  readonly isMoment: boolean;
}

export interface TurnReport {
  readonly turn: number;
  readonly season: number;
  readonly week: number;
  readonly age: number;
  readonly era: Era;
  readonly stature: Stature;
  readonly clubTier: ClubTier;
  readonly mediaEra: MediaEra;
  readonly lifeState: LifeState;
  readonly presented?: PresentedNode;
  /** Kullaniciya gosterilecek sistem bildirimleri. */
  readonly notices: readonly string[];
  readonly ending?: ResolvedEnding;
}

interface ActiveEvent {
  event: StoryEvent;
  variantId: string | undefined;
  nodeId: string;
  isMoment: boolean;
  /** Bu olay bir mac anina cevapsa, hangi ana. `MomentResolution` bundan kurulur. */
  moment?: PendingMoment;
  lastChoiceId?: string;
}

export interface EngineOptions {
  readonly seed?: number;
  /**
   * Kimlik kaynagi. Verilmezse casting katmani KAPALIDIR ve `{actor.*}`
   * yer tutuculari ham kalir -- zarif bozulma, hata degil.
   */
  readonly roster?: RosterProvider;
  readonly world?: WorldProvider;
  readonly worldFeed?: WorldFeed;
  /** Baslangic kulubu. Verilmezse arketipin seviyesinden secilir. */
  readonly startClubId?: string;
}

/**
 * Dunyada olan, motorun kendi basina bilemeyecegi olay.
 *
 * Host (simulasyon katmani) bildirir. Icerik BILDIREMEZ -- `derived` flag'ler
 * icerige kapalidir ve oyle kalmalidir.
 */
/**
 * Kariyer basi secimleri.
 *
 * Arketip "nereden geldigini" belirler; bunlar "ne olacagini". Ikisi ayri
 * sorulardir ve oyuncunun ikisine de cevap vermesi gerekir -- oyun testinde
 * ilk gorulen eksik buydu: arketip secilip dogrudan 2. haftaya duselüyordu,
 * mevki ve ilk kulup oyuncuya hic sorulmuyordu.
 *
 * Ikisi de OPSIYONEL: verilmezse arketipin varsayilani kullanilir, boylece
 * mevcut cagiranlar (testler, simulate) degismeden calisir.
 */
export interface CareerStart {
  /** Mevki. Verilmezse arketipin `startPosition` degeri. */
  readonly position?: Position;
  /** Ilk kulup. Verilmezse arketip seviyesinden tohumla secilir. */
  readonly clubId?: string;
}

/** Oyuncuya sunulacak bir baslangic kulubu secenegi. */
export interface StartingClubOption {
  readonly clubId: string;
  readonly name: string;
  readonly league: string;
  readonly reputation: number;
  /** Bu kulupte ilk 11'e girme sansi kabaca ne kadar -- 0-100. */
  readonly playingChance: number;
}

export type WorldEvent =
  | { readonly kind: 'national_call'; readonly matches: number }
  | { readonly kind: 'trophy'; readonly competitionId: string }
  /**
   * KULUP DEGISIKLIGI.
   *
   * `toRival` ayri bir kind degil bir alan: transferin kendisi ayni olay,
   * degisen tek sey NEREYE gidildigi. Ayri kind yapsaydik host'un "rakip mi"
   * bilgisini once cozup sonra farkli cagri yapmasi gerekirdi; boylece
   * kararin sahibi motor oluyor.
   */
  /**
   * BUYUK TURNUVA -- Dunya Kupasi / Avrupa Sampiyonasi.
   *
   * `national_call`den ayri bir kind: turnuva daha cok mac, daha cok
   * yorgunluk ve kazanilirsa KUPA demektir. Ayni kapiyi kullanmak
   * "iki maclik ara" ile "bir aylik turnuva"yi ayni sey yapardi.
   */
  | {
      readonly kind: 'tournament';
      readonly name: string;
      readonly matches: number;
      readonly won: boolean;
    }
  | {
      readonly kind: 'transfer';
      readonly toClubId: string;
      readonly toClubName: string;
      /** Ayrilinan kulubun EZELI RAKIBI mi. */
      readonly toRival: boolean;
    };

export class GameEngine {
  private state!: GameState;
  private rng!: Rng;
  private active: ActiveEvent | undefined;
  private momentQueue: BrokeredMoment[] = [];
  private matchDelta: MatchOutcomeDelta = emptyDelta();
  /** `momentDelta()` bu taban ile mevcut toplam arasindaki farki verir. */
  private momentBaseline: MatchOutcomeDelta = emptyDelta();
  private lastResolution: MomentResolution | undefined;
  private notices: string[] = [];
  /** Host'un bildirdigi rakip kulup -- reunion ve mac slotlari icin. */
  private opponentClubId: string | undefined;
  /** Bu hafta kac mac oynandi -- haftalik toparlanmanin girdisi. */
  private matchesThisWeek = 0;
  /** Bu hafta sahaya cikildi mi -- kimya erimesi bunu okur. */
  private playedThisWeek = false;

  private readonly evaluator = new ConditionEvaluator();
  private readonly applier: EffectApplier;
  private readonly persona = new PersonaAccumulator();
  private readonly interpolator = new TextInterpolator();
  private readonly filter: EligibilityFilter;
  private readonly selector: EventSelector;
  private readonly cooldowns: CooldownTracker;
  private readonly queue = new ScheduledEventQueue();
  private readonly scheduler: TurnScheduler;
  private readonly lifeStates: LifeStateMachine;
  private readonly progression: ProgressionTracker;
  private readonly mediaEras: MediaEraResolver;
  private readonly incidents: IncidentLedger;
  private readonly consequences: ConsequenceLedger;
  private readonly endings: EndingResolver;
  private readonly history = new EventHistory();
  private readonly matchGate = new MatchContextGate();
  private readonly broker: MatchMomentBroker;
  private readonly rolls = new RollResolver();
  private readonly saves: SaveGame;
  private readonly suspensions = new SuspensionTracker();
  private readonly archive: ActorArchive;
  private readonly casting: CastingDirector | undefined;
  private readonly reunion: ReunionDirector | undefined;
  private readonly nemesis: NemesisTracker;

  constructor(
    private readonly registry: ContentRegistry,
    private readonly options: EngineOptions = {},
  ) {
    this.applier = new EffectApplier(registry.flags);
    // SIRA ONEMLI: filtre tracker'a, secici filtreye bagli.
    // Kategori ritmi VERIDEN gelir (`cadence.json`); tracker'i onunla kurmak
    // zorundayiz, yoksa ucuncu soguma seviyesi hic devreye girmez.
    this.cooldowns = new CooldownTracker(registry.config.cadence);
    this.filter = new EligibilityFilter(this.evaluator, this.cooldowns);
    this.selector = new EventSelector(registry, this.filter);
    this.scheduler = new TurnScheduler(registry.config.turn, registry.config.eras);
    this.progression = new ProgressionTracker(registry.config.progression);
    this.mediaEras = new MediaEraResolver(registry.config.mediaEras);
    this.incidents = new IncidentLedger(registry.flags);
    this.consequences = new ConsequenceLedger(
      this.evaluator,
      registry.config.turn.turnsPerSeason,
    );
    this.endings = new EndingResolver(registry.config.endings, this.evaluator, this.interpolator);
    this.broker = new MatchMomentBroker(this.selector);
    this.saves = new SaveGame(registry.flags);
    this.archive = new ActorArchive(registry.config.turn.turnsPerSeason);
    this.lifeStates = new LifeStateMachine(registry.config.lifeStates);
    this.nemesis = new NemesisTracker(registry.config.nemeses, this.evaluator);

    if (options.roster) {
      this.casting = new CastingDirector(
        registry.slots,
        options.roster,
        new NameForge(registry.names),
        this.archive,
      );
      this.reunion = new ReunionDirector(registry.slots, options.roster, this.casting);
    }
  }

  // ------------------------------------------------------------- yasam dongusu

  /**
   * Oynanabilir mevkiler + kilitli olanlarin GEREKCESI.
   *
   * Kilit VERIDEN gelir (`release.json`). UI kilitli mevkileri de gostermeli
   * ama sebebiyle birlikte: "yakinda" demek yerine "kaleciye ozel mac anlari
   * henuz yazilmadi" demek durustur ve oyuncuya neyin eksik oldugunu soyler.
   */
  positionOptions(): readonly {
    position: Position;
    playable: boolean;
    label?: string;
    reason?: string;
  }[] {
    const release = this.registry.config.release;
    return POSITIONS.map((position) => {
      const locked = release.lockedPositions[position];
      return {
        position,
        playable: release.playablePositions.includes(position),
        ...(locked === undefined ? {} : { label: locked.label, reason: locked.reason }),
      };
    });
  }

  /**
   * Kilitli bir mevkiyi acik olanina indirger.
   *
   * `immigrant` ve `latebloom` arketipleri DF olarak tasarlandi; defans
   * kilitliyken bunlar en yakin acik mevkiye duser. Arketipin HIKAYESI
   * korunur, sahadaki rolu degisir -- kilit kalkinca kendi mevkilerine
   * geri donerler ve bu esleme kodda degil `release.json`da.
   */
  private resolvePosition(requested: Position): Position {
    const release = this.registry.config.release;
    if (release.playablePositions.includes(requested)) return requested;
    const fallback = release.positionFallback[requested];
    if (fallback !== undefined && release.playablePositions.includes(fallback)) {
      return fallback as Position;
    }
    return (release.playablePositions[0] ?? 'MF') as Position;
  }

  /**
   * Arketipin seviyesine uygun baslangic kulubu SECENEKLERI.
   *
   * Oyuncuya sunulur; secmezse `start()` tohumla kendisi secer. `playingChance`
   * kaba bir sinyal: guclu kulupte ilk 11 zor, zayifta kolay -- oyuncunun
   * "buyuk kulupte yedek mi, kucuk kulupte oynayan mi" tercihini bilerek
   * yapabilmesi icin.
   */
  startingClubOptions(archetype: Archetype, limit = 4): readonly StartingClubOption[] {
    const def = this.registry.config.archetypes.find((a) => a.id === archetype);
    const world = this.options.world;
    if (!def || !world) return [];

    return world
      .clubsByTier(def.startClubTier)
      .slice(0, limit)
      .map((club) => ({
        clubId: club.id,
        name: club.name,
        league: club.league,
        reputation: club.reputation,
        // Itibar yukseldikce ilk 11 zorlasir; 30 itibarli kulupte neredeyse
        // garanti, 90'da uzak ihtimal.
        playingChance: Math.max(5, Math.min(95, 120 - club.reputation)),
      }));
  }

  start(archetype: Archetype, choice: CareerStart = {}): TurnReport {
    const def = this.registry.config.archetypes.find((a) => a.id === archetype);
    if (!def) throw new EngineStateError(`Tanimsiz arketip: ${archetype}`);

    const flags = this.registry.flags.defaults();
    for (const [k, v] of Object.entries(def.startFlags)) {
      if (this.registry.flags.has(k)) flags[k] = v;
    }
    flags['archetype'] = archetype;
    flags['age'] = def.startAge;
    flags['club_tier'] = def.startClubTier;
    // Mevki oyuncunun secimi; arketip yalnizca VARSAYILANI verir.
    // Kilitli mevki secilirse acik olanina indirgenir -- cokme yok, sessiz
    // duzeltme var.
    flags['position'] = this.resolvePosition(choice.position ?? def.startPosition);
    flags['currentTurn'] = 1;

    const personaState = PersonaAccumulator.initial();
    for (const axis of ['sadakat', 'mizac', 'durus', 'dogruluk'] as const) {
      const v = flags[`persona_${axis}`];
      if (typeof v === 'number') personaState[axis] = v;
    }
    PersonaAccumulator.sync(personaState, flags);

    const seed = this.options.seed ?? Math.floor(Math.random() * 2 ** 31);

    this.state = {
      flags,
      flagSetTurn: {},
      flagSource: {},
      flagActor: {},
      turn: 1,
      season: 1,
      week: 1,
      age: def.startAge,
      startAge: def.startAge,
      archetype,
      lifeState: 'playing',
      stature: 'nobody',
      clubTier: def.startClubTier,
      clubId: '',
      mediaEra: 'press',
      persona: personaState,
      actors: {},
      casting: {},
      nemesis: {
        arcId: '',
        slotRef: def.nemesis ?? 'nemesis',
        stature: 'nobody',
        arcStage: 0,
        relation: 30,
        lastStageTurn: 0,
      },
      availability: { available: true, matchesRemaining: 0 },
      seenEvents: {},
      seenVariants: {},
      cooldowns: {},
      familyCooldowns: {},
      categoryCooldowns: {},
      scheduledEvents: [],
      consequenceLog: [],
      history: [],
      ratingHistory: [],
      // Kariyer MENAJERSIZ baslar. Kimse ilk sozlesmesini menajerle
      // imzalamaz; menajer bulmak ilk sezonun kendi hikayesi.
      formerAgents: [],
      wallet: [],
      walletTotals: {},
      rngSeed: seed,
      rngCursor: 0,
    };

    this.rng = new Rng(seed);
    this.active = undefined;
    this.notices = [];

    // Baslangic sohreti statlardan turetilir; "hickimse" varsayilani, 250 bin
    // servetle dogan bloodline icin yanlis olurdu.
    const change = this.progression.update(
      { stature: this.state.stature, clubTier: this.state.clubTier },
      this.state.flags,
    );
    this.state.stature = change.stature;

    // Secilen kulup gecerliyse o, degilse arketip seviyesinden tohumla.
    this.state.clubId =
      choice.clubId !== undefined && this.options.roster?.club(choice.clubId) !== undefined
        ? choice.clubId
        : this.pickStartingClub(def.startClubTier);
    this.casting?.castInitial(this.state, this.castingContext(), this.rng);

    const arc = this.nemesis.arcFor(archetype);
    if (arc) {
      this.state.nemesis.arcId = arc.id;
      this.state.nemesis.slotRef = arc.slotRef;
      if (this.options.world) {
        this.nemesis.placeInWorld(this.state, this.options.world, 'nobody', this.rng);
      }
    }
    this.nemesis.sync(this.state);
    this.state.rngCursor = this.rng.position;

    return this.report();
  }

  /** Arketipin seviyesine uyan bir kulup secer. Roster yoksa kimlik katmani kapalidir. */
  private pickStartingClub(tier: ClubTier): string {
    if (this.options.startClubId !== undefined) return this.options.startClubId;
    const roster = this.options.roster;
    if (!roster) return '';
    const candidates = roster.clubs().filter((c) => c.tier === tier);
    const pool = candidates.length > 0 ? candidates : roster.clubs();
    return pool[this.rng.int(pool.length)]?.id ?? '';
  }

  private castingContext(opponentClubId?: string): CastingContext {
    return {
      clubId: this.state.clubId,
      clubTier: this.state.clubTier,
      stature: this.state.stature,
      lifeState: this.state.lifeState,
      ...(opponentClubId !== undefined ? { opponentClubId } : {}),
    };
  }

  /**
   * Her turun basi: tanisiklik suresi tazelenir ve arsiv yeniden degerlendirilir.
   * Eski kaptanin bugun sahnede mi, bunu icerik degil burasi bilir.
   */
  private refreshCasting(): void {
    if (!this.casting) return;
    this.casting.refreshSeasons(this.state);
    this.reunion?.refresh(this.state, {
      lifeState: this.state.lifeState,
      turnsPerSeason: this.registry.config.turn.turnsPerSeason,
      ...(this.opponentClubId !== undefined ? { opponentClubId: this.opponentClubId } : {}),
    });
  }

  /** Sezon basi: gormedigin insanlar seni unutur, iz birakmayanlar arsivden dusar. */
  private onSeasonChange(): void {
    this.develop();
    this.awardSeason();
    this.tickContract();
    this.archive.decaySeason(this.state, this.registry.slots);
    this.archive.prune(this.state, this.registry.slots);

    if (this.options.world) {
      const risen = this.nemesis.advanceSeason(this.state, this.options.world, this.rng);
      this.state.rngCursor = this.rng.position;
      if (risen) {
        const who = this.casting?.view(this.state, this.state.nemesis.slotRef)?.name;
        this.notices.push(`${who ?? 'Rakibin'} yukseliyor: ${risen}`);
      }
    }
  }

  /**
   * BIREYSEL ODULLER -- sezon sonu.
   *
   * Oyunda hicbir odul yoktu: gol krali, yilin oyuncusu, hicbiri.
   * `kariyer_gol_sayisi` tutuluyordu ama sezon bazinda siralama yapan
   * bir sey yoktu, yani "bu sezon iyiydim" hicbir yerde kayda gecmiyordu.
   *
   * ESIKLER MUTLAK, siralama DEGIL:
   *   Gercek siralama tum ligin gol verisini gerektirir; `LeagueModel`
   *   NPC gollerini oyuncu bazinda tutmuyor. Mutlak esik dogru
   *   yaklasiklik ve oyuncu esigi HISSEDEBILIR -- "bir gol daha" gerilimi.
   *
   *   ESIKLER OLCEREK SECILDI: ilk denemede 20 gol / 25 katki verildi ve
   *   uc kariyerde HICBIR odul kazanilmadi -- olculen zirve sezon 19 gol
   *   ve 6 asistti, yani esik kil payi ulasilamazdi. 17 ve 20, iyi bir
   *   sezonda erisilebilir ama rutin degil.
   *
   * Odul `kupa_sayisi`na YAZILMAZ: o takim basarisidir. Odul ayri bir
   * sayacta durur ve `legacy` icerigi onu okuyabilir.
   */
  private awardSeason(): void {
    const f = this.state.flags;
    const goals = numberFlag(f, 'sezon_gol_sayisi');
    const assists = numberFlag(f, 'sezon_asist_sayisi');
    const apps = numberFlag(f, 'sezon_mac_sayisi');

    if (goals >= 17) {
      f['mem_gol_krali'] = true;
      f['odul_sayisi'] = numberFlag(f, 'odul_sayisi') + 1;
      this.notices.push(`GOL KRALI: ${goals} gol`);
    }
    // Yilin oyuncusu: yalnizca gol degil KATKI ve sureklilik.
    if (apps >= 25 && goals + assists >= 20 && numberFlag(f, 'form') >= 65) {
      f['mem_yilin_oyuncusu'] = true;
      f['odul_sayisi'] = numberFlag(f, 'odul_sayisi') + 1;
      this.notices.push(`YILIN OYUNCUSU: ${goals} gol, ${assists} asist`);
    }

    f['sezon_gol_sayisi'] = 0;
    f['sezon_asist_sayisi'] = 0;
  }

  /**
   * SOZLESME -- sezon sayaci ve bitis baskisi.
   *
   * `domain/transfer.ts` sozlesme suresini NPC degerlemesinde
   * kullaniyordu (biten sozlesme degeri 0.15'e dusurur) ama Hero'nun
   * sozlesmesi hic yenilenmiyor, hic bitmiyordu. Yani "son yilindasin"
   * baskisi -- futbolun en somut zaman baskisi -- oyunda yoktu.
   *
   * Burada yalnizca SAYAC isler ve bildirim duser; yenileme karari
   * `renewContract()` ile oyuncunun (ya da menajerinin) elinde.
   */
  private tickContract(): void {
    const f = this.state.flags;
    if (numberFlag(f, 'sozlesme_sezon') <= 0 && !this.state.flags['__contractStarted']) {
      // Ilk sozlesme: cirak uc yil imzalar.
      f['sozlesme_sezon'] = 3;
      this.state.flags['__contractStarted'] = true;
      return;
    }
    const left = numberFlag(f, 'sozlesme_sezon') - 1;
    f['sozlesme_sezon'] = Math.max(0, left);
    if (left === 1) this.notices.push('Sozlesmenin son yili. Yenileme konusulacak.');
    if (left <= 0) this.notices.push('Sozlesmen BITTI. Serbest oyuncusun.');
  }

  /**
   * SOZLESME YENILEME -- host bunu `:menajer` masasindan cagirir.
   *
   * Kulubun teklif ettigi maas piyasa degerine ve itibara baglidir;
   * menajerin `negotiation` gucu teklifi buyutur. Menajersiz oyuncu
   * TABANI alir -- menajer tutmanin en somut karsiligi bu.
   */
  contractOffer(): { weeklyWage: number; seasons: number } {
    this.requireStarted();
    const f = this.state.flags;
    const value = numberFlag(f, 'piyasa_degeri');
    // Haftalik maas kabaca piyasa degerinin binde biri bandinda.
    const base = Math.max(2_500, Math.round(value / 1_000));
    const agent = this.currentAgent();
    const push = agent === undefined ? 1 : 1 + (agent.profile.negotiation / 100) * 0.45;
    const age = this.state.age;
    // Genc oyuncuya uzun, yasliya kisa sozlesme.
    const seasons = age <= 23 ? 5 : age <= 29 ? 4 : age <= 33 ? 2 : 1;
    return { weeklyWage: Math.round(base * push), seasons };
  }

  /** Teklifi kabul eder: maas ve sure yazilir, menajer komisyonunu alir. */
  renewContract(offer: { weeklyWage: number; seasons: number }): void {
    this.requireStarted();
    const f = this.state.flags;
    f['haftalik_gelir'] = offer.weeklyWage;
    f['sozlesme_sezon'] = offer.seasons;

    const agent = this.currentAgent();
    if (agent !== undefined) {
      // Komisyon imza aninda kesilir -- menajerin parasi buradan gelir.
      const cut = Math.round(offer.weeklyWage * 52 * offer.seasons * agent.state.commission);
      f['servet'] = Math.max(0, numberFlag(f, 'servet') - cut);
      WalletLedger.record(this.state, -cut, 'komisyon', `${agent.profile.name} komisyonu`);
      this.reportAgentOutcome('transfer_done');
      this.notices.push(`Sozlesme yenilendi. Menajer komisyonu: ${cut}`);
    } else {
      this.notices.push('Sozlesme yenilendi (menajersiz -- taban teklif).');
    }
    this.syncDerived();
  }

  /**
   * GELISIM -- sezonluk buyume.
   *
   * NEDEN VARDI ETMEK GEREKTI:
   *   Motorda DUSUS vardi (`physicalDecline`, 31 yasindan sonra) ama
   *   BUYUME yoktu. `teknik` yalnizca on iki icerik olayindan
   *   ziplayarak artiyordu -- yani gelisim bir sistem degil, hangi
   *   sahneleri gordugune bagli bir tesadufti. Bir kariyer oyununda
   *   otuz sezon boyunca "daha iyi olmak" hissi yoktu.
   *
   * UC GIRDI:
   *   1. YAS      -- `learningRate` egrisi (16-20 tam hiz, 31'de sifir)
   *   2. OYNAMAK  -- sezonda kac mac oynadin. Yedek kalan gelismez;
   *                  bu, forma sansini gercek bir kariyer karari yapar.
   *   3. TAVAN    -- `potansiyel`e kalan mesafe. Tavana yaklastikca
   *                  kazanim kucululur; kimse sinirsiz gelismez.
   *
   * `profesyonellik` de carpan: iyi calisan daha cok kazanir. Boylece
   * icerikteki "disiplinli ol" secimleri sahada karsilik bulur.
   */
  private develop(): void {
    const f = this.state.flags;

    // Potansiyel bir kez belirlenir ve GIZLIDIR: oyuncu tavanini
    // bilmez, yalnizca yaklastikca yavasladigini hisseder.
    if (numberFlag(f, 'potansiyel') <= 0) {
      const base = (numberFlag(f, 'teknik') + numberFlag(f, 'fizik')) / 2;
      // TAVAN DAGILIMI: base-6 ile base+24 arasi. Tohumdan gelir, sabit.
      //
      // NEDEN NEGATIF TARAF VAR: taban eskiden `+12`ydi, yani HICBIR oyuncu
      // basladigi yerde kalamazdi. Herkes gelisiyor -> `calledUp` kalite
      // kapisini geciyor -> sohret puaninin %50'sini olusturan
      // `milli_mac_sayisi` birikiyor -> her kariyer ikon olarak bitiyordu.
      //
      // Olculen bedeli: 28 olu olayin 17'si "alt kademede yaslanan oyuncu"
      // icin yazilmisti (stature<=starter + era>=prime + clubTier<=lower)
      // ve bu bileske MATEMATIKSEL OLARAK ulasilamazdi. Eksik olan icerik
      // degil, basarisizlik yoluydu.
      //
      // Tavan mevcut seviyenin ALTINA dusebildiginde `room` sifir kalir ve
      // oyuncu hic gelismez -- alt ligde yaslanan adam. Dagilimin yaklasik
      // besde biri buraya duser.
      f['potansiyel'] = Math.min(99, Math.max(30, Math.round(base - 6 + this.rng.int(31))));
      this.state.rngCursor = this.rng.position;
    }

    const matches = numberFlag(f, 'sezon_mac_sayisi');
    f['sezon_mac_sayisi'] = 0;
    if (matches === 0) return; // Hic oynamadiysa gelisim yok.

    const rate = this.scheduler.learningRate(this.state.age);
    if (rate <= 0) return;

    // Otuz mac tam kazanim; azi orantili, cogu ek getirmez.
    const played = Math.min(1, matches / 30);
    const care = 0.6 + (numberFlag(f, 'profesyonellik') / 100) * 0.8;
    const ceiling = numberFlag(f, 'potansiyel');

    let grew = 0;
    for (const axis of ['teknik', 'fizik'] as const) {
      const now = numberFlag(f, axis);
      const room = Math.max(0, ceiling - now);
      if (room <= 0) continue;
      // Kalan boslugun en fazla altida biri, uc girdiyle olceklenmis.
      const gain = Math.round(Math.min(room, (room / 6) * rate * played * care));
      if (gain <= 0) continue;
      f[axis] = clamp100(now + gain);
      grew += gain;
    }

    if (grew > 0) {
      this.notices.push(`Gelisim: +${grew} (${matches} mac oynadin)`);
    }
  }

  /**
   * Rakip arkinin bir sonraki asamasini kuyruga alir.
   *
   * Rastgele secime birakilsa yirmi bes sezonda uc asama gorunurdu; yay
   * ancak SIRAYLA ve garanti gelirse anlam tasir. Asamalari ICERIK ilerletir,
   * burasi yalnizca siradakini planlar.
   */
  private scheduleNemesis(): void {
    this.nemesis.sync(this.state);

    const resolution = this.nemesis.resolution(this.state);
    if (resolution) {
      if (this.registry.get(resolution.eventId)) {
        this.queue.enqueue(
          this.state.scheduledEvents,
          { op: 'schedule', event: resolution.eventId, inTurns: 1, priority: 'forced' },
          { turn: this.state.turn, sourceEventId: '__nemesis__' },
        );
      }
      this.state.nemesis.resolution = resolution.id;
      return;
    }

    const next = this.nemesis.nextStage(this.state);
    if (!next || !this.registry.get(next.eventId)) return;
    this.queue.enqueue(
      this.state.scheduledEvents,
      { op: 'schedule', event: next.eventId, inTurns: 1, priority: 'forced' },
      { turn: this.state.turn, sourceEventId: '__nemesis__' },
    );
    this.state.nemesis.queuedStage = next.stage;
  }

  /**
   * TRANSFER. Yeni seviyede bir kulup secilir ve club-scope kadro yeniden dokulur.
   *
   * Eski kulubun kaptani, hocasi, doktoru SILINMEZ; iliskileriyle birlikte
   * arsive gider ve ileride `former_*` slotlarindan geri donebilir.
   */
  private transferToTier(tier: ClubTier): void {
    const roster = this.options.roster;
    if (!roster || !this.casting) return;

    const pool = roster.clubs().filter((c) => c.tier === tier && c.id !== this.state.clubId);
    const next = pool[this.rng.int(pool.length)];
    this.state.rngCursor = this.rng.position;
    if (!next) return;

    this.casting.transferTo(this.state, next.id, this.castingContext(), this.rng);
    this.state.rngCursor = this.rng.position;
    this.notices.push(`Yeni kulup: ${next.name}`);
  }

  /** Sahnenin merkezindeki aktor -- `mem_*` izleri buna damgalanir. */
  private sceneActorId(active: ActiveEvent): string | undefined {
    const node = this.nodeOf(active);
    if (!node) return undefined;
    const texts = [node.title, node.text, ...(node.choices ?? []).map((c) => c.text)];
    for (const text of texts) {
      for (const { key } of TextInterpolator.tokens(text)) {
        if (!key.startsWith('actor.')) continue;
        const slotId = key.slice('actor.'.length).split('.')[0];
        if (slotId === undefined) continue;
        const actorId = this.state.casting[slotId];
        if (actorId !== undefined) return actorId;
      }
    }
    return undefined;
  }

  /** Kimlik ve dunya yer tutucularinin kaynagi. */
  private identityContext(): Pick<
    Parameters<TextInterpolator['interpolate']>[1],
    'player' | 'club' | 'opponent' | 'world' | 'actor' | 'memory'
  > {
    const roster = this.options.roster;
    const club = roster?.club(this.state.clubId);
    const rival = club?.rivalId !== undefined ? roster?.club(club.rivalId) : undefined;
    const opponentClub =
      this.opponentClubId !== undefined ? roster?.club(this.opponentClubId) : undefined;

    return {
      player: {
        name: String(this.state.flags['player_name'] ?? 'Sen'),
        age: this.state.age,
      },
      club: {
        name: club?.name ?? '',
        city: club?.city ?? '',
        stadium: club?.stadium ?? '',
        rival: rival?.name ?? '',
      },
      opponent: {
        name:
          opponentClub?.name ??
          String(this.state.flags['inc_opponent'] ?? this.state.flags['opponent_name'] ?? ''),
        city: opponentClub?.city ?? '',
        stadium: opponentClub?.stadium ?? '',
      },
      world: this.options.worldFeed?.tokens(this.state.season, this.state.week) ?? {},
      ...(this.casting ? { actor: this.casting.resolver(this.state) } : {}),
      memory: (flagKey, field) => this.memoryToken(flagKey, field),
    };
  }

  /**
   * `{memory.mem_x.actor}` -- izi kimin yuzunden tasidigin.
   * Isim prosedureldir ama iz kalicidir; damga ikisini birbirine baglar.
   */
  private memoryToken(flagKey: string, field: string): string | undefined {
    if (field === 'actor') {
      const actor = this.state.actors[this.state.flagActor[flagKey] ?? ''];
      return actor?.name;
    }
    const turn = this.state.flagSetTurn[flagKey];
    if (turn === undefined) return undefined;
    const perSeason = this.registry.config.turn.turnsPerSeason;
    if (field === 'season') return String(Math.floor((turn - 1) / perSeason) + 1);
    if (field === 'week') return String(((turn - 1) % perSeason) + 1);
    if (field === 'turn') return String(turn);
    if (field === 'seasonsAgo') {
      return String(Math.floor((this.state.turn - turn) / perSeason));
    }
    return undefined;
  }

  /** Bir hafta ilerlet ve (varsa) bir olay sun. */
  advanceTurn(): TurnReport {
    this.requireStarted();
    if (this.active) {
      throw new EngineStateError(
        'Acik bir karar varken tur ilerletilemez. Once choose() ile secim yapin.',
      );
    }
    if (this.state.ending !== undefined) {
      throw new EngineStateError('Kariyer sona erdi.');
    }

    this.notices = [];
    this.state.turn += 1;
    const previousSeason = this.state.season;
    this.syncClock();
    this.tickTimers();
    this.tickFatigue();
    this.tickBonds();
    this.tickEconomy();
    this.tickLoan();
    this.tickManager();
    this.syncDerived();
    if (this.state.season !== previousSeason) this.onSeasonChange();
    this.refreshCasting();

    const ending = this.checkEnding();
    if (ending) return this.report(ending);

    const selection = this.selector.select(
      {
        ...this.eligibilityContext(),
        history: this.state.history,
        persona: this.state.persona,
        scheduledEvents: this.state.scheduledEvents,
      },
      this.rng,
    );
    this.state.rngCursor = this.rng.position;

    if (selection) {
      if (selection.scheduledBy) {
        this.notices.push(
          `Zamanlanmis olay: "${selection.event.id}" (${selection.scheduledBy.sourceEventId} tarafindan tur ${selection.scheduledBy.sourceTurn}'de ayarlandi)`,
        );
      }
      this.enterEvent(selection.event, selection.variantId, false);
    }

    return this.report();
  }

  currentNode(): PresentedNode | undefined {
    if (!this.active) return undefined;
    return this.present(this.active);
  }

  /** Kilitli secenekler GIZLENMEZ; sebebiyle birlikte doner. */
  availableChoices(): readonly PresentedChoice[] {
    return this.currentNode()?.choices ?? [];
  }

  choose(choiceId: string): TurnReport {
    this.requireStarted();
    const active = this.active;
    if (!active) throw new EngineStateError('Su an bekleyen bir karar yok.');

    const node = this.nodeOf(active);
    if (!node) throw new EngineStateError(`Node bulunamadi: ${active.nodeId}`);

    this.notices = [];

    if (node.kind === 'outcome') {
      if (choiceId !== CONTINUE_CHOICE_ID) {
        throw new EngineStateError(`Bu node'da yalnizca "${CONTINUE_CHOICE_ID}" gecerli.`);
      }
      this.recordChoice(active, CONTINUE_CHOICE_ID);
      this.goTo(active, node.next);
      return this.report();
    }

    const choice = (node.choices ?? []).find((c) => c.id === choiceId);
    if (!choice) throw new EngineStateError(`Gecersiz secim: ${choiceId}`);
    if (!this.isChoiceUnlocked(choice)) {
      throw new EngineStateError(`Secim kilitli: ${choiceId}`);
    }

    const source: EffectSource = {
      origin: 'content',
      eventId: active.event.id,
      choiceId: choice.id,
      choiceText: choice.text,
    };
    this.applyEffects(choice.effects, source, this.sceneActorId(active));
    this.state.persona = this.persona.apply(this.state.persona, this.state.flags, choice.persona);
    this.recordChoice(active, choice.id);
    this.syncDerived();

    this.goTo(active, choice.target);
    return this.report();
  }

  // ------------------------------------------------------------- mac sozlesmesi

  /**
   * Mac baslar: roportaj penceresi kapanir, baglam yazilir, rakip kadro dokulur.
   *
   * Duraklamali akisin GIRIS noktasi. Simulator bunu cagirip sonra her kritik
   * an icin `presentMoment` ile motoru durdurur.
   */
  beginMatch(context: MatchContext): void {
    this.requireStarted();
    if (this.active) {
      throw new EngineStateError('Acik bir karar varken mac baslatilamaz.');
    }

    // Yeni mac: onceki macin roportaj penceresi kapanir.
    this.incidents.clear(this.state);
    this.matchGate.applyContext(this.state.flags, context);
    this.matchDelta = emptyDelta();
    this.momentBaseline = emptyDelta();
    this.lastResolution = undefined;
    this.momentQueue = [];

    // Rakip kadrodan mac slotlari dokulur; eski kulubunse arsiv sahneye doner.
    this.opponentClubId = this.resolveOpponentClub(context.opponentName);
    this.casting?.castMatchSlots(this.state, this.castingContext(this.opponentClubId), this.rng);
    this.refreshCasting();
  }

  /**
   * TEK bir mac anini sunar ve motoru orada DURDURUR.
   *
   * Karsiligi olan icerik yoksa `undefined` doner ve simulator hic duraklamadan
   * devam eder -- host bosa moment sunmus olur, oyun kirilmaz.
   */
  presentMoment(moment: PendingMoment): PendingDecision | undefined {
    this.requireStarted();
    if (this.active) {
      throw new EngineStateError(
        'Onceki mac ani hala acik. Once choose() ile karari verin.',
      );
    }

    const result = this.broker.broker([moment], this.eligibilityContext(), this.rng);
    this.state.rngCursor = this.rng.position;

    const entry = result.queue[0];
    if (!entry) return undefined;

    // Bu andan itibaren biriken fark = bu momentin skora katkisi.
    this.momentBaseline = this.matchDelta;
    this.lastResolution = undefined;
    this.enterMoment(entry);
    return entry.decision;
  }

  /**
   * Son sunulan momentin skora katkisi.
   *
   * Simulator bunu okuyup skoru gunceller ve devam eder; mac bitene kadar
   * beklemez. Aksi halde 30. dakikadaki gol 90. dakikada sayilir ve sonraki
   * momentlerin skor baglami yanlis olur.
   */
  momentDelta(): MomentDelta {
    const now = this.matchDelta;
    const base = this.momentBaseline;
    return {
      goals: now.goalsDelta - base.goalsDelta,
      assists: now.assistsDelta - base.assistsDelta,
      yellowCards: now.yellowCards - base.yellowCards,
      redCard: now.redCard && !base.redCard,
      injuryWeeks: Math.max(0, now.injuryWeeks - base.injuryWeeks),
      ratingModifier: now.ratingModifier - base.ratingModifier,
      incidents: now.incidents.slice(base.incidents.length),
    };
  }

  /** Son momentin nasil kapandigi -- host loglayabilir, UI ozet gosterebilir. */
  momentResolution(): MomentResolution | undefined {
    return this.lastResolution;
  }

  /**
   * Duraklayamayan host'lar icin sarmalayici: tum anlari kuyruga alir ve
   * ilkini sunar; kalanlar `choose()` zinciri ilerledikce otomatik gelir.
   *
   * `pendingMoments` bos gonderilirse moment fazi atlanir (ZARIF BOZULMA).
   */
  playMatch(input: { context: MatchContext; pendingMoments: readonly PendingMoment[] }): {
    decisions: number;
    dropped: readonly PendingMoment[];
  } {
    this.beginMatch(input.context);

    const result = this.broker.broker(input.pendingMoments, this.eligibilityContext(), this.rng);
    this.state.rngCursor = this.rng.position;
    this.momentQueue = [...result.queue];

    this.nextMoment();
    return { decisions: result.queue.length, dropped: result.dropped };
  }

  /** Motorun host'a dondurdugu delta. Tum moment kararlari bittikten sonra okunur. */
  matchOutcome(): MatchOutcomeDelta {
    return this.matchDelta;
  }

  /** Host gercek sonucu bildirir; incident'ler acilir, roportaj olaylari tetiklenebilir. */
  finalizeMatch(result: MatchResultReport): void {
    this.requireStarted();
    this.matchGate.applyResult(this.state.flags, result, this.state.ratingHistory);
    this.incidents.record(this.state, this.matchDelta.incidents);
    this.applyMatchFatigue(result.minutes);
    this.applyMatchChemistry(result.minutes);

    if (this.state.availability.matchesRemaining > 0) {
      this.state.availability = this.suspensionConsume();
    }
    this.syncDerived();
  }

  availability(): PlayerAvailability {
    return this.state.availability;
  }

  /**
   * HOST -> MOTOR: sahanin disinda olan, motorun kendi basina bilemeyecegi sey.
   *
   * NEDEN GEREKLI:
   *   `milli_mac_sayisi` ve `kupa_sayisi` `derived` flag'lerdir; `ReadOnlyFlagRule`
   *   iceriklerin bunlara yazmasini YASAKLAR (dogru karar -- bir olay dosyasi
   *   kupa sayisini uyduramamali). Ama hicbir sey de yazmiyordu: ikisi de
   *   kariyer boyunca 0 kaliyor, dolayisiyla `progression.json`daki agirliklari
   *   (kupa 25, milli mac 1.5) sohret hesabina HIC katilmiyordu.
   *
   *   Bu kapi o boslugu kapatir ve sinira sadik kalir: yazan motordur, iceren
   *   dunyadir. Icerik hala yazamaz.
   *
   * Milli davet ayrica `national_duty` hayat durumunu tetikler; `axes.json`
   * o durumda `transfer` kategorisini kapatir -- kamptayken transfer sahnesi
   * cikmasin.
   */
  reportWorldEvent(event: WorldEvent): void {
    this.requireStarted();

    switch (event.kind) {
      case 'national_call': {
        const caps = numberFlag(this.state.flags, 'milli_mac_sayisi');
        this.state.flags['milli_mac_sayisi'] = caps + event.matches;
        if (event.matches > 0) {
          this.setLifeState('national_duty');
          this.state.lifeStateUntil = this.state.turn + 1;
          // Milli maclar da YORAR -- hatta digerlerinden fazla: seyahat,
          // farkli tempo, dinlenmeyen bir ara. Milli ara Hero icin tatil
          // degil, ekstra yuk.
          for (let i = 0; i < event.matches; i += 1) {
            this.applyMatchFatigue(90, 'national');
          }
        }
        this.notices.push(`Milli takim: ${event.matches} mac`);
        break;
      }
      case 'trophy': {
        this.state.flags['kupa_sayisi'] = numberFlag(this.state.flags, 'kupa_sayisi') + 1;
        this.notices.push(`Kupa: ${event.competitionId}`);
        break;
      }
      case 'tournament': {
        // BUYUK TURNUVA -- Dunya Kupasi / Avrupa Sampiyonasi.
        //
        // Milli takim vardi (kadro, davet, `national_duty`) ama TURNUVA
        // yoktu: milli takim yalnizca "ara haftada iki mac" demekti.
        // Oysa bir kariyerin en cok hatirlanan anlari turnuvalarda gecer.
        //
        // Turnuva milli macin BUYUK hali: daha cok mac, daha cok yorgunluk,
        // daha cok gorunurluk. Kazanilirsa kupa sayilir -- ve `kupa_sayisi`
        // stature formulunun en agir girdisidir (agirlik 25), yani buyuk
        // turnuva kazanmak kariyeri gercekten degistirir.
        const caps = numberFlag(this.state.flags, 'milli_mac_sayisi');
        this.state.flags['milli_mac_sayisi'] = caps + event.matches;
        this.state.flags['mem_turnuva_oynadi'] = true;
        this.setLifeState('national_duty');
        this.state.lifeStateUntil = this.state.turn + 2;

        for (let i = 0; i < event.matches; i += 1) this.applyMatchFatigue(90, 'national');

        if (event.won) {
          this.state.flags['mem_turnuva_sampiyonu'] = true;
          this.state.flags['kupa_sayisi'] =
            numberFlag(this.state.flags, 'kupa_sayisi') + 1;
          this.state.flags['taraftar_destegi'] = clamp100(
            numberFlag(this.state.flags, 'taraftar_destegi') + 25,
          );
          this.notices.push(`${event.name} SAMPIYONU`);
        } else {
          this.notices.push(`${event.name}: ${event.matches} mac`);
        }
        break;
      }
      case 'transfer': {
        this.state.flags['kulup'] = event.toClubId;

        if (event.toRival) {
          // EZELI RAKIBE GECIS -- geri alinamaz bir iz.
          //
          // Neden kalici bayrak: transfer bir kez olur ama bedeli kariyer
          // boyunca odenir. Eski taraftar seni asla affetmez, ilk derbide
          // islik calinir, veda mac sahnesi bunu okur. Sayac ayrica tutulur
          // cunku IKI kez rakibe gecmek bir kez gecmekten baska bir seydir:
          // birincisi ihanet, ikincisi karakter.
          this.state.flags['mem_rakibe_transfer'] = true;
          this.state.flags['rakip_kulup_gecmisi'] =
            numberFlag(this.state.flags, 'rakip_kulup_gecmisi') + 1;

          // Taraftar destegi COKUYOR, medya baskisi patliyor. Bu ceza
          // olaya degil KARARA bagli: icerik bunu hafifletemez, yalnizca
          // uzerine hikaye kurabilir.
          this.state.flags['taraftar_destegi'] = clamp100(
            numberFlag(this.state.flags, 'taraftar_destegi') - 35,
          );
          this.state.flags['medya_baskisi'] = clamp100(
            numberFlag(this.state.flags, 'medya_baskisi') + 30,
          );
          this.notices.push(`Ezeli rakibe transfer: ${event.toClubName}`);
        } else {
          this.notices.push(`Yeni kulup: ${event.toClubName}`);
        }
        break;
      }
    }

    this.syncDerived();
  }

  // ------------------------------------------------------------- menajer

  /**
   * Hero'nun su an calisabilecegi menajerler.
   *
   * Havuz KENDINI FILTRELER: Super Ajan on altisindaki bir cirakla masaya
   * oturmaz. Filtre `reach`e karsi Hero'nun itibari -- yani "istedigin
   * menajeri secebilirsin" degil, "seni kim ister" sorusu. Kariyer
   * ilerledikce liste kendiliginden buyur; bu, yukselisin en somut
   * gostergelerinden biri.
   */
  agentOptions(limit = 5): readonly AgentProfile[] {
    this.requireStarted();
    const pool = this.options.roster?.agents?.();
    if (pool === undefined || pool.length === 0) return [];

    const standing = this.heroStanding();
    return [...pool]
      .filter((a) => a.id !== this.state.agent?.agentId)
      // Menajerin erisimi Hero'nun durusunun COK ustundeyse ilgilenmez.
      // 25 puanlik tolerans: bir basamak yukarisi hep ulasilabilir olmali,
      // yoksa oyuncu hicbir zaman sinif atlayamaz.
      .filter((a) => a.reach <= standing + 25)
      .sort((a, b) => b.reach - a.reach)
      .slice(0, limit);
  }

  /** Su anki menajerin profili -- yoksa Hero menajersiz. */
  currentAgent(): { profile: AgentProfile; state: AgentState } | undefined {
    const state = this.state.agent;
    if (state === undefined) return undefined;
    const profile = this.agentProfile(state.agentId);
    return profile === undefined ? undefined : { profile, state };
  }

  /**
   * Menajerle anlas.
   *
   * Onceki menajer varsa ARSIVE gider (`formerAgents`) ve yeni menajerin
   * baslangic memnuniyeti duser -- sik menajer degistirmenin gorunmeyen
   * bedeli. Fesih bedelini host oder; motor yalnizca tutari soyler
   * (`terminationFeeNow`), cunku parayi hangi bayraktan dusecegini
   * bilen taraf icerik, motor degil.
   */
  signAgent(agentId: number): boolean {
    this.requireStarted();
    const profile = this.agentProfile(agentId);
    if (profile === undefined) return false;

    const previous = this.state.agent;
    if (previous !== undefined) {
      if (this.state.turn < previous.switchableFromTurn) return false;
      this.state.formerAgents.push(previous.agentId);
    }

    const fresh = newAgentState(profile, this.state.turn);
    this.state.agent = {
      ...fresh,
      satisfaction: newAgentSatisfaction(this.state.formerAgents.length),
    };

    // Slotu bagla ki icerik `{actor.agent.name}` yazabilsin. Menajer bir
    // sayi degil bir KISI: sozlesme ekraninda gorulen isimle, iki sezon
    // sonra seni satmaya calisan isim ayni olmali.
    this.castAgentActor(profile);
    this.notices.push(`Yeni menajer: ${profile.name} (${profile.archetype})`);
    this.syncDerived();
    return true;
  }

  /** Menajeri birak. Bedeli host oder; motor yalnizca durumu temizler. */
  releaseAgent(): void {
    this.requireStarted();
    const current = this.state.agent;
    if (current === undefined) return;
    this.state.formerAgents.push(current.agentId);
    this.state.agent = undefined;
    this.casting?.unbindSlot(this.state, 'agent');
    this.syncDerived();
  }

  /** Su anda menajeri feshetmenin bedeli. */
  terminationFeeNow(weeklyIncome: number, seasonsLeft: number): number {
    const current = this.state.agent;
    return current === undefined ? 0 : terminationFee(current, weeklyIncome, seasonsLeft);
  }

  /**
   * KOMISYON PAZARLIGI.
   *
   * Basarisiz pazarlik BEDAVA DEGIL: memnuniyet duser ve on tur boyunca
   * tekrar denenemez. Bedelsiz olsaydi oyuncu her tur deneyip er ya da
   * gec kabul ettirirdi -- `negotiation` niteligi anlamsizlasirdi.
   */
  negotiateCommission(proposed: number): { accepted: boolean; reason?: string } {
    this.requireStarted();
    const current = this.currentAgent();
    if (current === undefined) return { accepted: false, reason: 'menajer yok' };
    if (this.state.turn < current.state.negotiableFromTurn) {
      return { accepted: false, reason: 'pazarlik sogumasi suruyor' };
    }
    if (proposed >= current.state.commission) {
      // Menajerin lehine teklif -- pazarlik degil hediye, her zaman kabul.
      this.state.agent = { ...current.state, commission: proposed };
      return { accepted: true };
    }

    const chance = negotiationChance(current.profile, current.state, proposed);
    const accepted = this.rng.next() < chance;

    this.state.agent = accepted
      ? { ...current.state, commission: proposed }
      : {
          ...current.state,
          satisfaction: Math.max(0, current.state.satisfaction - NEGOTIATION_REJECT_PENALTY),
          negotiableFromTurn: this.state.turn + NEGOTIATION_COOLDOWN,
        };

    this.checkAgentQuit();
    return accepted ? { accepted: true } : { accepted: false, reason: 'reddedildi' };
  }

  /**
   * Menajerin bu hafta teklif getirme olasiligi ve sonucu.
   *
   * Host hedef kulubu verir (piyasa kimin ilgilendigini bilir), motor
   * menajerin o kapiyi acip acamayacagina karar verir. Menajersiz Hero
   * de teklif alabilir -- yalnizca dortte bir olasilikla.
   */
  rollAgentOffer(ctx: OfferContext): boolean {
    this.requireStarted();
    const current = this.currentAgent();
    const chance =
      current === undefined
        ? 0.06 * (ctx.windowOpen ? 3 : 1) * AGENTLESS_OFFER_FACTOR
        : offerChance(current.profile, current.state, ctx);
    return this.rng.next() < chance;
  }

  /**
   * Teklife verilen cevabin menajer tarafindaki bedeli.
   *
   * Reddetmek sabirli menajerde omuz silkme, sabirsizda kirilma. Bu tek
   * cagri `super_agent`la calismanin bedelini somutlastiran sey: uc kez
   * "hayir" dersen seni birakir.
   */
  reportAgentOutcome(event: SatisfactionEvent): void {
    this.requireStarted();
    const current = this.currentAgent();
    if (current === undefined) return;
    this.state.agent = applySatisfaction(current.state, event, current.profile);
    this.checkAgentQuit();
    this.syncDerived();
  }

  /** Sezon sonu: birlikte gecen sezon sayaci ve form degerlendirmesi. */
  closeAgentSeason(inForm: boolean): void {
    const current = this.currentAgent();
    if (current === undefined) return;
    this.state.agent = { ...current.state, seasonsTogether: current.state.seasonsTogether + 1 };
    this.reportAgentOutcome(inForm ? 'season_in_form' : 'season_out_of_form');
  }

  private agentProfile(agentId: number): AgentProfile | undefined {
    return this.options.roster?.agents?.().find((a) => a.id === agentId);
  }

  /**
   * Memnuniyet dibe vurduysa menajer BIRAKIR.
   *
   * Sessizce degil: uyari esigi gecildiginde bir bildirim dusuyor ki
   * oyuncu icin surpriz olmasin. Kotu sonuclarin gorulebilir olmasi,
   * onlari adil kilan sey.
   */
  private checkAgentQuit(): void {
    const current = this.state.agent;
    if (current === undefined) return;

    if (agentQuits(current)) {
      const name = this.agentProfile(current.agentId)?.name ?? 'Menajerin';
      this.state.formerAgents.push(current.agentId);
      this.state.agent = undefined;
      this.casting?.unbindSlot(this.state, 'agent');
      this.notices.push(`${name} seninle calismayi birakti.`);
    } else if (current.satisfaction < AGENT_WARNING_THRESHOLD) {
      this.notices.push('Menajerin telefonlarina gec donuyor.');
    }
  }

  /** Menajer slotunu imzalanan kisiye baglar. */
  private castAgentActor(profile: AgentProfile): void {
    const [first = profile.name, ...rest] = profile.name.split(' ');
    const id = `agent:${profile.id}`;
    const existing = this.state.actors[id];
    const actor: ActorState = existing ?? {
      id,
      name: profile.name,
      first,
      last: rest.join(' ') || first,
      slotId: 'agent',
      // Baslangic iliskisi memnuniyetle ayni: henuz tanismadiniz, aranizda
      // yalnizca sozlesme var.
      relation: this.state.agent?.satisfaction ?? AGENT_START_SATISFACTION,
      trust: 40,
      chemistry: 0,
      minutesTogether: 0,
      lastInteractionTurn: this.state.turn,
      arcStage: 0,
      alive: true,
      metTurn: this.state.turn,
      lastBoundTurn: this.state.turn,
      memoryStamps: [],
    };
    this.state.actors[id] = actor;
    // Yonetmen yoksa (roster'siz mock dunya) slot baglanmaz -- menajer
    // yine calisir, yalnizca metinde adi gecmez.
    this.casting?.bindActor(this.state, 'agent', actor);
  }

  /**
   * Hero'nun piyasadaki durusu 0-100 -- menajer havuzunun filtresi.
   *
   * SOHRET EKSENI `stature`DIR, bir bayrak degil.
   *
   *   Ilk yazimda burada `sohret` adli bir bayrak okunuyordu. Oyle bir
   *   bayrak PROJEDE YOK: `core.json`da kayitli degil, hicbir icerik
   *   yazmiyor. `numberFlag` yoksa 0 dondugu icin hata da vermiyordu --
   *   durus sessizce `clubRep * 0.4`e dusuyor ve 89 itibarli kulupteki
   *   bir yildiz bile 36 puanlik bir cirak gibi gorunuyordu. 900 turluk
   *   olcum bunu "sohret hic hareket etmiyor" satiriyla ortaya cikardi.
   *
   * `stature` motorun kendi turettigi yedi basamakli merdiven
   * (nobody -> legend); 0-100'e olcekleniyor ve kulup itibariyla
   * harmanlaniyor: kucuk kulupte parlayan oyuncu da, buyuk kulubun
   * yedegi de menajer bulabilmeli.
   */
  private heroStanding(): number {
    const steps = STATURES.length - 1;
    const fame = (statureIndex(this.state.stature) / steps) * 100;
    const clubRep = this.options.roster?.club(this.state.clubId)?.reputation ?? 40;
    return Math.round(fame * 0.6 + clubRep * 0.4);
  }

  // ------------------------------------------------------------- gozlem

  /** KELEBEK GUNLUGU: bu olay neden cikti? */
  explain(eventId: string): readonly string[] {
    return this.consequences.explain(eventId, this.state);
  }

  snapshot(): Readonly<GameState> {
    return this.state;
  }

  save(): SaveEnvelope {
    this.state.rngCursor = this.rng.position;
    return this.saves.save(this.state);
  }

  load(envelope: SaveEnvelope): void {
    this.state = this.saves.load(envelope);
    this.rng = new Rng(this.state.rngSeed, this.state.rngCursor);
    this.active = undefined;
    this.momentQueue = [];
    this.notices = [];
  }

  // ------------------------------------------------------------- ic isleyis

  private requireStarted(): void {
    if (this.state === undefined) throw new EngineStateError('Once start() cagrilmali.');
  }

  private syncClock(): void {
    const clock = this.scheduler.clock(this.state.turn, this.state.startAge);
    this.state.season = clock.season;
    this.state.week = clock.week;
    this.state.age = clock.age;
    this.state.flags['currentTurn'] = clock.turn;
    this.state.flags['season'] = clock.season;
    this.state.flags['week'] = clock.week;
    this.state.flags['age'] = clock.age;
  }

  /**
   * Bir macin yorgunluk maliyetini isler.
   *
   * `matchesThisWeek` sayaci burada artar; haftalik toparlanma o sayiya
   * bakarak ne kadar dinlenildigini belirler. Uc maclik bir hafta ile bos bir
   * hafta ayni toparlanmayi vermemeli.
   */
  private applyMatchFatigue(minutes: number, importance?: MatchImportance): void {
    const f = this.state.flags;
    const kind =
      importance ?? ((typeof f['match_importance'] === 'string'
        ? (f['match_importance'] as MatchImportance)
        : 'league'));

    const delta = matchLoad({
      minutes,
      importance: kind,
      age: this.state.age,
      professionalism: numberFlag(f, 'profesyonellik'),
    });

    f['tukenmislik'] = clamp100(numberFlag(f, 'tukenmislik') + delta.tukenmislik);
    f['kondisyon'] = clamp100(numberFlag(f, 'kondisyon') + delta.kondisyon);
    this.matchesThisWeek += 1;
  }

  /**
   * Haftalik toparlanma + yasa bagli asinma + sakatlik riski.
   *
   * `TurnScheduler.physicalDecline` yillardir tanimliydi ama HIC cagrilmiyordu:
   * yas fizigi ve kondisyonu hic dusurmuyordu. Sezon donusunde uygulaniyor.
   */
  /**
   * HAFTALIK EKONOMI -- maas odenir, piyasa degeri guncellenir.
   *
   * NEDEN VARDI ETMEK GEREKTI:
   *   `haftalik_gelir` bayragi vardi, dort icerik olayi yaziyordu ama
   *   MOTOR HICBIR ZAMAN `servet`e eklemiyordu. Yani "sozlesmen ne
   *   kadar" sorusunun oyunda hicbir karsiligi yoktu: para yalnizca bir
   *   sahne verince artiyor, verince azaliyordu.
   *
   *   `piyasa_degeri` de ayni durumdaydi -- stature formulunun girdisi
   *   ama yalnizca yedi icerik olayindan geliyordu, yani oyuncunun
   *   gercek durumundan bagimsizdi.
   *
   * MAAS NEREDEN GELIR:
   *   Kulup itibari ve Hero'nun sohreti. Sozlesme muzakeresi henuz yok
   *   (bkz. eksikler denetimi B4); o gelene kadar makul bir tahmin
   *   uretmek, sifir birakmaktan iyidir. Muzakere geldiginde bu taban
   *   yalnizca BASLANGIC degeri olur.
   */

  // --------------------------------------------------------------- KREDI

  /**
   * Bu gelirle alinabilecek krediler.
   *
   * Kapasite mevcut borcla azalir; bitince banka teklifi duser ve geriye
   * yalnizca tefeci kalir. "Artik sana kimse vermiyor" ani boyle dogal
   * olarak kurulur.
   */
  loanOffers(): readonly LoanOffer[] {
    this.requireStarted();
    if (this.state.loan !== undefined) return [];
    return loanOffers(
      numberFlag(this.state.flags, 'haftalik_gelir'),
      numberFlag(this.state.flags, 'borc'),
    );
  }

  /**
   * Krediyi ceker: para ELINE GECER, borc TOPLAM geri odeme kadar artar.
   *
   * `borc` tek gercek kaynak olarak tutuluyor -- icerik zaten onu okuyor
   * (`evt_dark_betting_offer` 40.000'de tetikleniyor), yani borclanmak
   * sike teklifi zincirini kendiliginden aciyor.
   */
  takeLoan(offer: LoanOffer): void {
    this.requireStarted();
    if (this.state.loan !== undefined) {
      throw new EngineStateError('Zaten acik bir kredin var.');
    }
    const f = this.state.flags;
    f['servet'] = numberFlag(f, 'servet') + offer.principal;
    f['borc'] = numberFlag(f, 'borc') + offer.total;
    this.state.loan = {
      lender: offer.lender,
      weekly: offer.weekly,
      weeksLeft: offer.weeks,
      missed: 0,
    };
    WalletLedger.record(this.state, offer.principal, 'kredi', `${offer.lender} kredisi`);
    this.notices.push(
      `Kredi cekildi: ${offer.principal.toLocaleString('tr-TR')} TL. ` +
        `Haftalik taksit ${offer.weekly.toLocaleString('tr-TR')} TL, ${offer.weeks} hafta.`,
    );
  }

  /** Acik kredinin durumu -- host masasi icin. */
  currentLoan(): Readonly<LoanState> | undefined {
    return this.state.loan;
  }

  /**
   * Haftalik taksit.
   *
   * Para yetmezse taksit KACIRILIR: ceza borca eklenir ve sayac artar.
   * Ust uste `DEFAULT_THRESHOLD` kacirmak temerruttur ve alacakliya gore
   * farkli sonuc verir:
   *   banka  -- basin ve itibar; medya baskisi artar
   *   tefeci -- `mem_mafia_favor_owed` yazilir; bu iz `legal` kolundaki
   *             tahsilat sahnesini besler
   *
   * Temerrut kredinin kendisini KAPATMAZ; borc durur ve buyur. Kacis
   * yok, secim var: ya odersin ya bedeline katlanirsin.
   */
  private tickLoan(): void {
    const loan = this.state.loan;
    if (loan === undefined) return;
    const f = this.state.flags;

    if (loan.weeksLeft <= 0) {
      this.state.loan = undefined;
      this.notices.push('Kredi kapandi.');
      return;
    }

    const wealth = numberFlag(f, 'servet');
    if (wealth >= loan.weekly) {
      f['servet'] = wealth - loan.weekly;
      f['borc'] = Math.max(0, numberFlag(f, 'borc') - loan.weekly);
      loan.weeksLeft -= 1;
      loan.missed = 0;
      WalletLedger.record(this.state, -loan.weekly, 'kredi', 'Kredi taksiti');
      if (loan.weeksLeft <= 0) {
        this.state.loan = undefined;
        this.notices.push('Kredi bitti. Borcun kapandi.');
      }
      return;
    }

    // --- TAKSIT KACIRILDI
    const penalty = latePenalty(loan);
    f['borc'] = numberFlag(f, 'borc') + penalty;
    loan.missed += 1;
    this.notices.push(
      `Kredi taksiti odenemedi (${loan.missed}). Gecikme cezasi: ${penalty.toLocaleString('tr-TR')} TL.`,
    );

    if (loan.missed < DEFAULT_THRESHOLD) return;

    // --- TEMERRUT
    loan.missed = 0;
    if (loan.lender === 'tefeci') {
      // Bu iz `legal` kolundaki tahsilat sahnesini besler.
      f['mem_mafia_favor_owed'] = true;
      this.state.flagSetTurn['mem_mafia_favor_owed'] = this.state.turn;
      this.notices.push('Borcunu almaya geldiler.');
    } else {
      f['medya_baskisi'] = clamp100(numberFlag(f, 'medya_baskisi') + 12);
      this.notices.push('Bankaya olan borcun basina sizdi.');
    }
  }


  /**
   * TEKNIK DIREKTORUN KOVULMASI.
   *
   * `yonetim_baskisi` bayragini 17 icerik olayi yaziyordu ve motor onu
   * HIC okumuyordu -- "hocayla atistin, yonetim rahatsiz" yazan her
   * sahne sessizce etkisizdi. Burasi o baskiyi bir sonuca bagliyor.
   *
   * Yeni bir "isyan" mekanigi DEGIL: hoca kotu sezonda ve dagilmis
   * soyunma odasinda da gider. Isyan yalnizca sureci hizlandirir --
   * kasitli kotu oynamak formu, takim arkadaslarini kiskirtmak huzuru
   * dusurur ve ikisi de bu formulun girdisi.
   *
   * Yalnizca `manager` slotu yeniden dokulur. Kaptanin ve yildiz
   * oyuncunun da degismesi yanlis olurdu: onlarla kurulan iliski
   * kariyerin kendisidir.
   */
  private tickManager(): void {
    if (!this.casting) return;
    const f = this.state.flags;
    if (f[slotBoundFlag('manager')] !== true) return;

    const relations = new Map<string, number>();
    for (const [slotId, actorId] of Object.entries(this.state.casting)) {
      const actor = this.state.actors[actorId];
      if (actor) relations.set(slotId, actor.relation);
    }

    const pressure = sackPressure({
      boardPressure: numberFlag(f, 'yonetim_baskisi'),
      harmony: dressingRoomHarmony(relations),
      form: numberFlag(f, 'form'),
    });

    const chance = sackChance(pressure);
    if (chance <= 0) return;
    if (this.rng.next() >= chance) {
      this.state.rngCursor = this.rng.position;
      return;
    }
    this.state.rngCursor = this.rng.position;

    // --- KOVULDU
    const outgoing = this.state.actors[this.state.casting['manager'] ?? '']?.name;
    const replaced = this.casting.recastSlot(
      this.state,
      'manager',
      this.castingContext(),
      this.rng,
    );
    this.state.rngCursor = this.rng.position;
    if (!replaced) return;

    f['yonetim_baskisi'] = pressureAfterSack(pressure);
    // Icerik bu izi okuyabilir: "senin yuzunden mi gitti?"
    f['mem_hoca_kovuldu'] = true;
    this.state.flagSetTurn['mem_hoca_kovuldu'] = this.state.turn;

    const incoming = this.state.actors[this.state.casting['manager'] ?? '']?.name;
    this.notices.push(
      outgoing === undefined
        ? 'Teknik direktor gorevden alindi.'
        : `${outgoing} gorevden alindi. Yerine ${incoming ?? 'yeni bir isim'} geldi.`,
    );
  }

  private tickEconomy(): void {
    const f = this.state.flags;

    // Maas: sozlesme yoksa kulup itibari + sohretten tahmin edilir.
    if (numberFlag(f, 'haftalik_gelir') <= 0) {
      const clubRep = this.options.roster?.club(this.state.clubId)?.reputation ?? 40;
      const steps = STATURES.length - 1;
      const fame = statureIndex(this.state.stature) / steps;
      // Alt lig cirak ~2.500, elit yildiz ~250.000 bandinda.
      f['haftalik_gelir'] = Math.round(2_500 + clubRep * 120 * (0.4 + fame * 4));
    }
    const wage = numberFlag(f, 'haftalik_gelir');
    f['servet'] = numberFlag(f, 'servet') + wage;
    WalletLedger.record(this.state, wage, 'maas', 'Haftalik maas');

    // --- SPONSORLUK
    //
    // `iliski_sponsor` bayragini 12 icerik olayi yaziyordu ve NE icerik
    // NE motor okuyordu. Burasi o bayragi bir gelire bagliyor -- ama bir
    // HEDIYE degil bir KAPI olarak: iliskisi bozuk oyuncuya marka para
    // vermez (esik altinda gelir sifir).
    const sponsor = sponsorIncome(
      numberFlag(f, 'iliski_sponsor'),
      statureIndex(this.state.stature) / (STATURES.length - 1),
      numberFlag(f, 'medya_itibari'),
      wage,
    );
    if (sponsor > 0) {
      f['servet'] = numberFlag(f, 'servet') + sponsor;
      WalletLedger.record(this.state, sponsor, 'sponsor', 'Sponsorluk geliri');
    }
  }

  /**
   * PIYASA DEGERI -- motor tabani hesaplar, HIKAYE carpani oynatir.
   *
   * Eskiden `piyasa_degeri` `resource` turundeydi ve yedi icerik olayi
   * dogrudan yaziyordu (bahis skandalinda 0, kahraman gecesinde
   * +200.000 gibi). Motor turetmeye baslayinca o efektler her tur
   * uzerine yazilarak sessizce ETKISIZ kaldi.
   *
   * Saf turetme de yanlis olurdu: bir bahis skandali oyuncunun degerini
   * gercekten cokertmeli. Cozum ikiye bolmek -- motor "ne kadar iyi
   * oyuncusun"u hesaplar (NPC'lerle ayni `valuePlayer` matematigi),
   * icerik "piyasa sana nasil bakiyor"u oynatir (`piyasa_carpani`,
   * %100 notr, mahkumiyette 0).
   */
  private deriveMarketValue(): void {
    const f = this.state.flags;
    const quality = Math.round((numberFlag(f, 'teknik') + numberFlag(f, 'fizik')) / 2);
    const base = valuePlayer({
      baseValue: 250_000 + quality * quality * 900,
      age: this.state.age,
      overall: quality,
      potential: Math.min(99, quality + 8),
      form: numberFlag(f, 'form'),
      seasonsLeft: 2,
    });
    f['piyasa_degeri'] = Math.round(base * (numberFlag(f, 'piyasa_carpani') / 100));
  }

  private tickFatigue(): void {
    const f = this.state.flags;

    const recovery = weeklyRecovery({
      matchesThisWeek: this.matchesThisWeek,
      age: this.state.age,
      professionalism: numberFlag(f, 'profesyonellik'),
      lifeState: this.state.lifeState,
      currentKondisyon: numberFlag(f, 'kondisyon'),
      currentTukenmislik: numberFlag(f, 'tukenmislik'),
    });

    f['tukenmislik'] = clamp100(numberFlag(f, 'tukenmislik') + recovery.tukenmislik);
    f['kondisyon'] = clamp100(numberFlag(f, 'kondisyon') + recovery.kondisyon);

    // Sezon donusu: yasa bagli fiziksel dusus.
    if (this.state.week === 1 && this.state.turn > 1) {
      const decline = this.scheduler.physicalDecline(this.state.age);
      if (decline !== 0) {
        f['fizik'] = clamp100(numberFlag(f, 'fizik') + decline);
        f['kondisyon'] = clamp100(numberFlag(f, 'kondisyon') + decline);
      }
    }

    // Risk TURETILIR, birikmez -- dinlenince duser.
    const risk = injuryRisk(
      numberFlag(f, 'tukenmislik'),
      numberFlag(f, 'kondisyon'),
      this.state.age,
    );
    f['sakatlik_riski'] = risk;

    this.rollFatigueInjury(risk);
    this.matchesThisWeek = 0;
  }

  /**
   * Yorgunluktan sakatlanma.
   *
   * ATESLENMEYEN risk dekorasyondur: `sakatlik_riski` yillardir hesaplanmiyor
   * ve hicbir sey de okumuyordu. Artik hem yaziliyor hem sonuc doguruyor.
   *
   * AYRI RNG AKISI:
   *   Motorun ana `this.rng` akisina dokunmuyoruz. Dokunsaydik her turda bir
   *   cekilis daha yapilir ve mevcut tohumlarin urettigi butun kariyerler
   *   kayardi -- 276 testin bir kismi determinizme dayaniyor. Bunun yerine
   *   (tohum, tur) ikilisinden turetilmis yerel bir akis: yine deterministik,
   *   ama mevcut dunyayi bozmuyor.
   */
  private rollFatigueInjury(risk: number): void {
    if (this.state.lifeState !== 'playing' && this.state.lifeState !== 'loaned') return;
    if (this.state.flags['is_injured'] === true) return;

    const stream = new Rng((this.state.rngSeed ^ 0x7f4a7c15 ^ (this.state.turn * 2654435761)) >>> 0);
    if (stream.next() >= weeklyInjuryChance(risk)) return;

    const weeks = injuryWeeks(risk, stream.next());
    this.state.flags['injury_weeks'] = weeks;
    this.state.flags['is_injured'] = true;
    this.setLifeState('injured');
    this.notices.push(`Sakatlandin: ${weeks} hafta (yorgunluk riski ${risk})`);
  }

  /**
   * Maca cikan Hero'nun SAHA ARKADASLARIYLA kimyasini besler.
   *
   * Yalnizca `source: 'squad'` slotlar: kaptan, yildiz, kaleci, caylak...
   * Teknik direktor ya da baskanla "kimya" olmaz -- onlarla iliski ve guven
   * vardir.
   */
  private applyMatchChemistry(minutes: number): void {
    const gain = chemistryGain(minutes);
    if (gain <= 0) return;

    for (const [slotId, actorId] of Object.entries(this.state.casting)) {
      const slot = this.registry.slots.get(slotId);
      if (slot?.source !== 'squad') continue;

      const actor = this.state.actors[actorId];
      if (!actor) continue;

      actor.minutesTogether += minutes;
      actor.chemistry = applyChemistry(actor.chemistry, gain);
      actor.lastInteractionTurn = this.state.turn;
      this.state.flags[slotChemistryFlag(slotId)] = actor.chemistry;
    }
    this.playedThisWeek = true;
  }

  /**
   * Kimya erimesi + soyunma odasi huzuru.
   *
   * Kimya yalnizca OYNANMAYAN haftalarda erir; oynanan haftada `applyMatchChemistry`
   * zaten besledi. Ikisini ayni turda uygulamak "oynadin ama yine de eridi"
   * gibi tuhaf bir sonuc verirdi.
   */
  private tickBonds(): void {
    if (!this.playedThisWeek) {
      for (const [slotId, actorId] of Object.entries(this.state.casting)) {
        const slot = this.registry.slots.get(slotId);
        if (slot?.source !== 'squad') continue;
        const actor = this.state.actors[actorId];
        if (!actor || actor.chemistry <= 0) continue;

        actor.chemistry = applyChemistry(actor.chemistry, chemistryDecay(actor.chemistry, 1));
        this.state.flags[slotChemistryFlag(slotId)] = actor.chemistry;
      }
    }
    this.playedThisWeek = false;

    // --- SOYUNMA ODASI HUZURU
    //
    // `iliski_takim` bugune kadar yalnizca icerik tarafindan yaziliyordu;
    // artik kadro slotlarinin agirlikli ortalamasindan TURUYOR ve morali
    // besliyor.
    const relations = new Map<string, number>();
    for (const [slotId, actorId] of Object.entries(this.state.casting)) {
      const actor = this.state.actors[actorId];
      if (actor) relations.set(slotId, actor.relation);
    }
    const harmony = dressingRoomHarmony(relations);
    if (harmony !== undefined) this.state.flags['iliski_takim'] = harmony;

    // --- MORAL: HEDEFE DOGRU KAYMA
    //
    // Icerik moral'e 93 pozitif karsilik 503 negatif efekt yaziyor; bir
    // toparlanma olmadan moralin MEDYANI 0'a oturuyordu (olculdu). Moral
    // artik durumun (huzur + form) yankisi: soklar sert kalir, ama zamanla
    // gercek duruma doner.
    const morale = numberFlag(this.state.flags, 'moral');
    const target = moraleTarget(
      harmony,
      numberFlag(this.state.flags, 'form'),
      numberFlag(this.state.flags, 'iliski_aile'),
    );
    const recovery = moraleRecovery(morale, target);
    if (recovery !== 0) {
      this.state.flags['moral'] = clamp100(morale + recovery);
    }
  }

  /** Sakatlik, hukum ve gecici hayat durumu sayaclari. */
  private tickTimers(): void {
    const weeks = this.state.flags['injury_weeks'];
    if (typeof weeks === 'number' && weeks > 0) {
      const left = weeks - 1;
      this.state.flags['injury_weeks'] = left;
      if (left <= 0) {
        this.state.flags['is_injured'] = false;
        if (this.state.lifeState === 'injured') this.setLifeState('playing');
      }
    }

    const sentence = this.state.flags['sentence_weeks'];
    if (typeof sentence === 'number' && sentence > 0) {
      this.state.flags['sentence_weeks'] = sentence - 1;
    }

    if (this.state.lifeStateUntil !== undefined && this.state.turn >= this.state.lifeStateUntil) {
      delete this.state.lifeStateUntil;
      this.setLifeState('playing');
    }
  }

  /** Turetilmis eksenleri yeniden hesaplar ve degisiklikleri bildirir. */
  private syncDerived(): void {
    const nextMediaEra = this.mediaEras.resolve(this.state.season);
    if (nextMediaEra !== this.state.mediaEra) {
      const transition = this.mediaEras.transitionEvent(this.state.mediaEra, nextMediaEra);
      this.state.mediaEra = nextMediaEra;
      this.notices.push(`Medya cagi degisti: ${this.mediaEras.label(nextMediaEra)}`);
      if (transition && this.registry.get(transition)) {
        this.queue.enqueue(
          this.state.scheduledEvents,
          { op: 'schedule', event: transition, inTurns: 1, priority: 'forced' },
          { turn: this.state.turn, sourceEventId: '__media_era__' },
        );
      }
    }
    this.state.flags['media_era'] = this.state.mediaEra;

    // PIYASA DEGERI burada TURETILIR, haftalik tik'te degil.
    //
    // Turetilmis bir deger girdileri degistigi ANDA guncellenmeli.
    // Once `tickEconomy` icindeydi ve yalnizca tur donusunde
    // hesaplaniyordu; bir mahkumiyet sahnesi `piyasa_carpani`yi
    // sifirlasa bile deger bir sonraki tura kadar eski kaliyordu.
    // Zincir testi tam olarak bunu yakaladi.
    this.deriveMarketValue();

    const change = this.progression.update(
      { stature: this.state.stature, clubTier: this.state.clubTier },
      this.state.flags,
    );
    if (change.stature !== this.state.stature) {
      this.state.stature = change.stature;
      this.notices.push(
        change.direction === 'up' ? `Sohretin yukseldi: ${change.stature}` : `Sohretin dustu: ${change.stature}`,
      );
      if (change.triggerEvent && this.registry.get(change.triggerEvent)) {
        this.queue.enqueue(
          this.state.scheduledEvents,
          { op: 'schedule', event: change.triggerEvent, inTurns: 1, priority: 'forced' },
          { turn: this.state.turn, sourceEventId: '__progression__' },
        );
      }
    }

    this.state.flags['lifeState'] = this.state.lifeState;
    this.state.availability = this.suspensionAvailability();
    this.scheduleNemesis();
  }

  /**
   * Bitis kontrolu -- ARADA BIR VEDA DONEMI VAR.
   *
   * OLCULEN SORUN: burasi `retired` hayat durumunu bitis ekraniyla AYNI
   * turda set ediyordu. Bitis dondugu an host donguleri kariyeri
   * kapatiyor, yani `retired` durumu **sifir tur** suruyordu. Sonuc:
   * yalnizca `retired` isteyen 4 olay 1400 turluk simulasyonda bile
   * "kuyruga hic girmedi" olarak olculdu. Icerik hatasi degildi.
   *
   * COZUM: zorunlu yas gelince once `retired` durumuna GECILIR ve
   * `retirementEpilogueTurns` kadar oynanir; bitis o sure dolunca
   * cozulur. `retirementStage` zaten `window`/`choice`/`forced` diye
   * asamali tasarlanmisti -- eksik olan kabloydu, yeni bir sistem degil.
   */
  private checkEnding(): ResolvedEnding | undefined {
    const stage = this.scheduler.retirementStage(this.state.age);
    if (stage !== 'forced') return undefined;

    const epilogue = Math.max(0, this.registry.config.turn.retirementEpilogueTurns);

    // Ilk kez: emekli ol, ama kariyeri KAPATMA.
    if (this.state.retiredAtTurn === undefined) {
      this.state.flags['retired'] = true;
      this.state.retiredAtTurn = this.state.turn;
      this.setLifeState('retired');
      if (epilogue > 0) {
        this.notices.push(
          `Kariyerin sona erdi. Veda donemi: ${epilogue} hafta.`,
        );
        return undefined;
      }
    }

    // Veda donemi dolmadiysa oynamaya devam.
    if (this.state.turn - this.state.retiredAtTurn < epilogue) return undefined;

    const ending = this.endings.resolve(this.state, {
      flags: this.state.flags,
      ...this.identityContext(),
    });
    if (ending) this.state.ending = ending.id;
    return ending;
  }

  private eligibilityContext(): EligibilityContext {
    return {
      era: this.scheduler.era(this.state.age),
      stature: this.state.stature,
      clubTier: this.state.clubTier,
      lifeState: this.state.lifeState,
      mediaEra: this.state.mediaEra,
      archetype: this.state.archetype,
      turn: this.state.turn,
      flags: this.state.flags,
      flagSetTurn: this.state.flagSetTurn,
      seenEvents: this.state.seenEvents,
      seenVariants: this.state.seenVariants,
      cooldownState: {
        cooldowns: this.state.cooldowns,
        familyCooldowns: this.state.familyCooldowns,
        categoryCooldowns: this.state.categoryCooldowns,
      },
    };
  }

  private scaleContext(): ScaleContext {
    return {
      stature: this.state.stature,
      clubTier: this.state.clubTier,
      season: this.state.season,
    };
  }

  private enterEvent(
    event: StoryEvent,
    variantId: string | undefined,
    isMoment: boolean,
    moment?: PendingMoment,
  ): void {
    const rootId = eventRoot(event, variantId);
    if (rootId === undefined) return;

    this.cooldowns.mark(event, this.state.turn, this.state);
    this.state.seenEvents[event.id] = this.state.turn;
    if (variantId !== undefined) {
      this.state.seenVariants[`${event.id}#${variantId}`] = this.state.turn;
    }
    this.consequences.record(event, this.state);

    this.history.push(this.state.history, {
      turn: this.state.turn,
      eventId: event.id,
      family: event.family,
      category: event.category,
      tier: event.tier,
      choiceIds: [],
      ...(variantId !== undefined ? { variantId } : {}),
    });

    this.active = {
      event,
      variantId,
      nodeId: rootId,
      isMoment,
      ...(moment !== undefined ? { moment } : {}),
    };
    this.enterNode();
  }

  /** Node'a girildiginde onEnter efektlerini uygular ve `roll` ise cozer. */
  private enterNode(): void {
    let guard = 0;
    while (this.active && guard < 32) {
      guard += 1;
      const active = this.active;
      const node = this.nodeOf(active);
      if (!node) {
        this.active = undefined;
        return;
      }

      if (node.onEnter && node.onEnter.length > 0) {
        this.applyEffects(node.onEnter, {
          origin: 'content',
          eventId: active.event.id,
          choiceId: `${node.id}:onEnter`,
          choiceText: node.title,
        });
        this.syncDerived();
      }

      if (node.kind !== 'roll') return;

      // `roll` node'u oyuncuya SORULMAZ; motor stat agirlikli cozer ve devam eder.
      const rolled = this.rolls.resolve(node, this.state.flags, this.rng);
      this.state.rngCursor = this.rng.position;
      if (!rolled) {
        this.active = undefined;
        return;
      }
      if (rolled.outcome.effects) {
        this.applyEffects(rolled.outcome.effects, {
          origin: 'content',
          eventId: active.event.id,
          choiceId: `${node.id}:roll`,
          choiceText: node.title,
        });
        this.syncDerived();
      }
      active.nodeId = rolled.target;
    }
  }

  private goTo(active: ActiveEvent, target: string | undefined): void {
    if (target === undefined) {
      this.endActiveEvent();
      return;
    }
    const nodes = eventNodes(active.event, active.variantId);
    if (!(target in nodes)) {
      // Kirik hedef runtime'i dusurmez; validator build zamaninda yakalar.
      this.endActiveEvent();
      return;
    }
    active.nodeId = target;
    this.enterNode();
  }

  private endActiveEvent(): void {
    const closing = this.active;
    // Mac ani kapandiginda cozumu kaydet: host loglayabilir, UI ozetleyebilir.
    // `MomentResolution` bugune kadar tanimliydi ama hicbir yerde uretilmiyordu.
    if (closing?.moment !== undefined) {
      this.lastResolution = {
        moment: closing.moment,
        eventId: closing.event.id,
        choiceId: closing.lastChoiceId ?? '',
        outcomeNodeId: closing.nodeId,
      };
    }
    this.active = undefined;
    if (this.momentQueue.length > 0) this.nextMoment();
  }

  private nextMoment(): void {
    const next = this.momentQueue.shift();
    if (!next) return;
    this.momentBaseline = this.matchDelta;
    this.enterMoment(next);
  }

  /** Bir mac anina girer; metin yer tutucularini o anin baglamiyla doldurur. */
  private enterMoment(entry: BrokeredMoment): void {
    // Moment metinlerinin {opponent}/{minute}/{scoreline} yer tutuculari icin.
    this.state.flags['inc_minute'] = entry.moment.minute;
    this.state.flags['inc_scoreline'] = entry.moment.scoreline;
    this.state.flags['inc_opponent'] = entry.moment.opponent;
    this.enterEvent(entry.selection.event, entry.selection.variantId, true, entry.moment);
  }

  private nodeOf(active: ActiveEvent): StoryNode | undefined {
    return eventNodes(active.event, active.variantId)[active.nodeId];
  }

  private recordChoice(active: ActiveEvent, choiceId: string): void {
    active.lastChoiceId = choiceId;
    const last = this.state.history[this.state.history.length - 1];
    if (last && last.eventId === active.event.id) {
      (last.choiceIds as string[]).push(choiceId);
    }
  }

  private isChoiceUnlocked(choice: Choice): boolean {
    return this.evaluator.evaluate(choice.requires, {
      flags: this.state.flags,
      flagSetTurn: this.state.flagSetTurn,
      turn: this.state.turn,
    });
  }

  /** Flag efektlerini uygular; schedule/lifeState/suspend efektlerini yonlendirir. */
  private applyEffects(
    effects: readonly Effect[],
    source: EffectSource,
    sceneActorId?: string,
  ): void {
    const { changes, deferred } = this.applier.applyAll(
      effects,
      this.state,
      this.scaleContext(),
      source,
    );

    for (const change of changes) {
      // CUZDAN: icerigin yazdigi her para hareketi deftere gecer. Bu
      // dongu zaten tum degisiklikleri geziyor, yani ek maliyet yok.
      if (change.flag === 'servet') {
        const before = typeof change.before === 'number' ? change.before : 0;
        const after = typeof change.after === 'number' ? change.after : 0;
        WalletLedger.record(this.state, after - before, 'olay', source.eventId);
      }
      if (change.shortfall) {
        this.notices.push(
          `Paran yetmedi: ${change.shortfall.amount.toLocaleString('tr-TR')} TL borclandin.`,
        );
      }
      // Iz kalici, yuz degisken: damga ikisini birbirine baglar.
      if (this.registry.flags.get(change.flag)?.kind === 'memory') {
        this.archive.stampMemory(this.state, change.flag, sceneActorId);
      }
    }

    for (const effect of deferred) {
      if (isScheduleEffect(effect)) {
        this.queue.enqueue(this.state.scheduledEvents, effect, {
          turn: this.state.turn,
          sourceEventId: source.eventId,
        });
      } else if (isLifeStateEffect(effect)) {
        if (LifeStateMachine.isLifeState(effect.to)) {
          const moved = this.setLifeState(effect.to);
          if (moved && effect.forTurns !== undefined) {
            this.state.lifeStateUntil = this.state.turn + effect.forTurns;
          }
        }
      } else if (isSuspendEffect(effect)) {
        this.state.availability = this.suspend(effect.matches, effect.reason);
        this.notices.push(`${effect.reason}: ${effect.matches} mac ceza.`);
      } else if (isClubTierEffect(effect)) {
        if (ProgressionTracker.isClubTier(effect.to)) {
          this.state.clubTier = this.progression.setClubTier(this.state.flags, effect.to);
          this.transferToTier(this.state.clubTier);
          this.notices.push(`Kulup seviyesi: ${effect.to}`);
        }
      } else if (isMatchDeltaEffect(effect)) {
        this.accumulateMatchDelta(effect, source);
      }
    }
  }

  /**
   * Mac ici kararin skora yansiyan kismini biriktirir.
   *
   * Motor host'a TEK bir delta dondurur; birden fazla moment karari ayni macta
   * verilirse etkileri toplanir.
   */
  private accumulateMatchDelta(effect: MatchDeltaEffect, source: EffectSource): void {
    const d = this.matchDelta;
    const incidents = [...d.incidents];
    if (effect.incident !== undefined) {
      incidents.push({
        flag: effect.incident,
        minute: Number(this.state.flags['inc_minute'] ?? 0),
        scoreline: String(this.state.flags['inc_scoreline'] ?? ''),
        opponent: String(this.state.flags['inc_opponent'] ?? ''),
        causedByEventId: source.eventId,
        causedByChoiceId: source.choiceId,
        causedByChoiceText: source.choiceText,
      });
    }
    this.matchDelta = {
      goalsDelta: d.goalsDelta + (effect.goals ?? 0),
      assistsDelta: d.assistsDelta + (effect.assists ?? 0),
      yellowCards: d.yellowCards + (effect.yellowCards ?? 0),
      redCard: d.redCard || effect.redCard === true,
      injuryWeeks: Math.max(d.injuryWeeks, effect.injuryWeeks ?? 0),
      ratingModifier: d.ratingModifier + (effect.rating ?? 0),
      incidents,
    };

    // Sakatlik motorun kendi durumudur; host'a bildirilir ama burada da islenir.
    if (effect.injuryWeeks !== undefined && effect.injuryWeeks > 0) {
      this.state.flags['is_injured'] = true;
      this.state.flags['injury_weeks'] = effect.injuryWeeks;
      this.setLifeState('injured');
    }
  }

  private setLifeState(to: LifeState): boolean {
    const { state, ok } = this.lifeStates.tryTransition(this.state.lifeState, to);
    if (ok && state !== this.state.lifeState) {
      this.state.lifeState = state;
      this.state.flags['lifeState'] = state;
      this.notices.push(`Hayat durumu: ${state}`);
      // Hucre arkadasi ancak hapisteyken vardir; kapi kapaninca sahne de kapanir.
      this.casting?.castStateSlots(this.state, this.castingContext(), this.rng);
      this.state.rngCursor = this.rng.position;
    }
    return ok;
  }

  /**
   * HERO ile kimya cozucusu -- host'a verilir.
   *
   * Simulator motorun flag sozlugunu GORMEZ. Bu fonksiyon o sinirin uzerinden
   * TEK bir sayi geciriyor: "bu oyuncuyla ne kadar iyi anlasiyorsun". Neden
   * iyi anlastigini (kac mac, hangi sezon, hangi olay) simulator bilmez.
   */
  chemistryFor(sourceId: string): number | undefined {
    for (const actorId of Object.values(this.state.casting)) {
      const actor = this.state.actors[actorId];
      if (actor?.sourceId === sourceId) return actor.chemistry;
    }
    return undefined;
  }

  /** Host takim ADI verir; kimlik katmani kulup KIMLIGI ister. */
  private resolveOpponentClub(opponentName: string): string | undefined {
    return this.options.roster?.clubs().find((c) => c.name === opponentName)?.id;
  }

  /**
   * Host'un rakip olarak kullanabilecegi kulup adlari.
   * Bunu kullanan host, rakip adini kimlige cozulebilir kilar -- "eski
   * kulubunle mac" tetigi ancak boyle calisir.
   */
  /**
   * Hero'nun host'a gecirilen OZETI.
   *
   * Host motorun flag sozlugunu gormez: `skandal_seviyesi` ya da `mem_*`
   * izleri simulatoru ilgilendirmez. Bu daralma bilinclidir -- host bu ozetin
   * disina cikamadigi surece "simulator hikayeyi okuyor" sizintisi olusamaz.
   */
  heroProfile(): HeroProfile {
    const f = this.state.flags;
    const n = (key: string, fallback: number): number => {
      const v = f[key];
      return typeof v === 'number' ? v : fallback;
    };
    const position = POSITIONS.includes(f['position'] as Position)
      ? (f['position'] as Position)
      : 'MF';

    return {
      position,
      // Teknik eksen pas/teknik ikilisinin ortalamasi; simulator tek sayi ister.
      technical: Math.round((n('teknik', 50) + n('profesyonellik', 50) * 0.4) / 1.4),
      physical: Math.round((n('fizik', 50) + n('kondisyon', 70)) / 2),
      form: n('form', 50),
      // Tukenmislik dogrudan tazeligi yer; sahaya ne kadar dinc ciktigi budur.
      stamina: Math.max(0, Math.min(100, n('kondisyon', 70) - n('tukenmislik', 0) * 0.5)),
      stature: this.state.stature,
      morale: n('moral', 50),
      isCaptain: f['is_captain'] === true,
    };
  }

  opponentPool(): readonly string[] {
    const roster = this.options.roster;
    if (!roster) return [];
    const own = this.state?.clubId;
    return roster
      .clubs()
      .filter((c) => c.id !== own)
      .map((c) => c.name);
  }

  // Ceza yardimcilari -- durum flag'ler uzerinde tutulur, mantik SuspensionTracker'da.
  private suspend(matches: number, reason: string): PlayerAvailability {
    const availability = this.suspensions.suspend(this.state, matches, reason);
    if (!availability.available) this.setLifeState('suspended');
    return availability;
  }

  private suspensionConsume(): PlayerAvailability {
    const availability = this.suspensions.consumeMatch(this.state);
    if (availability.available && this.state.lifeState === 'suspended') this.setLifeState('playing');
    return availability;
  }

  private suspensionAvailability(): PlayerAvailability {
    const base = this.suspensions.availability(this.state);
    if (!base.available) return base;
    // Hapis, rehab ve kadro disi gibi durumlar da sahaya cikmayi engeller.
    if (!this.lifeStates.canPlay(this.state.lifeState)) {
      return { available: false, reason: this.state.lifeState, matchesRemaining: 0 };
    }
    return base;
  }

  private present(active: ActiveEvent): PresentedNode | undefined {
    const node = this.nodeOf(active);
    if (!node) return undefined;

    const interpolation = {
      flags: this.state.flags,
      locals: {
        opponent: String(this.state.flags['inc_opponent'] ?? this.state.flags['opponent_name'] ?? ''),
        minute: Number(this.state.flags['inc_minute'] ?? 0),
        scoreline: String(this.state.flags['inc_scoreline'] ?? ''),
      },
      ...this.identityContext(),
    };

    const choices: PresentedChoice[] =
      node.kind === 'outcome'
        ? [{ id: CONTINUE_CHOICE_ID, text: 'Devam et', locked: false }]
        : (node.choices ?? [])
            .map((c) => this.presentChoice(c, interpolation))
            .filter((c) => !(c.locked && c.hidden))
            .map(({ hidden: _hidden, ...rest }) => rest);

    return {
      eventId: active.event.id,
      nodeId: node.id,
      title: this.interpolator.interpolate(node.title, interpolation),
      text: this.interpolator.interpolate(node.text, interpolation),
      kind: node.kind,
      tier: active.event.tier,
      category: active.event.category,
      choices,
      isMoment: active.isMoment,
      ...(active.variantId !== undefined ? { variantId: active.variantId } : {}),
    };
  }

  private presentChoice(
    choice: Choice,
    interpolation: Parameters<TextInterpolator['interpolate']>[1],
  ): PresentedChoice & { hidden: boolean } {
    const unlocked = this.isChoiceUnlocked(choice);
    if (unlocked) {
      return {
        id: choice.id,
        text: this.interpolator.interpolate(choice.text, interpolation),
        locked: false,
        hidden: false,
      };
    }
    const fail = this.evaluator.firstFailingLeaf(choice.requires, {
      flags: this.state.flags,
      flagSetTurn: this.state.flagSetTurn,
      turn: this.state.turn,
    });
    return {
      id: choice.id,
      text: this.interpolator.interpolate(choice.text, interpolation),
      locked: true,
      hidden: choice.hideWhenLocked === true,
      ...(choice.lockLabel !== undefined ? { lockLabel: choice.lockLabel } : {}),
      ...(fail !== undefined
        ? { lockReason: `${fail.flag} ${fail.op} ${JSON.stringify(fail.value ?? '')}` }
        : {}),
    };
  }

  private report(ending?: ResolvedEnding): TurnReport {
    const presented = this.currentNode();
    return {
      turn: this.state.turn,
      season: this.state.season,
      week: this.state.week,
      age: this.state.age,
      era: this.scheduler.era(this.state.age),
      stature: this.state.stature,
      clubTier: this.state.clubTier,
      mediaEra: this.state.mediaEra,
      lifeState: this.state.lifeState,
      notices: [...this.notices],
      ...(presented !== undefined ? { presented } : {}),
      ...(ending !== undefined ? { ending } : {}),
    };
  }
}

export type { FlagValue };

/** Sayisal flag okumasi -- eksikse ya da tip disiysa 0. */
function numberFlag(flags: Record<string, unknown>, key: string): number {
  const value = flags[key];
  return typeof value === 'number' ? value : 0;
}

function clamp100(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;
}
