/**
 * Casting yonetmeni -- slotlari somut aktorlere baglar.
 *
 * Icerik "kaptan" der; kaptanin kim oldugunu burasi belirler. Transferde
 * club-scope slotlar yeniden dokulur, eskiler `ActorArchive`e gider.
 *
 * Ayni kisiyle yeniden karsilasildiginda (eski kulubune donus, milli takim,
 * rakip kadro) aktor arsivden BULUNUR ve iliski kaldigi yerden devam eder --
 * "seni hatirliyorum" hissi buradan gelir.
 */

import {
  initialRelation,
  isRosterPerson,
  slotArcFlag,
  slotBoundFlag,
  slotChemistryFlag,
  slotRelationFlag,
  slotTrustFlag,
  slotSeasonsFlag,
  type ActorState,
  type AnyPerson,
  type RosterPerson,
  type SlotDefinition,
  type SlotScope,
} from '../domain/actors.js';
import type { RosterProvider } from '../domain/roster.js';
import type { GameState } from '../domain/state.js';
import { NameForge } from '../evaluation/NameForge.js';
import type { ActorResolver, ActorView } from '../evaluation/TextInterpolator.js';
import type { Rng } from '../selection/Rng.js';
import { ActorArchive } from './ActorArchive.js';

export interface CastingContext {
  readonly clubId: string;
  readonly clubTier: string;
  readonly stature: string;
  readonly lifeState: string;
  readonly opponentClubId?: string;
}

export class CastingDirector {
  constructor(
    private readonly slots: ReadonlyMap<string, SlotDefinition>,
    private readonly roster: RosterProvider,
    private readonly forge: NameForge,
    private readonly archive: ActorArchive,
  ) {}

  /** Kariyer basi: kalici slotlarin hepsi doldurulur. */
  castInitial(state: GameState, ctx: CastingContext, rng: Rng): void {
    this.castScope(state, 'career', ctx, rng);
    this.castScope(state, 'club', ctx, rng);
    this.castScope(state, 'world', ctx, rng);
  }

  /**
   * TRANSFER. Club-scope slotlar arsivlenip yeni kulupten yeniden dokulur.
   * Career-scope slotlara DOKUNULMAZ -- menajerin, baban, gazeteci seninle gelir.
   */
  transferTo(state: GameState, newClubId: string, ctx: CastingContext, rng: Rng): void {
    this.unbindScope(state, 'club');
    state.clubId = newClubId;
    this.castScope(state, 'club', { ...ctx, clubId: newClubId }, rng);
  }

  /** Hayat durumu slotlari (hucre arkadasi, gardiyan, rehab danismani). */
  castStateSlots(state: GameState, ctx: CastingContext, rng: Rng): void {
    this.unbindScope(state, 'state');
    this.castScope(state, 'state', ctx, rng);
  }

  /** Mac slotlari: rakip kadrosundan, her mac yeniden. */
  castMatchSlots(state: GameState, ctx: CastingContext, rng: Rng): void {
    this.unbindScope(state, 'match');
    this.castScope(state, 'match', ctx, rng);
  }

  castScope(state: GameState, scope: SlotScope, ctx: CastingContext, rng: Rng): void {
    const taken = new Set<string>();
    for (const slot of this.slots.values()) {
      if (slot.scope !== scope) continue;
      if (slot.lifeStates && !slot.lifeStates.includes(ctx.lifeState)) continue;
      this.bind(state, slot, ctx, rng, taken);
    }
  }

  /** Slotu bosaltir; aktorun son hali arsive yazilir. */
  unbindSlot(state: GameState, slotId: string): void {
    const actorId = state.casting[slotId];
    if (actorId !== undefined) {
      const actor = state.actors[actorId];
      if (actor) {
        actor.relation = numberFlag(state, slotRelationFlag(slotId), actor.relation);
        actor.trust = numberFlag(state, slotTrustFlag(slotId), actor.trust);
        actor.arcStage = numberFlag(state, slotArcFlag(slotId), actor.arcStage);
        actor.lastBoundTurn = state.turn;
      }
      delete state.casting[slotId];
    }
    state.flags[slotBoundFlag(slotId)] = false;
    state.flags[slotSeasonsFlag(slotId)] = 0;
    state.flags[slotChemistryFlag(slotId)] = 0;
  }

  unbindScope(state: GameState, scope: SlotScope): void {
    for (const slot of this.slots.values()) {
      if (slot.scope === scope) this.unbindSlot(state, slot.id);
    }
  }

  /**
   * TEK bir slotu bosaltip yeniden doker.
   *
   * `castScope` tum kulup slotlarini yeniden dokuyor; teknik direktor
   * kovuldugunda kaptan ve yildiz oyuncunun da degismesi YANLIS olurdu --
   * onlarla kurulan iliski kariyerin kendisidir. Tek slotluk dokum bu
   * yuzden ayri bir kapi.
   *
   * Eski aktor SILINMEZ, arsive gider: kovulan hoca yillar sonra baska
   * bir kulupte karsina cikabilir (`ReunionDirector`).
   */
  recastSlot(state: GameState, slotId: string, ctx: CastingContext, rng: Rng): boolean {
    const slot = this.slots.get(slotId);
    if (!slot) return false;

    // GIDEN KISI DISLANIR. Kulup kadrosunda o role uygun tek kisi
    // olabilir (mock dunyada tam olarak boyle); dislanmazsa kovulan hoca
    // ayni hafta geri gelir ve kovulma anlamsizlasir. Kimse kalmazsa
    // `createActor` prosedurel bir isim uretir -- disaridan gelen yeni
    // hoca da gercek bir sonuctur.
    const outgoingSource = state.actors[state.casting[slotId] ?? '']?.sourceId;
    const taken = new Set<string>();
    for (const [otherSlot, actorId] of Object.entries(state.casting)) {
      if (otherSlot === slotId) continue;
      const source = state.actors[actorId]?.sourceId;
      if (source !== undefined) taken.add(source);
    }
    if (outgoingSource !== undefined) taken.add(outgoingSource);

    this.unbindSlot(state, slotId);
    this.bind(state, slot, ctx, rng, taken);
    return state.casting[slotId] !== undefined;
  }

  /** Bir slotu belirli bir aktore baglar -- `ReunionDirector` bunu kullanir. */
  bindActor(state: GameState, slotId: string, actor: ActorState): void {
    state.casting[slotId] = actor.id;
    state.flags[slotRelationFlag(slotId)] = actor.relation;
    state.flags[slotTrustFlag(slotId)] = actor.trust;
    state.flags[slotChemistryFlag(slotId)] = actor.chemistry;
    state.flags[slotArcFlag(slotId)] = actor.arcStage;
    state.flags[slotBoundFlag(slotId)] = true;
    state.flags[slotSeasonsFlag(slotId)] = this.archive.seasonsKnown(state, actor);
  }

  /** Her turun basinda `slot_*_seasons` degerlerini tazeler. */
  refreshSeasons(state: GameState): void {
    for (const [slotId, actorId] of Object.entries(state.casting)) {
      const actor = state.actors[actorId];
      if (actor) state.flags[slotSeasonsFlag(slotId)] = this.archive.seasonsKnown(state, actor);
    }
  }

  /** Metin enterpolasyonu icin cozucu. */
  resolver(state: GameState): ActorResolver {
    return (slotId: string) => this.view(state, slotId);
  }

  view(state: GameState, slotId: string): ActorView | undefined {
    const actor = this.archive.get(state, state.casting[slotId]);
    if (!actor) return undefined;

    // Canli veri onceliklidir; kaynak artik tanimiyorsa snapshot'a dusulur.
    const live = actor.sourceId !== undefined ? this.roster.lookup(actor.sourceId) : undefined;
    const slot = this.slots.get(slotId);
    const first = live?.first ?? actor.first;
    const last = live?.last ?? actor.last;
    const base = live?.displayName ?? actor.name;
    const name = slot?.titled !== undefined ? `${slot.titled} ${base}` : base;
    const clubId = live?.clubId ?? actor.clubId;

    const view: Record<string, string | number> = { name, first, last };
    if (live?.age !== undefined) view['age'] = live.age;
    if (clubId !== undefined) {
      const club = this.roster.club(clubId);
      if (club) view['club'] = club.name;
    }
    if (slot) view['role'] = slot.label;
    if (live && isRosterPerson(live)) view['number'] = live.shirtNumber;
    return view as unknown as ActorView;
  }

  // ------------------------------------------------------------------ dahili

  private bind(
    state: GameState,
    slot: SlotDefinition,
    ctx: CastingContext,
    rng: Rng,
    taken: Set<string>,
  ): void {
    const person = this.selectPerson(slot, ctx, taken);
    if (person) taken.add(person.sourceId);

    const existing = person ? this.archive.findBySource(state, person.sourceId) : undefined;
    const actor = existing ?? this.createActor(state, slot, ctx, rng, person);
    if (person) actor.clubId = person.clubId;
    this.bindActor(state, slot.id, actor);
  }

  private createActor(
    state: GameState,
    slot: SlotDefinition,
    ctx: CastingContext,
    rng: Rng,
    person: AnyPerson | undefined,
  ): ActorState {
    const forged =
      person ??
      this.forge.forge(
        {
          gender: slot.gender ?? 'any',
          origin: 'tr',
          ...(slot.nicknamed === true ? { nicknamed: true } : {}),
        },
        () => rng.next(),
      );

    const id = person ? `act_${person.sourceId}` : `act_${slot.id}_${state.turn}`;
    const actor: ActorState = {
      id,
      name: forged.displayName,
      first: forged.first,
      last: forged.last,
      slotId: slot.id,
      relation: initialRelation(slot, ctx.stature),
      // Guven ILISKIDEN dusuk baslar: birini sevmek bedava, ona guvenmek
      // kazanilir. Yeni tanisilan herkese %60 oraninda guvenilir.
      trust: Math.round(initialRelation(slot, ctx.stature) * 0.6),
      // Kimya SIFIRDAN baslar -- daha birlikte bir dakika oynanmadi.
      chemistry: 0,
      minutesTogether: 0,
      lastInteractionTurn: state.turn,
      arcStage: 0,
      alive: true,
      metTurn: state.turn,
      lastBoundTurn: state.turn,
      memoryStamps: [],
      ...(person ? { sourceId: person.sourceId, clubId: person.clubId } : {}),
    };
    return this.archive.remember(state, actor);
  }

  private selectPerson(
    slot: SlotDefinition,
    ctx: CastingContext,
    taken: Set<string>,
  ): AnyPerson | undefined {
    if (slot.source === 'staff') {
      const found = this.roster
        .staff(ctx.clubId)
        .find((s) => s.role === slot.staffRole && !taken.has(s.sourceId));
      return found;
    }
    if (slot.source === 'squad') {
      return applyCastingRule(this.roster.squad(ctx.clubId), slot.castingRule, taken);
    }
    if (slot.source === 'opponent_squad') {
      if (ctx.opponentClubId === undefined) return undefined;
      return applyCastingRule(this.roster.squad(ctx.opponentClubId), slot.castingRule, taken);
    }
    return undefined;
  }
}

/**
 * Kadrodan kimin secilecegi.
 * Alinmis kisiler DISLANIR; kaptan, kaleci ve akademi cocugu ayni kisi olamaz.
 */
function applyCastingRule(
  squad: readonly RosterPerson[],
  rule: string | undefined,
  taken: Set<string>,
): RosterPerson | undefined {
  const pool = squad.filter((p) => !taken.has(p.sourceId));
  if (pool.length === 0) return undefined;

  const best = (score: (p: RosterPerson) => number): RosterPerson =>
    pool.reduce((a, b) => (score(b) > score(a) ? b : a));

  if (rule === undefined) return pool[0];
  if (rule === 'oldest') return best((p) => p.age);
  if (rule === 'youngest') return best((p) => -p.age);
  // Oyuncunun mevkisi henuz modellenmedigi icin "mevkidas" en yakin rakip
  // olarak okunur: kaleci disindaki en iyi ikinci oyuncu.
  if (rule === 'same_position') {
    const outfield = pool.filter((p) => p.position !== 'GK');
    return outfield.length > 0
      ? outfield.reduce((a, b) => (b.quality > a.quality ? b : a))
      : pool[0];
  }

  const [kind, arg] = rule.split(':');
  if (kind === 'position') return pool.find((p) => p.position === arg) ?? pool[0];
  if (kind === 'highest' && arg) return best((p) => numericField(p, arg));
  if (kind === 'lowest' && arg) return best((p) => -numericField(p, arg));
  return pool[0];
}

function numericField(p: RosterPerson, field: string): number {
  const v = (p as unknown as Record<string, unknown>)[field];
  return typeof v === 'number' ? v : 0;
}

function numberFlag(state: GameState, key: string, fallback: number): number {
  const v = state.flags[key];
  return typeof v === 'number' ? v : fallback;
}
