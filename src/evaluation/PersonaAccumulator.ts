/**
 * Kimlik eksenleri birikimi -- "oyun seni taniyor".
 *
 * Tek bir "itibar" sayisi yerine dort eksen. Secimlerle BIRIKIR; icerik bunlari
 * dogrudan `set` EDEMEZ (EffectApplier bunu zaten reddeder), yalnizca iteker.
 *
 * Ne etkiler: NPC diyalog tonu, medyanin seni cerceveleme bicimi, acilan ozel
 * dallar (personaAffinity), hangi sonlanmayi aldigin, rakibinin sana bakisi.
 */

import { PERSONA_AXES, personaFlagKey, type PersonaAxis } from '../domain/axes.js';
import type { FlagValue } from '../domain/flags.js';
import type { PersonaState } from '../domain/state.js';

/** Tek bir secimin bir eksene katabilecegi maksimum itekleme. */
const MAX_NUDGE = 12;

export class PersonaAccumulator {
  /** Secimin persona katkisini uygular ve flag'lere yansitir. */
  apply(
    persona: PersonaState,
    flags: Record<string, FlagValue>,
    contribution: Partial<Record<PersonaAxis, number>> | undefined,
  ): PersonaState {
    if (!contribution) return persona;
    const next: PersonaState = { ...persona };
    for (const axis of PERSONA_AXES) {
      const raw = contribution[axis];
      if (raw === undefined || raw === 0) continue;
      const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, raw));
      next[axis] = Math.max(0, Math.min(100, next[axis] + nudge));
      flags[personaFlagKey(axis)] = next[axis];
    }
    return next;
  }

  /**
   * Bir olayin kimlige yakinligi: 0 = alakasiz, 1 = tam ortasinda.
   * WeightedPicker bunu bonus olarak kullanir; kimligine uyan olaylar daha sik cikar.
   */
  affinity(persona: PersonaState, affinity: Partial<Record<PersonaAxis, number>> | undefined): number {
    if (!affinity) return 0;
    let total = 0;
    let count = 0;
    for (const axis of PERSONA_AXES) {
      const want = affinity[axis];
      if (want === undefined) continue;
      // Eksen degeri ile istenen deger arasindaki yakinlik (0-100 -> 0-1).
      const distance = Math.abs(persona[axis] - want) / 100;
      total += 1 - distance;
      count += 1;
    }
    return count === 0 ? 0 : total / count;
  }

  static initial(): PersonaState {
    return { sadakat: 50, mizac: 50, durus: 50, dogruluk: 50 };
  }

  /** Persona degerlerini flag sozlugune yazar (kosullar bunlari okuyabilsin diye). */
  static sync(persona: PersonaState, flags: Record<string, FlagValue>): void {
    for (const axis of PERSONA_AXES) flags[personaFlagKey(axis)] = persona[axis];
  }
}
