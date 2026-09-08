/**
 * KELEBEK GUNLUGU.
 *
 * Her olaydan sonra "bu neden basima geldi?" izi. `flagSetTurn` ve `flagSource`
 * zaten EffectApplier tarafindan tutuldugu icin ucuzdur: tetigin OKUDUGU flag'i,
 * onu YAZAN karara kadar geriye izler.
 *
 *   "Bu olay su yuzden cikti: Sezon 5, Hafta 12 -- Cem Aga'nin teklifini kabul ettin."
 *
 * Kariyer sonunda hangi dallari gordugun, hangilerinin kapali kaldigi da
 * buradan cikar; tekrar oynama motivasyonu bu.
 */

import type { ConsequenceTrace, GameState } from '../domain/state.js';
import type { StoryEvent } from '../domain/story.js';
import { ConditionEvaluator } from '../evaluation/ConditionEvaluator.js';

export class ConsequenceLedger {
  constructor(
    private readonly evaluator: ConditionEvaluator = new ConditionEvaluator(),
    private readonly turnsPerSeason = 40,
  ) {}

  /**
   * Olayin tetigini saglayan flag'leri, onlari yazan kararlara kadar izler.
   * Kaynagi bilinmeyen flag'ler (baslangic degerleri, host verileri) atlanir --
   * onlarin arkasinda bir KARAR yoktur.
   */
  trace(event: StoryEvent, state: GameState): ConsequenceTrace[] {
    if (!event.trigger) return [];

    const satisfying = this.evaluator.satisfyingLeaves(event.trigger, {
      flags: state.flags,
      flagSetTurn: state.flagSetTurn,
      turn: state.turn,
    });

    const traces: ConsequenceTrace[] = [];
    const seen = new Set<string>();

    for (const flag of satisfying) {
      if (seen.has(flag)) continue;
      seen.add(flag);

      const source = state.flagSource[flag];
      if (!source) continue;

      const elapsed = Math.max(0, source.turn - 1);
      traces.push({
        eventId: event.id,
        viaFlag: flag,
        causedByTurn: source.turn,
        causedBySeason: Math.floor(elapsed / this.turnsPerSeason) + 1,
        causedByWeek: (elapsed % this.turnsPerSeason) + 1,
        causedByEventId: source.eventId,
        causedByChoiceId: source.choiceId,
        causedByChoiceText: source.choiceText,
      });
    }

    return traces;
  }

  /** Gunluge yazar ve kaydi dondurur. */
  record(event: StoryEvent, state: GameState): ConsequenceTrace[] {
    const traces = this.trace(event, state);
    state.consequenceLog.push(...traces);
    return traces;
  }

  /** Bir olayin neden ciktiginin insan okunur aciklamasi. */
  explain(eventId: string, state: GameState): string[] {
    return state.consequenceLog
      .filter((t) => t.eventId === eventId)
      .map(
        (t) =>
          `Sezon ${t.causedBySeason}, Hafta ${t.causedByWeek} - "${t.causedByChoiceText}" (${t.causedByEventId})`,
      );
  }
}
