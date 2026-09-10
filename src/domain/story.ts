/**
 * Hikaye yapilari: node, secim, olay.
 */

import type {
  Archetype,
  ClubTier,
  Era,
  LifeState,
  MediaEra,
  PersonaAxis,
  Stature,
  Tier,
} from './axes.js';
import type { Condition } from './conditions.js';
import type { Effect } from './effects.js';

export type AuthoringOrigin = 'hand' | 'generated';

/**
 * Bir secim.
 *
 * requires saglanmadiginda secim GIZLENMEZ, KILITLI gosterilir (lockLabel ile).
 * Oyuncu neyi kacirdigini gormeli -- kapali kapinin arkasi motivasyondur.
 */
export interface Choice {
  readonly id: string;
  /** Karakterin SESI. Mekanik ozet degil; mekanik etiket lockLabel alaninda durur. */
  readonly text: string;
  readonly requires?: Condition;
  /** Ornek: "[Liderlik 70]". requires varsa zorunludur. */
  readonly lockLabel?: string;
  /** Istisnai: kilitliyken tamamen gizle (surprizi bozacaksa). */
  readonly hideWhenLocked?: boolean;
  readonly effects: readonly Effect[];
  /** Hedef node id'si. Verilmezse olay biter ve takvime donulur. */
  readonly target?: string;
  /** Kimlik eksenlerine katki. Dogrudan set degil, itekleme. */
  readonly persona?: Partial<Record<PersonaAxis, number>>;
}

/**
 * Stat-agirlikli olasilik:  agirlik = base + toplam(flagDegeri * scale)
 *
 * Teknik 90 olan oyuncunun penalti isabeti, teknik 30 olandan
 * olculebilir sekilde yuksek olmalidir.
 */
export interface WeightExpression {
  readonly base: number;
  readonly modifiers?: readonly { readonly flag: string; readonly scale: number }[];
}

/** roll node'unda bir sonuc dali. */
export interface RollOutcome {
  readonly target: string;
  readonly weight: WeightExpression;
  /** Bu dal secildiginde uygulanacak ek efektler. */
  readonly effects?: readonly Effect[];
}

export type NodeKind =
  /** Oyuncu secer. En az 3 secenek ZORUNLU. */
  | 'branch'
  /** Anlati kapanisi; tek bir devam cikisi. */
  | 'outcome'
  /** Motor tohumlu RNG + stat agirliklariyla karar verir. */
  | 'roll';

export interface StoryNode {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly kind: NodeKind;
  /** Node'a girildigi anda kosulsuz uygulanan efektler. */
  readonly onEnter?: readonly Effect[];
  /** branch icin. */
  readonly choices?: readonly Choice[];
  /** roll icin. */
  readonly outcomes?: readonly RollOutcome[];
  /** outcome icin: bittiginde nereye. Verilmezse olay biter. */
  readonly next?: string;
}

/** Bir olayin metin varyanti -- ayni yapi, farkli sahne. */
export interface EventVariant {
  readonly id: string;
  readonly rootNode: string;
  readonly nodes: Readonly<Record<string, StoryNode>>;
  /** Varyanta ozel ek kapilama (ornegin yalnizca immigrant arketipi). */
  readonly archetypes?: readonly Archetype[];
}

/** Validator muafiyeti. reason ZORUNLUDUR; bos muafiyet hatadir. */
export interface LintWaiver {
  readonly ignore: readonly string[];
  readonly reason: string;
}

export interface CooldownSpec {
  /** Bu olayin kendisi kac tur tekrar cikamaz. */
  readonly self: number;
  /**
   * Ayni AILEDEN herhangi bir olay kac tur cikamaz.
   * "Ust uste 100 kez gece kulubu" hatasini yapisal olarak onler.
   */
  readonly family: number;
}

/** Olayin anlati defteri kimligi. */
export interface StoryMeta {
  /** Uzun kol (ornegin transfer_agent_arc). */
  readonly arc?: string;
  /** Arc icindeki halka (ornegin teklif_1, teklif_2, kopus). */
  readonly beat?: string;
  /** Sahnenin oznel yuzu: hangi slotun etrafinda donuyor. */
  readonly slot?: string;
  /** Defter imzasi; verilirse anti-tekrar kapilari bunu okur. */
  readonly signature?: string;
}

/** Olay bazli tekrar sozlesmesi. */
export interface RepeatPolicy {
  /** Ayni arc etiketinden bir olay en erken kac tur sonra gelebilir. */
  readonly arcGapTurns?: number;
  /** Ayni beat etiketi en erken kac tur sonra gelebilir. */
  readonly beatGapTurns?: number;
  /** Ayni imza en erken kac tur sonra gelebilir. */
  readonly signatureGapTurns?: number;
  /** Ayni beat etiketi bir kariyerde en fazla kac kez oynanir. */
  readonly maxBeatUses?: number;
}

/**
 * Bir senaryo agaci.
 *
 * Kapilama uc bagimsiz eksenle yapilir (era x stature x clubTier) + lifeState
 * + mediaEra + arketip. Bos birakilan eksen "hepsi" demektir.
 */
export interface StoryEvent {
  readonly id: string;
  /** Cooldown ailesi. Ayni temanin tum varyasyonlari ayni aileyi paylasir. */
  readonly family: string;
  /** Klasor/kategori: match, reaction, legal, life, daily, dark... */
  readonly category: string;
  readonly tier: Tier;
  /** Icerigin kokeni: elle mi yazildi yoksa model uretimi mi. */
  readonly authored?: AuthoringOrigin;

  readonly eras?: readonly Era[];
  readonly stature?: readonly Stature[];
  readonly clubTiers?: readonly ClubTier[];
  readonly lifeStates?: readonly LifeState[];
  readonly mediaEras?: readonly MediaEra[];
  readonly archetypes?: readonly Archetype[];

  /** Kimligine uyan olaylar daha sik cikar. */
  readonly personaAffinity?: Partial<Record<PersonaAxis, number>>;

  readonly weight: number;
  readonly cooldown: CooldownSpec;
  /** Kariyer boyunca yalnizca bir kez. */
  readonly once?: boolean;
  /**
   * Haftalik havuzda ASLA cikmaz; yalnizca bir `schedule` onu getirebilir.
   * Sirali yaylar (rakip arki, cag gecisleri) bu sayede karismaz.
   */
  readonly scheduledOnly?: boolean;
  readonly trigger?: Condition;

  /** Bu olay hangi PendingMoment tipini karsiliyor (yalnizca match kategorisi). */
  readonly momentType?: string;

  /** Faz B: olaylar arasi kalici anlati imzasi. */
  readonly story?: StoryMeta;
  /** Faz B: olay bazli tekrar freni. */
  readonly repeatPolicy?: RepeatPolicy;

  /** Tek varyantli olaylar icin. */
  readonly rootNode?: string;
  readonly nodes?: Readonly<Record<string, StoryNode>>;
  /** Cok varyantli olaylar icin -- secici GORULMEMIS varyanti tercih eder. */
  readonly variants?: readonly EventVariant[];

  readonly lint?: LintWaiver;
  /** Hangi dosyadan geldi -- hata mesajlari icin. */
  readonly sourceFile?: string;
}

/** `arc` + `beat` ikilisini tek anahtarda birlestirir. */
export function storyBeatKey(story: StoryMeta): string | undefined {
  if (story.beat === undefined) return undefined;
  return `${story.arc ?? '_'}#${story.beat}`;
}

/** Olayin repeat-policy imza anahtari. */
export function eventStorySignature(event: StoryEvent): string | undefined {
  return event.story?.signature;
}

function pickVariant(event: StoryEvent, variantId?: string): EventVariant | undefined {
  const variants = event.variants ?? [];
  if (variantId !== undefined) return variants.find((v) => v.id === variantId);
  return variants[0];
}

export function eventNodes(
  event: StoryEvent,
  variantId?: string,
): Readonly<Record<string, StoryNode>> {
  if (event.nodes) return event.nodes;
  return pickVariant(event, variantId)?.nodes ?? {};
}

export function eventRoot(event: StoryEvent, variantId?: string): string | undefined {
  if (event.rootNode) return event.rootNode;
  return pickVariant(event, variantId)?.rootNode;
}

/** Tum varyantlarin tum node'lari -- validator icin. */
export function* allNodes(event: StoryEvent): Generator<readonly [string, StoryNode]> {
  if (event.nodes) {
    for (const entry of Object.entries(event.nodes)) yield entry;
  }
  for (const v of event.variants ?? []) {
    for (const entry of Object.entries(v.nodes)) yield entry;
  }
}

/** Tum varyantlardaki tum secimler -- validator icin. */
export function* allChoices(event: StoryEvent): Generator<readonly [StoryNode, Choice]> {
  for (const [, node] of allNodes(event)) {
    for (const choice of node.choices ?? []) yield [node, choice];
  }
}
