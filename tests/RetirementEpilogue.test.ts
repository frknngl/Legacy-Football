/**
 * VEDA DONEMI -- emeklilik bir DURUM olmali, bitis ekraniyla ayni an degil.
 *
 * OLCULEN SORUN:
 *   `GameEngine.checkEnding()` `retired` hayat durumunu bitis ekraniyla
 *   AYNI turda set ediyordu. Host donguleri bitis donunce kariyeri
 *   kapattigi icin `retired` durumu **sifir tur** suruyordu.
 *
 *   Sonuc olculdu: yalnizca `lifeStates: ["retired"]` isteyen 4 olay
 *   (`evt_business_agent_kayip_retired`, `evt_business_childhood_friend_kayip`,
 *   `evt_money_sporting_director_zafer_bedeli_retired`,
 *   `evt_personal_cousin_borc_retired`) 1400 turluk simulasyonda bile
 *   "kuyruga hic girmedi" diye raporlaniyordu. Icerik hatasi sanildi;
 *   degildi -- motor o duruma hic girmiyordu.
 *
 * Bu test veda doneminin GERCEKTEN oynandigini kanitlar. Epilog kablosu
 * sokulurse dusen ilk test budur.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;
let mock: MockWorld;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 91);
});

/** Zorunlu emeklilik yasina kadar tur ilerletir; acik karar varsa ilk secenegi alir. */
function runToRetirement(engine: GameEngine, maxTurns = 2000): number {
  let retiredTurns = 0;
  for (let i = 0; i < maxTurns; i += 1) {
    const report = engine.advanceTurn();
    // Acik dugumleri kapat, yoksa bir sonraki tur ilerletilemez.
    for (let guard = 0; guard < 40; guard += 1) {
      const node = engine.currentNode();
      if (!node) break;
      const open = engine.availableChoices().filter((c) => !c.locked);
      if (open.length === 0) break;
      engine.choose(open[0]!.id);
    }
    if (engine.snapshot().flags['retired'] === true) retiredTurns += 1;
    if (report.ending !== undefined) break;
  }
  return retiredTurns;
}

describe('Veda donemi', () => {
  it('yapilandirma epilog suresini tasiyor', () => {
    expect(registry.config.turn.retirementEpilogueTurns).toBeGreaterThan(0);
  });

  it('emeklilik bitisle ayni turda GELMEZ -- arada oynanan turlar var', () => {
    const engine = new GameEngine(registry, { seed: 91, ...mock });
    engine.start('street');
    const retiredTurns = runToRetirement(engine);

    // Kablo sokulurse burasi 1 olur (bitisin dondugu tek tur).
    expect(retiredTurns).toBeGreaterThan(1);
    expect(engine.snapshot().ending).toBeDefined();
  });

  it('emekli olunan tur damgalaniyor', () => {
    const engine = new GameEngine(registry, { seed: 91, ...mock });
    engine.start('street');
    runToRetirement(engine);
    const state = engine.snapshot();
    expect(state.retiredAtTurn).toBeDefined();
    expect(state.turn - state.retiredAtTurn!).toBeGreaterThanOrEqual(
      registry.config.turn.retirementEpilogueTurns,
    );
  });

  it('`retired` hayat durumuna yazilmis icerik var -- epilog bos degil', () => {
    const forRetired = registry.events.filter((e) => e.lifeStates?.includes('retired'));
    expect(forRetired.length).toBeGreaterThanOrEqual(4);
  });
});
