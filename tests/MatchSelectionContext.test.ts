import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine, type EngineOptions } from '../src/runtime/GameEngine.js';
import { createMockWorld } from '../src/testing/mockWorld.js';

const CONTENT_DIR = fileURLToPath(new URL('../content', import.meta.url));

let registry: ContentRegistry;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource(CONTENT_DIR)).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
});

async function makeEngine(options: EngineOptions): Promise<GameEngine> {
  const world = await createMockWorld(CONTENT_DIR, registry, 42);
  const engine = new GameEngine(registry, {
    seed: 42,
    roster: world.roster,
    world: world.world,
    worldFeed: world.worldFeed,
    ...options,
  });
  engine.start('street' as never);
  return engine;
}

describe('haftalik secim baglami', () => {
  it('advanceTurn oncesi pre-match baglamini yazar', async () => {
    const engine = await makeEngine({
      selectionMatchContext: () => ({
        opponentName: 'Kupadaki Rakip',
        importance: 'cup_final',
        isStarter: false,
        teamLeaguePosition: 17,
        teamLeagueSize: 20,
        teamRelegationLine: 18,
        teamInRelegationZone: false,
      }),
    });

    engine.advanceTurn();

    const flags = engine.snapshot().flags;
    expect(flags['match_context_phase']).toBe('pre_match');
    expect(flags['next_match_exists']).toBe(true);
    expect(flags['next_match_importance']).toBe('cup_final');
    expect(flags['next_opponent_name']).toBe('Kupadaki Rakip');
    expect(flags['match_importance']).toBe('cup_final');
    expect(flags['opponent_name']).toBe('Kupadaki Rakip');
    expect(flags['is_starter']).toBe(false);
    expect(flags['next_team_league_position']).toBe(17);
    expect(flags['next_team_relegation_line']).toBe(18);
  });

  it('provider bu hafta fikstur donmezse stale baglami temizler', async () => {
    const engine = await makeEngine({
      selectionMatchContext: () => undefined,
    });

    const flags = engine.snapshot().flags;
    flags['match_importance'] = 'cup_final';
    flags['opponent_name'] = 'Eski Rakip';
    flags['is_starter'] = true;

    engine.advanceTurn();

    expect(flags['match_context_phase']).toBe('free_week');
    expect(flags['next_match_exists']).toBe(false);
    expect(flags['match_importance']).toBe('none');
    expect(flags['opponent_name']).toBe('');
    expect(flags['is_starter']).toBe(false);
  });
});
