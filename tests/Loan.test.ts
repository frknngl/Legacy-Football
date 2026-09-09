/**
 * KREDI VE TEMERRUT.
 *
 * NEDEN VAR: `borc` bayragi kuruluydu ama yalnizca "paran yetmedi"
 * durumunda doluyordu; oyuncunun BILEREK borclanmasi mumkun degildi.
 * Oysa icerik borcu bol bol anlatiyor -- on borc temali `mem_*` bayragina
 * 58 sahne yaziyor ve olculdugunde HICBIRI okunmuyordu.
 *
 * Bedava yan etki: `evt_dark_betting_offer` zaten `borc >= 40000` ile
 * tetikleniyor. Yani borclanmak sike teklifi zincirini kendiliginden
 * aciyor -- yeni icerik yazmadan olu bir kapi aciliyor. Tefeciye temerrut
 * ise `mem_mafia_favor_owed` yaziyor; o iz de `evt_legal_mafia_collects`
 * tetiginin uc kosulundan biri ve HIC dolmuyordu.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { DEFAULT_THRESHOLD, latePenalty, loanOffers } from '../src/domain/loan.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;
let mock: MockWorld;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 53);
});

describe('Teklif uretimi', () => {
  it('gelirsiz oyuncuya kredi verilmiyor', () => {
    expect(loanOffers(0, 0)).toEqual([]);
  });

  it('banka tefeciden UCUZ ama tefeci daha hizli', () => {
    const [banka, tefeci] = loanOffers(10_000, 0);
    expect(banka!.lender).toBe('banka');
    expect(tefeci!.lender).toBe('tefeci');

    const bankaCost = banka!.total / banka!.principal;
    const tefeciCost = tefeci!.total / tefeci!.principal;
    expect(tefeciCost).toBeGreaterThan(bankaCost);
    expect(tefeci!.weeks).toBeLessThan(banka!.weeks);
  });

  it('mevcut borc kapasiteyi DUSURUYOR -- sonsuz para basilamaz', () => {
    const bos = loanOffers(10_000, 0);
    const borclu = loanOffers(10_000, 300_000);
    expect(borclu.length).toBeLessThan(bos.length);
  });

  it('kapasite bitince hicbir teklif kalmiyor', () => {
    expect(loanOffers(10_000, 5_000_000)).toEqual([]);
  });

  it('toplam geri odeme anaparadan BUYUK -- faiz gercek', () => {
    for (const o of loanOffers(10_000, 0)) {
      expect(o.total).toBeGreaterThan(o.principal);
      expect(o.weekly * o.weeks).toBeGreaterThanOrEqual(o.total);
    }
  });
});

describe('Gecikme cezasi', () => {
  it('tefeci bankadan sert', () => {
    const banka = latePenalty({ lender: 'banka', weekly: 1000, weeksLeft: 10, missed: 1 });
    const tefeci = latePenalty({ lender: 'tefeci', weekly: 1000, weeksLeft: 10, missed: 1 });
    expect(tefeci).toBeGreaterThan(banka);
  });
});

/**
 * Acik dugumleri kapatir. `false` donerse kilitlenme var ve tur
 * ILERLETILEMEZ -- motor acik karar varken advanceTurn'e izin vermiyor.
 */
function drain(engine: GameEngine): boolean {
  for (let g = 0; g < 40; g += 1) {
    if (!engine.currentNode()) return true;
    const open = engine.availableChoices().filter((c) => !c.locked);
    // Kilidi ZORLAMIYORUZ: motorun akisinda olmayan bir gecis yapmak
    // olculen dunyayi oynanandan ayirir.
    if (open.length === 0) return false;
    engine.choose(open[0]!.id);
  }
  return !engine.currentNode();
}

/** Kariyeri baslatir ve ilk turu bosaltir -- kredi almadan once sart. */
function started(seed: number): GameEngine {
  const engine = new GameEngine(registry, { seed, ...mock });
  engine.start('street');
  engine.advanceTurn();
  drain(engine);
  return engine;
}

/** N tur ilerletir; acik dugumleri kapatir. */
function run(engine: GameEngine, turns: number): void {
  for (let i = 0; i < turns; i += 1) {
    engine.advanceTurn();
    if (!drain(engine)) return;
    if (engine.snapshot().ending !== undefined) return;
  }
}

describe('Motor baglantisi', () => {
  it('kredi cekilince para ELINE geciyor, borc TOPLAM kadar artiyor', () => {
    const engine = started(53);

    // DIKKAT: `snapshot()` CANLI referans dondurur, kopya degil.
    // Sayilari once yakalamazsak mutasyondan SONRAKI degeri okuruz.
    const wealthBefore = Number(engine.snapshot().flags['servet']);
    const debtBefore = Number(engine.snapshot().flags['borc']);

    const offer = engine.loanOffers()[0];
    expect(offer).toBeDefined();
    engine.takeLoan(offer!);

    const after = engine.snapshot();
    expect(Number(after.flags['servet'])).toBe(wealthBefore + offer!.principal);
    expect(Number(after.flags['borc'])).toBe(debtBefore + offer!.total);
    expect(engine.currentLoan()).toBeDefined();
  });

  it('kredi cuzdan defterine yaziliyor', () => {
    const engine = started(53);
    engine.takeLoan(engine.loanOffers()[0]!);

    const entries = engine.snapshot().wallet.filter((e) => e.kind === 'kredi');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.amount).toBeGreaterThan(0);
  });

  it('ikinci kredi acikken alinamiyor', () => {
    const engine = started(53);
    engine.takeLoan(engine.loanOffers()[0]!);

    expect(engine.loanOffers()).toEqual([]);
  });

  it('taksitler odendikce borc AZALIYOR', () => {
    const engine = started(53);
    engine.takeLoan(engine.loanOffers()[0]!);

    const loan = engine.currentLoan()!;
    const debtAfterTaking = Number(engine.snapshot().flags['borc']);
    const weeksLeft = loan.weeksLeft;

    run(engine, 5);

    const now = engine.currentLoan();
    // Kredi ya ilerledi ya kapandi; ikisi de gecerli.
    if (now !== undefined) {
      expect(now.weeksLeft).toBeLessThan(weeksLeft);
      expect(Number(engine.snapshot().flags['borc'])).toBeLessThan(debtAfterTaking);
    }
  });
});

describe('Temerrut -- olu icerigi canlandirir', () => {
  /** Parasiz birakip taksiti kacirtir. */
  function starve(engine: GameEngine, turns: number): void {
    for (let i = 0; i < turns; i += 1) {
      const flags = engine.snapshot().flags;
      flags['servet'] = 0;
      // DIKKAT: maasi 0 YAPMA. `tickEconomy` maas <= 0 ise kulup
      // itibarindan YENIDEN TURETIYOR ve oyuncu zenginlesiyor; ilk
      // yazimda test tam bu yuzden dusmustu. 1 TL birakmak turetmeyi
      // engeller ve taksiti odenemez kilar.
      flags['haftalik_gelir'] = 1;
      engine.advanceTurn();
      if (!drain(engine)) return;
      if (engine.snapshot().ending !== undefined) return;
    }
  }

  it('tefeciye temerrut `mem_mafia_favor_owed` yaziyor -- HIC dolmayan tetik', () => {
    const engine = started(53);

    const tefeci = engine.loanOffers().find((o) => o.lender === 'tefeci');
    expect(tefeci).toBeDefined();
    engine.takeLoan(tefeci!);

    expect(engine.snapshot().flags['mem_mafia_favor_owed']).toBeFalsy();
    starve(engine, DEFAULT_THRESHOLD + 2);

    // `evt_legal_mafia_collects` tetiginin uc kosulundan biri budur ve
    // olcumde HIC dolmuyordu.
    expect(engine.snapshot().flags['mem_mafia_favor_owed']).toBe(true);
  });

  it('kacirilan taksit borcu BUYUTUYOR -- sarmal gercek', () => {
    const engine = started(53);
    engine.takeLoan(engine.loanOffers().find((o) => o.lender === 'tefeci')!);

    const before = Number(engine.snapshot().flags['borc']);
    starve(engine, 2);
    expect(Number(engine.snapshot().flags['borc'])).toBeGreaterThan(before);
  });

  it('borc `evt_dark_betting_offer` esigini gecebiliyor -- zincir aciliyor', () => {
    const engine = new GameEngine(registry, { seed: 53, ...mock });
    engine.start('street');
    // Yuksek gelir ver ki teklif de buyuk olsun.
    engine.snapshot().flags['haftalik_gelir'] = 6_000;
    engine.advanceTurn();

    const offer = engine.loanOffers().find((o) => o.lender === 'banka');
    expect(offer).toBeDefined();
    engine.takeLoan(offer!);

    // Sike teklifi sahnesi `borc >= 40000` ile tetikleniyor.
    expect(Number(engine.snapshot().flags['borc'])).toBeGreaterThanOrEqual(40_000);
  });
});

describe('Eski kayit uyumu', () => {
  it('kredisiz eski kayit yuklenebiliyor', () => {
    const engine = started(53);

    const save = JSON.parse(JSON.stringify(engine.save())) as { state: Record<string, unknown> };
    delete save.state['loan'];

    const fresh = new GameEngine(registry, { seed: 53, ...mock });
    expect(() => fresh.load(save as never)).not.toThrow();
    expect(fresh.currentLoan()).toBeUndefined();
  });
});

describe('BORC ZORUNLU DEGIL -- kimden, ne pahasina, ne zaman senin kararin', () => {
  /**
   * `servet` eskiden `shortfallTo: "borc"` tasiyordu: parasi yetmeyen bir
   * harcama sessizce borca donusuyordu. O borcun kimden alindigi, faizi ve
   * vadesi yoktu -- hicbir yerden gelen bir yuk.
   *
   * Oysa borc kolunun BUTUN anlami bu ucunde: bankadan mi tefeciden mi
   * arkadastan mi, ne pahasina, ne zaman. Otomatik yazilan borc o soruyu
   * yok ediyordu. Olculdu: 12 kariyerde hic kredi cekmeden bir kariyerde
   * 22.297 TL borc olusuyordu.
   */
  it('parasi yetmeyen secim KILITLENIR, borca donusmez', () => {
    const engine = started(31);
    const flags = engine.snapshot().flags;
    flags['servet'] = 0;
    const before = Number(flags['borc'] ?? 0);

    // Korpusta para harcayan 99 secim var; parasi sifir olan oyuncuya
    // hicbiri ACIK gorunmemeli.
    let sawLockedSpend = false;
    for (let i = 0; i < 200; i += 1) {
      if (engine.snapshot().ending !== undefined) break;
      engine.snapshot().flags['servet'] = 0;
      engine.advanceTurn();
      for (let g = 0; g < 40; g += 1) {
        if (!engine.currentNode()) break;
        const all = engine.availableChoices();
        if (all.some((c) => c.locked && c.lockLabel === '[Paran yetmiyor]')) {
          sawLockedSpend = true;
        }
        const open = all.filter((c) => !c.locked);
        if (open.length === 0) break;
        engine.choose(open[0]!.id);
      }
    }

    // Servet her turda sifirlandi; buna ragmen borc BUYUMEDI.
    expect(Number(engine.snapshot().flags['borc'] ?? 0)).toBe(before);
    expect(sawLockedSpend, 'para kilidi hic devreye girmedi -- test bir sey sinamiyor').toBe(true);
  });

  it('para kilidi hicbir sahneyi CIKISSIZ birakmiyor', () => {
    // Olculdu: harcama iceren 85 dugumun hicbirinde TUM secenekler para
    // harcamiyor. Yani kilit bir dugumu kapatamaz.
    const engine = started(31);
    for (let i = 0; i < 150; i += 1) {
      if (engine.snapshot().ending !== undefined) break;
      engine.snapshot().flags['servet'] = 0;
      engine.advanceTurn();
      for (let g = 0; g < 40; g += 1) {
        const node = engine.currentNode();
        if (!node) break;
        const all = engine.availableChoices();
        if (all.length > 0) {
          expect(
            all.some((c) => !c.locked),
            `${node.eventId}/${node.nodeId}: parasiz oyuncuya acik secenek kalmadi`,
          ).toBe(true);
        }
        const open = all.filter((c) => !c.locked);
        if (open.length === 0) break;
        engine.choose(open[0]!.id);
      }
    }
  });

  it('kilit sebebi PARA oldugunu soyluyor -- oyuncu ne yapacagini bilsin', () => {
    const engine = started(31);
    engine.snapshot().flags['servet'] = 0;
    for (let i = 0; i < 200; i += 1) {
      if (engine.snapshot().ending !== undefined) break;
      engine.snapshot().flags['servet'] = 0;
      engine.advanceTurn();
      for (let g = 0; g < 40; g += 1) {
        if (!engine.currentNode()) break;
        const hit = engine.availableChoices().find((c) => c.lockLabel === '[Paran yetmiyor]');
        if (hit !== undefined) {
          expect(hit.lockReason).toMatch(/TL eksik/);
          return;
        }
        const open = engine.availableChoices().filter((c) => !c.locked);
        if (open.length === 0) break;
        engine.choose(open[0]!.id);
      }
    }
    throw new Error('para kilidi hic gorulmedi');
  });

  it('BILEREK alinan borc hala calisiyor -- kisitlanan zorlama, secim degil', () => {
    const engine = started(31);
    engine.snapshot().flags['haftalik_gelir'] = 50_000;
    const offers = engine.loanOffers();
    expect(offers.length).toBeGreaterThan(0);

    engine.takeLoan(offers[0]!);

    expect(Number(engine.snapshot().flags['borc'])).toBeGreaterThan(0);
  });
});
