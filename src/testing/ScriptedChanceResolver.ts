/**
 * Senaryolu sans cozucu -- testler icin.
 *
 * Sonuclari SIRAYLA verir; RNG'ye bakmaz. Boylece bir test "bu macta tam iki
 * gol olsun" diyebilir ve simulatorun geri kalanini (skor tutma, gol atani
 * secme, moment uretimi) rastgeleligin gurultusu olmadan olcebilir.
 *
 * Ayni zamanda portun gercekten TAKAS EDILEBILIR oldugunun kanitidir:
 * `MathChanceResolver` yerine bu konuldugunda simulator tek satir degismez.
 */

import type { ChanceContext, ChanceResolver, ChanceResult } from '../domain/chance.js';

export class ScriptedChanceResolver implements ChanceResolver {
  private cursor = 0;
  readonly seen: ChanceContext[] = [];

  /**
   * @param script Sirayla dondurulecek sonuclar.
   * @param fallback Senaryo bitince ne olsun (varsayilan: hepsi kurtarilir).
   */
  constructor(
    private readonly script: readonly ChanceResult['outcome'][],
    private readonly fallback: ChanceResult['outcome'] = 'saved',
  ) {}

  resolve(context: ChanceContext, _roll: number): ChanceResult {
    this.seen.push(context);
    const outcome = this.script[this.cursor] ?? this.fallback;
    this.cursor += 1;
    return {
      outcome,
      xG: outcome === 'goal' ? 1 : 0,
      playerRating: outcome === 'goal' ? 1 : -0.3,
    };
  }

  reset(): void {
    this.cursor = 0;
    this.seen.length = 0;
  }
}
