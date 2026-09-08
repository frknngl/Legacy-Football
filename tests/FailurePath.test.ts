/**
 * BASARISIZLIK YOLU -- her kariyer yukselmemeli.
 *
 * OLCULEN SORUN:
 *   `GameEngine.develop()` tavani `base + 12 + rng.int(19)` ile
 *   uretiyordu. Taban HER ZAMAN `+12` oldugu icin hicbir oyuncu
 *   basladigi yerde kalamiyordu:
 *
 *     herkes gelisir -> `calledUp` kalite kapisini gecer ->
 *     sohret puaninin %50'sini olusturan `milli_mac_sayisi` birikir ->
 *     her kariyer ikon olarak biter.
 *
 *   Bedeli icerikte olculdu: 28 olu olayin 17'si "alt kademede
 *   yaslanan oyuncu" icin yazilmisti --
 *   `stature<=starter` + `era>=prime` + `clubTier<=lower` -- ve bu
 *   bileske MATEMATIKSEL OLARAK ulasilamazdi. Eksik olan icerik degil,
 *   basarisizlik yoluydu.
 *
 *   Duzeltme sonrasi olculdu: olu olay 28 -> 15, kapsama %83 -> %91.
 *
 * Bu test tavan dagiliminin negatif tarafini korur. Taban geri yukari
 * cekilirse dusen ilk test budur.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { Rng } from '../src/selection/Rng.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;
let mock: MockWorld;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 5);
});

/** Ilk sezon donusune kadar ilerletir; `potansiyel` orada bir kez belirlenir. */
function potentialVsStart(seed: number): { potential: number; base: number } {
  const engine = new GameEngine(registry, { seed, ...mock });
  // RASTGELE SECIM sart.
  //
  // Ilk yazimda bot hep ILK acik secenegi aliyordu. O bir oyuncu degil,
  // kotumser bir robot: olculdugunde kariyerlerin %43'u duraklamis
  // gorunuyordu. Ayni tohumlarla rastgele secimde oran %23 -- yani
  // tasarim hedefi (~beste bir) tutuyor, olcum politikasi yaniltiyordu.
  //
  // Ayni hata bu projede daha once para dengesinde de yapildi
  // ("icerik maastan cok para veriyor" -> gercekte 1.09x).
  const rng = new Rng(seed ^ 0xabc);
  engine.start('street');
  const s0 = engine.snapshot();
  const base = (Number(s0.flags['teknik'] ?? 0) + Number(s0.flags['fizik'] ?? 0)) / 2;

  const perSeason = registry.config.turn.turnsPerSeason;
  for (let i = 0; i < perSeason + 2; i += 1) {
    engine.advanceTurn();
    for (let guard = 0; guard < 40; guard += 1) {
      if (!engine.currentNode()) break;
      const open = engine.availableChoices().filter((c) => !c.locked);
      if (open.length === 0) break;
      engine.choose(open[Math.floor(rng.next() * open.length)]!.id);
    }
    if (engine.snapshot().ending !== undefined) break;
  }
  return { potential: Number(engine.snapshot().flags['potansiyel'] ?? 0), base };
}

describe('Basarisizlik yolu', () => {
  const SEEDS = 24;
  let sample: { potential: number; base: number }[];

  beforeAll(() => {
    sample = Array.from({ length: SEEDS }, (_, i) => potentialVsStart(1000 + i * 37));
  });

  it('tavan her kariyerde belirleniyor', () => {
    expect(sample.every((s) => s.potential > 0)).toBe(true);
  });

  it('BAZI kariyerlerde tavan baslangic seviyesinin ALTINDA -- gelisme yok', () => {
    const stalled = sample.filter((s) => s.potential <= s.base);
    // Taban `+12`ye geri cekilirse bu sifir olur ve test duser.
    expect(stalled.length).toBeGreaterThan(0);
  });

  it('cogunluk yine de gelisebiliyor -- oyun cezalandirici degil', () => {
    const grows = sample.filter((s) => s.potential > s.base + 5);
    expect(grows.length).toBeGreaterThan(SEEDS / 2);
  });

  it('tavan makul aralikta kaliyor', () => {
    for (const s of sample) {
      expect(s.potential).toBeGreaterThanOrEqual(30);
      expect(s.potential).toBeLessThanOrEqual(99);
    }
  });
});
