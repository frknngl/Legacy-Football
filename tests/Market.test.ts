/**
 * BORSA VE KRIPTO.
 *
 * KUMARDAN FARKI YAPISAL: kumar tek atistir, sonuc aninda belli olur ve
 * biter. Piyasa bir POZISYONDUR -- her hafta deger degistirir ve asil
 * karar "ne zaman cikacagin"dir. Ayni parayla ayni enstrumana giren iki
 * oyuncu, ne zaman sattiklarina gore bambaska yerlere varir.
 *
 * ENFLASYONLA BAG: Anadolu'da (%27,5) nakit erirken hisse nominal olarak
 * yukselir. "Enflasyondan hisseye kacmak" ancak bu bag varsa bir
 * stratejidir; yoksa hisse de nakitle birlikte erir ve secim kaybolur.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import {
  dividendFor,
  portfolioValue,
  rollCrash,
  stepPrice,
  tradeRejection,
  unrealised,
  type Instrument,
} from '../src/domain/market.js';
import { Rng } from '../src/selection/Rng.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;
let mock: MockWorld;

const endeks: Instrument = {
  id: 'e',
  label: 'E',
  kind: 'endeks',
  basePrice: 100,
  drift: 0.05,
  volatility: 0.018,
  dividend: 0.03,
  minWealth: 0,
};
const kripto: Instrument = {
  id: 'k',
  label: 'K',
  kind: 'kripto',
  basePrice: 100,
  drift: 0.25,
  volatility: 0.12,
  minWealth: 0,
};

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 51);
});

describe('Katalog', () => {
  it('icerikten yukleniyor -- enstrumanlar kodda degil', () => {
    expect(registry.config.markets.length).toBeGreaterThanOrEqual(4);
  });

  it('GETIRI OYNAKLIKLA ALINIYOR -- bedava getiri yok', () => {
    const sorted = [...registry.config.markets].sort((a, b) => a.drift - b.drift);
    // En dusuk getirili en az oynak, en yuksek getirili en oynak olmali.
    expect(sorted[0]!.volatility).toBeLessThan(sorted[sorted.length - 1]!.volatility);
  });

  it('kripto her hisseden DAHA oynak', () => {
    const cryptos = registry.config.markets.filter((i) => i.kind === 'kripto');
    const equities = registry.config.markets.filter((i) => i.kind !== 'kripto');
    expect(cryptos.length).toBeGreaterThan(0);
    const mostStable = Math.min(...cryptos.map((c) => c.volatility));
    const wildest = Math.max(...equities.map((e) => e.volatility));
    expect(mostStable).toBeGreaterThan(wildest);
  });

  it('KRIPTO TEMETTU ODEMEZ -- beklemek onun icin bedava degil', () => {
    for (const i of registry.config.markets) {
      if (i.kind === 'kripto') expect(i.dividend).toBeUndefined();
    }
  });

  it('daha riskli enstruman daha COK servet istiyor', () => {
    const sorted = [...registry.config.markets].sort((a, b) => a.volatility - b.volatility);
    expect(sorted[sorted.length - 1]!.minWealth).toBeGreaterThan(sorted[0]!.minWealth);
  });
});

describe('Fiyat matematigi', () => {
  it('ENFLASYON fiyata giriyor -- yoksa hisse de nakitle erirdi', () => {
    // Ayni tohum, tek fark enflasyon.
    const calm = stepPrice(endeks, 100, 0, 0.5);
    const hot = stepPrice(endeks, 100, 60, 0.5);
    expect(hot).toBeGreaterThan(calm);
  });

  it('ANADOLUda hisse nakitten hizli kosuyor', () => {
    // Enflasyon %27,5 -- bir sezon boyunca nakit sabit kalir, hisse
    // nominal olarak yukselir. Korunma araci olmasinin sarti bu.
    const rng = new Rng(9);
    let price = 100;
    for (let w = 0; w < 52; w += 1) price = stepPrice(endeks, price, 27.5, rng.next());
    expect(price).toBeGreaterThan(120);
  });

  it('kripto endeksten COK daha genis dagiliyor', () => {
    const spread = (inst: Instrument): number => {
      const rng = new Rng(3);
      let lo = Infinity;
      let hi = -Infinity;
      let price = 100;
      for (let w = 0; w < 300; w += 1) {
        price = stepPrice(inst, price, 5, rng.next());
        lo = Math.min(lo, price);
        hi = Math.max(hi, price);
      }
      return hi / lo;
    };
    expect(spread(kripto)).toBeGreaterThan(spread(endeks) * 2);
  });

  it('fiyat SIFIRA dusmuyor -- pozisyon yok olmaz', () => {
    const rng = new Rng(11);
    let price = 100;
    for (let w = 0; w < 2000; w += 1) {
      price = stepPrice(kripto, price, 0, rng.next());
      expect(price).toBeGreaterThan(0);
    }
  });

  it('cokus NADIR ama gercek; kripto DAHA SIK cokuyor', () => {
    let all = 0;
    let cryptoOnly = 0;
    const rng = new Rng(21);
    for (let i = 0; i < 20_000; i += 1) {
      const crash = rollCrash(rng.next());
      if (crash === undefined) continue;
      if (crash.hits.length > 1) all += 1;
      else cryptoOnly += 1;
    }
    expect(all).toBeGreaterThan(0);
    expect(cryptoOnly).toBeGreaterThan(all);
    // On bes sezon ~780 hafta; genel cokus ortalama 2-4 kez gorulmeli.
    expect((all / 20_000) * 780).toBeLessThan(6);
  });

  it('cokus yalnizca VURDUGU turu dusuruyor', () => {
    const crash = { severity: 0.5, hits: ['kripto' as const] };
    expect(stepPrice(kripto, 100, 0, 0.5, crash)).toBeLessThan(60);
    expect(stepPrice(endeks, 100, 0, 0.5, crash)).toBeGreaterThan(90);
  });
});

describe('Portfoy', () => {
  const priceOf = (id: string): number => (id === 'e' ? 200 : 50);

  it('deger birim x fiyat', () => {
    expect(portfolioValue([{ id: 'e', units: 10, avgCost: 100 }], priceOf)).toBe(2000);
  });

  it('kar ORTALAMA MALIYETE gore', () => {
    expect(unrealised({ id: 'e', units: 10, avgCost: 100 }, 200)).toBe(1000);
    expect(unrealised({ id: 'k', units: 10, avgCost: 100 }, 50)).toBe(-500);
  });

  it('temettu YALNIZCA odeyenden geliyor', () => {
    const both = dividendFor(
      [
        { id: 'e', units: 10, avgCost: 100 },
        { id: 'k', units: 10, avgCost: 100 },
      ],
      [endeks, kripto],
      priceOf,
    );
    const onlyEquity = dividendFor(
      [{ id: 'e', units: 10, avgCost: 100 }],
      [endeks, kripto],
      priceOf,
    );
    expect(both).toBe(onlyEquity);
    expect(both).toBeGreaterThan(0);
  });

  it('bilinmeyen enstruman temettu uretmiyor -- katalog degisirse cokmez', () => {
    expect(dividendFor([{ id: 'yok', units: 1, avgCost: 1 }], [endeks], priceOf)).toBe(0);
  });
});

describe('Alim reddi', () => {
  it('olmayan enstruman reddedilir', () => {
    expect(tradeRejection(undefined, 100, 1_000_000)).toBeDefined();
  });

  it('SERVET ESIGI var -- her masaya oturulmaz', () => {
    const gated = { ...kripto, minWealth: 500_000 };
    expect(tradeRejection(gated, 1000, 10_000)).toContain('500000');
    expect(tradeRejection(gated, 1000, 900_000)).toBeUndefined();
  });

  it('parasi olmayana satilmaz', () => {
    expect(tradeRejection(endeks, 5000, 1000)).toBe('Bu kadar paran yok.');
  });

  it('gecersiz tutar reddedilir', () => {
    expect(tradeRejection(endeks, 0, 10_000)).toBeDefined();
    expect(tradeRejection(endeks, Number.NaN, 10_000)).toBeDefined();
  });
});

describe('Motor baglantisi', () => {
  function rich(seed = 51): GameEngine {
    const engine = new GameEngine(registry, { seed, ...mock });
    engine.start('street');
    engine.snapshot().flags['servet'] = 20_000_000;
    return engine;
  }

  /**
   * N hafta ilerlet, acik kararlari kapat.
   *
   * `advanceTurn` acik bir karar varken atmaz -- karar kapanmadan hafta
   * gecmez. Politika SABIT (ilk acik secim) cunku burada olculen sey
   * icerik degil FIYAT; tohum ayni oldugu surece iki motor ayni yere
   * varmali.
   */
  function weeks(engine: GameEngine, n: number): void {
    for (let i = 0; i < n; i += 1) {
      if (engine.snapshot().ending !== undefined) return;
      engine.advanceTurn();
      for (let g = 0; g < 40; g += 1) {
        if (!engine.currentNode()) break;
        const open = engine.availableChoices().filter((ch) => !ch.locked);
        if (open.length === 0) break;
        engine.choose(open[0]!.id);
      }
    }
  }

  it('alim serveti dusuruyor ve AYRI kategoriye yaziliyor', () => {
    const engine = rich();
    const before = Number(engine.snapshot().flags['servet']);
    const inst = engine.marketQuotes()[0]!.instrument;

    engine.buyPosition(inst.id, 1_000_000);

    expect(Number(engine.snapshot().flags['servet'])).toBe(before - 1_000_000);
    // Kumarla ayni satirda GORUNMEMELI: yoksa "hangisi kazandiriyor"
    // sorusu cevapsiz kalir.
    const entries = engine.snapshot().wallet.filter((e) => e.kind === 'yatirim');
    expect(entries[0]!.amount).toBe(-1_000_000);
    expect(engine.snapshot().wallet.some((e) => e.kind === 'bahis')).toBe(false);
  });

  it('ORTALAMA MALIYET ikinci alimda guncelleniyor', () => {
    const engine = rich();
    const inst = engine.marketQuotes()[0]!.instrument;
    engine.buyPosition(inst.id, 500_000);
    const first = engine.marketQuotes().find((q) => q.instrument.id === inst.id)!;

    // Fiyat degissin diye birkac hafta gecir.
    weeks(engine, 10);
    engine.buyPosition(inst.id, 500_000);

    const after = engine.marketQuotes().find((q) => q.instrument.id === inst.id)!;
    expect(after.units!).toBeGreaterThan(first.units!);
  });

  it('YARIM satis pozisyonu acik birakiyor', () => {
    const engine = rich();
    const inst = engine.marketQuotes()[0]!.instrument;
    engine.buyPosition(inst.id, 1_000_000);
    const full = engine.marketQuotes().find((q) => q.instrument.id === inst.id)!.units!;

    engine.sellPosition(inst.id, 0.5);

    const left = engine.marketQuotes().find((q) => q.instrument.id === inst.id);
    expect(left?.units).toBeCloseTo(full / 2, 4);
  });

  it('tam satis pozisyonu KAPATIYOR', () => {
    const engine = rich();
    const inst = engine.marketQuotes()[0]!.instrument;
    engine.buyPosition(inst.id, 1_000_000);
    engine.sellPosition(inst.id, 1);
    expect(engine.marketQuotes().find((q) => q.instrument.id === inst.id)?.units).toBeUndefined();
  });

  it('olmayan pozisyon satilamaz', () => {
    expect(() => rich().sellPosition('endeks_ulusal')).toThrow();
  });

  it('PIYASA OYUNCUYU BEKLEMIYOR -- pozisyonun olmasa da yuruyor', () => {
    const engine = rich();
    const before = engine.marketQuotes().map((q) => q.price);
    weeks(engine, 12);
    const after = engine.marketQuotes().map((q) => q.price);
    expect(after).not.toEqual(before);
  });

  it('temettu DEFTERE yaziliyor', () => {
    const engine = rich();
    const payer = engine.marketQuotes().find((q) => q.instrument.dividend !== undefined)!;
    engine.buyPosition(payer.instrument.id, 5_000_000);

    weeks(engine, 1);

    const div = engine
      .snapshot()
      .wallet.filter((e) => e.kind === 'yatirim' && e.label === 'Temettu');
    expect(div.length).toBeGreaterThan(0);
    expect(div[0]!.amount).toBeGreaterThan(0);
  });

  it('AYNI TOHUM AYNI PIYASA -- kaydet/yukle fiyati degistirmiyor', () => {
    const a = rich(77);
    weeks(a, 15);
    const save = JSON.parse(JSON.stringify(a.save()));

    const b = new GameEngine(registry, { seed: 77, ...mock });
    b.load(save);
    weeks(a, 10);
    weeks(b, 10);
    expect(b.marketQuotes().map((q) => q.price)).toEqual(a.marketQuotes().map((q) => q.price));
  });

  it('eski kayit piyasasiz yuklenebiliyor', () => {
    const engine = rich();
    const save = JSON.parse(JSON.stringify(engine.save())) as { state: Record<string, unknown> };
    delete save.state['market'];

    const fresh = new GameEngine(registry, { seed: 51, ...mock });
    expect(() => fresh.load(save as never)).not.toThrow();
    expect(fresh.marketQuotes().every((q) => q.units === undefined)).toBe(true);
  });

  it('BUYUK VURGUN iz birakiyor -- icerik okuyabilsin', () => {
    const engine = rich();
    const inst = engine.marketQuotes()[0]!;
    engine.buyPosition(inst.instrument.id, 2_000_000);
    // Fiyati elle ikiye katla: iz mekanigini siniyoruz, sansi degil.
    engine.snapshot().market.prices[inst.instrument.id] = inst.price * 2;

    engine.sellPosition(inst.instrument.id, 1);

    expect(engine.snapshot().flags['mem_borsa_vurgunu']).toBe(true);
  });

  it('BUYUK ZARAR da iz birakiyor', () => {
    const engine = rich();
    const inst = engine.marketQuotes()[0]!;
    engine.buyPosition(inst.instrument.id, 2_000_000);
    engine.snapshot().market.prices[inst.instrument.id] = inst.price * 0.1;

    engine.sellPosition(inst.instrument.id, 1);

    expect(engine.snapshot().flags['mem_borsa_yandi']).toBe(true);
  });
});
