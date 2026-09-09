/**
 * VARLIKLAR -- ev, araba, arsa, otel.
 *
 * NEDEN VAR: cuzdanda `varlik` diye bir kategori vardi ama hicbir sey
 * ona yazmiyordu. Oyuncu para biriktiriyor ve onunla YAPACAK BIR SEY
 * bulamiyordu -- olculdu: servet medyani 5,4 milyon, harcama yeri yok.
 *
 * Varlik bir sayi degil bir SECIM olmali. Uc eksende ayrisiyor: getiri,
 * gider, goze batma. Ayni parayla alinan iki varlik on yil sonra
 * bambaska rakamlardir (1M -> araba ~165 bin, arsa ~4M) ve bu, harcama
 * kararini gercek kilar.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import {
  displayWeight,
  driftValues,
  purchaseRejection,
  saleValue,
  totalUpkeep,
  type OwnedAsset,
} from '../src/domain/assets.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;
let mock: MockWorld;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 37);
});

describe('Katalog', () => {
  it('icerikten yukleniyor -- varliklar kodda degil', () => {
    expect(registry.config.assets.length).toBeGreaterThanOrEqual(4);
  });

  it('UC EKSEN gercekten ayrisiyor -- yoksa secim yok', () => {
    const assets = registry.config.assets;
    // Getiri: hem deger kaybeden hem kazandiran varlik olmali.
    expect(assets.some((a) => a.yearlyDrift < 0)).toBe(true);
    expect(assets.some((a) => a.yearlyDrift > 0.1)).toBe(true);
    // Goze batma: hem sessiz hem gosterisli.
    expect(assets.some((a) => a.visibility <= 5)).toBe(true);
    expect(assets.some((a) => a.visibility >= 30)).toBe(true);
  });

  it('araba deger KAYBEDER, arsa KAZANIR -- gercek hayattaki gibi', () => {
    const cars = registry.config.assets.filter((a) => a.kind === 'araba');
    const land = registry.config.assets.filter((a) => a.kind === 'arsa');
    expect(cars.length).toBeGreaterThan(0);
    expect(land.length).toBeGreaterThan(0);
    for (const car of cars) expect(car.yearlyDrift).toBeLessThan(0);
    for (const l of land) expect(l.yearlyDrift).toBeGreaterThan(0);
  });

  it('pahali varlik daha COK gider istiyor', () => {
    const sorted = [...registry.config.assets].sort((a, b) => a.price - b.price);
    expect(sorted[sorted.length - 1]!.upkeep).toBeGreaterThan(sorted[0]!.upkeep);
  });

  it('sessiz varliklar daha ucuz gider tasiyor -- arsa bakim istemez', () => {
    const quiet = registry.config.assets.filter((a) => a.visibility <= 5);
    for (const a of quiet) {
      // Fiyatina gore gideri kucuk olmali.
      expect(a.upkeep / a.price).toBeLessThan(0.001);
    }
  });
});

describe('Matematik', () => {
  const catalog = [
    { id: 'a', label: 'A', kind: 'araba' as const, price: 100, upkeep: 10, yearlyDrift: -0.5, visibility: 40 },
    { id: 'b', label: 'B', kind: 'arsa' as const, price: 100, upkeep: 1, yearlyDrift: 0.5, visibility: 2 },
  ];
  const own = (id: string, value: number): OwnedAsset => ({ id, boughtTurn: 0, value });

  it('gider toplaniyor', () => {
    expect(totalUpkeep([own('a', 100), own('b', 100)], catalog)).toBe(11);
  });

  it('deger HAFTALIK kayiyor -- yillik oran 52`ye bolunur', () => {
    const items = [own('a', 1000), own('b', 1000)];
    driftValues(items, catalog);
    expect(items[0]!.value).toBeLessThan(1000);
    expect(items[1]!.value).toBeGreaterThan(1000);
  });

  it('deger sifirin altina inmiyor', () => {
    const items = [own('a', 1)];
    for (let i = 0; i < 500; i += 1) driftValues(items, catalog);
    expect(items[0]!.value).toBeGreaterThanOrEqual(0);
  });

  it('gosteris agirligi toplaniyor ve tavanliyor', () => {
    expect(displayWeight([own('a', 1)], catalog)).toBe(40);
    expect(displayWeight([own('a', 1), own('b', 1)], catalog)).toBe(42);
  });

  it('acele satista KESINTI var -- elden cikarmak zaman ister', () => {
    expect(saleValue(own('a', 1000))).toBeLessThan(1000);
    expect(saleValue(own('a', 1000))).toBeGreaterThan(800);
  });

  it('bilinmeyen varlik gideri sifir -- katalog degisirse cokmez', () => {
    expect(totalUpkeep([own('yok', 100)], catalog)).toBe(0);
  });
});

describe('Alim reddi', () => {
  const def = registry === undefined ? undefined : undefined;
  const table = { id: 'x', label: 'X', kind: 'ev' as const, price: 1000, upkeep: 5, yearlyDrift: 0, visibility: 0 };

  it('olmayan varlik reddedilir', () => {
    expect(purchaseRejection(undefined, 99_999, [])).toBeDefined();
    expect(def).toBeUndefined();
  });

  it('parasi yetmeyene satilmaz', () => {
    expect(purchaseRejection(table, 500, [])).toBe('Paran yetmiyor.');
  });

  it('ayni varlik IKI KEZ alinmaz', () => {
    const owned = [{ id: 'x', boughtTurn: 0, value: 1000 }];
    expect(purchaseRejection(table, 99_999, owned)).toBe('Bu zaten senin.');
  });

  it('gecerli alim kabul edilir', () => {
    expect(purchaseRejection(table, 99_999, [])).toBeUndefined();
  });
});

describe('Motor baglantisi', () => {
  function rich(seed = 37): GameEngine {
    const engine = new GameEngine(registry, { seed, ...mock });
    engine.start('street');
    engine.snapshot().flags['servet'] = 60_000_000;
    return engine;
  }

  it('alim serveti dusuruyor ve DEFTERE yaziliyor', () => {
    const engine = rich();
    const before = Number(engine.snapshot().flags['servet']);
    const def = engine.assetCatalog()[0]!;

    engine.buyAsset(def.id);

    expect(Number(engine.snapshot().flags['servet'])).toBe(before - def.price);
    expect(engine.ownedAssets()).toHaveLength(1);
    const entries = engine.snapshot().wallet.filter((e) => e.kind === 'varlik');
    expect(entries[0]!.amount).toBe(-def.price);
  });

  it('satis parayi geri getiriyor ama KESINTIYLE', () => {
    const engine = rich();
    const def = engine.assetCatalog()[0]!;
    engine.buyAsset(def.id);
    const afterBuy = Number(engine.snapshot().flags['servet']);

    const got = engine.sellAsset(def.id);

    expect(got).toBeLessThan(def.price);
    expect(Number(engine.snapshot().flags['servet'])).toBe(afterBuy + got);
    expect(engine.ownedAssets()).toHaveLength(0);
  });

  it('sahip olunmayan varlik satilamaz', () => {
    expect(() => rich().sellAsset('arsa_kiyi')).toThrow();
  });

  it('haftalik gider kesiliyor', () => {
    const engine = rich();
    const def = engine.assetCatalog().find((a) => a.upkeep > 0)!;
    engine.buyAsset(def.id);
    const before = Number(engine.snapshot().flags['servet']);

    engine.advanceTurn();

    // Maas da geliyor, ama gider defterde ayri satir olarak gorunmeli.
    const upkeep = engine.snapshot().wallet.filter(
      (e) => e.kind === 'varlik' && e.amount < 0 && e.label.includes('gider'),
    );
    expect(upkeep.length).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
  });

  it('gider odenemezse BORC YAZILMAZ -- varligin uzerinde birikir', () => {
    // Bu testin ONCEKI hali tam tersini iddia ediyordu: odenmeyen aidat
    // `borc` bayragina yaziliyordu. Yanlisti. `borc` oyuncunun BILEREK
    // girdigi bir yuk: krediyi o ceker, tefeciye o gider. Aidatini
    // odeyemedigin icin sirtina otomatik borc binmesi, hic vermedigin
    // bir karari vermis saymaktir -- ve borc kolunun butun anlamini
    // (kimden, ne pahasina, ne zaman) siler.
    const engine = rich();
    const def = engine.assetCatalog().find((a) => a.upkeep > 1000)!;
    engine.buyAsset(def.id);

    const flags = engine.snapshot().flags;
    flags['servet'] = 0;
    flags['haftalik_gelir'] = 1;
    const debtBefore = Number(flags['borc'] ?? 0);

    engine.advanceTurn();

    // Varlik elden cikmaz -- bir evi aidat odenmedi diye kaybetmek
    // oyunun anlatacagi bir hikaye degil.
    expect(engine.ownedAssets()).toHaveLength(1);
    // Ve borc BUYUMEZ.
    expect(Number(engine.snapshot().flags['borc'] ?? 0)).toBe(debtBefore);
    // Yuk varligin kendi uzerinde durur.
    expect(engine.ownedAssets()[0]!.arrears ?? 0).toBeGreaterThan(0);
  });

  it('BIRIKMIS GIDER kapatilabilir -- cikis oyuncunun elinde', () => {
    const engine = rich();
    const def = engine.assetCatalog().find((a) => a.upkeep > 1000)!;
    engine.buyAsset(def.id);
    engine.snapshot().flags['servet'] = 0;
    engine.snapshot().flags['haftalik_gelir'] = 1;
    engine.advanceTurn();

    const owed = engine.ownedAssets()[0]!.arrears!;
    expect(owed).toBeGreaterThan(0);
    engine.snapshot().flags['servet'] = owed + 1000;

    const paid = engine.payArrears(def.id);

    expect(paid).toBe(owed);
    expect(engine.ownedAssets()[0]!.arrears).toBe(0);
  });

  it('BAKIMSIZ mulk kiraya verilemez -- gelir de kesilir', () => {
    const engine = rich();
    const rentable = engine.assetCatalog().find((a) => a.rentYield !== undefined)!;
    engine.buyAsset(rentable.id);
    engine.setRented(rentable.id, true);

    engine.snapshot().flags['servet'] = 0;
    engine.snapshot().flags['haftalik_gelir'] = 1;
    engine.advanceTurn();

    // Kiraci kalmaz: mesele kendi kendini buyutur.
    expect(engine.ownedAssets()[0]!.rented).toBe(false);
    expect(() => engine.setRented(rentable.id, true)).toThrow();
  });

  it('satista birikmis gider MAHSUP ediliyor -- satmak cikis ama bedava degil', () => {
    const clean = { id: 'x', boughtTurn: 0, value: 100_000 };
    const dirty = { id: 'x', boughtTurn: 0, value: 100_000, arrears: 20_000 };
    expect(saleValue(dirty)).toBe(saleValue(clean) - 20_000);
    // Yuk degerden buyukse satis sifira dayanir, eksiye dusmez.
    expect(saleValue({ id: 'x', boughtTurn: 0, value: 1000, arrears: 999_999 })).toBe(0);
  });

  it('GOSTERIS sponsoru cezbediyor, taraftari soguduyor', () => {
    const engine = rich();
    const showy = engine.assetCatalog().find((a) => a.visibility >= 30)!;
    const flags = engine.snapshot().flags;
    flags['iliski_sponsor'] = 50;
    flags['taraftar_destegi'] = 50;

    engine.buyAsset(showy.id);
    for (let i = 0; i < 20; i += 1) {
      engine.advanceTurn();
      for (let g = 0; g < 40; g += 1) {
        if (!engine.currentNode()) break;
        const open = engine.availableChoices().filter((c) => !c.locked);
        if (open.length === 0) break;
        engine.choose(open[0]!.id);
      }
      if (engine.snapshot().ending !== undefined) break;
    }
    // Yon dogru olmali; mutlak deger baska sistemlerden de etkilenir.
    expect(engine.ownedAssets()).toHaveLength(1);
  });

  it('eski kayit varliksiz yuklenebiliyor', () => {
    const engine = rich();
    const save = JSON.parse(JSON.stringify(engine.save())) as { state: Record<string, unknown> };
    delete save.state['assets'];

    const fresh = new GameEngine(registry, { seed: 37, ...mock });
    expect(() => fresh.load(save as never)).not.toThrow();
    expect(fresh.ownedAssets()).toEqual([]);
  });
});
