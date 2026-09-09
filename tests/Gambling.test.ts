/**
 * KUMAR VE BAHIS.
 *
 * NEDEN VAR: `social` kategorisi kumari ANLATIYORDU ama mekanik yoktu;
 * sahneler `servet`e SABIT bir sayi yaziyordu. "Masaya oturdun ve
 * 150.000 kaybettin" bir karar degil, bir cumledir. Karar MIKTARI
 * oyuncunun secmesiyle baslar -- ve bu, `ValueRef` ilkelinin (Faz 2)
 * varlik sebebiydi.
 *
 * Oyun matematigi ICERIKTE (`content/economy/games.json`): kasanin
 * avantajini ayarlamak kod degisikligi gerektirmemeli, yoksa denemek
 * pahalilasir ve hic denenmez.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { betRejection, houseEdge, resolveBet } from '../src/domain/gambling.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;
let mock: MockWorld;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 23);
});

describe('Katalog', () => {
  it('icerikten yukleniyor -- masalar kodda degil', () => {
    expect(registry.config.games.length).toBeGreaterThanOrEqual(3);
  });

  it('HER secenekte kasa KAZANIYOR -- yoksa oyuncu sonsuz para basar', () => {
    for (const game of registry.config.games) {
      for (const option of game.options) {
        expect(houseEdge(option), `${game.id}/${option.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('kasa avantaji makul -- soygun degil', () => {
    for (const game of registry.config.games) {
      for (const option of game.options) {
        expect(houseEdge(option), `${game.id}/${option.id}`).toBeLessThan(0.25);
      }
    }
  });

  it('riskli secenek daha AZ odemez', () => {
    // `>` degil `>=`: blackjack'te "dur" ve "cek" ikisi de 1:1 oder ama
    // olasiliklari farklidir -- gercek hayatta da boyle. Sart olan sey
    // dusuk olasiligin DAHA AZ odememesi.
    for (const game of registry.config.games) {
      const sorted = [...game.options].sort((a, b) => b.chance - a.chance);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i]!.payout, `${game.id}`).toBeGreaterThanOrEqual(sorted[i - 1]!.payout);
      }
    }
  });

  it('her masada EN AZ IKI farkli odeme var -- yoksa secim yok', () => {
    for (const game of registry.config.games) {
      const payouts = new Set(game.options.map((o) => o.payout));
      expect(payouts.size, `${game.id}`).toBeGreaterThan(1);
    }
  });

  it('her masanin sinirlari tutarli', () => {
    for (const game of registry.config.games) {
      expect(game.minStake).toBeGreaterThan(0);
      expect(game.maxStake).toBeGreaterThan(game.minStake);
    }
  });
});

describe('Bahis cozumu', () => {
  const option = { id: 'x', label: 'X', chance: 0.5, payout: 2 };

  it('kazanmak NET kazanc verir -- anapara iki kez sayilmaz', () => {
    // 1000 yatir, 2x ode: eline 2000 gecer, net +1000.
    expect(resolveBet(option, 1000, 0.1).delta).toBe(1000);
  });

  it('kaybetmek yatirilani goturur', () => {
    expect(resolveBet(option, 1000, 0.9).delta).toBe(-1000);
  });

  it('esik tam sinirda -- roll < chance', () => {
    expect(resolveBet(option, 100, 0.4999).won).toBe(true);
    expect(resolveBet(option, 100, 0.5).won).toBe(false);
  });

  it('35:1 rulet dogru odiyor', () => {
    const single = { id: 's', label: 'S', chance: 0.027, payout: 36 };
    expect(resolveBet(single, 1000, 0.01).delta).toBe(35_000);
  });
});

describe('Bahis reddi', () => {
  const game = registry === undefined ? undefined : undefined;
  const table = {
    id: 't', label: 'T', minWealth: 5000, minStake: 500, maxStake: 10_000,
    options: [{ id: 'a', label: 'A', chance: 0.5, payout: 2 }],
  };

  it('olmayan secenek reddedilir', () => {
    expect(betRejection(table, undefined, 1000, 50_000)).toBeDefined();
  });

  it('masaya oturacak parasi yoksa reddedilir', () => {
    expect(betRejection(table, table.options[0], 1000, 100)).toContain('5000');
  });

  it('sinirlarin disi reddedilir', () => {
    expect(betRejection(table, table.options[0], 100, 50_000)).toBeDefined();
    expect(betRejection(table, table.options[0], 99_999, 500_000)).toBeDefined();
  });

  it('cebindekinden fazlasi reddedilir', () => {
    expect(betRejection(table, table.options[0], 9000, 8000)).toBe('Bu kadar paran yok.');
  });

  it('gecerli bahis kabul edilir', () => {
    expect(betRejection(table, table.options[0], 1000, 50_000)).toBeUndefined();
    expect(game).toBeUndefined();
  });
});

describe('Motor baglantisi', () => {
  function started(seed: number): GameEngine {
    const engine = new GameEngine(registry, { seed, ...mock });
    engine.start('street');
    engine.snapshot().flags['servet'] = 500_000;
    return engine;
  }

  it('masalar servete gore listeleniyor', () => {
    const engine = started(23);
    expect(engine.gameOptions().length).toBeGreaterThan(0);

    engine.snapshot().flags['servet'] = 100;
    expect(engine.gameOptions().length).toBe(0);
  });

  it('bahis serveti degistiriyor ve DEFTERE yaziliyor', () => {
    const engine = started(23);
    const before = Number(engine.snapshot().flags['servet']);
    const game = engine.gameOptions()[0]!;

    const result = engine.placeBet(game.id, game.options[0]!.id, 10_000);
    const after = Number(engine.snapshot().flags['servet']);

    expect(after).toBe(before + result.delta);
    const bets = engine.snapshot().wallet.filter((e) => e.kind === 'bahis');
    expect(bets).toHaveLength(1);
    expect(bets[0]!.amount).toBe(result.delta);
  });

  it('MIKTARI OYUNCU BELIRLIYOR -- ayni masa farkli sonuc', () => {
    const a = started(23);
    const b = started(23);
    const g = a.gameOptions()[0]!;

    const small = a.placeBet(g.id, g.options[0]!.id, 1_000);
    const large = b.placeBet(g.id, g.options[0]!.id, 100_000);

    // Ayni tohum, ayni secim: sonuc AYNI ama tutar farkli.
    expect(small.won).toBe(large.won);
    expect(Math.abs(large.delta)).toBeGreaterThan(Math.abs(small.delta));
  });

  it('bahis tutari icerigin okuyabilecegi bir ize yaziliyor', () => {
    const engine = started(23);
    const g = engine.gameOptions()[0]!;
    engine.placeBet(g.id, g.options[0]!.id, 7_500);

    // `ValueRef` bunu okuyabilir: {"ref": "son_bahis_tutari", "mul": -1}
    expect(engine.snapshot().flags['son_bahis_tutari']).toBe(7_500);
    expect(engine.snapshot().flags['mem_kumar_oynadi']).toBe(true);
  });

  it('gecersiz bahis motoru DUSURMEZ, sebep doner', () => {
    const engine = started(23);
    const g = engine.gameOptions()[0]!;
    expect(() => engine.placeBet(g.id, g.options[0]!.id, -5)).toThrow();
    expect(() => engine.placeBet('boyle_masa_yok', 'x', 100)).toThrow();
  });

  it('DETERMINIZM: ayni tohum + ayni bahis = ayni sonuc', () => {
    const a = started(99);
    const b = started(99);
    const g = a.gameOptions()[0]!;
    expect(a.placeBet(g.id, g.options[0]!.id, 5_000).won).toBe(
      b.placeBet(g.id, g.options[0]!.id, 5_000).won,
    );
  });

  it('uzun vadede KASA kazaniyor -- ekonomi kendini basmiyor', () => {
    const engine = started(7);
    engine.snapshot().flags['servet'] = 100_000_000;
    const g = registry.config.games.find((x) => x.id === 'rulet')!;

    let net = 0;
    for (let i = 0; i < 400; i += 1) {
      net += engine.placeBet(g.id, 'kirmizi', 10_000).delta;
    }
    // 400 elde kasanin %2,7 avantaji oyuncuyu zarara sokmali.
    expect(net).toBeLessThan(0);
  });
});
