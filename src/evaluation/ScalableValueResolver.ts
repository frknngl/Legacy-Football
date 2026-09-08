/**
 * Olceklenen degeri somut sayiya cevirir.
 *
 * Tek olay, 7 sohret seviyesi. 2. Lig'de 10.000 TL rusvet, ikon seviyesinde
 * 730.000 TL. Ayni senaryonun 5 kopyasini yazma ihtiyaci ortadan kalkar.
 */

import { clubTierIndex, statureIndex } from '../domain/axes.js';
import {
  isScalableValue,
  type EffectValue,
  type ScalableValue,
  type ScaleContext,
} from '../domain/effects.js';

export class ScalableValueResolver {
  resolve(value: ScalableValue, ctx: ScaleContext): number {
    const raw = value.base + value.perTier * this.axisIndex(value, ctx);
    return this.clamp(raw, value);
  }

  /** Sayi ise oldugu gibi, olceklenen deger ise cozerek dondurur. */
  resolveEffectValue(value: EffectValue | undefined, ctx: ScaleContext): EffectValue | undefined {
    if (isScalableValue(value)) return this.resolve(value, ctx);
    return value;
  }

  /**
   * Bir olceklenen degerin TUM seviyelerdeki karsiliklari.
   * `ScalableValueRule` bunu kullanarak hicbir seviyede sacma bir tutar
   * olusmadigini dogrular.
   */
  spread(value: ScalableValue, season: number): number[] {
    const steps = value.scaleBy === 'stature' ? 7 : value.scaleBy === 'clubTier' ? 5 : season;
    const out: number[] = [];
    for (let i = 0; i < Math.max(1, steps); i += 1) {
      out.push(this.clamp(value.base + value.perTier * i, value));
    }
    return out;
  }

  private axisIndex(value: ScalableValue, ctx: ScaleContext): number {
    switch (value.scaleBy) {
      case 'stature':
        return statureIndex(ctx.stature);
      case 'clubTier':
        return clubTierIndex(ctx.clubTier);
      case 'season':
        return Math.max(0, ctx.season - 1);
    }
  }

  private clamp(n: number, value: ScalableValue): number {
    let out = n;
    if (value.clampMin !== undefined) out = Math.max(value.clampMin, out);
    if (value.clampMax !== undefined) out = Math.min(value.clampMax, out);
    return Math.round(out);
  }
}
