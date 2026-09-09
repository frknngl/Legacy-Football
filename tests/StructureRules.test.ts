import { beforeAll, describe, expect, it } from 'vitest';
import type { StoryEvent, StoryNode } from '../src/domain/story.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import {
  ReadOnlyFlagRule,
  ScheduleReachabilityRule,
  ValueRefRule,
} from '../src/validation/rules/structure.js';

let registry: ContentRegistry;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
});

function outcomeNode(): StoryNode {
  return {
    id: 'n_end',
    title: 'Son',
    text: 'Bitti',
    kind: 'outcome',
  };
}

function baseEvent(input: {
  id: string;
  category?: string;
  tier?: 'epic' | 'major' | 'minor' | 'beat';
  scheduledOnly?: boolean;
  nodes: Record<string, StoryNode>;
}): StoryEvent {
  return {
    id: input.id,
    family: `fam_${input.id}`,
    category: input.category ?? 'life',
    tier: input.tier ?? 'minor',
    weight: 10,
    cooldown: { self: 1, family: 1 },
    rootNode: 'n_root',
    nodes: input.nodes,
    ...(input.scheduledOnly ? { scheduledOnly: true } : {}),
  };
}

describe('yapisal kural kapsami', () => {
  it('ReadOnlyFlagRule roll outcome efektlerini de denetler', () => {
    const event = baseEvent({
      id: 'evt_test_readonly_roll',
      nodes: {
        n_root: {
          id: 'n_root',
          title: 'Zar',
          text: 'Atis',
          kind: 'roll',
          outcomes: [
            {
              target: 'n_end',
              weight: { base: 1 },
              effects: [{ flag: 'season_goals', op: 'set', value: 99 }],
            },
          ],
        },
        n_end: outcomeNode(),
      },
    });

    const findings = ReadOnlyFlagRule.check({ registry, events: [event] });
    expect(findings.some((f) => f.path?.includes('nodes.n_root.outcomes[0].effects[0]'))).toBe(true);
    expect(findings.some((f) => f.message.includes('season_goals'))).toBe(true);
  });

  it('ScheduleReachabilityRule roll outcome schedule efektlerini de denetler', () => {
    const target = baseEvent({
      id: 'evt_test_unreachable_target',
      scheduledOnly: true,
      nodes: { n_root: outcomeNode() },
    });

    const source = baseEvent({
      id: 'evt_test_schedule_from_roll',
      nodes: {
        n_root: {
          id: 'n_root',
          title: 'Zar',
          text: 'Atis',
          kind: 'roll',
          outcomes: [
            {
              target: 'n_end',
              weight: { base: 1 },
              effects: [
                {
                  op: 'schedule',
                  event: 'evt_test_unreachable_target',
                  inTurns: 2,
                  priority: 'forced',
                },
              ],
            },
          ],
        },
        n_end: outcomeNode(),
      },
    });

    const findings = ScheduleReachabilityRule.check({ registry, events: [source, target] });
    const hit = findings.find(
      (f) =>
        f.rule === 'ScheduleReachabilityRule' &&
        f.message.includes('evt_test_unreachable_target') &&
        f.path === 'nodes.n_root',
    );
    expect(hit).toBeDefined();
    expect(hit!.message).toContain('SONSUZA DEK ertelenir');
  });

  it('ValueRefRule roll outcome icindeki ValueRef alanlarini denetler', () => {
    const event = baseEvent({
      id: 'evt_test_valueref_roll',
      nodes: {
        n_root: {
          id: 'n_root',
          title: 'Zar',
          text: 'Atis',
          kind: 'roll',
          outcomes: [
            {
              target: 'n_end',
              weight: { base: 1 },
              effects: [
                {
                  flag: 'servet',
                  op: 'add',
                  value: { ref: 'inc_scoreline', mul: 1 },
                },
              ],
            },
          ],
        },
        n_end: outcomeNode(),
      },
    });

    const findings = ValueRefRule.check({ registry, events: [event] });
    const hit = findings.find(
      (f) => f.rule === 'ValueRefRule' && f.path === 'nodes.n_root.outcomes[0].effects[0]',
    );
    expect(hit).toBeDefined();
    expect(hit!.message).toContain('sayisal degil');
  });
});
