/**
 * EMEKLILIK -- "bir sezon daha" karari.
 *
 * OLCULEN SORUN: iskele zaten kuruluydu ama KABLOSU yoktu.
 * `TurnScheduler.retirementStage` uc asama donduruyordu --
 * `window` (33+), `choice` (38+), `forced` (41) -- ama motorda yalnizca
 * `forced` okunuyordu. Kariyeri hep motor bitiriyordu; oyuncunun "bir
 * sezon daha" deme hakki yoktu.
 *
 * Bu dosyanin isi iki bedelin AYRI PARA BIRIMINDEN oldugunu sinamak:
 * devam etmek FIZIK oder, kotu oynarken devam etmek ITIBAR oder,
 * birakmak ise KAPIYI kapatir.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import {
  extraDecline,
  formWarning,
  legacyDamage,
  shouldAsk,
} from '../src/domain/retirement.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;
let mock: MockWorld;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 101);
});

describe('Matematik', () => {
  it('KARAR yalnizca `choice` asamasinda sorulur', () => {
    // 33 yasindaki bir futbolcuya her sezon "birakiyor musun" demek
    // karari degersizlestirir; o asama icerik icin bir kapidir.
    expect(shouldAsk('none')).toBe(false);
    expect(shouldAsk('window')).toBe(false);
    expect(shouldAsk('choice')).toBe(true);
    expect(shouldAsk('forced')).toBe(false);
  });

  it('devam etmenin bedeli HER TEKRARDA artiyor', () => {
    expect(extraDecline(0)).toBe(0);
    const first = extraDecline(1);
    const fourth = extraDecline(4);
    expect(first).toBeLessThan(0);
    expect(fourth).toBeLessThan(first);
  });

  it('ITIBAR bedeli yalnizca KOTU oynayana', () => {
    // "Bir yil fazla oynadi" cumlesi kotu oynayan veteran icin kurulur;
    // 39 yasinda 70 formla oynayan biri cezalandirilmamali.
    expect(legacyDamage(70, 3)).toBe(0);
    expect(legacyDamage(30, 3)).toBeLessThan(0);
  });

  it('hic devam etmediyse itibar bedeli YOK', () => {
    expect(legacyDamage(20, 0)).toBe(0);
  });

  it('itibar bedeli TAVANLI -- sonsuza kadar buyumuyor', () => {
    expect(legacyDamage(0, 3)).toBe(legacyDamage(0, 99));
  });

  it('form uyarisi yalnizca karar asamasinda', () => {
    expect(formWarning(40, 'choice')).toBe(true);
    expect(formWarning(70, 'choice')).toBe(false);
    expect(formWarning(40, 'window')).toBe(false);
  });
});

describe('Motor baglantisi', () => {
  /** Karar asamasina kadar oynatir. */
  function toChoiceAge(seed = 101): GameEngine {
    const engine = new GameEngine(registry, { seed, ...mock });
    engine.start('street');
    for (let i = 0; i < 1100; i += 1) {
      if (engine.snapshot().ending !== undefined) break;
      if (engine.retirementPrompt() !== undefined) break;
      engine.advanceTurn();
      for (let g = 0; g < 40; g += 1) {
        if (!engine.currentNode()) break;
        const open = engine.availableChoices().filter((ch) => !ch.locked);
        if (open.length === 0) break;
        engine.choose(open[0]!.id);
      }
    }
    return engine;
  }

  it('genc oyuncuya SORULMUYOR', () => {
    const engine = new GameEngine(registry, { seed: 101, ...mock });
    engine.start('street');
    expect(engine.retirementPrompt()).toBeUndefined();
  });

  it('KARAR ASAMASINA gelince soruluyor', () => {
    const engine = toChoiceAge();
    const prompt = engine.retirementPrompt();
    expect(prompt, 'kariyer boyunca karar hic sorulmadi').toBeDefined();
    expect(prompt!.age).toBeGreaterThanOrEqual(
      registry.config.turn.retirementChoiceMinAge,
    );
    expect(prompt!.seasonsLeft).toBeGreaterThanOrEqual(0);
  });

  it('DEVAM: fizik odenir, iz kalir, kariyer surer', () => {
    const engine = toChoiceAge();
    expect(engine.retirementPrompt()).toBeDefined();
    const fizik = Number(engine.snapshot().flags['fizik']);

    const out = engine.decideRetirement(false);

    expect(out.retired).toBe(false);
    expect(Number(engine.snapshot().flags['fizik'])).toBeLessThan(fizik);
    expect(engine.snapshot().flags['mem_bir_sezon_daha']).toBe(true);
    expect(engine.snapshot().flags['retired']).not.toBe(true);
  });

  it('BIRAK: kendi karariyla, veda donemi basliyor', () => {
    const engine = toChoiceAge();
    expect(engine.retirementPrompt()).toBeDefined();

    const out = engine.decideRetirement(true);

    expect(out.retired).toBe(true);
    expect(engine.snapshot().flags['mem_kendi_birakti']).toBe(true);
    expect(engine.snapshot().flags['retired']).toBe(true);
    expect(engine.snapshot().lifeState).toBe('retired');
    // Kariyer HEMEN kapanmiyor -- veda donemi `retired` icerigin sahneye
    // cikabildigi tek pencere.
    expect(engine.snapshot().ending).toBeUndefined();
  });

  it('karar bir kez verilir; ikinci kez atiyor', () => {
    const engine = toChoiceAge();
    engine.decideRetirement(false);
    expect(engine.retirementPrompt()).toBeUndefined();
    expect(() => engine.decideRetirement(false)).toThrow();
  });

  it('CEVAPSIZ kalirsa oyuncu OYNAMAYA DEVAM eder', () => {
    // Kimse cevap vermeyerek emekli olmaz.
    const engine = toChoiceAge();
    expect(engine.retirementPrompt()).toBeDefined();

    engine.advanceTurn();

    expect(engine.snapshot().flags['retired']).not.toBe(true);
  });

  it('KOTU FORMLA devam etmek itibardan yiyor', () => {
    const engine = toChoiceAge();
    engine.decideRetirement(false);
    const f = engine.snapshot().flags;
    f['form'] = 20;
    f['medya_itibari'] = 60;
    const season = engine.snapshot().season;

    // Bir sonraki sezon basina kadar oynat.
    for (let i = 0; i < 60 && engine.snapshot().season === season; i += 1) {
      if (engine.snapshot().ending !== undefined) break;
      engine.snapshot().flags['form'] = 20;
      engine.advanceTurn();
      for (let g = 0; g < 40; g += 1) {
        if (!engine.currentNode()) break;
        const open = engine.availableChoices().filter((ch) => !ch.locked);
        if (open.length === 0) break;
        engine.choose(open[0]!.id);
      }
    }

    expect(engine.snapshot().flags['mem_gecikmis_veda']).toBe(true);
  });

  it('eski kayit emeklilik alani olmadan yuklenebiliyor', () => {
    const engine = new GameEngine(registry, { seed: 101, ...mock });
    engine.start('street');
    const save = JSON.parse(JSON.stringify(engine.save())) as { state: Record<string, unknown> };
    delete save.state['retirement'];

    const fresh = new GameEngine(registry, { seed: 101, ...mock });
    expect(() => fresh.load(save as never)).not.toThrow();
    expect(fresh.retirementPrompt()).toBeUndefined();
  });
});
