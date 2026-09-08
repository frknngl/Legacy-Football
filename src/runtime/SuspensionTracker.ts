/**
 * Ceza takibi.
 *
 * Motor cezayi VERIR ve host'a bildirir; host oyuncuyu o maclarda kadroya
 * yazmaz. Motor kadro kurmaz, host ceza vermez -- sinir nettir.
 *
 * Cezali haftalarda `match` kategorisi kapanir, buna karsilik `pitch` ve
 * `life` kategorisinden ozel olaylar acilir (tribunden izleme, hocayla
 * gerginlik, ayri idman).
 */

import type { FlagValue } from '../domain/flags.js';
import type { PlayerAvailability } from '../domain/match.js';

export interface SuspensionState {
  flags: Record<string, FlagValue>;
}

export class SuspensionTracker {
  /** Yeni ceza uygular. Mevcut cezanin uzerine EKLENIR. */
  suspend(state: SuspensionState, matches: number, reason: string): PlayerAvailability {
    const current = this.remaining(state);
    const total = current + Math.max(0, matches);
    state.flags['suspension_matches'] = total;
    state.flags['is_suspended'] = total > 0;
    // Tekrarlayan suclu sonraki PFDK roll'unde daha sert cezalanir.
    const record = state.flags['disiplin_sicili'];
    state.flags['disiplin_sicili'] = Math.min(
      100,
      (typeof record === 'number' ? record : 0) + matches * 4,
    );
    return { available: total <= 0, reason, matchesRemaining: total };
  }

  /** Bir mac oynandiginda (ya da atlandiginda) cezayi bir azaltir. */
  consumeMatch(state: SuspensionState): PlayerAvailability {
    const remaining = Math.max(0, this.remaining(state) - 1);
    state.flags['suspension_matches'] = remaining;
    state.flags['is_suspended'] = remaining > 0;
    return remaining > 0
      ? { available: false, reason: 'Ceza suruyor', matchesRemaining: remaining }
      : { available: true, matchesRemaining: 0 };
  }

  availability(state: SuspensionState): PlayerAvailability {
    const remaining = this.remaining(state);
    if (remaining > 0) {
      return { available: false, reason: 'Disiplin cezasi', matchesRemaining: remaining };
    }
    if (state.flags['is_injured'] === true) {
      const weeks = state.flags['injury_weeks'];
      return {
        available: false,
        reason: 'Sakatlik',
        matchesRemaining: typeof weeks === 'number' ? weeks : 0,
      };
    }
    return { available: true, matchesRemaining: 0 };
  }

  private remaining(state: SuspensionState): number {
    const v = state.flags['suspension_matches'];
    return typeof v === 'number' ? v : 0;
  }
}
