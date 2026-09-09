/**
 * AGIR SAKATLIK -- tedavi karari.
 *
 * OLCULEN SORUN: sakatlik vardi ama KARAR yoktu. Motor bir sayi
 * uretiyordu ("6 hafta yoksun"), oyuncu bekliyordu, bitiyordu.
 *
 * Ayrica `end_broken_body` sonlanmasi `mem_hid_injury` izini OKUYORDU
 * ama o izi YAZAN hicbir sey yoktu -- bir kariyer sonu erisilemezdi.
 *
 * Bu dosyanin isi uc yolun gercekten UC AYRI PARA BIRIMINDEN odedigini
 * sinamak: ameliyat ZAMAN, konservatif ORTA yol, gizlemek RISK.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import {
  collapseWeeks,
  collapses,
  defaultTreatment,
  fragilityAfter,
  fragilityRisk,
  healFragility,
  isSerious,
  recoveryWeeks,
  treatmentRejection,
} from '../src/domain/injury.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;
let mock: MockWorld;

const cfg = (): ReturnType<() => ContentRegistry['config']['treatments']> =>
  registry.config.treatments;
const byId = (id: string) => cfg().treatments.find((t) => t.id === id)!;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 91);
});

describe('Katalog', () => {
  it('icerikten yukleniyor -- denge kodda degil', () => {
    expect(cfg().treatments.length).toBeGreaterThanOrEqual(3);
    expect(cfg().seriousWeeks).toBeGreaterThan(0);
  });

  it('UC AYRI PARA BIRIMI -- ameliyat zaman, gizlemek risk', () => {
    const ameliyat = byId('ameliyat');
    const konservatif = byId('konservatif');
    const gizle = byId('gizle');

    // Ameliyat EN UZUN yokluk. Bedeli zaman.
    expect(ameliyat.weekMultiplier).toBeGreaterThan(konservatif.weekMultiplier);
    // Gizlemek HIC yokluk getirmez. Bedeli risk.
    expect(gizle.weekMultiplier).toBe(0);
    expect(gizle.collapseChance ?? 0).toBeGreaterThan(0);
    // Ameliyat tek basina kirilganligi DUSUREN yol.
    expect(ameliyat.fragilityHeal ?? 0).toBeGreaterThan(0);
    expect(konservatif.fragilityHeal ?? 0).toBe(0);
  });

  it('RISK ODEYEN en cok kirilganlik birakiyor', () => {
    expect(byId('gizle').fragility).toBeGreaterThan(byId('konservatif').fragility);
    expect(byId('konservatif').fragility).toBeGreaterThan(byId('ameliyat').fragility);
  });

  it('yalnizca ameliyat PARA istiyor', () => {
    expect(byId('ameliyat').cost ?? 0).toBeGreaterThan(0);
    expect(byId('konservatif').cost ?? 0).toBe(0);
  });

  it('karar verilmezse KONSERVATIF uygulanir -- kulup doktoru', () => {
    expect(defaultTreatment(cfg())?.id).toBe('konservatif');
  });
});

describe('Matematik', () => {
  it('HAFIF sakatlik karar sormuyor -- yoksa karar degersizlesir', () => {
    expect(isSerious(cfg().seriousWeeks - 1, cfg())).toBe(false);
    expect(isSerious(cfg().seriousWeeks, cfg())).toBe(true);
  });

  it('ameliyat sureyi UZATIYOR, gizlemek sifirliyor', () => {
    expect(recoveryWeeks(byId('ameliyat'), 8)).toBeGreaterThan(8);
    expect(recoveryWeeks(byId('konservatif'), 8)).toBe(8);
    expect(recoveryWeeks(byId('gizle'), 8)).toBe(0);
  });

  it('AMELIYAT birikmis kirilganligi dusuruyor', () => {
    // 40 kirilganlikla ameliyat olmak, kirilganligi AZALTMALI.
    expect(fragilityAfter(40, byId('ameliyat'))).toBeLessThan(40);
    // Konservatif ve gizleme artirir.
    expect(fragilityAfter(40, byId('konservatif'))).toBeGreaterThan(40);
    expect(fragilityAfter(40, byId('gizle'))).toBeGreaterThan(
      fragilityAfter(40, byId('konservatif')),
    );
  });

  it('kirilganlik 0-100 bandinda kaliyor', () => {
    expect(fragilityAfter(0, byId('ameliyat'))).toBeGreaterThanOrEqual(0);
    expect(fragilityAfter(98, byId('gizle'))).toBeLessThanOrEqual(100);
  });

  it('kirilganlik riske EKLENIYOR -- carpmiyor', () => {
    expect(fragilityRisk(0)).toBe(0);
    expect(fragilityRisk(60)).toBeGreaterThan(0);
    // Tavana tek basina yapistirmamali.
    expect(fragilityRisk(100)).toBeLessThan(60);
  });

  it('TEK YONLU MANDAL DEGIL -- saglikli haftada iyilesiyor', () => {
    // Bu projede ayni deseni dort kez duzeltmistik: yalnizca tirmanan
    // bir buyukluk kariyerin sonunda herkesi ayni yere goturur.
    expect(healFragility(30, cfg())).toBeLessThan(30);
    expect(healFragility(0, cfg())).toBe(0);
  });

  it('iyilesme YAVAS -- karar agirligini korumali', () => {
    let v = 30;
    for (let i = 0; i < 10; i += 1) v = healFragility(v, cfg());
    // On haftada yarisindan fazlasi durmali.
    expect(v).toBeGreaterThan(15);
  });

  it('cokus ERTELENEN faturayi faiziyle getiriyor', () => {
    expect(collapseWeeks(6)).toBeGreaterThan(6 * 2);
    expect(collapseWeeks(0)).toBeGreaterThanOrEqual(2);
  });

  it('cokus yalnizca GIZLEMEDE mumkun', () => {
    expect(collapses(byId('gizle'), 0.01)).toBe(true);
    expect(collapses(byId('gizle'), 0.99)).toBe(false);
    expect(collapses(byId('ameliyat'), 0.001)).toBe(false);
  });
});

describe('Ret', () => {
  const pending = { baseWeeks: 8, askedTurn: 0 };

  it('bekleyen karar yoksa secilemez', () => {
    expect(treatmentRejection(byId('ameliyat'), undefined, 9_999_999)).toBeDefined();
  });

  it('olmayan tedavi reddedilir', () => {
    expect(treatmentRejection(undefined, pending, 9_999_999)).toBeDefined();
  });

  it('PARASI YETMEYEN ameliyat olamaz', () => {
    expect(treatmentRejection(byId('ameliyat'), pending, 1000)).toContain('para');
    // Ama konservatif her zaman acik -- caresiz kalinmaz.
    expect(treatmentRejection(byId('konservatif'), pending, 0)).toBeUndefined();
  });
});

describe('Motor baglantisi', () => {
  function injured(seed = 91): GameEngine {
    const engine = new GameEngine(registry, { seed, ...mock });
    engine.start('street');
    engine.snapshot().flags['servet'] = 5_000_000;
    // Agir sakatligi elle kur: sansi degil MEKANIGI siniyoruz.
    engine.injuryState().pending = { baseWeeks: 8, askedTurn: engine.snapshot().turn };
    return engine;
  }

  it('AGIR sakatlik karar soruyor, hafif sormuyor', () => {
    const engine = new GameEngine(registry, { seed: 91, ...mock });
    engine.start('street');
    expect(engine.pendingTreatment()).toBeUndefined();
    expect(engine.treatmentOptions()).toHaveLength(0);
  });

  it('secenekler sure ve bedelle geliyor', () => {
    const options = injured().treatmentOptions();
    expect(options.length).toBeGreaterThanOrEqual(3);
    const ameliyat = options.find((o) => o.treatment.id === 'ameliyat')!;
    const gizle = options.find((o) => o.treatment.id === 'gizle')!;
    expect(ameliyat.weeks).toBeGreaterThan(8);
    expect(gizle.weeks).toBe(0);
  });

  it('AMELIYAT: para gidiyor, sure uzuyor, klinige giriyor', () => {
    const engine = injured();
    const before = Number(engine.snapshot().flags['servet']);

    engine.chooseTreatment('ameliyat');

    expect(Number(engine.snapshot().flags['servet'])).toBeLessThan(before);
    expect(Number(engine.snapshot().flags['injury_weeks'])).toBeGreaterThan(8);
    expect(engine.snapshot().lifeState).toBe('rehab_clinic');
    expect(engine.snapshot().flags['mem_ameliyat_oldu']).toBe(true);
    expect(engine.pendingTreatment()).toBeUndefined();
  });

  it('GIZLEME: sahada kaliyorsun ve `mem_hid_injury` yaziliyor', () => {
    // Bu iz `end_broken_body` tarafindan okunuyordu ama YAZAN yoktu.
    const engine = injured();

    engine.chooseTreatment('gizle');

    expect(engine.snapshot().flags['is_injured']).toBe(false);
    expect(Number(engine.snapshot().flags['injury_weeks'])).toBe(0);
    expect(engine.snapshot().flags['mem_hid_injury']).toBe(true);
    expect(engine.injuryState().hidden).toBe(true);
  });

  it('GIZLENMIS sakatlik her hafta bedel odetiyor', () => {
    const engine = injured();
    engine.snapshot().flags['kondisyon'] = 90;
    engine.chooseTreatment('gizle');

    engine.advanceTurn();

    expect(Number(engine.snapshot().flags['kondisyon'])).toBeLessThan(90);
  });

  it('KARAR VERILMEZSE kulup doktoru karar veriyor -- oyun kilitlenmiyor', () => {
    const engine = injured();
    expect(engine.pendingTreatment()).toBeDefined();

    engine.advanceTurn();

    expect(engine.pendingTreatment()).toBeUndefined();
    expect(Number(engine.snapshot().flags['sakatlik_kirilganligi'])).toBeGreaterThan(0);
  });

  it('KIRILGANLIK sakatlik riskine giriyor', () => {
    const a = new GameEngine(registry, { seed: 91, ...mock });
    a.start('street');
    a.advanceTurn();
    const cleanRisk = Number(a.snapshot().flags['sakatlik_riski']);

    const b = new GameEngine(registry, { seed: 91, ...mock });
    b.start('street');
    b.injuryState().fragility = 60;
    b.advanceTurn();

    expect(Number(b.snapshot().flags['sakatlik_riski'])).toBeGreaterThan(cleanRisk);
  });

  it('eski kayit sakatliksiz yuklenebiliyor', () => {
    const engine = injured();
    const save = JSON.parse(JSON.stringify(engine.save())) as { state: Record<string, unknown> };
    delete save.state['injury'];

    const fresh = new GameEngine(registry, { seed: 91, ...mock });
    expect(() => fresh.load(save as never)).not.toThrow();
    expect(fresh.injuryState().fragility).toBe(0);
  });
});
