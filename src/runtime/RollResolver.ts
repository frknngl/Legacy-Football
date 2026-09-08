/**
 * `roll` node cozucu.
 *
 * Oyuncu karar verir, sonucu STAT belirler. Penaltiya "ben cekerim" demek
 * cesarettir; golu atmak teknigin isidir. Tohumlu RNG sayesinde ayni tohum +
 * ayni secim = ayni sonuc (test edilebilirlik).
 */

import type { RollOutcome, StoryNode } from '../domain/story.js';
import type { FlagValue } from '../domain/flags.js';
import { WeightExpressionEvaluator } from '../evaluation/WeightExpressionEvaluator.js';
import type { Rng } from '../selection/Rng.js';

export interface RollResult {
  readonly outcome: RollOutcome;
  readonly target: string;
  /** Her dalin hesaplanmis agirligi -- hata ayiklama ve test icin. */
  readonly weights: readonly { readonly target: string; readonly weight: number }[];
}

export class RollResolver {
  constructor(private readonly evaluator = new WeightExpressionEvaluator()) {}

  resolve(
    node: StoryNode,
    flags: Readonly<Record<string, FlagValue>>,
    rng: Rng,
  ): RollResult | undefined {
    const outcomes = node.outcomes ?? [];
    if (outcomes.length === 0) return undefined;

    const weights = outcomes.map((o) => ({
      target: o.target,
      weight: this.evaluator.evaluate(o.weight, flags),
    }));

    const total = weights.reduce((sum, w) => sum + w.weight, 0);
    // Tum agirliklar sifirsa ilk dal kullanilir -- oyuncu bosluga dusmez.
    if (total <= 0) {
      const first = outcomes[0]!;
      return { outcome: first, target: first.target, weights };
    }

    const chosen = rng.weighted(outcomes, (o) => this.evaluator.evaluate(o.weight, flags));
    const outcome = chosen ?? outcomes[0]!;
    return { outcome, target: outcome.target, weights };
  }
}
