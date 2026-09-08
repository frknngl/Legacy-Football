import { beforeAll, describe, expect, it } from 'vitest';
import type { GameState } from '../src/domain/state.js';
import { NameForge } from '../src/evaluation/NameForge.js';
import { TextInterpolator } from '../src/evaluation/TextInterpolator.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import { ActorArchive } from '../src/runtime/ActorArchive.js';
import { CastingDirector } from '../src/runtime/CastingDirector.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;
let mock: MockWorld;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 77);
});

function retiredState(overrides: Record<string, unknown> = {}): {
  engine: GameEngine;
  state: GameState;
} {
  const engine = new GameEngine(registry, { seed: 77, ...mock });
  engine.start('street');
  const state = engine.snapshot();
  state.flags['retired'] = true;
  for (const [k, v] of Object.entries(overrides)) {
    state.flags[k] = v as never;
    state.flagSetTurn[k] = state.turn;
  }
  return { engine, state };
}

describe('Sonlanma tablosu', () => {
  it('endings.json yuklendi', () => {
    expect(registry.config.endings.length).toBeGreaterThanOrEqual(15);
  });

  it('her kariyer en az bir son alir -- kosulsuz yedek var', () => {
    const fallback = registry.config.endings.filter((e) => e.priority === 0);
    expect(fallback).toHaveLength(1);
    expect(fallback[0]!.id).toBe('end_quiet_goodbye');
  });

  it('oncelikler benzersiz -- beraberlikte hangisinin secildigi rastlantiya kalmaz', () => {
    const priorities = registry.config.endings.map((e) => e.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it('kapsayan son, kapsanandan once gelir', () => {
    const byId = new Map(registry.config.endings.map((e) => [e.id, e.priority]));
    // Hapis yatmis bir oyuncu ayni anda "sessiz veda" kosulunu da saglar.
    expect(byId.get('end_incarcerated')!).toBeGreaterThan(byId.get('end_quiet_goodbye')!);
    expect(byId.get('end_incarcerated')!).toBeGreaterThan(byId.get('end_forgotten')!);
  });

  it('AYNI istatistik, FARKLI persona -> farkli son', () => {
    const loyal = retiredState({
      stature: 'icon',
      persona_sadakat: 80,
      kupa_sayisi: 5,
    });
    const mercenary = retiredState({
      stature: 'icon',
      persona_sadakat: 20,
      kupa_sayisi: 5,
      servet: 30_000_000,
    });

    const resolveFor = (s: GameState): string | undefined =>
      registry.config.endings
        .filter((e) => matches(e.requires, s))
        .sort((a, b) => b.priority - a.priority)[0]?.id;

    expect(resolveFor(loyal.state)).toBe('end_legend');
    expect(resolveFor(mercenary.state)).toBe('end_mercenary');
  });

  it('her epilog tam olarak cozulur -- ham token kalmaz', () => {
    const { state } = retiredState({
      mem_was_incarcerated: true,
      mem_turned_informant: true,
      mem_hid_injury: true,
      mem_attacked_tff: true,
      mem_prison_mentored: true,
      mem_refused_fixing: true,
      mem_stood_against_racism: true,
      borc: 5_000_000,
      servet: 30_000_000,
      skandal_seviyesi: 90,
      tukenmislik: 90,
      medya_itibari: 85,
      liderlik: 85,
      persona_durus: 85,
      persona_dogruluk: 85,
      persona_sadakat: 85,
    });

    const casting = new CastingDirector(
      registry.slots,
      mock.roster,
      new NameForge(registry.names),
      new ActorArchive(registry.config.turn.turnsPerSeason),
    );
    const club = mock.roster.club(state.clubId);
    const interpolator = new TextInterpolator();
    const ctx = {
      flags: state.flags,
      actor: casting.resolver(state),
      club: { name: club?.name ?? '', city: club?.city ?? '', stadium: club?.stadium ?? '' },
    };

    for (const ending of registry.config.endings) {
      const rendered = interpolator.interpolate(ending.epilogue, ctx);
      expect(rendered, ending.id).not.toContain('{');
      expect(rendered.length, ending.id).toBeGreaterThan(80);
    }
  });
});

/** Kosul degerlendirmesi -- EndingResolver ile ayni mantik, testte gorulur halde. */
function matches(condition: unknown, state: GameState): boolean {
  const c = condition as Record<string, unknown>;
  if (Array.isArray(c['allOf'])) return c['allOf'].every((x) => matches(x, state));
  if (Array.isArray(c['anyOf'])) return c['anyOf'].some((x) => matches(x, state));

  const flag = String(c['flag']);
  const value = state.flags[flag];
  switch (c['op']) {
    case 'isSet':
      return value === true;
    case 'eq':
      return value === c['value'];
    case 'gte':
      return typeof value === 'number' && value >= Number(c['value']);
    case 'lte':
      return typeof value === 'number' && value <= Number(c['value']);
    case 'in':
      return (c['value'] as unknown[]).includes(value);
    default:
      return false;
  }
}
