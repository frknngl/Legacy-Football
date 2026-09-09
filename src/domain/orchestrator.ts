/**
 * Orkestratör yapilandirmasi: motorun davranisini belirleyen, icerikten okunan tanimlar.
 * Bunlar kod degil VERIdir -- content/orchestrator/ altindaki JSON dosyalarindan gelir.
 */

import type { Archetype, ClubTier, Era, LifeState, MediaEra, Stature } from './axes.js';
import type { NameConfig, NemesisDefinition, Position, SlotDefinition } from './actors.js';
import type { Ending, EpilogueCoda } from './endings.js';
import type { FlagDefinition, FlagValue } from './flags.js';
import type { GameDefinition } from './gambling.js';
import type { AssetDefinition } from './assets.js';
import type { InflationConfig } from './inflation.js';
import type { Instrument } from './market.js';
import type { PrivateLifeConfig } from './privateLife.js';

export interface EraDefinition {
  readonly id: Era;
  readonly minAge: number;
  readonly maxAge: number;
  readonly label: string;
}

export interface StatureThreshold {
  readonly id: Stature;
  /** StatureCalculator skorunun bu seviyeye cikmasi icin gereken esik. */
  readonly threshold: number;
  readonly label: string;
}

export interface ClubTierDefinition {
  readonly id: ClubTier;
  readonly label: string;
}

/** Hayat durumu: gecis kurallari ve kapatilan icerik havuzlari. */
export interface LifeStateDefinition {
  readonly id: LifeState;
  readonly label: string;
  /** Bu durumda sahaya cikilabilir mi. */
  readonly canPlay: boolean;
  readonly transitionsTo: readonly LifeState[];
  /** Bu durumdayken kapali icerik kategorileri. */
  readonly closedCategories: readonly string[];
}

/** era x stature x clubTier izgarasinda anlamsiz hucreler. */
export interface ImpossibleCell {
  readonly era?: Era;
  readonly stature?: Stature;
  readonly clubTier?: ClubTier;
  readonly reason: string;
}

export interface ProgressionConfig {
  readonly statureThresholds: readonly StatureThreshold[];
  readonly clubTiers: readonly ClubTierDefinition[];
  /** StatureCalculator girdi agirliklari: flag -> katsayi. */
  readonly statureWeights: Readonly<Record<string, number>>;
  /**
   * Histerezis payi: seviye DUSMESI icin skorun esigin bu kadar altina inmesi gerekir.
   * Yukselis hizli, dusus yavas -- tek kotu sezonda ikon -> hickimse olmaz.
   */
  readonly hysteresis: number;
  /** Seviye atlama/dusme olaylarinin id'leri. */
  readonly promotionEvent?: string;
  readonly demotionEvent?: string;
  readonly impossibleCells: readonly ImpossibleCell[];
}

export interface MediaEraDefinition {
  readonly id: MediaEra;
  readonly minSeason: number;
  readonly maxSeason: number;
  readonly label: string;
  /** Cag degisiminde tetiklenen gecis olayi. */
  readonly transitionEvent?: string;
}

export interface ArchetypeDefinition {
  readonly id: Archetype;
  readonly label: string;
  readonly startAge: number;
  readonly note: string;
  /** Baslangic flag degerleri -- registry default'larinin uzerine yazilir. */
  readonly startFlags: Readonly<Record<string, FlagValue>>;
  readonly startClubTier: ClubTier;
  /**
   * Hero'nun sahadaki mevkisi.
   *
   * 11v11 simulasyonunun onkosulu: kadro Hero'nun ETRAFINA kurulur ve moment
   * uretimi mevkiye bakar (santrfor `one_on_one` gorur, stoper degil).
   */
  readonly startPosition: Position;
  readonly nemesis?: string;
}

export interface TurnConfig {
  readonly turnsPerSeason: number;
  /** Emeklilik penceresi acilir. */
  readonly retirementWindowAge: number;
  /** Oyuncunun karar verebildigi aralik. */
  readonly retirementChoiceMinAge: number;
  /** Zorunlu emeklilik. */
  readonly forcedRetirementAge: number;
  /**
   * VEDA DONEMI -- zorunlu emeklilikten SONRA kac tur oynanir.
   *
   * NEDEN VAR: `retired` hayat durumu, bitis ekraniyla ayni anda set
   * ediliyordu; yani sifir tur suruyordu. O duruma yazilmis 10 olayin
   * 4'u (yalnizca `retired` isteyenler) hicbir kariyerde sahneye
   * gelemiyordu -- icerik degil, motor kaynakli olu icerik.
   */
  readonly retirementEpilogueTurns: number;
}

/** Yuklenmis tum orkestratör yapilandirmasi. */
/**
 * KATEGORI RITMI -- ucuncu soguma seviyesi.
 *
 * Olay ve aile sogumasi ayni SAHNENIN tekrarini engeller; bu, ayni TONUN
 * tekrarini engeller. Bes farkli aileye ait bes soyunma odasi olayi, aile
 * sogumasi acisindan birbirinden bagimsizdir ve ust uste cikabilir.
 */
export interface CadenceConfig {
  readonly defaultCooldown: number;
  readonly categories: Readonly<Record<string, number>>;
}

/**
 * SURUM KAPILARI -- ilk cikista neyin acik oldugu.
 *
 * Mevki kilidi kod degil veri: kaleci ve defans acilinca `release.json`
 * degisir, TypeScript degismez.
 */
export interface ReleaseConfig {
  readonly playablePositions: readonly string[];
  readonly lockedPositions: Readonly<Record<string, { label: string; reason: string }>>;
  /** Kilitli mevkinin dusecegi acik mevki. */
  readonly positionFallback: Readonly<Record<string, string>>;
}

export interface OrchestratorConfig {
  readonly schemaVersion: number;
  readonly flags: readonly FlagDefinition[];
  readonly eras: readonly EraDefinition[];
  readonly lifeStates: readonly LifeStateDefinition[];
  readonly progression: ProgressionConfig;
  readonly mediaEras: readonly MediaEraDefinition[];
  readonly archetypes: readonly ArchetypeDefinition[];
  /** Kimlik katmani: icerigin yazdigi rol yuvalari. */
  readonly slots: readonly SlotDefinition[];
  /** Prosedurel isim havuzlari. */
  readonly names: NameConfig;
  readonly nemeses: readonly NemesisDefinition[];
  readonly endings: readonly Ending[];
  /**
   * Epilog kodalari -- kariyerin biraktigi izlerin sondaki karsiligi.
   * Sonlanmadan bagimsiz: hangisiyle bitilirse bitilsin uygulanir.
   */
  readonly epilogueCodas: readonly EpilogueCoda[];
  readonly turn: TurnConfig;
  /** Kumar katalogu -- `content/economy/games.json`. */
  readonly games: readonly GameDefinition[];
  /** Varlik katalogu -- `content/economy/assets.json`. */
  readonly assets: readonly AssetDefinition[];
  /** Enflasyon -- `content/economy/inflation.json`. */
  readonly inflation: InflationConfig;
  /** Borsa ve kripto katalogu -- `content/economy/markets.json`. */
  readonly markets: readonly Instrument[];
  /** Ozel hayat dengesi -- `content/social/private-life.json`. */
  readonly privateLife: PrivateLifeConfig;
  readonly cadence: CadenceConfig;
  readonly release: ReleaseConfig;
  /**
   * YETIM BAYRAK TABANI -- circir listesi.
   *
   * Buradaki `mem_*` bayraklari yaziliyor ama okunmuyor; bu bir BORCTUR
   * ve kapatilana kadar `warn`. Listede OLMAYAN yeni bir yetim `error`.
   * Liste bosaldiginda dosya kaldirilir ve kural saf `error` olur.
   */
  readonly orphanBaseline: readonly string[];
}
