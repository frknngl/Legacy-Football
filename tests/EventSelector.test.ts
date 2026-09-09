import { beforeAll, describe, expect, it } from 'vitest';
import {
  ARCHETYPES,
  CLUB_TIERS,
  ERAS,
  LIFE_STATES,
  MEDIA_ERAS,
  STATURES,
  type Archetype,
} from '../src/domain/axes.js';
import type { StoryEvent, StoryNode } from '../src/domain/story.js';
import type { PersonaState, ScheduledEvent } from '../src/domain/state.js';
import { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import { EventSelector, type SelectionContext } from '../src/selection/EventSelector.js';
import { Rng } from '../src/selection/Rng.js';

let baseConfig: ContentRegistry['config'];

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  baseConfig = loaded.registry!.config;
});

const PERSONA: PersonaState = {
  sadakat: 50,
  mizac: 50,
  durus: 50,
  dogruluk: 50,
};

function nodes(): Record<string, StoryNode> {
  return {
    n_root: {
      id: 'n_root',
      title: 'Baslik',
      text: 'Metin',
      kind: 'outcome',
    },
  };
}

function plainEvent(id: string, weight: number): StoryEvent {
  return {
    id,
    family: `fam_${id}`,
    category: 'life',
    tier: 'minor',
    weight,
    cooldown: { self: 1, family: 1 },
    rootNode: 'n_root',
    nodes: nodes(),
  };
}

function scheduledOnlyEvent(id: string, weight: number): StoryEvent {
  return { ...plainEvent(id, weight), scheduledOnly: true };
}

function variantEvent(input: {
  id: string;
  weight: number;
  momentType?: string;
  archetypesByVariant: readonly (readonly Archetype[])[];
  variantIds: readonly string[];
}): StoryEvent {
  return {
    id: input.id,
    family: `fam_${input.id}`,
    category: 'match',
    tier: 'major',
    weight: input.weight,
    cooldown: { self: 1, family: 1 },
    ...(input.momentType ? { momentType: input.momentType } : {}),
    variants: input.variantIds.map((id, i) => {
      const archetypes = input.archetypesByVariant[i];
      return {
        id,
        ...(archetypes ? { archetypes } : {}),
        rootNode: 'n_root',
        nodes: nodes(),
      };
    }),
  };
}

function registryFor(events: readonly StoryEvent[]): ContentRegistry {
  return new ContentRegistry(baseConfig, events, {
    eras: ERAS,
    statures: STATURES,
    clubTiers: CLUB_TIERS,
    lifeStates: LIFE_STATES,
    mediaEras: MEDIA_ERAS,
    archetypes: ARCHETYPES,
  });
}

function context(overrides: Partial<SelectionContext> = {}): SelectionContext {
  const base: SelectionContext = {
    era: 'prime',
    stature: 'star',
    clubTier: 'elite',
    lifeState: 'playing',
    mediaEra: 'press',
    archetype: 'street',
    turn: 60,
    flags: {},
    flagSetTurn: {},
    seenEvents: {},
    seenVariants: {},
    storyArcTurns: {},
    storyBeatTurns: {},
    storyBeatCounts: {},
    storySignatureTurns: {},
    cooldownState: { cooldowns: {}, familyCooldowns: {}, categoryCooldowns: {} },
    history: [],
    persona: PERSONA,
    scheduledEvents: [],
  };

  return {
    ...base,
    ...overrides,
    flags: overrides.flags ?? base.flags,
    flagSetTurn: overrides.flagSetTurn ?? base.flagSetTurn,
    seenEvents: overrides.seenEvents ?? base.seenEvents,
    seenVariants: overrides.seenVariants ?? base.seenVariants,
    storyArcTurns: overrides.storyArcTurns ?? base.storyArcTurns,
    storyBeatTurns: overrides.storyBeatTurns ?? base.storyBeatTurns,
    storyBeatCounts: overrides.storyBeatCounts ?? base.storyBeatCounts,
    storySignatureTurns: overrides.storySignatureTurns ?? base.storySignatureTurns,
    cooldownState: overrides.cooldownState ?? base.cooldownState,
    history: overrides.history ?? base.history,
    persona: overrides.persona ?? base.persona,
    scheduledEvents: overrides.scheduledEvents ?? base.scheduledEvents,
  };
}

function scheduled(eventId: string, priority: 'forced' | 'weighted', dueTurn = 60): ScheduledEvent {
  return {
    eventId,
    dueTurn,
    priority,
    onIneligible: 'defer',
    maxDeferTurns: 40,
    sourceEventId: 'evt_source',
    sourceTurn: 10,
    deferredTurns: 0,
  };
}

describe('EventSelector tekrar ve varyant secimi', () => {
  it('gorulmemis olay varken gorulmus olaya dusmez', () => {
    const seen = plainEvent('evt_seen', 100);
    const fresh = plainEvent('evt_fresh', 1);
    const selector = new EventSelector(registryFor([seen, fresh]));

    const result = selector.select(
      context({
        seenEvents: { evt_seen: 5 },
      }),
      new Rng(17),
    );

    expect(result?.event.id).toBe('evt_fresh');
  });

  it('due weighted olay gorulmusse, gorulmemis normal varken secilmez', () => {
    const dueSeen = scheduledOnlyEvent('evt_due_seen', 200);
    const fresh = plainEvent('evt_fresh', 1);
    const queue = [scheduled('evt_due_seen', 'weighted')];
    const selector = new EventSelector(registryFor([dueSeen, fresh]));

    const result = selector.select(
      context({
        seenEvents: { evt_due_seen: 10 },
        scheduledEvents: queue,
      }),
      new Rng(13),
    );

    expect(result?.event.id).toBe('evt_fresh');
    // Secilmeyen weighted aday kuyrukta kalmali.
    expect(queue).toHaveLength(1);
  });

  it('arketipe uygun varyant yoksa olayi secmez', () => {
    const incompatible = variantEvent({
      id: 'evt_incompatible',
      weight: 40,
      archetypesByVariant: [['academy']],
      variantIds: ['v_only_academy'],
    });
    const selector = new EventSelector(registryFor([incompatible]));

    const result = selector.select(context(), new Rng(3));
    expect(result).toBeUndefined();
  });

  it('moment seciminde de gorulmemis icerigi once secmeye devam eder', () => {
    const seenMoment = variantEvent({
      id: 'evt_moment_seen',
      weight: 120,
      momentType: 'penalty_for',
      archetypesByVariant: [['street']],
      variantIds: ['v_seen'],
    });
    const newMoment = variantEvent({
      id: 'evt_moment_new',
      weight: 1,
      momentType: 'penalty_for',
      archetypesByVariant: [['street']],
      variantIds: ['v_new'],
    });
    const selector = new EventSelector(registryFor([seenMoment, newMoment]));

    const result = selector.forMoment(
      'penalty_for',
      context({ seenVariants: { 'evt_moment_seen#v_seen': 12 } }),
      new Rng(9),
    );

    expect(result?.event.id).toBe('evt_moment_new');
    expect(result?.variantId).toBe('v_new');
  });
});

describe('EventSelector zamanli kuyruk davranisi', () => {
  it('due weighted olay secilmezse kuyrukta kalir', () => {
    const normal = plainEvent('evt_regular', 100);
    const dueWeighted = scheduledOnlyEvent('evt_due_weighted', 0);
    const queue = [scheduled('evt_due_weighted', 'weighted')];
    const selector = new EventSelector(registryFor([normal, dueWeighted]));

    const result = selector.select(context({ scheduledEvents: queue }), new Rng(5));

    expect(result?.event.id).toBe('evt_regular');
    expect(queue).toHaveLength(1);
    expect(queue[0]?.eventId).toBe('evt_due_weighted');
  });

  it('due weighted olay secildiginde kuyruktan duser', () => {
    const normal = plainEvent('evt_regular', 0);
    const dueWeighted = scheduledOnlyEvent('evt_due_weighted', 30);
    const queue = [scheduled('evt_due_weighted', 'weighted')];
    const selector = new EventSelector(registryFor([normal, dueWeighted]));

    const result = selector.select(context({ scheduledEvents: queue }), new Rng(7));

    expect(result?.event.id).toBe('evt_due_weighted');
    expect(result?.scheduledBy?.priority).toBe('weighted');
    expect(queue).toHaveLength(0);
  });

  it('forced olay agirlikli havuzu bypass eder', () => {
    const normal = plainEvent('evt_regular', 1000);
    const dueForced = scheduledOnlyEvent('evt_due_forced', 0);
    const queue = [scheduled('evt_due_forced', 'forced')];
    const selector = new EventSelector(registryFor([normal, dueForced]));

    const result = selector.select(context({ scheduledEvents: queue }), new Rng(11));

    expect(result?.event.id).toBe('evt_due_forced');
    expect(result?.forced).toBe(true);
    expect(queue).toHaveLength(0);
  });
});

describe('EventSelector Faz B repeat policy', () => {
  it('arc gap aktifken ayni arc olayi secilmez', () => {
    const constrained: StoryEvent = {
      ...plainEvent('evt_arc_locked', 100),
      story: { arc: 'transfer_agent_arc', beat: 'offer_1' },
      repeatPolicy: { arcGapTurns: 20 },
    };
    const fallback = plainEvent('evt_free', 1);
    const selector = new EventSelector(registryFor([constrained, fallback]));

    const result = selector.select(
      context({
        turn: 60,
        storyArcTurns: { transfer_agent_arc: 50 },
      }),
      new Rng(19),
    );

    expect(result?.event.id).toBe('evt_free');
  });

  it('maxBeatUses dolunca ayni beat tekrar secilmez', () => {
    const constrained: StoryEvent = {
      ...plainEvent('evt_beat_locked', 100),
      story: { arc: 'transfer_agent_arc', beat: 'offer_2' },
      repeatPolicy: { maxBeatUses: 1 },
    };
    const fallback = plainEvent('evt_free', 1);
    const selector = new EventSelector(registryFor([constrained, fallback]));

    const result = selector.select(
      context({
        storyBeatCounts: { 'transfer_agent_arc#offer_2': 1 },
      }),
      new Rng(23),
    );

    expect(result?.event.id).toBe('evt_free');
  });

  it('signature gap aktifken ayni imza gecici olarak bloklanir', () => {
    const constrained: StoryEvent = {
      ...plainEvent('evt_signature_locked', 100),
      story: { signature: 'transfer:agent:offer' },
      repeatPolicy: { signatureGapTurns: 30 },
    };
    const fallback = plainEvent('evt_free', 1);
    const selector = new EventSelector(registryFor([constrained, fallback]));

    const result = selector.select(
      context({
        turn: 80,
        storySignatureTurns: { 'transfer:agent:offer': 65 },
      }),
      new Rng(29),
    );

    expect(result?.event.id).toBe('evt_free');
  });

});
