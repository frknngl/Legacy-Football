/**
 * Sonlanma cozucu.
 *
 * Emeklilik tek bir ekran degildir. Kosullari saglayan sonlanmalardan EN YUKSEK
 * onceligi olan secilir: "mahkum" sonu, "sessiz veda" sonundan once gelmelidir --
 * ikisi de dogru olabilir, ama biri digerini kapsar.
 */

import type { Ending, ResolvedEnding } from '../domain/endings.js';
import type { GameState } from '../domain/state.js';
import { ConditionEvaluator } from '../evaluation/ConditionEvaluator.js';
import { TextInterpolator, type InterpolationContext } from '../evaluation/TextInterpolator.js';

export class EndingResolver {
  constructor(
    private readonly endings: readonly Ending[],
    private readonly evaluator: ConditionEvaluator = new ConditionEvaluator(),
    private readonly interpolator: TextInterpolator = new TextInterpolator(),
  ) {}

  resolve(state: GameState, interpolation: InterpolationContext): ResolvedEnding | undefined {
    const matches = this.endings
      .filter((e) =>
        this.evaluator.evaluate(e.requires, {
          flags: state.flags,
          flagSetTurn: state.flagSetTurn,
          turn: state.turn,
        }),
      )
      .sort((a, b) => b.priority - a.priority);

    const chosen = matches[0];
    if (!chosen) return undefined;

    return {
      id: chosen.id,
      title: chosen.title,
      epilogue: this.interpolator.interpolate(chosen.epilogue, interpolation),
    };
  }

  /** Hangi sonlanmalarin kosulu saglaniyor -- test ve hata ayiklama icin. */
  candidates(state: GameState): readonly string[] {
    return this.endings
      .filter((e) =>
        this.evaluator.evaluate(e.requires, {
          flags: state.flags,
          flagSetTurn: state.flagSetTurn,
          turn: state.turn,
        }),
      )
      .sort((a, b) => b.priority - a.priority)
      .map((e) => e.id);
  }
}
