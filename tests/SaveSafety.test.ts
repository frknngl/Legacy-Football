import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import type { MatchContext, PendingMoment } from '../src/domain/match.js';

let registry: ContentRegistry;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
});

function openScene(engine: GameEngine, maxTurns = 40): void {
  for (let i = 0; i < maxTurns; i += 1) {
    const report = engine.advanceTurn();
    if (report.presented) return;
  }
  throw new Error('acik sahne bulunamadi');
}

function closeScene(engine: GameEngine, maxSteps = 30): void {
  for (let i = 0; i < maxSteps; i += 1) {
    const node = engine.currentNode();
    if (!node) return;
    const open = engine.availableChoices().find((c) => !c.locked);
    if (!open) return;
    engine.choose(open.id);
  }
}

const CONTEXT: MatchContext = {
  opponentName: 'Goztepe',
  importance: 'derby',
  isStarter: true,
};

const MOMENTS: readonly PendingMoment[] = [
  { type: 'penalty_for', minute: 12, scoreline: '0-0', opponent: 'Goztepe', importance: 'derby' },
  { type: 'one_on_one', minute: 74, scoreline: '1-1', opponent: 'Goztepe', importance: 'derby' },
];

describe('kayit guvenligi', () => {
  it('acik haftalik karar varken save engellenir', () => {
    const engine = new GameEngine(registry, { seed: 3 });
    engine.start('street');
    openScene(engine);

    expect(() => engine.save()).toThrow(/Acik bir karar varken kayit alinamaz/);
  });

  it('sahne kapaninca save alinabilir', () => {
    const engine = new GameEngine(registry, { seed: 3 });
    engine.start('street');
    openScene(engine);
    closeScene(engine);

    expect(() => engine.save()).not.toThrow();
  });

  it('mac moment zinciri acikken save engellenir', () => {
    const engine = new GameEngine(registry, { seed: 7 });
    engine.start('street');

    const played = engine.playMatch({ context: CONTEXT, pendingMoments: MOMENTS });
    expect(played.decisions).toBeGreaterThan(0);
    expect(engine.currentNode()?.isMoment).toBe(true);

    expect(() => engine.save()).toThrow(/Acik bir karar varken kayit alinamaz/);
  });

  it('moment zinciri tamamlaninca save alinabilir', () => {
    const engine = new GameEngine(registry, { seed: 7 });
    engine.start('street');

    const played = engine.playMatch({ context: CONTEXT, pendingMoments: MOMENTS });
    expect(played.decisions).toBeGreaterThan(0);
    closeScene(engine, 80);

    expect(engine.currentNode()).toBeUndefined();
    expect(() => engine.save()).not.toThrow();
  });
});
