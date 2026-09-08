/**
 * Olay gecmisi -- halka tampon.
 *
 * Iki isi var: WeightedPicker'in anti-tekrar penceresini beslemek ve icerigin
 * "gecmisi hatirlamasini" saglamak. Sinirsiz buyumesine izin verilmez; 1000
 * turluk kariyerde tam gecmis gereksiz yere kaydi sisirir.
 */

import type { HistoryEntry } from '../domain/state.js';

const DEFAULT_CAPACITY = 60;

export class EventHistory {
  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

  push(history: HistoryEntry[], entry: HistoryEntry): void {
    history.push(entry);
    while (history.length > this.capacity) history.shift();
  }

  /** Son N kayit. */
  recent(history: readonly HistoryEntry[], n: number): readonly HistoryEntry[] {
    return history.slice(-n);
  }

  /** Bu olay son N turda cikti mi? */
  seenWithin(history: readonly HistoryEntry[], eventId: string, turn: number, within: number): boolean {
    return history.some((h) => h.eventId === eventId && turn - h.turn < within);
  }
}
