/**
 * Olay secici -- facade.
 *
 * Secim sirasi:
 *   1. Vadesi gelmis ZORUNLU (forced) olaylar -- agirlikli secim BYPASS edilir
 *   2. Vadesi gelmis weighted olaylar -- havuza yuksek agirlikla girer
 *   3. Uygun havuzdan agirlikli secim
 *
 * TEKRAR GARANTISI:
 *   Uygun havuzda GORULMEMIS icerik kaldigi surece hicbir metin tekrar etmez.
 *   Havuz tukendiginde en uzun suredir gorulmemis varyanta dusulur ve bu durum
 *   `fallback` olarak raporlanir. `simulate` ilk fallback turunu olcer.
 */

import type { ContentRegistry } from '../loading/ContentRegistry.js';
import type { StoryEvent } from '../domain/story.js';
import type { HistoryEntry, PersonaState, ScheduledEvent } from '../domain/state.js';
import { EligibilityFilter, type EligibilityContext } from './EligibilityFilter.js';
import type { Rng } from './Rng.js';
import { ScheduledEventQueue } from './ScheduledEventQueue.js';
import { WeightedPicker } from './WeightedPicker.js';

const SCHEDULED_WEIGHT_BONUS = 6;

interface WeightedScheduledCandidate {
  readonly event: StoryEvent;
  readonly entry: ScheduledEvent;
}

interface ScheduledSelection {
  readonly forced?: SelectionResult;
  readonly weighted: readonly WeightedScheduledCandidate[];
}

export interface SelectionResult {
  readonly event: StoryEvent;
  readonly variantId?: string;
  /** Zorunlu kuyruktan mi geldi? */
  readonly forced: boolean;
  /** Gorulmemis varyant kalmadigi icin tekrara mi dusuldu? */
  readonly fallback: boolean;
  /** Kuyruktan geldiyse onu kim zamanladi. */
  readonly scheduledBy?: ScheduledEvent;
}

export interface SelectionContext extends EligibilityContext {
  readonly history: readonly HistoryEntry[];
  readonly persona: PersonaState;
  readonly scheduledEvents: ScheduledEvent[];
}

export class EventSelector {
  constructor(
    private readonly registry: ContentRegistry,
    private readonly filter: EligibilityFilter = new EligibilityFilter(),
    private readonly picker: WeightedPicker = new WeightedPicker(),
    private readonly queue: ScheduledEventQueue = new ScheduledEventQueue(),
  ) {}

  select(ctx: SelectionContext, rng: Rng): SelectionResult | undefined {
    const scheduled = this.collectScheduled(ctx);
    if (scheduled.forced) return scheduled.forced;

    const normal = this.selectablePool(this.eligiblePool(ctx), ctx);
    const queued = scheduled.weighted
      .filter((c) => this.selectablePool([c.event], ctx).length > 0);

    const all = this.boostedPool(normal, queued);
    if (all.length === 0) return undefined;

    // Tekrari ertelemek icin once gorulmemis icerik havuzunda sec.
    const unseen = this.boostedPool(
      normal.filter((e) => this.hasUnseenContent(e, ctx)),
      queued.filter((c) => this.hasUnseenContent(c.event, ctx)),
    );
    const source = unseen.length > 0 ? unseen : all;

    const chosen = this.picker.pick(source, rng, {
      turn: ctx.turn,
      history: ctx.history,
      persona: ctx.persona,
      flags: ctx.flags,
    });
    if (!chosen) return undefined;

    const result = this.withVariant(chosen, ctx, rng, false);
    if (!result) return undefined;

    const scheduledBy = queued.find((c) => c.event.id === chosen.id)?.entry;
    if (!scheduledBy) return result;

    this.queue.resolve(
      scheduledBy,
      ctx.scheduledEvents,
      this.scheduledEligibility(ctx),
      { consume: true },
    );
    return { ...result, scheduledBy };
  }

  /**
   * Haftalik takvimde cikabilecek olaylar.
   *
   * `momentType` tasiyan olaylar BU HAVUZA GIRMEZ: onlar host'un sundugu bir
   * mac anina cevaptir, takvimin kendiliginden urettigi bir sey degil. Aksi
   * halde penalti sahnesi maç olmadan cikar ve {opponent} / {minute} yer
   * tutuculari bos kalir.
   *
   * `scheduledOnly` de ayni nedenle disaridadir: sirali bir yayin ucuncu
   * halkasi rastgele cikarsa yay yay olmaktan cikar.
   */
  eligiblePool(ctx: EligibilityContext): readonly StoryEvent[] {
    return this.registry
      .candidates({
        era: ctx.era,
        stature: ctx.stature,
        clubTier: ctx.clubTier,
        lifeState: ctx.lifeState,
        mediaEra: ctx.mediaEra,
        archetype: ctx.archetype,
      })
      .filter((e) => e.momentType === undefined && e.scheduledOnly !== true)
      .filter((e) => this.filter.isEligible(e, ctx));
  }

  /** Bir `PendingMoment` tipini karsilayan uygun olaylar. */
  forMoment(momentType: string, ctx: EligibilityContext, rng: Rng): SelectionResult | undefined {
    const candidates = this.selectablePool(
      this.registry
      .forMoment(momentType)
      .filter((e) => this.filter.isEligible(e, ctx)),
      ctx,
    );
    if (candidates.length === 0) return undefined;

    // Mac anlarinda da gorulmemis icerik tukenene kadar tekrar etme.
    const unseen = candidates.filter((e) => this.hasUnseenContent(e, ctx));
    const source = unseen.length > 0 ? unseen : candidates;

    const chosen = rng.weighted(source, (e) => e.weight);
    if (!chosen) return undefined;
    return this.withVariant(chosen, ctx, rng, false);
  }

  private collectScheduled(ctx: SelectionContext): ScheduledSelection {
    const weighted: WeightedScheduledCandidate[] = [];
    const isRunnable = this.scheduledEligibility(ctx);

    for (const entry of this.queue.due(ctx.scheduledEvents, ctx.turn)) {
      if (entry.priority === 'forced') {
        const forced = this.queue.resolve(entry, ctx.scheduledEvents, isRunnable, { consume: true });
        if (forced === 'defer' || forced === 'drop') continue;

        const event = this.registry.get(forced.eventId);
        // Kuyruktaki olay icerikten silinmisse sessizce dus; validator zaten
        // build zamaninda bunu hata olarak bildirir.
        if (!event) continue;

        const result = this.withVariant(event, ctx, undefined, true);
        if (!result) continue;
        return { forced: { ...result, scheduledBy: entry }, weighted };
      }

      const preview = this.queue.resolve(entry, ctx.scheduledEvents, isRunnable, { consume: false });
      if (preview === 'defer' || preview === 'drop') {
        // Defer/drop etkisini bu turde uygula; aday havuzuna girmez.
        this.queue.resolve(entry, ctx.scheduledEvents, isRunnable, { consume: true });
        continue;
      }

      const event = this.registry.get(preview.eventId);
      if (!event) {
        this.queue.resolve(entry, ctx.scheduledEvents, isRunnable, { consume: true });
        continue;
      }
      weighted.push({ event, entry });
    }
    return { weighted };
  }

  private scheduledEligibility(ctx: SelectionContext): (eventId: string) => boolean {
    return (id: string): boolean => {
      const event = this.registry.get(id);
      if (!event) return false;
      if (!this.filter.isEligible(event, ctx)) return false;
      return this.selectablePool([event], ctx).length > 0;
    };
  }

  /**
   * Varyant secimi -- ayni metnin ikinci kez cikmasini engelleyen kapi.
   * `rng` verilmezse ilk uygun varyant secilir (zorunlu olaylarda determinizm).
   */
  private withVariant(
    event: StoryEvent,
    ctx: EligibilityContext,
    rng: Rng | undefined,
    forced: boolean,
  ): SelectionResult | undefined {
    const variants = event.variants ?? [];
    if (variants.length === 0) {
      return { event, forced, fallback: ctx.seenEvents[event.id] !== undefined };
    }

    const allowed = this.filter.allowedVariants(event, ctx);
    if (allowed.length === 0) return undefined;

    const unseen = allowed.filter((id) => ctx.seenVariants[`${event.id}#${id}`] === undefined);
    if (unseen.length > 0) {
      const id = rng ? unseen[rng.int(unseen.length)]! : unseen[0]!;
      return { event, variantId: id, forced, fallback: false };
    }

    // Havuz tukendi: EN UZUN SUREDIR gorulmemis varyanta dusulur.
    let oldestId = allowed[0]!;
    let oldestTurn = Number.POSITIVE_INFINITY;
    for (const id of allowed) {
      const seen = ctx.seenVariants[`${event.id}#${id}`] ?? -1;
      if (seen < oldestTurn) {
        oldestTurn = seen;
        oldestId = id;
      }
    }
    return { event, variantId: oldestId, forced, fallback: true };
  }

  private selectablePool(events: readonly StoryEvent[], ctx: EligibilityContext): StoryEvent[] {
    return events.filter((event) => {
      const variants = event.variants ?? [];
      return variants.length === 0 || this.filter.allowedVariants(event, ctx).length > 0;
    });
  }

  private hasUnseenContent(event: StoryEvent, ctx: EligibilityContext): boolean {
    const variants = event.variants ?? [];
    if (variants.length === 0) return ctx.seenEvents[event.id] === undefined;
    return this.filter.unseenVariants(event, ctx).length > 0;
  }

  private boostedPool(
    normal: readonly StoryEvent[],
    queued: readonly WeightedScheduledCandidate[],
  ): StoryEvent[] {
    const out = [...normal];
    for (const candidate of queued) {
      for (let i = 0; i < SCHEDULED_WEIGHT_BONUS; i += 1) {
        out.push(candidate.event);
      }
    }
    return out;
  }
}
