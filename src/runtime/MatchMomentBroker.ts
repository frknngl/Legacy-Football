/**
 * Mac ani araci.
 *
 * Host bir dizi `PendingMoment` sunar. Broker her biri icin bir hikaye olayi
 * arar; KARSILIGI OLMAYAN MOMENT SESSIZCE DUSURULUR -- host bosa moment sunmus
 * olur, oyun kirilmaz.
 *
 * Host'un mac simulasyonu hic yoksa `pendingMoments: []` gelir; broker bos
 * kuyruk dondurur ve motor yalnizca final sonucu okur (ZARIF BOZULMA).
 */

import type { PendingDecision, PendingMoment } from '../domain/match.js';
import type { EligibilityContext } from '../selection/EligibilityFilter.js';
import type { EventSelector, SelectionResult } from '../selection/EventSelector.js';
import type { Rng } from '../selection/Rng.js';
import { eventRoot } from '../domain/story.js';

export interface BrokeredMoment {
  readonly decision: PendingDecision;
  readonly selection: SelectionResult;
  readonly moment: PendingMoment;
}

export interface BrokerResult {
  readonly queue: readonly BrokeredMoment[];
  /** Karsiligi bulunamayan moment tipleri -- MomentCoverageRule bunlari olcer. */
  readonly dropped: readonly PendingMoment[];
}

export class MatchMomentBroker {
  constructor(private readonly selector: EventSelector) {}

  broker(
    moments: readonly PendingMoment[],
    ctx: EligibilityContext,
    rng: Rng,
  ): BrokerResult {
    const queue: BrokeredMoment[] = [];
    const dropped: PendingMoment[] = [];
    // Ayni maçta ayni olayi iki kez sormamak icin.
    const used = new Set<string>();

    for (const moment of moments) {
      const selection = this.selector.forMoment(
        moment.type,
        this.contextForMoment(ctx, moment),
        rng,
      );
      if (!selection || used.has(selection.event.id)) {
        dropped.push(moment);
        continue;
      }
      const nodeId = eventRoot(selection.event, selection.variantId);
      if (nodeId === undefined) {
        dropped.push(moment);
        continue;
      }
      used.add(selection.event.id);
      queue.push({
        moment,
        selection,
        decision: { moment, eventId: selection.event.id, nodeId },
      });
    }

    return { queue, dropped };
  }

  private contextForMoment(
    base: EligibilityContext,
    moment: PendingMoment,
  ): EligibilityContext {
    const scorelineBefore = moment.scorelineBefore ?? moment.scoreline;
    const scorelineAfter = moment.scorelineAfter ?? moment.scoreline;
    const scorelineProvisional = moment.scorelineProvisional ?? moment.scoreline;
    return {
      ...base,
      flags: {
        ...base.flags,
        inc_minute: moment.minute,
        inc_scoreline: moment.scoreline,
        inc_scoreline_before: scorelineBefore,
        inc_scoreline_after: scorelineAfter,
        inc_scoreline_provisional: scorelineProvisional,
        inc_opponent: moment.opponent,
      },
    };
  }
}
