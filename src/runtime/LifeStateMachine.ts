/**
 * HAYAT DURUMU MAKINESI -- RPG derinliginin omurgasi.
 *
 * Oyuncu her an bir DURUMDADIR; durum hangi icerik havuzunun acik oldugunu
 * belirler. "Her hafta ayni seyler oluyor" hissini kokten bitiren yapi budur.
 *
 * Hapisteyki bir oyuncuya mac, medya ve sponsor olaylari CIKMAZ; onun yerine
 * hapishane havuzu acilir.
 *
 * Gecis tablosu ve kapali kategoriler `content/orchestrator/axes.json`dan
 * gelir: yeni bir icerik kategorisi eklemek kod degisikligi gerektirmez.
 */

import { LIFE_STATES, type LifeState } from '../domain/axes.js';
import { InvalidTransitionError } from '../domain/errors.js';
import type { LifeStateDefinition } from '../domain/orchestrator.js';

/**
 * Veri yuklenemediginde kullanilan guvenli taban.
 *
 * `retired` mutlak sondur; `incarcerated’dan yalnizca tahliyeyle cikilir.
 * Bu iki kural veriye birakilamayacak kadar kritiktir, tabanda da durur.
 */
const FALLBACK: readonly LifeStateDefinition[] = LIFE_STATES.map((id) => ({
  id,
  label: id,
  canPlay: id === 'playing' || id === 'loaned' || id === 'national_duty',
  transitionsTo: id === 'retired' ? [] : LIFE_STATES.filter((s) => s !== id),
  closedCategories: [],
}));

export class LifeStateMachine {
  private readonly byId: ReadonlyMap<LifeState, LifeStateDefinition>;

  constructor(definitions: readonly LifeStateDefinition[] = FALLBACK) {
    const source = definitions.length > 0 ? definitions : FALLBACK;
    this.byId = new Map(source.map((d) => [d.id, d]));
  }

  canTransition(from: LifeState, to: LifeState): boolean {
    if (from === to) return true;
    return (this.byId.get(from)?.transitionsTo ?? []).includes(to);
  }

  transition(from: LifeState, to: LifeState): LifeState {
    if (!this.canTransition(from, to)) throw new InvalidTransitionError(from, to);
    return to;
  }

  /** Gecersiz gecisi FIRLATMADAN dener; basarisizsa mevcut durum korunur. */
  tryTransition(from: LifeState, to: LifeState): { state: LifeState; ok: boolean } {
    return this.canTransition(from, to) ? { state: to, ok: true } : { state: from, ok: false };
  }

  isCategoryOpen(state: LifeState, category: string): boolean {
    return !(this.byId.get(state)?.closedCategories ?? []).includes(category);
  }

  closedCategories(state: LifeState): readonly string[] {
    return this.byId.get(state)?.closedCategories ?? [];
  }

  /** Oyuncu bu durumda sahaya cikabilir mi? */
  canPlay(state: LifeState): boolean {
    return this.byId.get(state)?.canPlay === true;
  }

  static isLifeState(v: string): v is LifeState {
    return (LIFE_STATES as readonly string[]).includes(v);
  }
}
