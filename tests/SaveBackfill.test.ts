/**
 * ESKI KAYIT UYUMU -- sonradan eklenen alanlar kaydi bozmamali.
 *
 * OLCULEN SORUN:
 *   Bu oturumda `formerAgents`, `categoryCooldowns`, `ratingHistory` ve
 *   `availability` alanlari `GameState`e eklendi. `SaveGame.load()`
 *   eski kayitlar icin eksik alanlari dolduruyordu ama bu dordu
 *   listeye eklenmemisti.
 *
 *   Sonuc SESSIZ DEGIL SERTTI: eski bir kaydi yukleyip menajer
 *   imzalamak "Cannot read properties of undefined (reading 'length')"
 *   ile oyunu cokertiyordu -- `newAgentSatisfaction(formerAgents.length)`.
 *
 * Bu test her yeni `GameState` alaninin backfill'ini zorunlu kilar.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';

let registry: ContentRegistry;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  registry = loaded.registry!;
});

/** Sonradan eklenen ve eski kayitlarda BULUNMAYAN alanlar. */
const LATER_FIELDS = [
  'formerAgents',
  'categoryCooldowns',
  'ratingHistory',
  'availability',
  'rngStreams',
  'nextOccurrenceId',
  'flagActor',
  'storyArcTurns',
  'storyBeatTurns',
  'storyBeatCounts',
  'storySignatureTurns',
  'actors',
  'casting',
] as const;

function oldSaveWithout(fields: readonly string[]): ReturnType<GameEngine['save']> {
  const engine = new GameEngine(registry, { seed: 3 });
  engine.start('street');
  const env = JSON.parse(JSON.stringify(engine.save()));
  for (const f of fields) delete (env.state as Record<string, unknown>)[f];
  return env;
}

describe('eski kayit uyumu', () => {
  it('eksik alanlarla yuklenen kayit TUR ILERLETEBILIR', () => {
    const engine = new GameEngine(registry, { seed: 3 });
    engine.load(oldSaveWithout(LATER_FIELDS));
    expect(() => engine.advanceTurn()).not.toThrow();
  });

  it('her alan TEK BASINA eksikken de yuklenebilir', () => {
    // Toplu silme, bir alanin eksikligini digerinin maskelemesine izin
    // verir. Tek tek denemek her backfill'i ayri ayri kanitlar.
    for (const field of LATER_FIELDS) {
      const engine = new GameEngine(registry, { seed: 3 });
      engine.load(oldSaveWithout([field]));
      expect(() => engine.advanceTurn(), `eksik alan: ${field}`).not.toThrow();
    }
  });

  it('yuklendikten sonra dizi alanlari GERCEKTEN dizi olur', () => {
    const engine = new GameEngine(registry, { seed: 3 });
    engine.load(oldSaveWithout(LATER_FIELDS));
    const state = engine.snapshot();
    expect(Array.isArray(state.formerAgents)).toBe(true);
    expect(Array.isArray(state.ratingHistory)).toBe(true);
    expect(typeof state.categoryCooldowns).toBe('object');
    expect(typeof state.storyArcTurns).toBe('object');
    expect(typeof state.storyBeatTurns).toBe('object');
    expect(typeof state.storyBeatCounts).toBe('object');
    expect(typeof state.storySignatureTurns).toBe('object');
    expect(state.rngStreams).toBeDefined();
    expect(typeof state.rngStreams.selection.cursor).toBe('number');
    expect(state.availability).toBeDefined();
  });

  it('v1 kaydi migrate ederek yukler', () => {
    const engine = new GameEngine(registry, { seed: 3 });
    const env = oldSaveWithout(LATER_FIELDS) as unknown as {
      schemaVersion: number;
    };
    env.schemaVersion = 1;

    expect(() => engine.load(env as unknown as ReturnType<GameEngine['save']>)).not.toThrow();
    expect(() => engine.advanceTurn()).not.toThrow();
  });

  it('gelecek schemaVersion kaydini reddeder', () => {
    const engine = new GameEngine(registry, { seed: 3 });
    const env = oldSaveWithout([]) as unknown as {
      schemaVersion: number;
    };
    env.schemaVersion = 99;

    expect(() => engine.load(env as unknown as ReturnType<GameEngine['save']>)).toThrow(
      /daha yeni bir surumle uretilmis/,
    );
  });

  it('bozuk rngCursor degerlerini reddeder', () => {
    for (const cursor of [-1, Number.POSITIVE_INFINITY, 9_000_000]) {
      const engine = new GameEngine(registry, { seed: 3 });
      const env = oldSaveWithout([]) as unknown as {
        state: { rngCursor: number };
      };
      env.state.rngCursor = cursor;

      expect(
        () => engine.load(env as unknown as ReturnType<GameEngine['save']>),
        `rngCursor=${cursor}`,
      ).toThrow(/rngCursor/);
    }
  });

  it('flags nesnesi eksikse kaydi reddeder', () => {
    const engine = new GameEngine(registry, { seed: 3 });
    const env = oldSaveWithout([]) as unknown as {
      state: Record<string, unknown>;
    };
    delete env.state.flags;

    expect(() => engine.load(env as unknown as ReturnType<GameEngine['save']>)).toThrow(
      /flags nesnesi yok/,
    );
  });

  it('history occurrenceId ve nextOccurrenceId alanlarini backfill eder', () => {
    const source = new GameEngine(registry, { seed: 5 });
    source.start('street');

    for (let turn = 0; turn < 60 && source.snapshot().history.length < 2; turn += 1) {
      source.advanceTurn();
      for (let guard = 0; guard < 20 && source.currentNode(); guard += 1) {
        const open = source.availableChoices().find((c) => !c.locked);
        if (!open) break;
        source.choose(open.id);
      }
    }

    expect(source.snapshot().history.length).toBeGreaterThan(0);

    const env = JSON.parse(JSON.stringify(source.save())) as {
      state: {
        history: Array<Record<string, unknown>>;
        nextOccurrenceId?: number;
      };
    };
    delete env.state.nextOccurrenceId;
    for (const entry of env.state.history) delete entry.occurrenceId;

    const loaded = new GameEngine(registry, { seed: 5 });
    loaded.load(env as unknown as ReturnType<GameEngine['save']>);

    const ids = loaded.snapshot().history.map((h) => h.occurrenceId);
    expect(ids.every((id) => /^occ_\d+$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(loaded.snapshot().nextOccurrenceId).toBeGreaterThan(0);
  });
});
