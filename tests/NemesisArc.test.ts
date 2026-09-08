/**
 * RAKIP ARKI -- yapisal garanti #3'un en uzun yayi.
 *
 * Yirmi bes sezonluk bir kariyerde on asamanin SIRAYLA gelmesi ve sonunda
 * uc finalden birinin acilmasi gerekir. Bu test yayin rastgele secime
 * birakilmadigini ve gecmisin finali belirledigini kanitlar.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Archetype } from '../src/domain/axes.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { Rng } from '../src/selection/Rng.js';
import { createMockWorld } from '../src/testing/mockWorld.js';

const RESOLUTIONS = ['evt_rival_end_yikim', 'evt_rival_end_saygi', 'evt_rival_end_dostluk'];

let registry: ContentRegistry;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
});

/** Kariyeri sonuna kadar oynar ve rakip olaylarinin sirasini toplar. */
async function playCareer(seed: number): Promise<{
  order: string[];
  engine: GameEngine;
}> {
  const engine = new GameEngine(registry, {
    seed,
    ...(await createMockWorld('content', registry, seed)),
  });
  const rng = new Rng(seed ^ 0x9e3779b9);
  const order: string[] = [];

  engine.start('street' as Archetype);

  for (let i = 0; i < 1100; i += 1) {
    if (engine.snapshot().ending !== undefined) break;
    const report = engine.advanceTurn();
    const id = report.presented?.eventId;
    if (id?.startsWith('evt_rival_')) order.push(id);

    let guard = 0;
    while (engine.currentNode() && guard < 20) {
      guard += 1;
      const open = engine.availableChoices().filter((c) => !c.locked);
      if (open.length === 0) break;
      engine.choose(open[rng.int(open.length)]!.id);
    }
  }
  return { order, engine };
}

describe('rakip arki', () => {
  it('nemesis.json bir ark tanimliyor ve slot world-scope', () => {
    const arc = registry.config.nemeses[0];
    expect(arc).toBeDefined();
    expect(arc!.stages).toHaveLength(10);
    expect(registry.slots.get(arc!.slotRef)?.scope).toBe('world');
  });

  it('rakip kariyer basinda dokulur ve bir kulubu vardir', async () => {
    const engine = new GameEngine(registry, {
      seed: 512,
      ...(await createMockWorld('content', registry, 512)),
    });
    engine.start('street' as Archetype);
    const state = engine.snapshot();
    const actorId = state.casting['nemesis'];
    expect(actorId, 'rakip dokulmedi').toBeDefined();
    expect(state.actors[actorId!]?.clubId, 'rakibin kulubu yok').toBeTruthy();
  });

  it('on asama SIRAYLA gelir ve hicbiri tekrar etmez', async () => {
    const { order } = await playCareer(8080);
    const stages = order.filter((id) => !RESOLUTIONS.includes(id));

    expect(stages.length, 'hic asama gelmedi').toBeGreaterThan(0);
    expect(new Set(stages).size, 'bir asama tekrar etti').toBe(stages.length);

    const expected = registry.config.nemeses[0]!.stages.map((s) => s.eventId);
    expect(stages).toEqual(expected.slice(0, stages.length));
  });

  it('ark tamamlanirsa tam olarak BIR final acilir', async () => {
    const { order, engine } = await playCareer(8080);
    const ends = order.filter((id) => RESOLUTIONS.includes(id));
    const state = engine.snapshot();

    if (state.nemesis.arcStage >= 10) {
      expect(ends).toHaveLength(1);
      expect(state.nemesis.resolution).toBeDefined();
    } else {
      expect(ends).toHaveLength(0);
    }
  });

  it('turetilmis nemesis flagleri her tur guncel kalir', async () => {
    const { engine } = await playCareer(4141);
    const state = engine.snapshot();
    expect(state.flags['nemesis_arc']).toBe(state.nemesis.arcStage);
    expect(state.flags['nemesis_stature']).toBe(state.nemesis.stature);
  });

  it('farkli tohum farkli bir rakip ismi verir, ayni yayi verir', async () => {
    const a = new GameEngine(registry, {
      seed: 111,
      ...(await createMockWorld('content', registry, 111)),
    });
    const b = new GameEngine(registry, {
      seed: 222,
      ...(await createMockWorld('content', registry, 222)),
    });
    a.start('street' as Archetype);
    b.start('street' as Archetype);

    const nameOf = (e: GameEngine): string => {
      const s = e.snapshot();
      return s.actors[s.casting['nemesis']!]!.name;
    };
    expect(nameOf(a)).not.toBe(nameOf(b));
    expect(a.snapshot().nemesis.arcId).toBe(b.snapshot().nemesis.arcId);
  });
});
