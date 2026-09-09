/**
 * ENFLASYON VE KIRA.
 *
 * VERI GERCEK: 2015-2024 yillik TUFE ortalamalari (kaynaklar
 * `docs/enflasyon.md`). Oyundaki sekiz ulke arasinda ON BES KAT fark
 * var: Anadolu %27,5, Gallia %1,8.
 *
 * NEDEN OYUNA GIRIYOR: enflasyon yalnizca buyuk sayilar uretirse
 * GORUNMEZ olur -- her sey ayni oranda artarsa hicbir sey degismez.
 * Karar uretmesi icin ASIMETRIK olmali:
 *
 *   nakit ERIR      15 sezonda 1M TL -> Anadolu'da ~20 bin, Gallia'da ~746 bin
 *   varlik KORUR    ev/arsa nominal olarak enflasyonla yukselir
 *   MAAS GERIDE     sozlesme nominal ve sabit
 *   BORC ERIR       yuksek enflasyonda borclanmak kazandirir
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import {
  forCountry,
  nextIndex,
  realValue,
  seasonRate,
  weeklyFactor,
} from '../src/domain/inflation.js';
import { canRent, rentIncome, inflateValues } from '../src/domain/assets.js';
import { Rng } from '../src/selection/Rng.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;
let mock: MockWorld;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 43);
});

describe('Ulke verisi', () => {
  it('sekiz ulke de tanimli', () => {
    expect(registry.config.inflation.countries.length).toBe(8);
  });

  it('Anadolu en yuksek, Gallia en dusuk -- gercek veriyle uyumlu', () => {
    const cs = registry.config.inflation.countries;
    const top = [...cs].sort((a, b) => b.mean - a.mean)[0]!;
    const bottom = [...cs].sort((a, b) => a.mean - b.mean)[0]!;
    expect(top.name).toBe('Anadolu');
    expect(bottom.name).toBe('Gallia');
    // On bes kat fark -- ulke secimi ekonomiyi degistirmeli.
    expect(top.mean / bottom.mean).toBeGreaterThan(10);
  });

  it('yuksek enflasyonlu ulke daha OYNAK', () => {
    const cs = registry.config.inflation;
    expect(forCountry(cs, 'Anadolu').volatility).toBeGreaterThan(
      forCountry(cs, 'Gallia').volatility * 5,
    );
  });

  it('bilinmeyen ulke varsayilana duser -- mock dunya cokmez', () => {
    const fb = forCountry(registry.config.inflation, 'YokBoyleUlke');
    expect(fb.mean).toBeGreaterThan(0);
  });

  it('ulke adi verilmezse de calisir', () => {
    expect(forCountry(registry.config.inflation, undefined).mean).toBeGreaterThan(0);
  });
});

describe('Oran uretimi', () => {
  const anadolu = { name: 'A', mean: 27.5, volatility: 23 };
  const gallia = { name: 'G', mean: 1.8, volatility: 1.7 };

  it('ORTALAMAYA DONUS var -- enflasyon yapiskan bir buyukluk', () => {
    // Cok yuksek bir onceki oran, bir sonrakini yukari ceker.
    const rng = new Rng(1);
    const afterSpike = seasonRate(gallia, 40, rng.next());
    const afterCalm = seasonRate(gallia, 1, new Rng(1).next());
    expect(afterSpike).toBeGreaterThan(afterCalm);
  });

  it('uzun vadede ORTALAMAYA yaklasiyor', () => {
    for (const c of [anadolu, gallia]) {
      const rng = new Rng(77);
      let prev = c.mean;
      let sum = 0;
      for (let i = 0; i < 200; i += 1) {
        prev = seasonRate(c, prev, rng.next());
        sum += prev;
      }
      const avg = sum / 200;
      expect(Math.abs(avg - c.mean)).toBeLessThan(c.mean * 0.5 + 3);
    }
  });

  it('deflasyon mumkun ama DAR -- Iberia gercekten negatif yillar gordu', () => {
    // Iberia (Ispanya) 2015'te -0,5%, 2020'de -0,3% gordu. Testin
    // ONCEKI hali `gallia` kullaniyordu -- en dar oynaklikli ulke, yani
    // iddianin sinandigi yer yanlisti.
    const iberia = forCountry(registry.config.inflation, 'Iberia');
    const rng = new Rng(5);
    let prev = 0;
    let sawNegative = false;
    for (let i = 0; i < 400; i += 1) {
      prev = seasonRate(iberia, prev, rng.next());
      if (prev < 0) sawNegative = true;
      // Taban var: hicbir ulke kalici deflasyona girmemeli.
      expect(prev).toBeGreaterThanOrEqual(-2);
    }
    expect(sawNegative, 'Iberia hic negatif yil gormedi').toBe(true);
  });

  it('endeks bilesik buyuyor', () => {
    expect(nextIndex(100, 10)).toBeCloseTo(110, 0);
    expect(nextIndex(110, 10)).toBeCloseTo(121, 0);
  });

  it('haftalik carpan BILESIK KOK -- 52`ye bolme degil', () => {
    // %72'lik bir yil haftalik %1,38 degil ~%1,05'tir.
    const w = weeklyFactor(72);
    expect(Math.pow(w, 52)).toBeCloseTo(1.72, 2);
    expect((w - 1) * 100).toBeLessThan(72 / 52);
  });

  it('reel deger endeksle azaliyor', () => {
    expect(realValue(1_000_000, 100)).toBe(1_000_000);
    expect(realValue(1_000_000, 500)).toBe(200_000);
  });
});

describe('Kariyer boyu etki', () => {
  it('ANADOLU`da nakit erir, GALLIA`da erimez', () => {
    const run = (name: string): number => {
      const c = forCountry(registry.config.inflation, name);
      const rng = new Rng(4242);
      let idx = 100;
      let prev = c.mean;
      for (let s = 0; s < 15; s += 1) {
        prev = seasonRate(c, prev, rng.next());
        idx = nextIndex(idx, prev);
      }
      return realValue(1_000_000, idx);
    };

    const anadolu = run('Anadolu');
    const gallia = run('Gallia');
    // Anadolu'da 1M nakit onda birinden AZ eder; Gallia'da yarisindan cok.
    expect(anadolu).toBeLessThan(100_000);
    expect(gallia).toBeGreaterThan(500_000);
  });
});

describe('Kira', () => {
  const catalog = [
    { id: 'ev', label: 'Ev', kind: 'ev' as const, price: 1000, upkeep: 1, yearlyDrift: 0, visibility: 0, rentYield: 0.05 },
    { id: 'araba', label: 'Araba', kind: 'araba' as const, price: 1000, upkeep: 5, yearlyDrift: -0.2, visibility: 30 },
  ];

  it('arabanin kirasi OLMAZ', () => {
    expect(canRent(catalog[1])).toBe(false);
    expect(canRent(catalog[0])).toBe(true);
  });

  it('yalnizca KIRAYA VERILMIS varlik gelir getirir', () => {
    const idle = [{ id: 'ev', boughtTurn: 0, value: 5200 }];
    const rented = [{ id: 'ev', boughtTurn: 0, value: 5200, rented: true }];
    expect(rentIncome(idle, catalog)).toBe(0);
    expect(rentIncome(rented, catalog)).toBe(5);
  });

  it('kira DEGERE bagli -- deger arttikca kira artar', () => {
    const a = rentIncome([{ id: 'ev', boughtTurn: 0, value: 100_000, rented: true }], catalog);
    const b = rentIncome([{ id: 'ev', boughtTurn: 0, value: 200_000, rented: true }], catalog);
    expect(b).toBeGreaterThan(a);
  });

  it('katalogda kiralik mulk gideri KARSILIYOR -- yoksa kimse almaz', () => {
    for (const def of registry.config.assets) {
      if (def.rentYield === undefined) continue;
      const weeklyRent = (def.price * def.rentYield) / 52;
      expect(weeklyRent, def.id).toBeGreaterThan(def.upkeep);
    }
  });

  it('araba gideri KARSILANAMAZ -- sadece masraf, dogru', () => {
    const cars = registry.config.assets.filter((a) => a.kind === 'araba');
    for (const car of cars) expect(car.rentYield).toBeUndefined();
  });
});

describe('Motor baglantisi', () => {
  it('enflasyon endeksi sezonla ARTIYOR', () => {
    const engine = new GameEngine(registry, { seed: 43, ...mock });
    engine.start('street');
    const before = Number(engine.snapshot().flags['enflasyon_endeksi'] ?? 100);

    for (let i = 0; i < 90; i += 1) {
      engine.advanceTurn();
      for (let g = 0; g < 40; g += 1) {
        if (!engine.currentNode()) break;
        const open = engine.availableChoices().filter((c) => !c.locked);
        if (open.length === 0) break;
        engine.choose(open[0]!.id);
      }
      if (engine.snapshot().ending !== undefined) break;
    }
    expect(Number(engine.snapshot().flags['enflasyon_endeksi'])).toBeGreaterThan(before);
  });

  it('varlik degeri enflasyonla NOMINAL yukseliyor', () => {
    const items = [{ id: 'x', boughtTurn: 0, value: 1000 }];
    inflateValues(items, weeklyFactor(50));
    expect(items[0]!.value).toBeGreaterThan(1000);
  });

  it('kiraya verme ve cikarma calisiyor', () => {
    const engine = new GameEngine(registry, { seed: 43, ...mock });
    engine.start('street');
    engine.snapshot().flags['servet'] = 60_000_000;
    const rentable = engine.assetCatalog().find((a) => a.rentYield !== undefined)!;
    engine.buyAsset(rentable.id);

    engine.setRented(rentable.id, true);
    expect(engine.ownedAssets()[0]!.rented).toBe(true);
    engine.setRented(rentable.id, false);
    expect(engine.ownedAssets()[0]!.rented).toBe(false);
  });

  it('araba kiraya VERILEMEZ -- motor reddediyor', () => {
    const engine = new GameEngine(registry, { seed: 43, ...mock });
    engine.start('street');
    engine.snapshot().flags['servet'] = 60_000_000;
    const car = engine.assetCatalog().find((a) => a.kind === 'araba')!;
    engine.buyAsset(car.id);
    expect(() => engine.setRented(car.id, true)).toThrow();
  });

  it('kira geliri DEFTERE yaziliyor', () => {
    const engine = new GameEngine(registry, { seed: 43, ...mock });
    engine.start('street');
    engine.snapshot().flags['servet'] = 60_000_000;
    const rentable = engine.assetCatalog().find((a) => a.rentYield !== undefined)!;
    engine.buyAsset(rentable.id);
    engine.setRented(rentable.id, true);

    engine.advanceTurn();

    const rent = engine.snapshot().wallet.filter(
      (e) => e.kind === 'varlik' && e.label.includes('Kira'),
    );
    expect(rent.length).toBeGreaterThan(0);
    expect(rent[0]!.amount).toBeGreaterThan(0);
  });
});
