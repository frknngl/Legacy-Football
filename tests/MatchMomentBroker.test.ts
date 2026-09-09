import { beforeAll, describe, expect, it } from 'vitest';
import {
  ARCHETYPES,
  CLUB_TIERS,
  ERAS,
  LIFE_STATES,
  MEDIA_ERAS,
  STATURES,
} from '../src/domain/axes.js';
import type { Condition } from '../src/domain/conditions.js';
import type { StoryEvent, StoryNode } from '../src/domain/story.js';
import type { PendingMoment } from '../src/domain/match.js';
import type { EligibilityContext } from '../src/selection/EligibilityFilter.js';
import { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import { EventSelector } from '../src/selection/EventSelector.js';
import { Rng } from '../src/selection/Rng.js';
import { MatchMomentBroker } from '../src/runtime/MatchMomentBroker.js';

let baseConfig: ContentRegistry['config'];

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  baseConfig = loaded.registry!.config;
});

function nodes(): Record<string, StoryNode> {
  return {
    n_root: {
      id: 'n_root',
      title: 'Root',
      text: 'Moment node',
      kind: 'outcome',
    },
  };
}

function momentEvent(
  id: string,
  trigger: Condition,
): StoryEvent {
  return {
    id,
    family: `fam_${id}`,
    category: 'match',
    tier: 'major',
    momentType: 'penalty_for',
    weight: 10,
    cooldown: { self: 1, family: 1 },
    trigger,
    rootNode: 'n_root',
    nodes: nodes(),
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

function context(flags: EligibilityContext['flags']): EligibilityContext {
  return {
    era: 'prime',
    stature: 'star',
    clubTier: 'elite',
    lifeState: 'playing',
    mediaEra: 'press',
    archetype: 'street',
    turn: 70,
    flags,
    flagSetTurn: {},
    seenEvents: {},
    seenVariants: {},
    storyArcTurns: {},
    storyBeatTurns: {},
    storyBeatCounts: {},
    storySignatureTurns: {},
    cooldownState: { cooldowns: {}, familyCooldowns: {}, categoryCooldowns: {} },
  };
}

function moment(minute: number): PendingMoment {
  return {
    type: 'penalty_for',
    minute,
    scoreline: '1-1',
    opponent: 'Goztepe',
    importance: 'derby',
  };
}

describe('MatchMomentBroker', () => {
  it('her momenti kendi baglamiyla degerlendirir', () => {
    const earlyOnly = momentEvent('evt_early', { flag: 'inc_minute', op: 'lte', value: 45 });
    const lateOnly = momentEvent('evt_late', { flag: 'inc_minute', op: 'gte', value: 70 });
    const selector = new EventSelector(registryFor([earlyOnly, lateOnly]));
    const broker = new MatchMomentBroker(selector);

    const result = broker.broker(
      [moment(20), moment(80)],
      context({ inc_minute: 0 }),
      new Rng(1),
    );

    expect(result.dropped).toHaveLength(0);
    expect(result.queue).toHaveLength(2);
    expect(result.queue[0]?.decision.eventId).toBe('evt_early');
    expect(result.queue[1]?.decision.eventId).toBe('evt_late');
  });
});
