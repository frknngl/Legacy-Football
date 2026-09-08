import { describe, expect, it } from 'vitest';
import { StatureCalculator } from '../src/evaluation/StatureCalculator.js';
import { WeightExpressionEvaluator } from '../src/evaluation/WeightExpressionEvaluator.js';
import type { ProgressionConfig } from '../src/domain/orchestrator.js';

const config: ProgressionConfig = {
  statureThresholds: [
    { id: 'nobody', threshold: 0, label: 'Hickimse' },
    { id: 'local_talent', threshold: 60, label: 'Yerel yetenek' },
    { id: 'starter', threshold: 130, label: 'Ilk 11' },
    { id: 'star', threshold: 220, label: 'Yildiz' },
    { id: 'superstar', threshold: 330, label: 'Superstar' },
    { id: 'icon', threshold: 460, label: 'Ikon' },
    { id: 'legend', threshold: 620, label: 'Efsane' },
  ],
  clubTiers: [
    { id: 'amateur', label: 'Amator' },
    { id: 'lower', label: 'Alt lig' },
    { id: 'mid', label: 'Orta' },
    { id: 'contender', label: 'Sampiyonluk adayi' },
    { id: 'elite', label: 'Elit' },
  ],
  statureWeights: {
    taraftar_destegi: 1,
    medya_itibari: 1,
    piyasa_degeri: 0.000_02,
    kupa_sayisi: 25,
    milli_mac_sayisi: 1.5,
  },
  // ORAN: bir alt kademeye olan mesafenin yarisi kadar pay.
  hysteresis: 0.5,
  impossibleCells: [],
};

const calc = new StatureCalculator(config);

describe('StatureCalculator - turetilmis sohret', () => {
  it('sifir girdide hickimse', () => {
    expect(calc.rawLevel(calc.score({}))).toBe('nobody');
  });

  it('agirlikli toplami dogru hesaplar', () => {
    const score = calc.score({
      taraftar_destegi: 80,
      medya_itibari: 70,
      piyasa_degeri: 5_000_000,
      kupa_sayisi: 2,
      milli_mac_sayisi: 20,
    });
    // 80 + 70 + 100 + 50 + 30 = 330
    expect(score).toBe(330);
    expect(calc.rawLevel(score)).toBe('superstar');
  });
});

describe('StatureCalculator - HISTEREZIS', () => {
  it('yukselis ANINDA olur', () => {
    const flags = { taraftar_destegi: 90, medya_itibari: 90, kupa_sayisi: 2 };
    // 90 + 90 + 50 = 230 -> star
    expect(calc.next('nobody', flags)).toBe('star');
  });

  it('tek kotu sezonda ikon -> hickimse DUSUSU OLMAZ (en fazla tek basamak)', () => {
    // Ikon (460) iken skor 0’a cakiliyor.
    const crashed = calc.next('icon', {});
    expect(crashed).toBe('superstar');
    expect(crashed).not.toBe('nobody');
  });

  it('esigin hemen altinda seviye KORUNUR', () => {
    // star esigi 220, bir alt kademe (starter) 130 -> aralik 90, pay 45.
    // 175 puanin altina inmedikce star kalir.
    const flags = { taraftar_destegi: 95, medya_itibari: 85 }; // 180
    expect(calc.next('star', flags)).toBe('star');
  });

  it('histerezis payi asilinca tek basamak duser', () => {
    const flags = { taraftar_destegi: 80, medya_itibari: 70 }; // 150 < 175
    expect(calc.next('star', flags)).toBe('starter');
  });

  it('ORANSAL pay sayesinde en alt kademe ULASILABILIR kalir', () => {
    // Mutlak 60 puanlik pay, genisligi de 60 olan local_talent kademesinde
    // kapiyi 0 a indirirdi; pozitif skorlu hicbir oyuncu bir daha nobody
    // olamazdi. Oransal payda kapi 30 puandir.
    expect(calc.next('local_talent', { taraftar_destegi: 15, medya_itibari: 10 })).toBe('nobody');
    // 40 puan hala local_talent seviyesini tutar -- pay anlamli olmali.
    expect(calc.next('local_talent', { taraftar_destegi: 20, medya_itibari: 20 })).toBe(
      'local_talent',
    );
  });

  it('ard arda cagrilarak kademeli duser, ziplamaz', () => {
    let s = calc.next('icon', {});
    const path = [s];
    for (let i = 0; i < 6; i += 1) {
      s = calc.next(s, {});
      path.push(s);
    }
    expect(path).toEqual([
      'superstar',
      'star',
      'starter',
      'local_talent',
      'nobody',
      'nobody',
      'nobody',
    ]);
  });
});

describe('WeightExpressionEvaluator - stat agirlikli olasilik', () => {
  const evaluator = new WeightExpressionEvaluator();
  const penaltyScores = {
    base: 30,
    modifiers: [
      { flag: 'teknik', scale: 0.6 },
      { flag: 'moral', scale: 0.2 },
    ],
  };

  it('teknik 90 ile teknik 30 arasinda OLCULEBILIR fark uretir', () => {
    const good = evaluator.evaluate(penaltyScores, { teknik: 90, moral: 70 });
    const bad = evaluator.evaluate(penaltyScores, { teknik: 30, moral: 70 });
    expect(good).toBeGreaterThan(bad);
    expect(good - bad).toBeCloseTo(36, 5);
  });

  it('negatif agirlik 0’a kirpilir - imkansiz dal kuyrugu bozmaz', () => {
    expect(evaluator.evaluate({ base: 10, modifiers: [{ flag: 'x', scale: -5 }] }, { x: 100 })).toBe(
      0,
    );
  });

  it('modifier’i olmayan ifade base dondurur', () => {
    expect(evaluator.evaluate({ base: 42 }, {})).toBe(42);
  });

  it('tanimsiz flag 0 sayilir', () => {
    expect(evaluator.evaluate(penaltyScores, {})).toBe(30);
  });
});
