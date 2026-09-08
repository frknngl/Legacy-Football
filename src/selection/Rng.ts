/**
 * Tohumlanabilir rastgele sayi ureteci (mulberry32).
 *
 * Deterministik test ve tekrarlanabilir kariyer icin sart: ayni tohum + ayni
 * secimler = ayni kariyer. `cursor` kaydedilip yuklenebildigi icin bir oyunu
 * kaydedip devam ettirmek RNG akisini bozmaz.
 */
export class Rng {
  private state: number;

  constructor(
    readonly seed: number,
    private cursor = 0,
  ) {
    this.state = seed >>> 0;
    // Kaydedilmis imlece kadar ileri sar.
    for (let i = 0; i < cursor; i += 1) this.raw();
  }

  /** [0, 1) araliginda sayi. */
  next(): number {
    this.cursor += 1;
    return this.raw();
  }

  /** [0, max) araliginda tamsayi. */
  int(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** Agirlikli secim. Toplam agirlik 0 ise undefined doner. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T | undefined {
    let total = 0;
    for (const item of items) total += Math.max(0, weightOf(item));
    if (total <= 0) return undefined;

    let roll = this.next() * total;
    for (const item of items) {
      roll -= Math.max(0, weightOf(item));
      if (roll < 0) return item;
    }
    return items[items.length - 1];
  }

  /** Yerinde karistirma (Fisher-Yates). */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = this.int(i + 1);
      const a = items[i]!;
      const b = items[j]!;
      items[i] = b;
      items[j] = a;
    }
    return items;
  }

  get position(): number {
    return this.cursor;
  }

  private raw(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
