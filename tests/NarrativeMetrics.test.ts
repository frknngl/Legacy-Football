import { beforeAll, describe, expect, it } from 'vitest';
import {
  averageCountStats,
  countMapStats,
  mergeCountMaps,
  OccurrenceCollector,
  canonicalPresentedText,
} from '../src/cli/narrativeMetrics.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import { GameEngine, type PresentedNode } from '../src/runtime/GameEngine.js';

let registry: ContentRegistry;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
});

function node(overrides: Partial<PresentedNode>): PresentedNode {
  return {
    occurrenceId: 'occ_1',
    eventId: 'evt_test',
    nodeId: 'n_root',
    title: 'Baslik',
    text: 'Metin',
    kind: 'branch',
    tier: 'minor',
    category: 'life',
    choices: [
      { id: 'c_1', text: 'A secenegi', locked: false },
      { id: 'c_2', text: 'Devam et', locked: false },
    ],
    isMoment: false,
    ...overrides,
  };
}

function firstOpenChoice(engine: GameEngine): string | undefined {
  return engine.availableChoices().find((c) => !c.locked)?.id;
}

function drain(engine: GameEngine): void {
  for (let guard = 0; guard < 30 && engine.currentNode(); guard += 1) {
    const id = firstOpenChoice(engine);
    if (!id) break;
    engine.choose(id);
  }
}

describe('OccurrenceCollector', () => {
  it('ayni occurrence icindeki branch+outcome tek kez sayilir', () => {
    const collector = new OccurrenceCollector(new Set(['match', 'reaction']));

    collector.observe(node({ occurrenceId: 'occ_10', nodeId: 'n_root' }), 12);
    collector.observe(node({ occurrenceId: 'occ_10', nodeId: 'n_end', kind: 'outcome' }), 12);

    expect(collector.shownStory.get('evt_test')).toBe(1);
    expect(collector.totalOccurrences()).toBe(1);
    expect(collector.firstRepeatTurn).toBeUndefined();
  });

  it('ayni event yeni occurrence olarak gelirse tekrar turunu yazar', () => {
    const collector = new OccurrenceCollector();

    collector.observe(node({ occurrenceId: 'occ_1', nodeId: 'n_root' }), 8);
    collector.observe(node({ occurrenceId: 'occ_2', nodeId: 'n_root' }), 19);

    expect(collector.shownStory.get('evt_test')).toBe(2);
    expect(collector.firstRepeatTurn).toBe(19);
  });

  it('ambient kategoriyi ayri kovada tutar', () => {
    const collector = new OccurrenceCollector();

    collector.observe(node({ occurrenceId: 'occ_7', category: 'match' }), 4);

    expect(collector.shownAmbient.get('evt_test')).toBe(1);
    expect(collector.shownStory.get('evt_test')).toBeUndefined();
  });

  it('kanonik metin statik devam et etiketini dahil etmez', () => {
    const text = canonicalPresentedText(node({}));
    expect(text).toContain('Baslik');
    expect(text).toContain('A secenegi');
    expect(text).not.toContain('Devam et');
  });

  it('kariyer ortalamasi ile birlesik havuz oranini ayri hesaplar', () => {
    const run1 = new Map<string, number>([
      ['evt_a', 2],
      ['evt_b', 1],
    ]);
    const run2 = new Map<string, number>([
      ['evt_a', 1],
      ['evt_c', 1],
      ['evt_d', 1],
    ]);

    const avg = averageCountStats([run1, run2]);
    const merged = countMapStats(mergeCountMaps([run1, run2]));

    expect(avg.ratio).toBeCloseTo(1.25, 6);
    expect(merged.ratio).toBe(1.5);
    expect(avg.ratio).not.toBe(merged.ratio);
  });
});

describe('GameEngine occurrenceId', () => {
  it('sunulan dugumlerde occurrenceId tasir ve yeni olayda artar', () => {
    const engine = new GameEngine(registry, { seed: 9 });
    engine.start('street');

    let first: PresentedNode | undefined;
    for (let turn = 0; turn < 80 && !first; turn += 1) {
      engine.advanceTurn();
      first = engine.currentNode();
      if (!first) continue;
    }

    expect(first).toBeDefined();
    const firstNode = first!;
    expect(firstNode.occurrenceId).toMatch(/^occ_\d+$/);

    const chosen = firstOpenChoice(engine);
    expect(chosen).toBeDefined();
    const afterChoose = engine.choose(chosen!);
    if (afterChoose.presented) {
      expect(afterChoose.presented.occurrenceId).toBe(firstNode.occurrenceId);
    }
    drain(engine);

    let second: PresentedNode | undefined;
    for (let turn = 0; turn < 120 && !second; turn += 1) {
      engine.advanceTurn();
      second = engine.currentNode();
      if (!second) continue;
    }

    expect(second).toBeDefined();
    expect(second!.occurrenceId).not.toBe(firstNode.occurrenceId);

    const n1 = Number.parseInt(firstNode.occurrenceId.slice(4), 10);
    const n2 = Number.parseInt(second!.occurrenceId.slice(4), 10);
    expect(n2).toBeGreaterThan(n1);

    const history = engine.snapshot().history;
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((h) => /^occ_\d+$/.test(h.occurrenceId))).toBe(true);
  });
});
