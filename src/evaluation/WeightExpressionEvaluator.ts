/**
 * Stat-agirlikli olasilik.
 *
 *   agirlik = base + toplam(flagDegeri * scale)
 *
 * Teknik 90 olan oyuncunun penalti isabeti, teknik 30 olandan OLCULEBILIR
 * sekilde yuksek olmalidir. Negatif agirlik 0'a kirpilir -- imkansiz dal
 * kuyrugu bozmaz.
 */

import type { WeightExpression } from '../domain/story.js';
import type { FlagValue } from '../domain/flags.js';

export class WeightExpressionEvaluator {
  evaluate(expr: WeightExpression, flags: Readonly<Record<string, FlagValue>>): number {
    let weight = expr.base;
    for (const mod of expr.modifiers ?? []) {
      const raw = flags[mod.flag];
      const n = typeof raw === 'number' ? raw : typeof raw === 'boolean' ? (raw ? 1 : 0) : 0;
      weight += n * mod.scale;
    }
    return weight > 0 ? weight : 0;
  }
}
