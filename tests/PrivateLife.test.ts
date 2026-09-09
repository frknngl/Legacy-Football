/**
 * OZEL HAYAT.
 *
 * NEDEN YENI BIR ZINCIR KURMUYOR: motorda zaten kurulu ve olculmus bir
 * yol var --
 *
 *   iliski_aile -> moraleTarget -> moral -> heroDayFactor -> nitelikler
 *   -> mac reytingi -> form -> (geri) moraleTarget
 *
 * Ozel hayat bu yolun GIRISINE yazar. Ayri bir "form bonusu" eklemek
 * ayni sonucu verirdi ama iki ayri gercek uretirdi.
 *
 * ASIL KITLIK ZAMAN: her temasin bedeli kondisyon ve tukenmislik
 * uzerinden odenir. Bu dosyanin isi dort asimetrinin gercekten
 * calistigini sinamak -- yoksa ozel hayat bir sayac olur, karar degil.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import {
  BREAKUP_PATIENCE,
  BREAKUP_STRAIN,
  closenessGain,
  contactRejection,
  familyScore,
  nextStage,
  separationCost,
  shouldBreakUp,
  stageIndex,
  strainRelief,
  weeklyDrift,
  type PrivateLifeState,
} from '../src/domain/privateLife.js';
import { moraleTarget } from '../src/runtime/ChemistryTracker.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;
let mock: MockWorld;

const pl = (over: Partial<PrivateLifeState> = {}): PrivateLifeState => ({
  stage: 'iliski',
  closeness: 60,
  strain: 10,
  lastContactTurn: 0,
  stageSince: 0,
  unanswered: 0,
  usedThisWeek: {},
  highStrainWeeks: 0,
  ...over,
});

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 71);
});

describe('Katalog', () => {
  it('icerikten yukleniyor -- denge kodda degil', () => {
    expect(registry.config.privateLife.contacts.length).toBeGreaterThanOrEqual(4);
    expect(registry.config.privateLife.stages.length).toBeGreaterThanOrEqual(2);
  });

  it('VEREN COK ALIR -- bedava yakinlik yok', () => {
    const cs = [...registry.config.privateLife.contacts].sort((a, b) => a.closeness - b.closeness);
    const cheapest = cs[0]!;
    const richest = cs[cs.length - 1]!;
    // En cok veren, en cok kondisyon/tukenmislik hareketi de yapmali.
    const weight = (k: typeof cheapest): number =>
      Math.abs(k.kondisyon) + Math.abs(k.tukenmislik);
    expect(weight(richest)).toBeGreaterThan(weight(cheapest));
  });

  it('BULUSMA tukenmisligi DUSURUR ama kondisyonu yer', () => {
    // Dinlenmek ile gec yatmak ayni gecede olur -- asimetri #2.
    const aksam = registry.config.privateLife.contacts.find((c) => c.id === 'aksam')!;
    expect(aksam.tukenmislik).toBeLessThan(0);
    expect(aksam.kondisyon).toBeLessThan(0);
  });

  it('TAVAN MERDIVENI var -- ucuz temas her seyi cozemez', () => {
    const cs = registry.config.privateLife.contacts;
    const mesaj = cs.find((c) => c.id === 'mesaj')!;
    const arama = cs.find((c) => c.id === 'arama')!;
    const aksam = cs.find((c) => c.id === 'aksam')!;
    expect(mesaj.maxCloseness!).toBeLessThan(arama.maxCloseness!);
    expect(arama.maxCloseness!).toBeLessThan(aksam.maxCloseness ?? 100);
    // Evlilik esigi, ucuz temaslarin tavaninin USTUNDE olmali -- yoksa
    // mesajla evlenilir.
    const evlilik = registry.config.privateLife.stages.find((r) => r.to === 'evli')!;
    expect(evlilik.minCloseness).toBeGreaterThan(arama.maxCloseness!);
  });

  it('asamalar SIRALI ve zaman istiyor', () => {
    for (const rule of registry.config.privateLife.stages) {
      expect(stageIndex(rule.to)).toBeGreaterThan(stageIndex(rule.from));
      expect(rule.minWeeks).toBeGreaterThan(0);
    }
  });
});

describe('Yakinlik matematigi', () => {
  const kind = registry === undefined ? undefined : undefined;

  it('AZALAN GETIRI -- yuksekken ayni jest daha az sey ifade eder', () => {
    const mesaj = registry.config.privateLife.contacts[0]!;
    expect(closenessGain(mesaj, 20)).toBeGreaterThan(closenessGain(mesaj, 90));
    expect(kind).toBeUndefined();
  });

  it('temas gerginligi DUSURUR ama silmez', () => {
    const aksam = registry.config.privateLife.contacts.find((c) => c.id === 'aksam')!;
    const relief = strainRelief(aksam);
    expect(relief).toBeLessThan(0);
    expect(Math.abs(relief)).toBeLessThan(aksam.closeness);
  });
});

describe('Ihmal ve mesafe', () => {
  // roll 0,5 = ortalama hafta. Cekimin kendisi ayri sinaniyor.
  const ctx = { turn: 0, lifeState: 'playing', mediaPressure: 30, roll: 0.5 };

  it('ILK HAFTALAR bedelsiz -- kimse her hafta aranmak zorunda degil', () => {
    const drift = weeklyDrift(pl(), { ...ctx, turn: 2 });
    // Yakinlik erimez...
    expect(drift.closeness).toBe(0);
    // ...ve gerginlik TIRMANMAZ; aksine coker.
    expect(drift.strain).toBeLessThanOrEqual(0);
  });

  it('sessizlik uzadikca YIPRATIR', () => {
    const kisa = weeklyDrift(pl(), { ...ctx, turn: 5 });
    const uzun = weeklyDrift(pl(), { ...ctx, turn: 12 });
    expect(uzun.closeness).toBeLessThan(kisa.closeness);
    expect(uzun.strain).toBeGreaterThan(kisa.strain);
  });

  it('UZAKTAYKEN iki kat hizli', () => {
    const evde = weeklyDrift(pl(), { ...ctx, turn: 10 });
    const kampta = weeklyDrift(pl(), { ...ctx, turn: 10, lifeState: 'national_duty' });
    expect(kampta.closeness).toBeLessThan(evde.closeness);
    expect(kampta.strain).toBeGreaterThan(evde.strain);
  });

  it('SAKATKEN toparlar -- kariyerin en kotu donemi ozel hayatin en iyisi olabilir', () => {
    // Asimetri #4, kasitli.
    const drift = weeklyDrift(pl({ lastContactTurn: 1 }), {
      ...ctx,
      turn: 2,
      lifeState: 'injured',
    });
    expect(drift.closeness).toBeGreaterThan(0);
    expect(drift.strain).toBeLessThan(0);
  });

  it('BASIN yipratir -- o bunu hic secmedi', () => {
    const sakin = weeklyDrift(pl(), { ...ctx, turn: 1, mediaPressure: 20 });
    const firtina = weeklyDrift(pl(), { ...ctx, turn: 1, mediaPressure: 90 });
    expect(firtina.strain).toBeGreaterThan(sakin.strain);
  });

  it('CEVAPSIZ mesaj gerginligi kendi kendine buyutur', () => {
    const temiz = weeklyDrift(pl(), { ...ctx, turn: 1 });
    const birikmis = weeklyDrift(pl({ unanswered: 4 }), { ...ctx, turn: 1 });
    expect(birikmis.strain).toBeGreaterThan(temiz.strain);
  });

  it('EVLILIK zemin saglar -- ayni ihmal daha yavas yipratir', () => {
    const iliski = weeklyDrift(pl({ stage: 'iliski' }), { ...ctx, turn: 12 });
    const evli = weeklyDrift(pl({ stage: 'evli' }), { ...ctx, turn: 12 });
    expect(evli.strain).toBeLessThan(iliski.strain);
  });

it('TEMAS VARSA gerginlik kendiliginden cokuyor -- tek yonlu mandal degil', () => {
    // Moral, sponsor ve medyada ayni deseni uc kez duzeltmistik: yalnizca
    // tirmanan bir buyukluk kariyerin sonunda herkesi ayni yere goturur.
    const drift = weeklyDrift(pl({ strain: 40, lastContactTurn: 9 }), { ...ctx, turn: 10 });
    expect(drift.strain).toBeLessThan(0);
  });

  it('HAFTALAR birbirine benzemiyor -- cekim yipranmayi olcekliyor', () => {
    const iyi = weeklyDrift(pl(), { ...ctx, turn: 20, roll: 0 });
    const kotu = weeklyDrift(pl(), { ...ctx, turn: 20, roll: 0.99 });
    expect(kotu.strain).toBeGreaterThan(iyi.strain);
    expect(kotu.closeness).toBeLessThan(iyi.closeness);
  });

  it('cekim TOPARLANMAYA dokunmuyor -- iyi niyet sansa birakilmaz', () => {
    const a = weeklyDrift(pl({ strain: 40, lastContactTurn: 9 }), { ...ctx, turn: 10, roll: 0 });
    const b = weeklyDrift(pl({ strain: 40, lastContactTurn: 9 }), { ...ctx, turn: 10, roll: 0.99 });
    expect(a.strain).toBe(b.strain);
  });

  it('kimse yoksa kayma da yok', () => {
    expect(weeklyDrift(pl({ stage: 'yok' }), { ...ctx, turn: 50 })).toEqual({
      closeness: 0,
      strain: 0,
      reachedOut: false,
    });
  });
});

describe('Moral zemini', () => {
  it('GERGINLIK yakinliktan dusuluyor -- yakin ama gergin, uzak ve sakinden kotu', () => {
    const yakinGergin = familyScore(pl({ closeness: 90, strain: 80 }));
    const uzakSakin = familyScore(pl({ closeness: 60, strain: 0 }));
    expect(uzakSakin).toBeGreaterThan(yakinGergin);
  });

  it('AYRILIK zemini dusuruyor', () => {
    expect(familyScore(pl({ stage: 'ayrilik' }))).toBeLessThan(
      familyScore(pl({ stage: 'yok' })),
    );
  });

  it('MORAL HEDEFINE gercekten baglaniyor -- zincirin sinandigi yer', () => {
    // Ozel hayatin butun mekanigi bu tek baglantida anlam kazaniyor.
    const iyi = moraleTarget(50, 50, familyScore(pl({ closeness: 95, strain: 0 })));
    const kotu = moraleTarget(50, 50, familyScore(pl({ closeness: 20, strain: 70 })));
    expect(iyi).toBeGreaterThan(kotu);
  });
});

describe('Asama ve ayrilik', () => {
  it('asama ZAMAN ve YAKINLIK birlikte istiyor', () => {
    const cfg = registry.config.privateLife;
    // Yakinlik yeter ama zaman yetmez.
    expect(nextStage(pl({ stage: 'tanisma', closeness: 99 }), cfg, 1)).toBeUndefined();
    // Zaman yeter ama yakinlik yetmez.
    expect(nextStage(pl({ stage: 'tanisma', closeness: 10 }), cfg, 500)).toBeUndefined();
    // Ikisi de yeter.
    expect(nextStage(pl({ stage: 'tanisma', closeness: 99 }), cfg, 500)).toBeDefined();
  });

  it('GERGINKEN kimse bir sonraki adimi atmaz', () => {
    const cfg = registry.config.privateLife;
    expect(nextStage(pl({ stage: 'tanisma', closeness: 99, strain: 70 }), cfg, 500)).toBeUndefined();
  });

  it('ayrilik SABIR ister -- tek kotu hafta bitirmez', () => {
    expect(shouldBreakUp(pl({ strain: BREAKUP_STRAIN }), 1)).toBe(false);
    expect(shouldBreakUp(pl({ strain: BREAKUP_STRAIN }), BREAKUP_PATIENCE)).toBe(true);
    expect(shouldBreakUp(pl({ strain: 50 }), 99)).toBe(false);
  });

  it('EVLILIGIN bedeli var -- mal paylasimi', () => {
    expect(separationCost('evli', 1_000_000)).toBeGreaterThan(0);
    expect(separationCost('iliski', 1_000_000)).toBe(0);
    expect(separationCost('birlikte', 1_000_000)).toBe(0);
  });
});

describe('Ret', () => {
  it('kimse yokken temas kurulamaz', () => {
    const mesaj = registry.config.privateLife.contacts[0]!;
    expect(contactRejection(mesaj, pl({ stage: 'yok' }), 'playing', false)).toBeDefined();
    expect(contactRejection(mesaj, pl({ stage: 'ayrilik' }), 'playing', false)).toBeDefined();
  });

  it('UZAKTAYKEN bulusulamaz ve sebep SOYLENIR', () => {
    const aksam = registry.config.privateLife.contacts.find((c) => c.id === 'aksam')!;
    const reason = contactRejection(aksam, pl(), 'national_duty', false);
    expect(reason).toContain('Uzaktasin');
  });

  it('sezon ortasinda TATIL olmaz', () => {
    const tatil = registry.config.privateLife.contacts.find((c) => c.id === 'tatil')!;
    expect(contactRejection(tatil, pl(), 'playing', false)).toBeDefined();
    expect(contactRejection(tatil, pl(), 'playing', true)).toBeUndefined();
  });

  it('HAFTALIK SINIR var', () => {
    const aksam = registry.config.privateLife.contacts.find((c) => c.id === 'aksam')!;
    const used = pl({ usedThisWeek: { aksam: 1 } });
    expect(contactRejection(aksam, used, 'playing', false)).toContain('zaten');
  });

  it('erken asamada bulusma yok', () => {
    const aksam = registry.config.privateLife.contacts.find((c) => c.id === 'aksam')!;
    expect(contactRejection(aksam, pl({ stage: 'tanisma' }), 'playing', false)).toBeDefined();
  });
});

describe('Motor baglantisi', () => {
  function started(seed = 71): GameEngine {
    const engine = new GameEngine(registry, { seed, ...mock });
    engine.start('street');
    return engine;
  }

  /** Bir hafta ilerlet, acik karari kapat. */
  function week(engine: GameEngine): void {
    if (engine.snapshot().ending !== undefined) return;
    engine.advanceTurn();
    for (let g = 0; g < 40; g += 1) {
      if (!engine.currentNode()) break;
      const open = engine.availableChoices().filter((ch) => !ch.locked);
      if (open.length === 0) break;
      engine.choose(open[0]!.id);
    }
  }

  it('kariyer TANISMA ile basliyor', () => {
    expect(started().privateLife().stage).toBe('tanisma');
  });

  it('ARAMA bacaklari yormaz -- bedeli zaman, kondisyon degil', () => {
    const engine = started();
    const f = engine.snapshot().flags;
    f['kondisyon'] = 80;
    f['tukenmislik'] = 50;
    const before = engine.privateLife().closeness;

    engine.contactPartner('arama');

    expect(engine.privateLife().closeness).toBeGreaterThan(before);
    expect(Number(engine.snapshot().flags['kondisyon'])).toBe(80);
    // Yirmi dakika konusmak dinlendirir.
    expect(Number(engine.snapshot().flags['tukenmislik'])).toBeLessThan(50);
  });

  it('BULUSMA kondisyon odetiyor -- gec yatmanin bedeli var', () => {
    const engine = started();
    const f = engine.snapshot().flags;
    f['kondisyon'] = 80;
    f['tukenmislik'] = 50;
    engine.privateLife().stage = 'iliski';

    engine.contactPartner('aksam');

    expect(Number(engine.snapshot().flags['kondisyon'])).toBeLessThan(80);
    // Ama dinlendirir de: ikisi ayni gecede olur.
    expect(Number(engine.snapshot().flags['tukenmislik'])).toBeLessThan(50);
  });

  it('MESAJLA ILISKI YURUMEZ -- tavan merdiveni', () => {
    // Olculdu: tavan yokken dort haftada bir atilan BEDAVA bir mesaj
    // yakinligi 100'e cikariyor, evlilige goturuyor ve hicbir bedel
    // odetmiyordu -- ustelik sonucu her hafta bulusandan iyiydi. Yani en
    // ucuz strateji en iyisiydi ve geri kalan her sey olu secenekti.
    const engine = started();
    const mesaj = registry.config.privateLife.contacts.find((c) => c.id === 'mesaj')!;
    engine.privateLife().closeness = mesaj.maxCloseness!;

    engine.contactPartner('mesaj');

    expect(engine.privateLife().closeness).toBe(mesaj.maxCloseness);
  });

  it('temas `iliski_aile` uzerinden MORALE baglaniyor', () => {
    const engine = started();
    engine.snapshot().flags['kondisyon'] = 90;
    // Once ihmal edilmis bir iliski kur.
    engine.privateLife().closeness = 20;
    engine.privateLife().strain = 60;
    week(engine);
    const kotuZemin = Number(engine.snapshot().flags['iliski_aile']);

    engine.privateLife().closeness = 95;
    engine.privateLife().strain = 0;
    week(engine);
    const iyiZemin = Number(engine.snapshot().flags['iliski_aile']);

    expect(iyiZemin).toBeGreaterThan(kotuZemin);
  });

  it('HAFTALIK SINIR tur donunce sifirlaniyor', () => {
    const engine = started();
    engine.snapshot().flags['kondisyon'] = 90;
    engine.contactPartner('arama');
    engine.contactPartner('arama');
    expect(() => engine.contactPartner('arama')).toThrow();

    week(engine);

    expect(() => engine.contactPartner('arama')).not.toThrow();
  });

  it('IHMAL edilen iliski gercekten eriyor', () => {
    const engine = started();
    const before = engine.privateLife().closeness;
    for (let i = 0; i < 30; i += 1) week(engine);
    expect(engine.privateLife().closeness).toBeLessThan(before);
    expect(engine.privateLife().strain).toBeGreaterThan(0);
  });

  it('AYRILIK gerceklesiyor ve iz birakiyor', () => {
    const engine = started();
    const life = engine.privateLife();
    life.strain = 99;
    life.highStrainWeeks = BREAKUP_PATIENCE;

    week(engine);

    expect(engine.privateLife().stage).toBe('ayrilik');
    expect(engine.snapshot().flags['mem_ayrilik']).toBe(true);
  });

  it('EVLIYKEN ayrilik SERVETTEN goturuyor', () => {
    const engine = started();
    engine.snapshot().flags['servet'] = 1_000_000;
    const life = engine.privateLife();
    life.stage = 'evli';
    life.strain = 99;
    life.highStrainWeeks = BREAKUP_PATIENCE;

    week(engine);

    expect(Number(engine.snapshot().flags['servet'])).toBeLessThan(1_000_000);
    const split = engine.snapshot().wallet.filter((e) => e.label === 'Mal paylasimi');
    expect(split.length).toBe(1);
  });

  it('KACAMAK iz birakiyor -- icerik okuyabilsin', () => {
    const engine = started();
    engine.snapshot().flags['kondisyon'] = 90;
    engine.privateLife().stage = 'iliski';

    engine.contactPartner('kacamak');

    expect(engine.snapshot().flags['mem_mac_gecesi_kacti']).toBe(true);
  });

  it('secenekler SEBEBIYLE geliyor -- kisitlama bir hikaye', () => {
    const engine = started();
    const blocked = engine.contactOptions().filter((o) => !o.available);
    expect(blocked.length).toBeGreaterThan(0);
    for (const b of blocked) expect(b.reason).toBeTruthy();
  });

  it('eski kayit ozel hayatsiz yuklenebiliyor', () => {
    const engine = started();
    const save = JSON.parse(JSON.stringify(engine.save())) as { state: Record<string, unknown> };
    delete save.state['privateLife'];

    const fresh = new GameEngine(registry, { seed: 71, ...mock });
    expect(() => fresh.load(save as never)).not.toThrow();
    expect(fresh.privateLife().stage).toBe('tanisma');
  });

  it('AYNI TOHUM ayni ozel hayat -- kaydet/yukle degistirmiyor', () => {
    const a = started(88);
    for (let i = 0; i < 12; i += 1) week(a);
    const save = JSON.parse(JSON.stringify(a.save()));
    const b = new GameEngine(registry, { seed: 88, ...mock });
    b.load(save);
    expect(b.privateLife()).toEqual(a.privateLife());
  });
});
