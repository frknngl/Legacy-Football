/**
 * Indeksli, SALT-OKUNUR icerik deposu.
 *
 * Secici her turda ~1000 olayin hepsini taramak zorunda kalmasin diye
 * kapilama eksenlerinin her biri onceden indekslenir.
 */

import type { Archetype, ClubTier, Era, LifeState, MediaEra, Stature } from '../domain/axes.js';
import type { NameConfig, SlotDefinition } from '../domain/actors.js';
import type { OrchestratorConfig } from '../domain/orchestrator.js';
import { FlagRegistry } from '../domain/flags.js';
import type { StoryEvent } from '../domain/story.js';

function index<K extends string>(
  events: readonly StoryEvent[],
  pick: (e: StoryEvent) => readonly K[] | undefined,
  universe: readonly K[],
): Map<K, StoryEvent[]> {
  const map = new Map<K, StoryEvent[]>();
  for (const key of universe) map.set(key, []);
  for (const event of events) {
    // Eksen belirtilmemisse olay TUM degerlere aittir.
    const keys = pick(event) ?? universe;
    for (const key of keys) map.get(key)?.push(event);
  }
  return map;
}

export class ContentRegistry {
  readonly flags: FlagRegistry;
  /** Kimlik katmani: icerigin yazdigi rol yuvalari. */
  readonly slots: ReadonlyMap<string, SlotDefinition>;
  /** Prosedurel isim havuzlari -- HardcodedNameRule da bunu okur. */
  readonly names: NameConfig;

  private readonly byId: ReadonlyMap<string, StoryEvent>;
  private readonly byFamily: ReadonlyMap<string, StoryEvent[]>;
  private readonly byCategory: ReadonlyMap<string, StoryEvent[]>;
  private readonly byEra: ReadonlyMap<Era, StoryEvent[]>;
  private readonly byStature: ReadonlyMap<Stature, StoryEvent[]>;
  private readonly byClubTier: ReadonlyMap<ClubTier, StoryEvent[]>;
  private readonly byLifeState: ReadonlyMap<LifeState, StoryEvent[]>;
  private readonly byMediaEra: ReadonlyMap<MediaEra, StoryEvent[]>;
  private readonly byArchetype: ReadonlyMap<Archetype, StoryEvent[]>;
  private readonly byMomentType: ReadonlyMap<string, StoryEvent[]>;

  constructor(
    readonly config: OrchestratorConfig,
    readonly events: readonly StoryEvent[],
    universes: {
      eras: readonly Era[];
      statures: readonly Stature[];
      clubTiers: readonly ClubTier[];
      lifeStates: readonly LifeState[];
      mediaEras: readonly MediaEra[];
      archetypes: readonly Archetype[];
    },
  ) {
    this.flags = FlagRegistry.from(config.flags);
    this.slots = new Map(config.slots.map((s) => [s.id, s]));
    this.names = config.names;

    const byId = new Map<string, StoryEvent>();
    const byFamily = new Map<string, StoryEvent[]>();
    const byCategory = new Map<string, StoryEvent[]>();
    const byMomentType = new Map<string, StoryEvent[]>();

    for (const e of events) {
      byId.set(e.id, e);
      (byFamily.get(e.family) ?? byFamily.set(e.family, []).get(e.family)!).push(e);
      (byCategory.get(e.category) ?? byCategory.set(e.category, []).get(e.category)!).push(e);
      if (e.momentType) {
        (byMomentType.get(e.momentType) ?? byMomentType.set(e.momentType, []).get(e.momentType)!).push(e);
      }
    }

    this.byId = byId;
    this.byFamily = byFamily;
    this.byCategory = byCategory;
    this.byMomentType = byMomentType;
    this.byEra = index(events, (e) => e.eras, universes.eras);
    this.byStature = index(events, (e) => e.stature, universes.statures);
    this.byClubTier = index(events, (e) => e.clubTiers, universes.clubTiers);
    this.byLifeState = index(events, (e) => e.lifeStates, universes.lifeStates);
    this.byMediaEra = index(events, (e) => e.mediaEras, universes.mediaEras);
    this.byArchetype = index(events, (e) => e.archetypes, universes.archetypes);
  }

  get(id: string): StoryEvent | undefined {
    return this.byId.get(id);
  }

  family(name: string): readonly StoryEvent[] {
    return this.byFamily.get(name) ?? [];
  }

  category(name: string): readonly StoryEvent[] {
    return this.byCategory.get(name) ?? [];
  }

  forMoment(type: string): readonly StoryEvent[] {
    return this.byMomentType.get(type) ?? [];
  }

  families(): readonly string[] {
    return [...this.byFamily.keys()];
  }

  categories(): readonly string[] {
    return [...this.byCategory.keys()];
  }

  /**
   * Uc ana eksenin KESISIMI. Tarama alanini en dar indeksle baslatarak daraltir.
   * "2. Lig’de 30 yasindaki oyuncuya hicbir sey olmuyor" hatasini onleyen kapi budur.
   */
  candidates(axes: {
    era: Era;
    stature: Stature;
    clubTier: ClubTier;
    lifeState: LifeState;
    mediaEra: MediaEra;
    archetype: Archetype;
  }): readonly StoryEvent[] {
    const buckets = [
      this.byLifeState.get(axes.lifeState) ?? [],
      this.byEra.get(axes.era) ?? [],
      this.byStature.get(axes.stature) ?? [],
      this.byClubTier.get(axes.clubTier) ?? [],
      this.byMediaEra.get(axes.mediaEra) ?? [],
      this.byArchetype.get(axes.archetype) ?? [],
    ].sort((a, b) => a.length - b.length);

    const smallest = buckets[0];
    if (smallest === undefined || smallest.length === 0) return [];

    const rest = buckets.slice(1).map((b) => new Set(b));
    return smallest.filter((e) => rest.every((s) => s.has(e)));
  }
}
