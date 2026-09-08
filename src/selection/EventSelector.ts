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
    const scheduled = this.takeScheduled(ctx);
    if (scheduled) return scheduled;

    const pool = this.eligiblePool(ctx);
    const chosen = this.picker.pick(pool, rng, {
      turn: ctx.turn,
      history: ctx.history,
      persona: ctx.persona,
      flags: ctx.flags,
    });
    if (!chosen) return undefined;

    return this.withVariant(chosen, ctx, rng, false);
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
    const candidates = this.registry
      .forMoment(momentType)
      .filter((e) => this.filter.isEligible(e, ctx));
    if (candidates.length === 0) return undefined;
    const chosen = rng.weighted(candidates, (e) => e.weight);
    if (!chosen) return undefined;
    return this.withVariant(chosen, ctx, rng, false);
  }

  private takeScheduled(ctx: SelectionContext): SelectionResult | undefined {
    for (const entry of this.queue.due(ctx.scheduledEvents, ctx.turn)) {
      const outcome = this.queue.resolve(entry, ctx.scheduledEvents, (id) => {
        const event = this.registry.get(id);
        return event !== undefined && this.filter.isEligible(event, ctx);
      });
      if (outcome === 'defer' || outcome === 'drop') continue;

      const event = this.registry.get(outcome.eventId);
      // Kuyruktaki olay icerikten silinmisse sessizce dus; validator zaten
      // build zamaninda bunu hata olarak bildirir.
      if (!event) continue;

      const result = this.withVariant(event, ctx, undefined, entry.priority === 'forced');
      return { ...result, scheduledBy: entry };
    }
    return undefined;
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
  ): SelectionResult {
    const variants = event.variants ?? [];
    if (variants.length === 0) return { event, forced, fallback: false };

    const unseen = this.filter.unseenVariants(event, ctx);
    if (unseen.length > 0) {
      const id = rng ? unseen[rng.int(unseen.length)]! : unseen[0]!;
      return { event, variantId: id, forced, fallback: false };
    }

    // Havuz tukendi: EN UZUN SUREDIR gorulmemis varyanta dusulur.
    const allowed = this.filter.allowedVariants(event, ctx);
    if (allowed.length === 0) return { event, forced, fallback: true };

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
}
