/**
 * Zamanlanmis olay kuyrugu -- "her karar geri doner" garantisinin motoru.
 *
 * `forced` oncelikli olaylar AGIRLIKLI SECIMDEN ONCE ve garantili calisir:
 * "TFF'ye salladin, 2 hafta sonra PFDK'dasin." PFDK sevki sansa birakilamaz.
 *
 * Vade geldiginde olay uygun degilse (oyuncu bu arada hapse girdi, sakatlandi)
 * ne olacagi olayin kendi politikasidir:
 *   defer  -> uygun olana kadar ertele, maxDeferTurns kadar
 *   fire   -> uygunluk kapilarini yok say
 *   cancel -> iptal et; bu durumda replaceWith ZORUNLUDUR ki hikaye ipi
 *             sessizce kopmasin
 */

import type { ScheduleEffect } from '../domain/effects.js';
import type { ScheduledEvent } from '../domain/state.js';

const DEFAULT_MAX_DEFER = 40;

export interface DueResult {
  /** Simdi calistirilacak olay. */
  readonly eventId: string;
  readonly entry: ScheduledEvent;
  /** Uygunluk kapilari atlanacak mi (fire politikasi ya da forced+fire). */
  readonly bypassEligibility: boolean;
}

export class ScheduledEventQueue {
  /** `schedule` efektini kuyruga alir. */
  enqueue(
    queue: ScheduledEvent[],
    effect: ScheduleEffect,
    ctx: { turn: number; sourceEventId: string },
  ): ScheduledEvent {
    const entry: ScheduledEvent = {
      eventId: effect.event,
      dueTurn: ctx.turn + Math.max(1, effect.inTurns),
      priority: effect.priority,
      onIneligible: effect.onIneligible ?? 'defer',
      maxDeferTurns: effect.maxDeferTurns ?? DEFAULT_MAX_DEFER,
      sourceEventId: ctx.sourceEventId,
      sourceTurn: ctx.turn,
      deferredTurns: 0,
      ...(effect.replaceWith !== undefined ? { replaceWith: effect.replaceWith } : {}),
    };
    queue.push(entry);
    return entry;
  }

  /** Vadesi gelmis kayitlar, `forced` once olmak uzere. */
  due(queue: readonly ScheduledEvent[], turn: number): readonly ScheduledEvent[] {
    return queue
      .filter((e) => e.dueTurn <= turn)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === 'forced' ? -1 : 1;
        return a.dueTurn - b.dueTurn;
      });
  }

  /**
   * Vadesi gelmis bir kaydi cozer.
   *
   * `isEligible` cagirandan gelir (motor uygunluk kapilarini bilir, kuyruk bilmez).
   * Donen deger:
   *   - DueResult    : calistir
   *   - 'defer'      : kuyrukta kalsin, bir sonraki tur tekrar denenecek
   *   - 'drop'       : kuyruktan cikar (iptal edildi ya da erteleme suresi doldu)
   */
  resolve(
    entry: ScheduledEvent,
    queue: ScheduledEvent[],
    isEligible: (eventId: string) => boolean,
  ): DueResult | 'defer' | 'drop' {
    if (isEligible(entry.eventId)) {
      this.remove(queue, entry);
      return { eventId: entry.eventId, entry, bypassEligibility: false };
    }

    if (entry.onIneligible === 'fire') {
      this.remove(queue, entry);
      return { eventId: entry.eventId, entry, bypassEligibility: true };
    }

    if (entry.onIneligible === 'cancel') {
      this.remove(queue, entry);
      if (entry.replaceWith !== undefined) {
        return {
          eventId: entry.replaceWith,
          entry,
          // Yedek olay da uygun degilse zorla calistirilir; ip kopmamali.
          bypassEligibility: !isEligible(entry.replaceWith),
        };
      }
      return 'drop';
    }

    // defer
    const deferred = entry.deferredTurns + 1;
    if (deferred > entry.maxDeferTurns) {
      this.remove(queue, entry);
      if (entry.replaceWith !== undefined) {
        return { eventId: entry.replaceWith, entry, bypassEligibility: true };
      }
      return 'drop';
    }
    this.replace(queue, entry, { ...entry, deferredTurns: deferred, dueTurn: entry.dueTurn + 1 });
    return 'defer';
  }

  private remove(queue: ScheduledEvent[], entry: ScheduledEvent): void {
    const i = queue.indexOf(entry);
    if (i >= 0) queue.splice(i, 1);
  }

  private replace(queue: ScheduledEvent[], entry: ScheduledEvent, next: ScheduledEvent): void {
    const i = queue.indexOf(entry);
    if (i >= 0) queue[i] = next;
  }
}
