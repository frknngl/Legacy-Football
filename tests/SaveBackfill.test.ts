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
  'flagActor',
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
    expect(state.availability).toBeDefined();
  });
});
