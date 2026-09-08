/**
 * Zaman modeli.
 *
 *   1 tur = 1 hafta, 1 sezon = 40 tur
 *   age = startAge + floor((turn - 1) / turnsPerSeason)
 *
 * Emeklilik TURA degil YASA baglidir. Arketipler farkli yaslarda basladigi icin
 * kariyer uzunluklari da farklidir: 16 yasinda baslayan ~1040 tur, 19 yasinda
 * baslayan ~920 tur oynar. Sabit 1000 tur varsayimi 6 arketiple TUTMAZ.
 */

import type { Era } from '../domain/axes.js';
import type { EraDefinition, TurnConfig } from '../domain/orchestrator.js';

export interface TurnClock {
  readonly turn: number;
  readonly season: number;
  readonly week: number;
  readonly age: number;
}

export type RetirementStage =
  /** Emeklilik gundemde degil. */
  | 'none'
  /** Pencere acildi; emeklilik olaylari cikabilir ama karar zorunlu degil. */
  | 'window'
  /** Oyuncu karar verebilir. */
  | 'choice'
  /** Zorunlu. */
  | 'forced';

export class TurnScheduler {
  constructor(
    private readonly config: TurnConfig,
    private readonly eras: readonly EraDefinition[],
  ) {}

  clock(turn: number, startAge: number): TurnClock {
    const perSeason = this.config.turnsPerSeason;
    const elapsed = Math.max(0, turn - 1);
    return {
      turn,
      season: Math.floor(elapsed / perSeason) + 1,
      week: (elapsed % perSeason) + 1,
      age: startAge + Math.floor(elapsed / perSeason),
    };
  }

  era(age: number): Era {
    for (const e of this.eras) {
      if (age >= e.minAge && age <= e.maxAge) return e.id;
    }
    // Yas tanimli araliklarin disina tastiysa en yakin uca sabitle.
    const first = this.eras[0];
    const last = this.eras[this.eras.length - 1];
    if (first && age < first.minAge) return first.id;
    return last?.id ?? 'prime';
  }

  retirementStage(age: number): RetirementStage {
    if (age >= this.config.forcedRetirementAge) return 'forced';
    if (age >= this.config.retirementChoiceMinAge) return 'choice';
    if (age >= this.config.retirementWindowAge) return 'window';
    return 'none';
  }

  /** Bu arketip icin kariyerin teorik son turu -- simulate `--max-turns` bunu kullanir. */
  finalTurn(startAge: number): number {
    const seasons = this.config.forcedRetirementAge - startAge + 1;
    return Math.max(1, seasons) * this.config.turnsPerSeason;
  }

  /**
   * 31 yasindan sonra fiziksel dusus egrisi.
   * Her sezon `fizik` ve `kondisyon` uzerinde uygulanacak negatif drift.
   */
  physicalDecline(age: number): number {
    if (age < 31) return 0;
    return -(age - 30);
  }

  /**
   * OGRENME HIZI -- yasa gore gelisim carpani (0-1).
   *
   * NEDEN GEREKLI:
   *   Motorda DUSUS vardi (`physicalDecline`, 31 yasindan sonra) ama
   *   BUYUME yoktu. `teknik` yalnizca on iki icerik olayindan
   *   ziplayarak artiyordu; yani gelisim bir SISTEM degil, hangi
   *   sahneleri gordugune bagli bir tesaduf. Bir kariyer oyununda otuz
   *   sezon boyunca "daha iyi olmak" hissi bu yuzden yoktu.
   *
   * EGRI:
   *   16-20 yas tam hizda ogrenir (1.0). 21'den sonra dusmeye baslar,
   *   27'de yariya iner, 30'da neredeyse durur. Gercek futbolun
   *   gelisim egrisi bu: teknik olarak yirmili yaslarin ortasinda
   *   olgunlasilir, sonrasinda kazanim tecrubeden gelir -- ki o da
   *   `liderlik`/`profesyonellik` gibi baska eksenlerde.
   */
  learningRate(age: number): number {
    if (age <= 20) return 1;
    if (age >= 31) return 0;
    // 21 -> 0.95, 27 -> 0.5, 30 -> 0.1 civari yumusak dusus.
    return Math.max(0, 1 - Math.pow((age - 20) / 11, 1.6));
  }
}
