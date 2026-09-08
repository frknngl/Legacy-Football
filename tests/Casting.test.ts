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
import { Rng } from '../src/selection/Rng.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
});

async function startCareer(seed: number): Promise<{
  engine: GameEngine;
  state: GameState;
  mock: MockWorld;
}> {
  const mock = await createMockWorld('content', registry, seed);
  const engine = new GameEngine(registry, { seed, ...mock });
  engine.start('street');
  return { engine, state: engine.snapshot(), mock };
}

/** Motorunkiyle ayni yapilandirmada bagimsiz bir yonetmen -- transferi elle surmek icin. */
function director(mock: MockWorld): CastingDirector {
  return new CastingDirector(
    registry.slots,
    mock.roster,
    new NameForge(registry.names),
    new ActorArchive(registry.config.turn.turnsPerSeason),
  );
}

function ctxOf(state: GameState) {
  return {
    clubId: state.clubId,
    clubTier: state.clubTier,
    stature: state.stature,
    lifeState: state.lifeState,
  };
}

describe('Kimlik katmani -- kariyer basi', () => {
  it('kalici slotlar dolar ve turetilmis flag\u0027ler yazilir', async () => {
    const { state } = await startCareer(11);

    expect(state.clubId).not.toBe('');
    for (const slotId of ['captain', 'manager', 'agent', 'father', 'doctor']) {
      expect(state.casting[slotId], `${slotId} bagli olmali`).toBeDefined();
      expect(state.flags[`slot_${slotId}_bound`]).toBe(true);
      expect(typeof state.flags[`iliski_${slotId}`]).toBe('number');
      expect(state.flags[`npc_${slotId}_arc`]).toBe(0);
    }
  });

  it('mac ve former slotlari kariyer basinda BOS', async () => {
    const { state } = await startCareer(11);
    expect(state.casting['opponent_star']).toBeUndefined();
    expect(state.flags['slot_former_captain_bound']).toBe(false);
  });

  it('kadro icindeki roller ayni kisiye dusmez', async () => {
    const { state } = await startCareer(11);
    const ids = ['captain', 'keeper', 'youngster', 'veteran', 'star_teammate']
      .map((s) => state.casting[s])
      .filter((v): v is string => v !== undefined);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('itibar bazli baslangic: hoca sohrete saygi duyar, kaptan tehdit sayar', () => {
    const manager = registry.slots.get('manager')!.relationByStature!;
    const captain = registry.slots.get('captain')!.relationByStature!;

    // Hoca icin sohret duz kazanctir.
    expect(manager['legend']).toBeGreaterThan(manager['nobody']!);

    // Kaptan icin degil: zirvede yerini alan adamsin. Egri ortada tepe yapar.
    expect(captain['star']).toBeGreaterThan(captain['nobody']!);
    expect(captain['star']).toBeGreaterThan(captain['legend']!);
  });
});

describe('Transfer', () => {
  it('club slotlari yenilenir, career slotlarina DOKUNULMAZ', async () => {
    const { state, mock } = await startCareer(21);
    const before = {
      captain: state.casting['captain'],
      manager: state.casting['manager'],
      agent: state.casting['agent'],
      father: state.casting['father'],
    };

    const target = mock.roster.clubs().find((c) => c.id !== state.clubId)!;
    director(mock).transferTo(state, target.id, ctxOf(state), new Rng(1));

    expect(state.clubId).toBe(target.id);
    expect(state.casting['captain']).not.toBe(before.captain);
    expect(state.casting['manager']).not.toBe(before.manager);
    expect(state.casting['agent']).toBe(before.agent);
    expect(state.casting['father']).toBe(before.father);
  });

  it('eski aktorler arsivde iliskileriyle KALIR', async () => {
    const { state, mock } = await startCareer(22);
    const oldCaptainId = state.casting['captain']!;
    state.flags['iliski_captain'] = 88;
    state.flags['npc_captain_arc'] = 3;

    const target = mock.roster.clubs().find((c) => c.id !== state.clubId)!;
    director(mock).transferTo(state, target.id, ctxOf(state), new Rng(1));

    const archived = state.actors[oldCaptainId];
    expect(archived).toBeDefined();
    expect(archived!.relation).toBe(88);
    expect(archived!.arcStage).toBe(3);
    // Yeni kaptan sifirdan baslar; eskinin iliskisini devralmaz.
    expect(state.flags['iliski_captain']).not.toBe(88);
  });

  it('eski kulube donunce iliski kaldigi yerden devam eder', async () => {
    const { state, mock } = await startCareer(23);
    const homeClub = state.clubId;
    const originalCaptain = state.casting['captain']!;
    state.flags['iliski_captain'] = 91;

    const cast = director(mock);
    const away = mock.roster.clubs().find((c) => c.id !== homeClub)!;
    cast.transferTo(state, away.id, ctxOf(state), new Rng(1));
    cast.transferTo(state, homeClub, ctxOf(state), new Rng(2));

    expect(state.casting['captain']).toBe(originalCaptain);
    expect(state.flags['iliski_captain']).toBe(91);
  });
});

describe('ALTIN TEST -- ayni akis, farkli kadro', () => {
  it('farkli tohum tamamen farkli isimler verir ama yapi ayni kalir', async () => {
    const a = await startCareer(101);
    const b = await startCareer(202);

    const nameOf = (s: Awaited<ReturnType<typeof startCareer>>, slot: string): string =>
      s.state.actors[s.state.casting[slot]!]!.name;

    const slots = ['captain', 'manager', 'agent', 'journalist', 'doctor'];
    const overlap = slots.filter((s) => nameOf(a, s) === nameOf(b, s)).length;
    expect(overlap).toBe(0);

    // Yapi degismez: ayni slotlar bagli, ayni flag'ler yazili.
    for (const slot of slots) {
      expect(a.state.flags[`slot_${slot}_bound`]).toBe(b.state.flags[`slot_${slot}_bound`]);
    }
  });

  it('ayni tohum ayni kadroyu verir', async () => {
    const a = await startCareer(303);
    const b = await startCareer(303);
    expect(a.state.actors[a.state.casting['captain']!]!.name).toBe(
      b.state.actors[b.state.casting['captain']!]!.name,
    );
  });
});

describe('Metin cozumu', () => {
  it('{actor.*} ve {club.*} tokenleri ek cekimiyle cozulur', async () => {
    const { state, mock } = await startCareer(31);
    const cast = director(mock);
    const interpolator = new TextInterpolator();
    const club = mock.roster.club(state.clubId)!;

    const out = interpolator.interpolate(
      '{actor.captain.first:dat} dondu. {club.name:loc} son gun.',
      { flags: state.flags, actor: cast.resolver(state) as never, club: { name: club.name } },
    );

    const captain = state.actors[state.casting['captain']!]!;
    expect(out).toContain(captain.first);
    expect(out).toContain(club.name);
    expect(out).not.toContain('{');
  });

  it('cozulemeyen token ham kalir -- sessizce silinmez', () => {
    const out = new TextInterpolator().interpolate('{actor.yok_boyle_slot.name} geldi.', {
      flags: {},
    });
    expect(out).toBe('{actor.yok_boyle_slot.name} geldi.');
  });
});

describe('Aktor damgali hafiza', () => {
  it('mem_* izi kimin yuzunden tasindigini hatirlar', async () => {
    const { state } = await startCareer(41);
    const archive = new ActorArchive(registry.config.turn.turnsPerSeason);
    const captainId = state.casting['captain']!;

    archive.stampMemory(state, 'mem_betrayed_captain', captainId);

    expect(state.flagActor['mem_betrayed_captain']).toBe(captainId);
    expect(state.actors[captainId]!.memoryStamps).toContain('mem_betrayed_captain');
  });

  it('iz birakan aktor budanmaz, notr figuran unutulur', async () => {
    const { state, mock } = await startCareer(42);
    const archive = new ActorArchive(registry.config.turn.turnsPerSeason);
    const captainId = state.casting['captain']!;
    archive.stampMemory(state, 'mem_betrayed_captain', captainId);

    const target = mock.roster.clubs().find((c) => c.id !== state.clubId)!;
    director(mock).transferTo(state, target.id, ctxOf(state), new Rng(1));

    const before = Object.keys(state.actors).length;
    archive.prune(state, registry.slots);
    const after = Object.keys(state.actors).length;

    expect(after).toBeLessThan(before);
    expect(state.actors[captainId]).toBeDefined();
  });

  it('pozitif iliski sonumlenir, mem_* damgali negatif KALICIDIR', async () => {
    const { state, mock } = await startCareer(43);
    const archive = new ActorArchive(registry.config.turn.turnsPerSeason);
    const friendlyId = state.casting['keeper']!;
    const enemyId = state.casting['captain']!;

    state.flags['iliski_keeper'] = 90;
    state.flags['iliski_captain'] = 10;
    archive.stampMemory(state, 'mem_betrayed_captain', enemyId);

    const target = mock.roster.clubs().find((c) => c.id !== state.clubId)!;
    director(mock).transferTo(state, target.id, ctxOf(state), new Rng(1));

    archive.decaySeason(state, registry.slots);

    expect(state.actors[friendlyId]!.relation).toBeLessThan(90);
    expect(state.actors[enemyId]!.relation).toBe(10);
  });
});
