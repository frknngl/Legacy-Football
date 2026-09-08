/**
 * RAKIP ARKI -- paralel bir kariyerin izlenmesi.
 *
 * Iki isi var:
 *   1. Rakibin KENDI kariyerini yurutmek (sohret + kulup). Sen dusektikce o
 *      yukselir; bu bir ceza degil, bir aynadir.
 *   2. Arkin ON asamasini SIRAYLA kuyruga almak. Rastgele secime birakilirsa
 *      yirmi bes sezonluk bir kariyerde uc asama gorunur ve yay anlamsizlasir.
 *
 * Asamalari ICERIK ilerletir (`npc_nemesis_arc` +1); burasi yalnizca bir
 * sonrakini planlar. Yeni asama eklemek nemesis.json'a bir satirdir.
 */

import {
  slotArcFlag,
  slotRelationFlag,
  type NemesisDefinition,
  type NemesisResolution,
} from '../domain/actors.js';
import { STATURES, type Stature } from '../domain/axes.js';
import type { WorldProvider } from '../domain/roster.js';
import type { GameState } from '../domain/state.js';
import type { ConditionEvaluator } from '../evaluation/ConditionEvaluator.js';
import type { Rng } from '../selection/Rng.js';

/** Rakibin sohretinin seninkini gecmesi icin gereken sezon basi sans. */
const CLIMB_BASE = 0.35;

export interface NemesisPlan {
  readonly eventId: string;
  readonly stage: number;
  readonly label: string;
}

export class NemesisTracker {
  constructor(
    private readonly definitions: readonly NemesisDefinition[],
    private readonly evaluator: ConditionEvaluator,
  ) {}

  /** Arketipe uyan ilk ark; hicbiri uymazsa arketip kisitlamasi olmayan ilk ark. */
  arcFor(archetype: string): NemesisDefinition | undefined {
    return (
      this.definitions.find((d) => d.archetypes?.includes(archetype)) ??
      this.definitions.find((d) => d.archetypes === undefined)
    );
  }

  current(state: GameState): NemesisDefinition | undefined {
    return this.definitions.find((d) => d.id === state.nemesis.arcId);
  }

  /**
   * Rakibin sohreti ve kulubu bir sezon ilerler.
   * Sen ne kadar geridesen o kadar hizli tirmanir -- aynanin isi budur.
   */
  advanceSeason(state: GameState, world: WorldProvider, rng: Rng): string | undefined {
    const arc = this.current(state);
    if (!arc) return undefined;

    const mine = STATURES.indexOf(state.stature);
    const his = STATURES.indexOf(state.nemesis.stature);
    if (his >= STATURES.length - 1) return undefined;

    // Geride kaldigi her kademe tirmanma sansini artirir, ondeki her kademe azaltir.
    const chance = CLIMB_BASE + (mine - his) * 0.12;
    if (rng.next() >= Math.max(0.05, Math.min(0.85, chance))) return undefined;

    const next = STATURES[his + 1]!;
    state.nemesis.stature = next;
    this.placeInWorld(state, world, next, rng);
    this.sync(state);
    return next;
  }

  /** Rakibi sohretine yakisir bir kulube koyar; `{actor.nemesis.club}` bunu okur. */
  placeInWorld(state: GameState, world: WorldProvider, stature: Stature, rng: Rng): void {
    const actorId = state.casting[state.nemesis.slotRef];
    const actor = actorId !== undefined ? state.actors[actorId] : undefined;
    if (!actor) return;

    const pool = world.transferTargets(state.clubTier, stature).filter((c) => c.id !== state.clubId);
    if (pool.length === 0) return;
    actor.clubId = pool[rng.int(pool.length)]!.id;
  }

  /**
   * Sirada ne var. Kosullar:
   *   - onceki asama tamamlanmis
   *   - asamanin `minSeason` esigi gecilmis
   *   - son ark sahnesinden bu yana `gapTurns` tur gecmis
   */
  nextStage(state: GameState): NemesisPlan | undefined {
    const arc = this.current(state);
    if (!arc || state.nemesis.resolution !== undefined) return undefined;

    const done = state.nemesis.arcStage;
    const stage = arc.stages.find((s) => s.stage === done + 1);
    if (!stage) return undefined;
    if (state.nemesis.queuedStage === stage.stage) return undefined;
    if (state.seenEvents[stage.eventId] !== undefined) return undefined;
    if (stage.minSeason !== undefined && state.season < stage.minSeason) return undefined;
    if (state.turn - state.nemesis.lastStageTurn < arc.gapTurns) return undefined;

    return { eventId: stage.eventId, stage: stage.stage, label: stage.label };
  }

  /** Ark tamamlandiysa hangi finalle. Ilk eslesen kazanir; kosulsuz olan sonda. */
  resolution(state: GameState): { id: NemesisResolution; eventId: string } | undefined {
    const arc = this.current(state);
    if (!arc || state.nemesis.resolution !== undefined) return undefined;
    if (state.nemesis.arcStage < arc.stages.length) return undefined;

    for (const r of arc.resolutions) {
      if (r.condition === undefined || this.evaluator.evaluate(r.condition, state)) {
        return { id: r.id, eventId: r.eventId };
      }
    }
    return undefined;
  }

  /**
   * Ark durumunu flag'lerle iki yonlu esitler.
   * `iliski_nemesis` / `npc_nemesis_arc` ICERIGIN yazdigi taraftir; buradan
   * okunup `state.nemesis`e alinir, sonra turetilmis flag'ler geri yazilir.
   */
  sync(state: GameState): void {
    const slot = state.nemesis.slotRef;
    const relation = state.flags[slotRelationFlag(slot)];
    const arcStage = state.flags[slotArcFlag(slot)];
    if (typeof relation === 'number') state.nemesis.relation = relation;
    if (typeof arcStage === 'number' && arcStage > state.nemesis.arcStage) {
      state.nemesis.arcStage = arcStage;
      state.nemesis.lastStageTurn = state.turn;
      delete state.nemesis.queuedStage;
    }
    state.flags['nemesis_stature'] = state.nemesis.stature;
    state.flags['nemesis_arc'] = state.nemesis.arcStage;
  }
}
