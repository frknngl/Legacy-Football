/**
 * Uygunluk filtresi: bir olayin SU AN cikabilir olup olmadigina karar verir.
 *
 * Sekiz kapi:
 *   1. era        (yas evresi)
 *   2. stature    (sohret)          <- "seviyeye uygunluk" ucgeninin ikinci ayagi
 *   3. clubTier   (kulup seviyesi)  <- ucuncu ayagi
 *   4. lifeState  (hapis/sakat/kiralik...)
 *   5. mediaEra   (gazete -> deepfake)
 *   6. archetype
 *   7. trigger    (kosul agaci)
 *   8. cooldown (olay / aile / KATEGORI) + once + gorulmus varyant
 *
 * 2. Lig'deki 24 yasindaki oyuncu ile Sampiyonlar Liginde 24 yasindaki oyuncu
 * AYNI ERA'dadir ama ayni olaylari ALMAZ. Fark buradan cikar.
 */

import type { Archetype, ClubTier, Era, LifeState, MediaEra, Stature } from '../domain/axes.js';
import type { FlagValue } from '../domain/flags.js';
import { eventStorySignature, storyBeatKey, type StoryEvent } from '../domain/story.js';
import { ConditionEvaluator } from '../evaluation/ConditionEvaluator.js';
import { CooldownTracker, type CooldownState } from './CooldownTracker.js';

export interface EligibilityContext {
  readonly era: Era;
  readonly stature: Stature;
  readonly clubTier: ClubTier;
  readonly lifeState: LifeState;
  readonly mediaEra: MediaEra;
  readonly archetype: Archetype;
  readonly turn: number;
  readonly flags: Readonly<Record<string, FlagValue>>;
  readonly flagSetTurn: Readonly<Record<string, number>>;
  readonly seenEvents: Readonly<Record<string, number>>;
  readonly seenVariants: Readonly<Record<string, number>>;
  readonly storyArcTurns: Readonly<Record<string, number>>;
  readonly storyBeatTurns: Readonly<Record<string, number>>;
  readonly storyBeatCounts: Readonly<Record<string, number>>;
  readonly storySignatureTurns: Readonly<Record<string, number>>;
  readonly cooldownState: CooldownState;
}

export type RejectReason =
  | 'era'
  | 'stature'
  | 'clubTier'
  | 'lifeState'
  | 'mediaEra'
  | 'archetype'
  | 'trigger'
  | 'cooldown_self'
  | 'cooldown_family'
  | 'cooldown_category'
  | 'story_arc_gap'
  | 'story_beat_gap'
  | 'story_signature_gap'
  | 'story_beat_cap'
  | 'once';

function allows<T>(allowed: readonly T[] | undefined, actual: T): boolean {
  // Eksen belirtilmemisse olay TUM degerlere aciktir.
  return allowed === undefined || allowed.includes(actual);
}

function blockedByGap(lastSeenAt: number | undefined, currentTurn: number, gap: number): boolean {
  return lastSeenAt !== undefined && currentTurn - lastSeenAt < gap;
}

export class EligibilityFilter {
  constructor(
    private readonly evaluator: ConditionEvaluator = new ConditionEvaluator(),
    private readonly cooldowns: CooldownTracker = new CooldownTracker(),
  ) {}

  isEligible(event: StoryEvent, ctx: EligibilityContext): boolean {
    return this.rejectReason(event, ctx) === undefined;
  }

  /** Neden elendi? `simulate` raporunda ölü olaylarin sebebini gostermek icin. */
  rejectReason(event: StoryEvent, ctx: EligibilityContext): RejectReason | undefined {
    if (!allows(event.eras, ctx.era)) return 'era';
    if (!allows(event.stature, ctx.stature)) return 'stature';
    if (!allows(event.clubTiers, ctx.clubTier)) return 'clubTier';
    if (!allows(event.lifeStates, ctx.lifeState)) return 'lifeState';
    if (!allows(event.mediaEras, ctx.mediaEra)) return 'mediaEra';
    if (!allows(event.archetypes, ctx.archetype)) return 'archetype';

    const blocked = this.cooldowns.blockedBy(event, ctx.turn, ctx.cooldownState, ctx.seenEvents);
    if (blocked === 'once') return 'once';
    if (blocked === 'self') return 'cooldown_self';
    if (blocked === 'family') return 'cooldown_family';
    if (blocked === 'category') return 'cooldown_category';

    const story = event.story;
    const policy = event.repeatPolicy;
    if (story !== undefined && policy !== undefined) {
      if (
        story.arc !== undefined &&
        policy.arcGapTurns !== undefined &&
        blockedByGap(ctx.storyArcTurns[story.arc], ctx.turn, policy.arcGapTurns)
      ) {
        return 'story_arc_gap';
      }

      const beatKey = storyBeatKey(story);
      if (
        beatKey !== undefined &&
        policy.beatGapTurns !== undefined &&
        blockedByGap(ctx.storyBeatTurns[beatKey], ctx.turn, policy.beatGapTurns)
      ) {
        return 'story_beat_gap';
      }
      if (
        beatKey !== undefined &&
        policy.maxBeatUses !== undefined &&
        (ctx.storyBeatCounts[beatKey] ?? 0) >= policy.maxBeatUses
      ) {
        return 'story_beat_cap';
      }

      const signature = eventStorySignature(event);
      if (
        signature !== undefined &&
        policy.signatureGapTurns !== undefined &&
        blockedByGap(ctx.storySignatureTurns[signature], ctx.turn, policy.signatureGapTurns)
      ) {
        return 'story_signature_gap';
      }
    }

    if (
      !this.evaluator.evaluate(event.trigger, {
        flags: ctx.flags,
        flagSetTurn: ctx.flagSetTurn,
        turn: ctx.turn,
      })
    ) {
      return 'trigger';
    }

    return undefined;
  }

  /**
   * Bu olayin GORULMEMIS varyantlari.
   *
   * Ayni metnin ikinci kez cikmamasinin garantisi burada kurulur: secici once
   * hic gorulmemis varyantlari dener. Hepsi gorulduyse `undefined` doner ve
   * cagiran taraf "en uzun suredir gorulmemis" varyanta duser.
   */
  unseenVariants(event: StoryEvent, ctx: EligibilityContext): readonly string[] {
    const variants = event.variants ?? [];
    if (variants.length === 0) return [];
    return variants
      .filter((v) => allows(v.archetypes as readonly Archetype[] | undefined, ctx.archetype))
      .filter((v) => ctx.seenVariants[`${event.id}#${v.id}`] === undefined)
      .map((v) => v.id);
  }

  /** Arketipe uygun TUM varyantlar (gorulmus olsun olmasin). */
  allowedVariants(event: StoryEvent, ctx: EligibilityContext): readonly string[] {
    return (event.variants ?? [])
      .filter((v) => allows(v.archetypes as readonly Archetype[] | undefined, ctx.archetype))
      .map((v) => v.id);
  }
}
