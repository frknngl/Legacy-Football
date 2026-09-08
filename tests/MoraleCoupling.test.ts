/**
 * MORAL -> SAHA BAGI.
 *
 * OLCULEN SORUN (uc katmanli):
 *
 *   1. Carpan YANLIS ALANA uygulaniyordu. `heroAsFieldPlayer` gunun
 *      formunu yalnizca `quality`ye biniyordu; ama simulasyonun okudugu
 *      alan `attributes`:
 *        computeLines  -> goalkeeping / defending / passing / shooting
 *        pickShooter   -> attributes.shooting
 *        pickAssister  -> attributes.passing
 *      `quality` yalnizca `composure` olarak tek yerde okunuyordu.
 *      Olculdu: 500 macta moral 0 ile 100 arasinda HICBIR FARK YOKTU
 *      (106 gol / 28 asist / 6.258 reyting -- bire bir ayni).
 *
 *   2. Reyting OLAY-GUDUMLUYDU. Herkes 6.0'dan basliyor, uzerine gol ve
 *      asist ekleniyordu. Yani "bugun nasil oynadigin" oyuncunun her mac
 *      sonunda GORDUGU sayiya hic yansimiyordu -- ve `form` bayragi da
 *      bu reytinglerden turedigi icin dongu hic kapanmiyordu.
 *
 *   3. Moral TEK YONLU bir mandaldi. Icerik 93 pozitif (+850) karsilik
 *      503 negatif (-5329) efekt yaziyor ve toparlanma yoktu; 6
 *      kariyerlik olcumde moralin MEDYANI 0 cikti (p25 0, p75 8).
 *
 * Duzeltme sonrasi olculdu: moral 0->100 reytingi 6.06 -> 6.58 tasiyor,
 * kariyer icindeki moral medyani 0 -> 23 cikti ve bayrak 0.8-90.5
 * bandinda GERCEKTEN hareket ediyor.
 */

import { describe, expect, it } from 'vitest';
import { heroAsFieldPlayer, heroBaseRating, heroDayFactor } from '../src/simulation/TeamModel.js';
import { moraleRecovery, moraleTarget } from '../src/runtime/ChemistryTracker.js';
import { FlagRegistry } from '../src/domain/flags.js';
import type { HeroProfile } from '../src/domain/match.js';

const hero = (over: Partial<HeroProfile> = {}): HeroProfile => ({
  position: 'FW',
  technical: 70,
  physical: 70,
  form: 50,
  stamina: 80,
  stature: 'starter',
  morale: 50,
  isCaptain: false,
  ...over,
});

describe('Gunun formu niteliklere biniyor', () => {
  it('moral NITELIKLERI degistiriyor -- yalnizca quality degil', () => {
    const low = heroAsFieldPlayer(hero({ morale: 0 }), 'H');
    const high = heroAsFieldPlayer(hero({ morale: 100 }), 'H');

    // Kritik: simulasyon `attributes.shooting`i okuyor. Eskiden bu iki
    // deger AYNIYDI ve moral sahaya hic ulasmiyordu.
    expect(high.attributes.shooting).toBeGreaterThan(low.attributes.shooting);
    expect(high.attributes.passing).toBeGreaterThan(low.attributes.passing);
    expect(high.quality).toBeGreaterThan(low.quality);
  });

  it('form de niteliklere biniyor', () => {
    const low = heroAsFieldPlayer(hero({ form: 0 }), 'H');
    const high = heroAsFieldPlayer(hero({ form: 100 }), 'H');
    expect(high.attributes.shooting).toBeGreaterThan(low.attributes.shooting);
  });

  it('kaptanlik sahada okunuyor -- bu alan eskiden HIC kullanilmiyordu', () => {
    expect(heroDayFactor(hero({ isCaptain: true }))).toBeGreaterThan(
      heroDayFactor(hero({ isCaptain: false })),
    );
  });

  it('form 50 + moral 50 tam NOTR (1.00)', () => {
    expect(heroDayFactor(hero())).toBeCloseTo(1, 5);
  });

  it('form moralden daha agir basiyor -- saha performansi ruh halinden onemli', () => {
    const formSpan = heroDayFactor(hero({ form: 100 })) - heroDayFactor(hero({ form: 0 }));
    const moraleSpan = heroDayFactor(hero({ morale: 100 })) - heroDayFactor(hero({ morale: 0 }));
    expect(formSpan).toBeGreaterThan(moraleSpan);
    expect(moraleSpan).toBeGreaterThan(0.05);
  });
});

describe('Taban reyting', () => {
  it('notr oyuncu 6.0 aliyor', () => {
    expect(heroBaseRating(hero())).toBeCloseTo(6, 5);
  });

  it('moral tabani GERCEKTEN oynatiyor -- sabit 6.0 degil', () => {
    const spread = heroBaseRating(hero({ morale: 100 })) - heroBaseRating(hero({ morale: 0 }));
    expect(spread).toBeGreaterThan(0.3);
  });

  it('taban makul bandda kaliyor -- olaylar hala baskin', () => {
    // Bir gol ~+1.0 reyting getirir; taban onu bastirmamali.
    for (const m of [0, 50, 100]) {
      for (const f of [0, 50, 100]) {
        const r = heroBaseRating(hero({ morale: m, form: f, isCaptain: true }));
        expect(r).toBeGreaterThan(5.3);
        expect(r).toBeLessThan(6.8);
      }
    }
  });
});

describe('Moral toparlanmasi', () => {
  it('hedef huzur ve formdan turuyor', () => {
    expect(moraleTarget(90, 80)).toBeGreaterThan(moraleTarget(20, 30));
  });

  it('hedef asiri uclara gitmiyor', () => {
    expect(moraleTarget(100, 100)).toBeLessThanOrEqual(85);
    expect(moraleTarget(0, 0)).toBeGreaterThanOrEqual(15);
  });

  it('dipteki moral YUKARI kayiyor -- tek yonlu mandal degil', () => {
    expect(moraleRecovery(0, 50)).toBeGreaterThan(0);
  });

  it('tavandaki moral ASAGI kayiyor', () => {
    expect(moraleRecovery(90, 40)).toBeLessThan(0);
  });

  it('toparlanma YAVAS -- tek haftada sok silinmiyor', () => {
    // Icerik -15 yazdiysa ertesi hafta geri gelmemeli, yoksa kararlarin
    // agirligi kaybolur.
    expect(Math.abs(moraleRecovery(0, 50))).toBeLessThanOrEqual(5);
  });

  it('hedefteyken kaymiyor', () => {
    expect(moraleRecovery(50, 50)).toBe(0);
  });
});

describe('Yumusak taban (softFloor)', () => {
  const registry = FlagRegistry.from([
    { key: 'ruh', kind: 'stat', type: 'number', default: 50, label: 'Ruh', softFloor: 25 },
    { key: 'duz', kind: 'stat', type: 'number', default: 50, label: 'Duz' },
  ]);

  it('dizin USTUNDE azalis tam uygulaniyor', () => {
    expect(registry.dampen('ruh', 60, -10)).toBe(-10);
  });

  it('dizin ALTINDA azalis sonumleniyor', () => {
    const damped = registry.dampen('ruh', 10, -10);
    expect(damped).toBeGreaterThan(-10);
    expect(damped).toBeLessThan(0);
  });

  it('tabana yaklastikca daha da sonumleniyor -- 0a asimptotik', () => {
    const at10 = Math.abs(registry.dampen('ruh', 10, -10));
    const at3 = Math.abs(registry.dampen('ruh', 3, -10));
    expect(at3).toBeLessThan(at10);
  });

  it('ARTISLAR softFloor`dan etkilenmiyor', () => {
    expect(registry.dampen('ruh', 5, 10)).toBe(10);
  });

  it('softFloor tanimsizsa hicbir sey degismiyor', () => {
    expect(registry.dampen('duz', 5, -10)).toBe(-10);
  });
});
