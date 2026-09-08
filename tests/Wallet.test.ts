/**
 * CUZDAN DEFTERI.
 *
 * OLCULEN SORUN: `servet` tek bir sayiydi. Kariyer boyunca 2.500'den
 * 10,5 milyona cikiyordu ama "para nereye gitti" sorusu HIC
 * cevaplanamiyordu -- ne oyuncu icin, ne dengeyi olcen icin.
 *
 * Bu, kumar/kredi/varlik mekaniklerinin ONKOSULU: kaybin gorunmedigi bir
 * ekonomide risk almak bir karar degil, gurultudur. Ruleti once yazip
 * defteri sonra eklemek, oyuncunun neden fakirlestigini anlamadigi bir
 * oyun uretirdi.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { WalletLedger } from '../src/runtime/WalletLedger.js';
import { WALLET_KINDS } from '../src/domain/wallet.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';
import { testState } from './helpers.js';
import type { SaveEnvelope } from '../src/domain/state.js';

let registry: ContentRegistry;
let mock: MockWorld;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 31);
});

describe('WalletLedger -- kayit', () => {
  it('hareket deftere ve toplamlara isliyor', () => {
    const s = testState();
    s.flags['servet'] = 50_000;
    WalletLedger.record(s, 12_000, 'maas', 'Haftalik maas');

    expect(s.wallet).toHaveLength(1);
    expect(s.wallet[0]!.amount).toBe(12_000);
    expect(s.wallet[0]!.kind).toBe('maas');
    expect(WalletLedger.net(s, 'maas')).toBe(12_000);
  });

  it('gelir ve gider AYRI birikiyor -- net tek basina yaniltir', () => {
    const s = testState();
    WalletLedger.record(s, 100_000, 'bahis', 'Kazanc');
    WalletLedger.record(s, -180_000, 'bahis', 'Kayip');

    expect(WalletLedger.net(s, 'bahis')).toBe(-80_000);
    // "80 bin kaybettim" ile "280 bin cevirdim, 80 bin batirdim" farkli
    // hikayelerdir; kumarin hacmi ayri gorunmeli.
    expect(s.walletTotals.bahis).toEqual({ inflow: 100_000, outflow: 180_000 });
  });

  it('sifir tutarli hareket YAZILMIYOR -- defteri bogar', () => {
    const s = testState();
    WalletLedger.record(s, 0, 'olay', 'hicbir sey');
    WalletLedger.record(s, 0.4, 'olay', 'yuvarlanınca sifir');
    expect(s.wallet).toHaveLength(0);
  });

  it('defter SINIRLI -- kayit dosyasi 30 sezonda sismiyor', () => {
    const s = testState();
    for (let i = 0; i < WalletLedger.LIMIT + 60; i += 1) {
      WalletLedger.record(s, 100, 'maas', `hafta ${i}`);
    }
    expect(s.wallet).toHaveLength(WalletLedger.LIMIT);
    // ...ama TOPLAM sinirdan bagimsiz: hepsi sayilmis olmali.
    expect(WalletLedger.net(s, 'maas')).toBe((WalletLedger.LIMIT + 60) * 100);
  });

  it('en yeni hareket basta doner', () => {
    const s = testState();
    WalletLedger.record(s, 1, 'olay', 'once');
    s.turn = 5;
    WalletLedger.record(s, 2, 'olay', 'sonra');
    expect(WalletLedger.recent(s, 1)[0]!.label).toBe('sonra');
  });

  it('bakiye damgasi hareketten SONRAKI degeri tasiyor', () => {
    const s = testState();
    s.flags['servet'] = 7_500;
    WalletLedger.record(s, -2_500, 'olay', 'rusvet');
    expect(s.wallet[0]!.balance).toBe(7_500);
  });
});

describe('WalletLedger -- motor baglantisi', () => {
  it('maas her tur deftere yaziliyor', () => {
    const engine = new GameEngine(registry, { seed: 31, ...mock });
    engine.start('street');

    for (let i = 0; i < 6; i += 1) {
      engine.advanceTurn();
      for (let g = 0; g < 40; g += 1) {
        if (!engine.currentNode()) break;
        const open = engine.availableChoices().filter((ch) => !ch.locked);
        if (open.length === 0) break;
        engine.choose(open[0]!.id);
      }
    }

    const state = engine.snapshot();
    const wages = state.wallet.filter((e) => e.kind === 'maas');
    expect(wages.length).toBeGreaterThanOrEqual(6);
    expect(WalletLedger.net(state, 'maas')).toBeGreaterThan(0);
  });

  it('defterdeki toplam servetteki degisimi ACIKLIYOR', () => {
    const engine = new GameEngine(registry, { seed: 31, ...mock });
    engine.start('street');
    const before = Number(engine.snapshot().flags['servet'] ?? 0);

    for (let i = 0; i < 30; i += 1) {
      engine.advanceTurn();
      for (let g = 0; g < 40; g += 1) {
        if (!engine.currentNode()) break;
        const open = engine.availableChoices().filter((ch) => !ch.locked);
        if (open.length === 0) break;
        engine.choose(open[0]!.id);
      }
      if (engine.snapshot().ending !== undefined) break;
    }

    const state = engine.snapshot();
    const after = Number(state.flags['servet'] ?? 0);
    const ledgerSum = state.wallet.reduce((sum, e) => sum + e.amount, 0);

    // Defter 30 turda sinira takilmadigi icin toplam TAM eslesmeli.
    // Eslesmiyorsa bir para yolu deftere baglanmamis demektir -- ve
    // "para nereye gitti" sorusu yine cevapsiz kalir.
    expect(state.wallet.length).toBeLessThan(WalletLedger.LIMIT);
    expect(ledgerSum).toBe(after - before);
  });
});

describe('Eski kayit uyumu', () => {
  it('cuzdansiz eski kayit yuklenebiliyor', () => {
    const engine = new GameEngine(registry, { seed: 31, ...mock });
    engine.start('street');
    engine.advanceTurn();

    const save = JSON.parse(JSON.stringify(engine.save())) as SaveEnvelope;
    // Eski kayitta bu alanlar hic YOKTU; taklit etmek icin siliyoruz.
    const loose = save.state as unknown as Record<string, unknown>;
    delete loose['wallet'];
    delete loose['walletTotals'];

    const fresh = new GameEngine(registry, { seed: 31, ...mock });
    expect(() => fresh.load(save)).not.toThrow();
    expect(fresh.snapshot().wallet).toEqual([]);

    // ...ve bundan SONRAKI hareketler yazilabilmeli.
    fresh.advanceTurn();
    expect(fresh.snapshot().wallet.length).toBeGreaterThan(0);
  });
});

describe('Kategori sozlesmesi', () => {
  it('her tur icin etiket tanimli', () => {
    for (const kind of WALLET_KINDS) {
      expect(WalletLedger.net(testState(), kind)).toBe(0);
    }
  });
});
