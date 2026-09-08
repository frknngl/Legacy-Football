/**
 * Aktor arsivi.
 *
 * Transferde club-scope slotlar yeniden dokulur ama ESKI AKTORLER SILINMEZ:
 * iliskileri, ark asamalari ve onlarla damgalanmis `mem_*` izleri burada yasar.
 * "Eski kaptanin simdi rakip takimda" sahnesi bu yuzden tek bir ozel isim
 * yazmadan kurulabilir.
 *
 * Ayni kisiyle tekrar karsilasildiginda (ornegin eski kulubune donus) aktor
 * YENIDEN YARATILMAZ; arsivden bulunur ve iliski kaldigi yerden devam eder.
 */

import type { ActorState, SlotDefinition } from '../domain/actors.js';
import type { GameState } from '../domain/state.js';

/** Iliskinin "unutulabilir" sayilmasi icin taban degerden sapma esigi. */
const FORGETTABLE_DRIFT = 20;

export class ActorArchive {
  constructor(private readonly turnsPerSeason: number) {}

  /** Dis kaynaktaki kimlige gore daha once tanistigimiz aktoru bulur. */
  findBySource(state: GameState, sourceId: string): ActorState | undefined {
    for (const actor of Object.values(state.actors)) {
      if (actor.sourceId === sourceId) return actor;
    }
    return undefined;
  }

  remember(state: GameState, actor: ActorState): ActorState {
    state.actors[actor.id] = actor;
    return actor;
  }

  get(state: GameState, actorId: string | undefined): ActorState | undefined {
    return actorId === undefined ? undefined : state.actors[actorId];
  }

  /** Bu aktoru kac sezondur taniyorsun. */
  seasonsKnown(state: GameState, actor: ActorState): number {
    return Math.floor((state.turn - actor.metTurn) / this.turnsPerSeason);
  }

  /**
   * `mem_*` izini bir aktore baglar.
   *
   * Bu damga olmadan "alti sezon once seni satan kaptan" cumlesi kurulamaz;
   * flag kimin yuzunden yazildigini bilmez.
   */
  stampMemory(state: GameState, flagKey: string, actorId: string | undefined): void {
    if (actorId === undefined) return;
    const actor = state.actors[actorId];
    if (!actor) return;
    state.flagActor[flagKey] = actorId;
    if (!actor.memoryStamps.includes(flagKey)) actor.memoryStamps.push(flagKey);
  }

  /**
   * Sezon basi sonumlenme.
   *
   * KARAR: pozitif iliskiler zamanla erir -- gormedigin adam seni unutur.
   * `mem_*` damgali NEGATIF iz erimez: kirdigin adam seni unutmaz.
   * Yalnizca BAGLI OLMAYAN (arsivdeki) aktorlere uygulanir.
   */
  decaySeason(state: GameState, slots: ReadonlyMap<string, SlotDefinition>): void {
    const bound = new Set(Object.values(state.casting));
    for (const actor of Object.values(state.actors)) {
      if (bound.has(actor.id)) continue;
      const slot = slots.get(actor.slotId);
      if (!slot) continue;
      const { positivePerSeason, negativeLocked, towards } = slot.decay;
      if (positivePerSeason <= 0) continue;

      if (actor.relation > towards) {
        actor.relation = Math.max(towards, actor.relation - positivePerSeason);
      } else if (actor.relation < towards) {
        if (negativeLocked && actor.memoryStamps.length > 0) continue;
        actor.relation = Math.min(towards, actor.relation + positivePerSeason);
      }
    }
  }

  /**
   * Unutulabilir aktorleri temizler.
   *
   * 25 sezonda ~8 transfer x 13 club slotu 100'un uzerinde aktor birakir.
   * Iz birakmis olanlar KORUNUR; notr kalmis figuranlar unutulur -- bu hem
   * kayit boyutu hem anlati acisindan dogrudur.
   */
  prune(state: GameState, slots: ReadonlyMap<string, SlotDefinition>): number {
    const bound = new Set(Object.values(state.casting));
    let removed = 0;
    for (const [id, actor] of Object.entries(state.actors)) {
      if (bound.has(id)) continue;
      if (this.isMemorable(actor, slots)) continue;
      delete state.actors[id];
      removed += 1;
    }
    return removed;
  }

  private isMemorable(actor: ActorState, slots: ReadonlyMap<string, SlotDefinition>): boolean {
    if (actor.memoryStamps.length > 0) return true;
    if (actor.arcStage > 0) return true;
    const baseline = slots.get(actor.slotId)?.defaultRelation ?? 50;
    return Math.abs(actor.relation - baseline) > FORGETTABLE_DRIFT;
  }
}
