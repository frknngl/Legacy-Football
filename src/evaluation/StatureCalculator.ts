/**
 * Sohret hesaplayici.
 *
 * `stature` ELLE SET EDILMEZ -- piyasa degeri, taraftar destegi, medya itibari,
 * kupa sayisi ve milli mac sayisindan TURETILIR.
 *
 * HISTEREZIS: yukselis hizli, dusus yavas. Tek kotu sezonda ikon seviyesinden
 * hickimseye dusulmez; bir seviye dusmek icin skorun esigin `hysteresis` kadar
 * altina inmesi gerekir. Bu olmadan sohret her hafta zipzip oynar ve icerik
 * kapilama anlamsizlasir.
 */

import { STATURES, statureIndex, type Stature } from '../domain/axes.js';
import type { FlagValue } from '../domain/flags.js';
import type { ProgressionConfig } from '../domain/orchestrator.js';

export class StatureCalculator {
  constructor(private readonly config: ProgressionConfig) {}

  /** Ham sohret skoru: agirlikli toplam. */
  score(flags: Readonly<Record<string, FlagValue>>): number {
    let total = 0;
    for (const [flag, weight] of Object.entries(this.config.statureWeights)) {
      const raw = flags[flag];
      const n = typeof raw === 'number' ? raw : typeof raw === 'boolean' ? (raw ? 1 : 0) : 0;
      total += n * weight;
    }
    return total;
  }

  /**
   * Mevcut seviyeyi ve ham skoru alarak YENI seviyeyi dondurur.
   * Histerezis burada uygulanir.
   */
  next(current: Stature, flags: Readonly<Record<string, FlagValue>>): Stature {
    const s = this.score(flags);
    const target = this.rawLevel(s);
    const currentIndex = statureIndex(current);
    const targetIndex = statureIndex(target);

    // Yukselis: aninda.
    if (targetIndex > currentIndex) return target;
    if (targetIndex === currentIndex) return current;

    // Dusus: yalnizca mevcut seviyenin esiginin altina BELIRGIN sekilde
    // inersek ve o zaman bile TEK BASAMAK.
    //
    // Histerezis ORANSALDIR (bir altindaki kademeye olan mesafenin yuzdesi),
    // mutlak degil. Mutlak bir pay dar olan alt kademeleri butunuyle yutar:
    // 60 puanlik sabit pay, genisligi de 60 olan `local_talent` kademesinde
    // kapiyi 0'a indirir ve pozitif skoru olan hicbir oyuncu bir daha
    // `nobody`ye dusemez -- hapisten cikmis, kimsenin tanimadigi bir oyuncu
    // sonsuza dek "yerel yetenek" olarak kalirdi.
    const holdFloor = this.thresholdOf(current) - this.gapBelow(current) * this.config.hysteresis;
    if (s > holdFloor) return current;

    const demoted = STATURES[Math.max(0, currentIndex - 1)];
    return demoted ?? current;
  }

  /** Histerezissiz, skorun karsilik geldigi ham seviye. */
  rawLevel(score: number): Stature {
    let result: Stature = STATURES[0] as Stature;
    for (const t of this.config.statureThresholds) {
      if (score >= t.threshold) result = t.id;
    }
    return result;
  }

  private thresholdOf(s: Stature): number {
    return this.config.statureThresholds.find((t) => t.id === s)?.threshold ?? 0;
  }

  /** Bu seviyenin esigi ile bir alt seviyenin esigi arasindaki mesafe. */
  private gapBelow(s: Stature): number {
    const index = statureIndex(s);
    if (index <= 0) return 0;
    const below = STATURES[index - 1];
    if (below === undefined) return 0;
    return Math.max(1, this.thresholdOf(s) - this.thresholdOf(below));
  }
}
