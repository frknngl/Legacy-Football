/**
 * Medya cagi cozucu.
 *
 * Sezondan turetilir. 25 sezonun uzunlugunu YUK degil HIKAYE haline getirir:
 * sezon 1'de gazete mansetiyle ugrasan cocuk, sezon 22'de kendi deepfake
 * videosuyla savasiyor. Ayni mem_* izi her cagda farkli bicimde geri doner.
 */

import type { MediaEra } from '../domain/axes.js';
import type { MediaEraDefinition } from '../domain/orchestrator.js';

export class MediaEraResolver {
  constructor(private readonly definitions: readonly MediaEraDefinition[]) {}

  resolve(season: number): MediaEra {
    for (const d of this.definitions) {
      if (season >= d.minSeason && season <= d.maxSeason) return d.id;
    }
    return this.definitions[this.definitions.length - 1]?.id ?? 'press';
  }

  /** Cag degistiyse tetiklenecek gecis olayi. */
  transitionEvent(from: MediaEra, to: MediaEra): string | undefined {
    if (from === to) return undefined;
    return this.definitions.find((d) => d.id === to)?.transitionEvent;
  }

  label(era: MediaEra): string {
    return this.definitions.find((d) => d.id === era)?.label ?? era;
  }
}
