/**
 * SOSYAL FINANSMAN -- arkadastan borc.
 *
 * NEDEN AYRI BIR KOL: banka ve tefeci zaten vardi, ama ikisi de PARAYLA
 * odetiyor -- biri faizle, oteki daha yuksek faizle. Ucuncu bir kol
 * ancak PARA BIRIMI farkliysa gercek bir secim uretir:
 *
 *   banka   ucuz   -- odenmezse itibar
 *   tefeci  pahali -- odenmezse insanlar gelir
 *   arkadas FAIZSIZ -- odenmezse ARKADASINI kaybedersin
 *
 * Bu dosyanin isi ucuncunun gercekten UCUNCU oldugunu sinamak: faizi
 * yok, vadesi yok, ve bedeli baska bir kaynaktan cikiyor.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import {
  PATIENCE_WEEKS,
  TRUST_FLOOR,
  favorCeiling,
  favorRejection,
  friendshipBroken,
  outstanding,
  repayRejection,
  trustErosion,
  type Favor,
} from '../src/domain/favor.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;
let mock: MockWorld;

const favor = (over: Partial<Favor> = {}): Favor => ({
  actorId: 'a1',
  slotId: 'captain',
  amount: 100_000,
  takenTurn: 0,
  paid: 0,
  ...over,
});

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 63);
});

describe('Tavan', () => {
  it('GUVEN ESIGININ altinda kimse vermez', () => {
    expect(favorCeiling(TRUST_FLOOR - 1, 100_000, 10_000)).toBe(0);
    expect(favorCeiling(TRUST_FLOOR + 20, 100_000, 10_000)).toBeGreaterThan(0);
  });

  it('guven arttikca tavan artiyor', () => {
    const low = favorCeiling(65, 100_000, 10_000);
    const high = favorCeiling(95, 100_000, 10_000);
    expect(high).toBeGreaterThan(low);
  });

  it('IKI CARPAN da gerekli -- guvenen bir caylak cok veremez', () => {
    // Ayni guven, farkli kazanc.
    const rookie = favorCeiling(95, 6_000, 10_000);
    const star = favorCeiling(95, 200_000, 10_000);
    expect(star).toBeGreaterThan(rookie * 10);
  });

  it('kendi maasindan kucuk tutar TEKLIF EDILMEZ -- karar degil gurultu', () => {
    // Cok az kazanan bir arkadasin verebilecegi tutar senin haftaligindan
    // kucukse masaya hic gelmemeli.
    expect(favorCeiling(60, 5_000, 400_000)).toBe(0);
  });
});

describe('Sabir', () => {
  it('ILK HAFTALAR bedelsiz -- kimse ertesi hafta parasini istemez', () => {
    expect(trustErosion(favor(), 3)).toBe(0);
    expect(trustErosion(favor(), 7)).toBe(0);
  });

  it('bekledikce HIZLANIYOR', () => {
    const early = trustErosion(favor(), 20);
    const late = trustErosion(favor(), 50);
    expect(late).toBeGreaterThan(early);
    expect(early).toBeGreaterThan(0);
  });

  it('odenmis borc asindirmiyor', () => {
    expect(trustErosion(favor({ paid: 100_000 }), 200)).toBe(0);
  });

  it('SABIR BITINCE arkadaslik biter -- borc degil, kisi vazgecer', () => {
    expect(friendshipBroken(favor(), PATIENCE_WEEKS - 1)).toBe(false);
    expect(friendshipBroken(favor(), PATIENCE_WEEKS)).toBe(true);
  });

  it('odenmis borcta arkadaslik bitmiyor', () => {
    expect(friendshipBroken(favor({ paid: 100_000 }), 500)).toBe(false);
  });

  it('asinma TAVANLI -- sonsuza kadar buyumuyor', () => {
    expect(trustErosion(favor(), 5000)).toBeLessThanOrEqual(1.2);
  });

  it('kalan borc hesabi', () => {
    expect(outstanding(favor({ paid: 30_000 }))).toBe(70_000);
    expect(outstanding(favor({ paid: 200_000 }))).toBe(0);
  });
});

describe('Ret', () => {
  const offer = {
    actorId: 'a1',
    slotId: 'captain',
    name: 'Kaptan',
    ceiling: 100_000,
    reason: '',
  };

  it('teklifi olmayandan istenemez', () => {
    expect(favorRejection(undefined, 1000, false)).toBeDefined();
  });

  it('AYNI KISIDEN ikinci borc alinamaz -- once onu kapat', () => {
    expect(favorRejection(offer, 1000, true)).toContain('zaten');
  });

  it('tavanin ustu reddedilir', () => {
    expect(favorRejection(offer, 200_000, false)).toContain('en fazla');
    expect(favorRejection(offer, 100_000, false)).toBeUndefined();
  });

  it('gecersiz tutar reddedilir', () => {
    expect(favorRejection(offer, 0, false)).toBeDefined();
    expect(repayRejection(favor(), Number.NaN, 1_000_000)).toBeDefined();
  });

  it('olmayan borc odenemez', () => {
    expect(repayRejection(undefined, 1000, 1_000_000)).toBeDefined();
  });

  it('parasi olmayan odeyemez', () => {
    expect(repayRejection(favor(), 5000, 1000)).toBe('Bu kadar paran yok.');
  });
});

describe('Motor baglantisi', () => {
  function ready(seed = 63): GameEngine {
    const engine = new GameEngine(registry, { seed, ...mock });
    engine.start('street');
    // Kadro dokulsun ve guven olussun diye birkac hafta.
    for (let i = 0; i < 6; i += 1) {
      if (engine.snapshot().ending !== undefined) break;
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

  /** Guveni elle yukselterek en az bir teklif acar. */
  function withTrust(engine: GameEngine): { actorId: string; name: string; ceiling: number } {
    const state = engine.snapshot();
    for (const id of Object.keys(state.actors)) {
      state.actors[id]!.trust = 95;
    }
    const offers = engine.favorOffers();
    expect(offers.length, 'guven 95 iken hic teklif yok').toBeGreaterThan(0);
    return { actorId: offers[0]!.actorId, name: offers[0]!.name, ceiling: offers[0]!.ceiling };
  }

  it('GUVEN OLMADAN teklif cikmiyor', () => {
    const engine = ready();
    const state = engine.snapshot();
    for (const id of Object.keys(state.actors)) state.actors[id]!.trust = 20;
    expect(engine.favorOffers()).toHaveLength(0);
  });

  it('borc PARAYI getiriyor ve iz birakiyor', () => {
    const engine = ready();
    const { actorId, ceiling } = withTrust(engine);
    const before = Number(engine.snapshot().flags['servet']);

    engine.takeFavor(actorId, ceiling);

    expect(Number(engine.snapshot().flags['servet'])).toBe(before + ceiling);
    expect(engine.currentFavors()).toHaveLength(1);
    expect(engine.snapshot().flags['mem_arkadastan_borc']).toBe(true);
  });

  it('ISTEMEK BILE bir sey: guven duser, yakinlik artar', () => {
    const engine = ready();
    const { actorId } = withTrust(engine);
    const actor = engine.snapshot().actors[actorId]!;
    const trustBefore = actor.trust;
    const relBefore = actor.relation;

    engine.takeFavor(actorId, 20_000);

    expect(engine.snapshot().actors[actorId]!.trust).toBeLessThan(trustBefore);
    expect(engine.snapshot().actors[actorId]!.relation).toBeGreaterThan(relBefore);
  });

  it('AYNI KISIDEN ikinci borc alinamiyor', () => {
    const engine = ready();
    const { actorId } = withTrust(engine);
    engine.takeFavor(actorId, 20_000);
    expect(() => engine.takeFavor(actorId, 20_000)).toThrow();
    // Teklif listesinden de dusmeli.
    expect(engine.favorOffers().some((o) => o.actorId === actorId)).toBe(false);
  });

  it('FAIZ YOK -- odedigin, aldigin kadar', () => {
    const engine = ready();
    const { actorId } = withTrust(engine);
    engine.takeFavor(actorId, 40_000);
    const afterTake = Number(engine.snapshot().flags['servet']);

    engine.repayFavor(actorId, 40_000);

    expect(Number(engine.snapshot().flags['servet'])).toBe(afterTake - 40_000);
    expect(engine.currentFavors()).toHaveLength(0);
  });

  it('KAPATMAK aldigindan fazla guven geri veriyor', () => {
    const engine = ready();
    const { actorId } = withTrust(engine);
    const before = engine.snapshot().actors[actorId]!.trust;

    engine.takeFavor(actorId, 30_000);
    engine.repayFavor(actorId, 30_000);

    // Alirken -4, kapatirken +9: sozunu tutmak, hic istememekten guclu.
    expect(engine.snapshot().actors[actorId]!.trust).toBeGreaterThan(before);
  });

  it('kismi odeme borcu acik birakiyor', () => {
    const engine = ready();
    const { actorId, ceiling } = withTrust(engine);
    engine.takeFavor(actorId, ceiling);

    engine.repayFavor(actorId, Math.round(ceiling / 3));

    expect(engine.currentFavors()).toHaveLength(1);
    expect(outstanding(engine.currentFavors()[0]!)).toBe(ceiling - Math.round(ceiling / 3));
  });

  it('fazla odeme borcu asmiyor -- para bosa gitmiyor', () => {
    const engine = ready();
    const { actorId } = withTrust(engine);
    engine.takeFavor(actorId, 10_000);
    const afterTake = Number(engine.snapshot().flags['servet']);

    const paid = engine.repayFavor(actorId, 999_999);

    expect(paid).toBe(10_000);
    expect(Number(engine.snapshot().flags['servet'])).toBe(afterTake - 10_000);
  });

  it('BEKLEMEK guveni asindiriyor', () => {
    const engine = ready();
    const { actorId } = withTrust(engine);
    engine.takeFavor(actorId, 30_000);
    const after = engine.snapshot().actors[actorId]!.trust;

    for (let i = 0; i < 25; i += 1) {
      if (engine.snapshot().ending !== undefined) break;
      engine.advanceTurn();
      for (let g = 0; g < 40; g += 1) {
        if (!engine.currentNode()) break;
        const open = engine.availableChoices().filter((ch) => !ch.locked);
        if (open.length === 0) break;
        engine.choose(open[0]!.id);
      }
    }

    expect(engine.snapshot().actors[actorId]!.trust).toBeLessThan(after);
  });

  it('SABIR BITINCE arkadaslik kopuyor ve iz kaliyor', () => {
    const engine = ready();
    const { actorId } = withTrust(engine);
    engine.takeFavor(actorId, 30_000);
    const trustBefore = engine.snapshot().actors[actorId]!.trust;
    // Alma turunu geriye cek: bekleme suresini beklemeden sinariz.
    const f = engine.snapshot().favors[0]!;
    (f as { takenTurn: number }).takenTurn = engine.snapshot().turn - PATIENCE_WEEKS;

    engine.advanceTurn();

    expect(engine.currentFavors()).toHaveLength(0);
    expect(engine.snapshot().flags['mem_arkadasligi_yakti']).toBe(true);
    // Mutlak esik degil DUSUS olculur: baslangic guveni senaryoya gore
    // degisir, kopusun bedeli degismez.
    expect(engine.snapshot().actors[actorId]!.trust).toBeLessThan(trustBefore - 20);
  });

  it('eski kayit borcsuz yuklenebiliyor', () => {
    const engine = ready();
    const save = JSON.parse(JSON.stringify(engine.save())) as { state: Record<string, unknown> };
    delete save.state['favors'];

    const fresh = new GameEngine(registry, { seed: 63, ...mock });
    expect(() => fresh.load(save as never)).not.toThrow();
    expect(fresh.currentFavors()).toEqual([]);
  });

  it('isim KAYITTA degil kadroda -- bayatlamaz', () => {
    const engine = ready();
    const { actorId } = withTrust(engine);
    const f = engine.takeFavor(actorId, 15_000);
    // Kaydedilen sey slot ve aktor kimligi; ad degil.
    expect(Object.keys(f)).not.toContain('name');
    expect(engine.personName(f.slotId)).toBeTruthy();
  });
});
