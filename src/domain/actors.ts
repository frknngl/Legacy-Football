/**
 * KIMLIK KATMANI -- slot / aktor ayrimi.
 *
 * Icerik ASLA bir kisiye yazmaz, bir SLOT'a yazar:
 *   metin    -> {actor.captain.name}
 *   mekanik  -> iliski_captain
 *
 * O slotu kimin doldurdugu motorun isidir. Transferde club-scope slotlar
 * YENIDEN ATANIR, eski aktorler arsive gider ve iliskileri KORUNUR. Boylece
 * "eski kaptanin simdi rakip takimda" sahnesi tek bir ozel isim yazmadan
 * kurulabilir.
 */

import type { Condition } from './conditions.js';
import type { FlagDefinition } from './flags.js';

/** Slotun ne zaman yeniden atandigi. */
export const SLOT_SCOPES = ['career', 'club', 'world', 'match', 'state', 'former'] as const;export type SlotScope = (typeof SLOT_SCOPES)[number];

/** Aktorun nereden dokuldugu. */
export const ACTOR_SOURCES = ['squad', 'staff', 'opponent_squad', 'external'] as const;
export type ActorSource = (typeof ACTOR_SOURCES)[number];

export const STAFF_ROLES = [
  'manager',
  'assistant',
  'president',
  'sporting_director',
  'doctor',
  'physio',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const POSITIONS = ['GK', 'DF', 'MF', 'FW'] as const;
export type Position = (typeof POSITIONS)[number];

export type Gender = 'male' | 'female';

/**
 * Oyuncu nitelikleri (0-100) -- 11v11 simulasyonunun girdisi.
 *
 * `quality` bunlardan TURETILIR (bkz. `overallFor`), tersi degil. Boylece
 * "kaliteli ama sut atamayan santrfor" gibi tutarsizliklar yapisal olarak
 * imkansizlasir ve simulator her mevkiyi kendi ekseninden okur.
 *
 * CSV adaptoru geldiginde sutun listesi TAM OLARAK burasidir: simulator hangi
 * niteligi gercekten kullandigini kanitladigi icin fazla kolon ithal edilmez,
 * eksik kolon kacirilmaz.
 */
export interface PlayerAttributes {
  readonly pace: number;
  readonly shooting: number;
  readonly passing: number;
  readonly defending: number;
  readonly physical: number;
  readonly goalkeeping: number;
}

export type AttributeKey = keyof PlayerAttributes;

export const ATTRIBUTE_KEYS: readonly AttributeKey[] = [
  'pace',
  'shooting',
  'passing',
  'defending',
  'physical',
  'goalkeeping',
];

/**
 * Mevkiye gore nitelik agirliklari. Her satirin toplami 1.
 *
 * Bir stoperin sut yetenegi overall'ini neredeyse hic etkilemez; kalecinin
 * kurtarisi ise overall'inin ucte ikisidir. `TeamModel` hat guclerini de bu
 * agirliklardan okuyacak -- tek dogruluk kaynagi.
 */
export const POSITION_WEIGHTS: Readonly<
  Record<Position, Readonly<Record<AttributeKey, number>>>
> = {
  GK: { pace: 0.05, shooting: 0, passing: 0.1, defending: 0.05, physical: 0.15, goalkeeping: 0.65 },
  DF: { pace: 0.15, shooting: 0.03, passing: 0.15, defending: 0.42, physical: 0.25, goalkeeping: 0 },
  MF: { pace: 0.15, shooting: 0.15, passing: 0.4, defending: 0.15, physical: 0.15, goalkeeping: 0 },
  FW: { pace: 0.25, shooting: 0.4, passing: 0.15, defending: 0.03, physical: 0.17, goalkeeping: 0 },
};

/** Mevkiye gore agirlikli overall. `RosterPerson.quality` tam olarak budur. */
export function overallFor(position: Position, attributes: PlayerAttributes): number {
  const weights = POSITION_WEIGHTS[position];
  let total = 0;
  for (const key of ATTRIBUTE_KEYS) total += attributes[key] * weights[key];
  return Math.round(total);
}

/** Tek bir kokenin ad/soyad havuzu. */
export interface NamePool {
  readonly male: readonly string[];
  readonly female: readonly string[];
  readonly last: readonly string[];
}

/** names.json -- icerigin ozel isim yazmamasini mumkun kilan havuz. */
export interface NameConfig {
  readonly pools: Readonly<Record<string, NamePool>>;
  readonly foreignOrigins: readonly string[];
  readonly foreignRatioByClubTier: Readonly<Record<string, number>>;
  readonly nicknames: readonly string[];
}

/** Arsivdeki bir aktorun sahneye geri donme sebebi. */
export const REUNION_TRIGGERS = [
  'opponent_is_former_club',
  'joined_your_club',
  'became_pundit',
  'national_camp',
  'time_elapsed',
] as const;
export type ReunionTrigger = (typeof REUNION_TRIGGERS)[number];

/**
 * Kadrodan hangi kisinin secilecegi.
 *   highest:<alan> | lowest:<alan> | position:<POS> | staff:<rol> | oldest | youngest | same_position
 */
export type CastingRule = string;

/** Iliski sonumlenmesi. Pozitif erir, mem_* damgali negatif KALICIDIR. */
export interface RelationDecay {
  readonly positivePerSeason: number;
  readonly negativeLocked: boolean;
  readonly towards: number;
}

/** roles.json'daki bir slot tanimi. */
export interface SlotDefinition {
  readonly id: string;
  readonly scope: SlotScope;
  readonly label: string;
  readonly note?: string;
  readonly source: ActorSource;
  readonly staffRole?: StaffRole;
  readonly castingRule?: CastingRule;
  readonly gender?: 'male' | 'female' | 'any';
  /** "Cem 'Aga' Dogan" gibi lakapli isim uretilsin mi. */
  readonly nicknamed?: boolean;
  /** "Dr." gibi sabit unvan. */
  readonly titled?: string;
  /** Yalnizca bu hayat durumlarinda sahneye cikar. */
  readonly lifeStates?: readonly string[];
  readonly defaultRelation: number;
  /** Itibar bazli baslangic: sohretin yukseldikce yeni kaptan sana farkli baslar. */
  readonly relationByStature?: Readonly<Record<string, number>>;
  readonly arcStages: number;
  readonly mortal: boolean;
  readonly decay: RelationDecay;
  /** former-scope slotlar icin: hangi slotun arsivinden besleniyor. */
  readonly archiveOf?: string;
  readonly reunionTriggers?: readonly ReunionTrigger[];
}

/** Kadro/personel kaynagindan gelen ham kisi. Motor bunu SAHIPLENMEZ, okur. */
export interface RosterPerson {
  /** Dis kaynaktaki kararli kimlik. DB gelince gercek satir kimligi olur. */
  readonly sourceId: string;
  readonly first: string;
  readonly last: string;
  readonly displayName: string;
  readonly age: number;
  readonly position: Position;
  readonly leadership: number;
  /** Mevkiye gore agirlikli overall -- `attributes`ten TURETILIR, elle yazilmaz. */
  readonly quality: number;
  readonly aggression: number;
  /** 11v11 simulasyonunun okudugu ham nitelikler. */
  readonly attributes: PlayerAttributes;
  /** Isim havuzu kokeni: tr, br, es, fr, rs... */
  readonly origin: string;
  readonly gender: Gender;
  readonly clubId: string;
  readonly shirtNumber: number;
}

export interface StaffPerson {
  readonly sourceId: string;
  readonly first: string;
  readonly last: string;
  readonly displayName: string;
  readonly age: number;
  readonly role: StaffRole;
  readonly origin: string;
  readonly gender: Gender;
  readonly clubId: string;
}

export type AnyPerson = RosterPerson | StaffPerson;

export function isRosterPerson(p: AnyPerson): p is RosterPerson {
  return 'position' in p;
}

/**
 * Motorun sahiplendigi aktor kaydi.
 *
 * Isim burada SNAPSHOT'tir; canli veri `RosterProvider.lookup(sourceId)` ile
 * okunur. Kaynak artik taniyorsa guncel, tanimiyorsa (silinmis/emekli) bu
 * snapshot kullanilir -- zarif bozulma.
 */
export interface ActorState {
  readonly id: string;
  name: string;
  first: string;
  last: string;
  readonly sourceId?: string;
  /** Ilk hangi slot icin dokulmustu. */
  readonly slotId: string;
  clubId?: string;
  relation: number;
  /**
   * 0-100. Bedeli varken arkanda durur mu.
   * `relation`dan YAVAS hareket eder, ihanetle SERT duser.
   */
  trust: number;
  /**
   * 0-100. Sahada seni anliyor mu. Yalnizca `source: 'squad'` slotlarda
   * anlamli; sozle degil DAKIKAYLA kurulur, transferde sifirlanir.
   */
  chemistry: number;
  /** Birlikte oynanan toplam dakika -- `chemistry`nin ham girdisi. */
  minutesTogether: number;
  /** Son etkilesim turu -- "uzun suredir gorusmediniz" sahneleri icin. */
  lastInteractionTurn: number;
  arcStage: number;
  alive: boolean;
  metTurn: number;
  /** Son bagli oldugu tur -- sonumlenme ve arsiv budamasi icin. */
  lastBoundTurn: number;
  /** Bu aktorle damgalanmis mem_* izleri. Budamada KORUR. */
  memoryStamps: string[];
}

/** slotId -> actorId. Bos slot = bagli degil. */
export type Casting = Record<string, string>;

export function slotRelationFlag(slotId: string): string {
  return `iliski_${slotId}`;
}

export function slotArcFlag(slotId: string): string {
  return `npc_${slotId}_arc`;
}

export function slotBoundFlag(slotId: string): string {
  return `slot_${slotId}_bound`;
}

export function slotSeasonsFlag(slotId: string): string {
  return `slot_${slotId}_seasons`;
}

/**
 * GUVEN -- bedeli varken arkanda durur mu.
 *
 * `relation`dan AYRI olmak zorunda: kaptan seni sevebilir ama basina karsi
 * savunmak bedel ister. `relation 80 / trust 30` gercek bir soyunma odasi
 * halidir ve tek sayiyla ifade edilemez.
 */
export function slotTrustFlag(slotId: string): string {
  return `guven_${slotId}`;
}

/**
 * KIMYA -- sahada seni anliyor mu.
 *
 * SOZLE YUKSELMEZ. Yalnizca birlikte oynanan DAKIKADAN dogar ve transferde
 * sifirlanir. Bu yuzden icerik bu flag'e YAZAMAZ (`ReadOnlyFlagRule`);
 * yalnizca okur. Iki oyuncu birbirinden hoslanmasa da uc sezon birlikte
 * oynadiysa paslasir -- iliski ve kimya ayri eksenlerdir.
 */
export function slotChemistryFlag(slotId: string): string {
  return `kimya_${slotId}`;
}

/** Bir slot icin motorun sentezledigi dort flag. core.json'a elle yazilmaz. */
export function synthesizedFlagsFor(slotId: string): readonly string[] {
  return [
    slotRelationFlag(slotId),
    slotArcFlag(slotId),
    slotBoundFlag(slotId),
    slotSeasonsFlag(slotId),
    slotTrustFlag(slotId),
    slotChemistryFlag(slotId),
  ];
}

/** Itibar bazli baslangic iliskisi (KARAR: stature yuksekse yeni kaptan farkli baslar). */
export function initialRelation(slot: SlotDefinition, stature: string): number {
  return slot.relationByStature?.[stature] ?? slot.defaultRelation;
}

export const NEMESIS_RESOLUTIONS = ['yikim', 'saygi', 'dostluk'] as const;
export type NemesisResolution = (typeof NEMESIS_RESOLUTIONS)[number];

/** Rakip arkinin bir asamasi. */
export interface NemesisStage {
  readonly stage: number;
  readonly label: string;
  /** Bu asamayi acan olay. */
  readonly eventId: string;
  /** Bu asama en erken hangi sezonda planlanabilir. */
  readonly minSeason?: number;
}

export interface NemesisResolutionDefinition {
  readonly id: NemesisResolution;
  readonly eventId: string;
  /** Kosulsuz final SON sirada olmali; ilk eslesen kazanir. */
  readonly condition?: Condition;
}

/** Rakip arki. `slotRef` roles.json'daki bir world-scope slotu gosterir. */
export interface NemesisDefinition {
  readonly id: string;
  readonly slotRef: string;
  readonly label: string;
  /** Iki asama arasindaki en az tur farki -- ark bir sezona sikismasin. */
  readonly gapTurns: number;
  readonly stages: readonly NemesisStage[];
  readonly resolutions: readonly NemesisResolutionDefinition[];
  /** Hangi arketiplerde bu rakip secilir. Bos = hepsi. */
  readonly archetypes?: readonly string[];
}

/**
 * Bir slotun dort flag'ini uretir.
 *
 * Bu yuzden yeni bir NPC eklemek core.json'a DOKUNMAZ: roles.json'a bir satir
 * yeter. `iliski_*` ve `npc_*_arc` icerige acik, `slot_*` ikilisi motorun
 * turettigi salt-okunur degerlerdir.
 */
export function slotFlagDefinitions(slot: SlotDefinition): readonly FlagDefinition[] {
  return [
    {
      key: slotRelationFlag(slot.id),
      kind: 'relation',
      type: 'number',
      default: slot.defaultRelation,
      label: `${slot.label} ile iliski`,
    },
    {
      key: slotArcFlag(slot.id),
      kind: 'system',
      type: 'number',
      default: 0,
      min: 0,
      max: slot.arcStages,
      label: `${slot.label} arki asamasi`,
    },
    {
      key: slotBoundFlag(slot.id),
      kind: 'derived',
      type: 'boolean',
      default: false,
      label: `${slot.label} sahnede mi`,
    },
    {
      key: slotSeasonsFlag(slot.id),
      kind: 'derived',
      type: 'number',
      default: 0,
      label: `${slot.label} kac sezondur taniniyor`,
    },
  ];
}
