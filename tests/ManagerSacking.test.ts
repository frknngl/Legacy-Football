/**
 * TEKNIK DIREKTORUN KOVULMASI.
 *
 * OLCULEN SORUN: `yonetim_baskisi` bayragini **17 icerik olayi yaziyor**
 * ve motor onu HIC okumuyordu. "Hocayla atistin, yonetim rahatsiz" yazan
 * her sahne sessizce etkisizdi -- bayrak buyuyor, hicbir sey olmuyordu.
 *
 * Bu, isyan senaryosunun eksik ayagiydi. Denetimde dort ayaktan ucu
 * zaten kuruluydu (kapi: `liderlik`, riza: `trust`, icra: negatif
 * `rating`); eksik olan tek sey SONUCTU.
 *
 * Yeni bir "isyan" mekanigi degil: hoca kotu sezonda ve dagilmis
 * soyunma odasinda da gider. Isyan yalnizca sureci hizlandirir.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import {
  SACK_THRESHOLD,
  pressureAfterSack,
  sackChance,
  sackPressure,
} from '../src/runtime/ManagerTenure.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;
let mock: MockWorld;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 67);
});

describe('Baski formulu', () => {
  const base = { boardPressure: 0, harmony: 50, form: 50 };

  it('notr durumda baski yok', () => {
    expect(sackPressure(base)).toBe(0);
  });

  it('yonetim baskisi DOGRUDAN etkiliyor -- 17 olayin yazdigi sey', () => {
    expect(sackPressure({ ...base, boardPressure: 60 })).toBeGreaterThan(sackPressure(base));
  });

  it('dagilmis soyunma odasi hocayi yakiyor', () => {
    expect(sackPressure({ ...base, harmony: 15 })).toBeGreaterThan(sackPressure(base));
  });

  it('huzurlu oda hocayi KORUYOR', () => {
    expect(sackPressure({ ...base, boardPressure: 40, harmony: 85 })).toBeLessThan(
      sackPressure({ ...base, boardPressure: 40 }),
    );
  });

  it('hero`nun formu ZAYIF bir girdi -- tek oyuncu hocayi kovduramaz', () => {
    const formOnly = sackPressure({ ...base, form: 0 });
    const harmonyOnly = sackPressure({ ...base, harmony: 0 });
    expect(formOnly).toBeLessThan(harmonyOnly);
  });

  it('huzur bilinmiyorsa yok sayiliyor -- zarif bozulma', () => {
    expect(sackPressure({ ...base, harmony: undefined })).toBe(0);
  });

  it('0-100 disina cikmiyor', () => {
    expect(sackPressure({ boardPressure: 100, harmony: 0, form: 0 })).toBeLessThanOrEqual(100);
    expect(sackPressure({ boardPressure: 0, harmony: 100, form: 100 })).toBeGreaterThanOrEqual(0);
  });
});

describe('Kovulma sansi', () => {
  it('esigin altinda hicbir sans yok', () => {
    expect(sackChance(SACK_THRESHOLD - 1)).toBe(0);
  });

  it('baski arttikca sans artiyor', () => {
    expect(sackChance(100)).toBeGreaterThan(sackChance(80));
  });

  it('sans OLASILIK, kesinlik degil -- sayilabilen hoca gerilim uretmez', () => {
    // En yuksek baskida bile haftalik sans dusuk kalmali.
    expect(sackChance(100)).toBeLessThan(0.2);
    expect(sackChance(100)).toBeGreaterThan(0.05);
  });

  it('yeni hoca temiz sayfa ALMIYOR ama nefes aliyor', () => {
    const after = pressureAfterSack(100);
    expect(after).toBeLessThan(SACK_THRESHOLD);
    expect(after).toBeGreaterThan(0);
  });
});

/** Acik dugumleri kapatir; kilitlenmede `false` doner. */
function drain(engine: GameEngine): boolean {
  for (let g = 0; g < 40; g += 1) {
    if (!engine.currentNode()) return true;
    const open = engine.availableChoices().filter((c) => !c.locked);
    if (open.length === 0) return false;
    engine.choose(open[0]!.id);
  }
  return !engine.currentNode();
}

describe('Motor baglantisi', () => {
  it('baski yokken hoca DEGISMIYOR', () => {
    const engine = new GameEngine(registry, { seed: 67, ...mock });
    engine.start('street');
    const first = engine.snapshot().casting['manager'];
    expect(first).toBeDefined();

    for (let i = 0; i < 30; i += 1) {
      engine.snapshot().flags['yonetim_baskisi'] = 0;
      engine.advanceTurn();
      if (!drain(engine)) break;
      if (engine.snapshot().ending !== undefined) break;
    }
    expect(engine.snapshot().casting['manager']).toBe(first);
  });

  it('baski tavandayken hoca kovuluyor ve YERINE YENISI geliyor', () => {
    const engine = new GameEngine(registry, { seed: 67, ...mock });
    engine.start('street');
    const first = engine.snapshot().casting['manager'];

    let sacked = false;
    for (let i = 0; i < 120; i += 1) {
      const flags = engine.snapshot().flags;
      flags['yonetim_baskisi'] = 100;
      engine.advanceTurn();
      if (!drain(engine)) break;
      if (engine.snapshot().casting['manager'] !== first) {
        sacked = true;
        break;
      }
      if (engine.snapshot().ending !== undefined) break;
    }

    expect(sacked).toBe(true);
    // Slot BOS kalmamali: hocasiz kulup olmaz.
    expect(engine.snapshot().casting['manager']).toBeDefined();
  });

  it('kovulma `mem_hoca_kovuldu` izini birakiyor -- icerik okuyabilsin', () => {
    const engine = new GameEngine(registry, { seed: 67, ...mock });
    engine.start('street');
    const first = engine.snapshot().casting['manager'];

    for (let i = 0; i < 120; i += 1) {
      engine.snapshot().flags['yonetim_baskisi'] = 100;
      engine.advanceTurn();
      if (!drain(engine)) break;
      if (engine.snapshot().casting['manager'] !== first) break;
      if (engine.snapshot().ending !== undefined) break;
    }

    expect(engine.snapshot().flags['mem_hoca_kovuldu']).toBe(true);
  });

  it('kovulunca baski DUSUYOR -- kulup donme dolaba donmuyor', () => {
    const engine = new GameEngine(registry, { seed: 67, ...mock });
    engine.start('street');
    const first = engine.snapshot().casting['manager'];

    for (let i = 0; i < 120; i += 1) {
      engine.snapshot().flags['yonetim_baskisi'] = 100;
      engine.advanceTurn();
      if (!drain(engine)) break;
      if (engine.snapshot().casting['manager'] !== first) break;
      if (engine.snapshot().ending !== undefined) break;
    }

    expect(Number(engine.snapshot().flags['yonetim_baskisi'])).toBeLessThan(SACK_THRESHOLD);
  });

  it('YALNIZCA hoca degisiyor -- kaptanla kurulan iliski kariyerin kendisi', () => {
    const engine = new GameEngine(registry, { seed: 67, ...mock });
    engine.start('street');
    const firstManager = engine.snapshot().casting['manager'];
    const firstCaptain = engine.snapshot().casting['captain'];

    for (let i = 0; i < 120; i += 1) {
      engine.snapshot().flags['yonetim_baskisi'] = 100;
      engine.advanceTurn();
      if (!drain(engine)) break;
      if (engine.snapshot().casting['manager'] !== firstManager) break;
      if (engine.snapshot().ending !== undefined) break;
    }

    expect(engine.snapshot().casting['manager']).not.toBe(firstManager);
    expect(engine.snapshot().casting['captain']).toBe(firstCaptain);
  });
});
