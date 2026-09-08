/**
 * Reunion yonetmeni -- arsivi sahneye geri cagirir.
 *
 * Arsiv pasif bir mezarlik degildir. Her tur `former_*` slotlari yeniden
 * degerlendirilir: eski kulubunle mac mi var, eski kaptanin senin takimina mi
 * transfer oldu, milli takim kampinda mi karsilastiniz.
 *
 * Icerik bunlarin hicbirini bilmez; yalnizca `slot_former_captain_bound`
 * flag'ini okur.
 */

import type { ActorState, SlotDefinition } from '../domain/actors.js';
import type { RosterProvider } from '../domain/roster.js';
import type { GameState } from '../domain/state.js';
import type { CastingDirector } from './CastingDirector.js';

/** Bir aktorun "geri donmeye deger" sayilmasi icin taban degerden sapma. */
const PULL_THRESHOLD = 10;
/** `time_elapsed` tetigi icin gecmesi gereken sezon sayisi. */
const NOSTALGIA_SEASONS = 2;
/** Bu yasin ustundeki eski oyuncu ekranda/kenarda goruluyor sayilir. */
const PUNDIT_AGE = 35;

export interface ReunionContext {
  readonly opponentClubId?: string;
  readonly lifeState: string;
  readonly turnsPerSeason: number;
}

export class ReunionDirector {
  constructor(
    private readonly slots: ReadonlyMap<string, SlotDefinition>,
    private readonly roster: RosterProvider,
    private readonly casting: CastingDirector,
  ) {}

  /**
   * Tum `former_*` slotlarini yeniden degerlendirir.
   * Bagli olan bir slot kosulunu kaybederse BOSALIR; sahne kendiliginden kapanir.
   */
  refresh(state: GameState, ctx: ReunionContext): readonly string[] {
    const bound: string[] = [];
    for (const slot of this.slots.values()) {
      if (slot.scope !== 'former') continue;
      this.casting.unbindSlot(state, slot.id);

      const actor = this.pick(state, slot, ctx);
      if (!actor) continue;
      this.casting.bindActor(state, slot.id, actor);
      bound.push(slot.id);
    }
    return bound;
  }

  private pick(
    state: GameState,
    slot: SlotDefinition,
    ctx: ReunionContext,
  ): ActorState | undefined {
    const active = new Set(Object.values(state.casting));
    const candidates = Object.values(state.actors)
      .filter((a) => !active.has(a.id) && a.alive && this.matchesArchive(slot, a))
      .filter((a) => this.triggered(state, slot, a, ctx));

    if (candidates.length === 0) return undefined;
    // En cok iz birakan geri doner: notr figuran degil, hesabi kapanmamis adam.
    return candidates.reduce((a, b) => (this.pull(b) > this.pull(a) ? b : a));
  }

  private matchesArchive(slot: SlotDefinition, actor: ActorState): boolean {
    if (slot.archiveOf === undefined) return false;
    if (slot.archiveOf === 'any_club') {
      return this.slots.get(actor.slotId)?.scope === 'club';
    }
    return actor.slotId === slot.archiveOf;
  }

  private triggered(
    state: GameState,
    slot: SlotDefinition,
    actor: ActorState,
    ctx: ReunionContext,
  ): boolean {
    const triggers = slot.reunionTriggers ?? [];
    const live = actor.sourceId !== undefined ? this.roster.lookup(actor.sourceId) : undefined;
    const liveClub = live?.clubId ?? actor.clubId;

    for (const trigger of triggers) {
      switch (trigger) {
        case 'opponent_is_former_club':
          if (ctx.opponentClubId !== undefined && liveClub === ctx.opponentClubId) return true;
          break;
        case 'joined_your_club':
          if (liveClub === state.clubId) return true;
          break;
        case 'became_pundit':
          if (live !== undefined && live.age >= PUNDIT_AGE) return true;
          break;
        case 'national_camp':
          if (ctx.lifeState === 'national_duty') return true;
          break;
        case 'time_elapsed':
          if (
            state.turn - actor.lastBoundTurn >= NOSTALGIA_SEASONS * ctx.turnsPerSeason &&
            this.pull(actor) > PULL_THRESHOLD
          ) {
            return true;
          }
          break;
      }
    }
    return false;
  }

  /** Aktorun anlati cekimi: iz + ark + iliskinin tabandan sapmasi. */
  private pull(actor: ActorState): number {
    const baseline = this.slots.get(actor.slotId)?.defaultRelation ?? 50;
    return (
      Math.abs(actor.relation - baseline) + actor.arcStage * 10 + actor.memoryStamps.length * 25
    );
  }
}
