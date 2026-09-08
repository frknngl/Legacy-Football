/**
 * ILISKI BAYRAKLARININ SONUCU.
 *
 * OLCULEN SORUN: `iliski_sponsor` (12 sahne yaziyor) ve `iliski_aile`
 * (4 sahne) bayraklarini NE icerik NE motor okuyordu. "Cekimde surat
 * astin, marka rahatsiz" ya da "babanla arayi duzelttin" yazan her sahne
 * sessizce etkisizdi.
 *
 * Ayni tuzagin ikinci katmani: bayragi bir sonuca baglamak TEK BASINA
 * yetmedi. `iliski_sponsor` 50'den basliyor, icerik ona net -62 yaziyor
 * (4 pozitif / 8 negatif) ve toparlanma yoktu -- medyani 24'e oturuyordu,
 * yani esigin altinda kaliyor ve gelir hep sifir cikiyordu. Moralde de
 * aynen bu olmustu. Cozum de ayni: hedefe dogru kayma.
 */

import { describe, expect, it } from 'vitest';
import { SPONSOR_FLOOR, sponsorDrift, sponsorIncome, sponsorTarget } from '../src/domain/sponsor.js';
import { moraleTarget } from '../src/runtime/ChemistryTracker.js';

describe('Aile -> moral', () => {
  it('iyi aile iliskisi moral hedefini YUKSELTIYOR', () => {
    expect(moraleTarget(50, 50, 95)).toBeGreaterThan(moraleTarget(50, 50, 70));
  });

  it('kotu aile iliskisi DUSURUYOR', () => {
    expect(moraleTarget(50, 50, 20)).toBeLessThan(moraleTarget(50, 50, 70));
  });

  it('varsayilan (70) NOTR -- ailesi normal olan ne prim alir ne ceza', () => {
    expect(moraleTarget(50, 50, 70)).toBe(moraleTarget(50, 50));
  });

  it('aile katkisi huzurdan KUCUK -- oda haftalik, aile zemin', () => {
    const family = Math.abs(moraleTarget(50, 50, 100) - moraleTarget(50, 50, 40));
    const harmony = Math.abs(moraleTarget(100, 50) - moraleTarget(40, 50));
    expect(family).toBeLessThan(harmony);
  });
});

describe('Sponsorluk geliri', () => {
  const wage = 10_000;

  it('iliskisi BOZUK oyuncuya marka para vermez', () => {
    expect(sponsorIncome(SPONSOR_FLOOR - 1, 1, 50, wage)).toBe(0);
  });

  it('maassiz oyuncuya sponsorluk yok -- olcek referansi yok', () => {
    expect(sponsorIncome(80, 1, 50, 0)).toBe(0);
  });

  it('iliski arttikca gelir artiyor', () => {
    expect(sponsorIncome(80, 0.6, 50, wage)).toBeGreaterThan(
      sponsorIncome(40, 0.6, 50, wage),
    );
  });

  it('SOHRET carpan -- taninmayan oyuncuya kimse sponsor olmaz', () => {
    expect(sponsorIncome(80, 1, 50, wage)).toBeGreaterThan(sponsorIncome(80, 0.1, 50, wage));
  });

  it('skandal isim daha az kazaniyor', () => {
    expect(sponsorIncome(80, 1, 90, wage)).toBeGreaterThan(sponsorIncome(80, 1, 5, wage));
  });

  it('gradyan olculdu: cirak ~0, efsane maasin dortte biri kadar', () => {
    const rookie = sponsorIncome(33, 0.4, 15, wage);
    const legend = sponsorIncome(65, 1, 50, wage);
    // Cirak icin gorunur ama kucuk; efsane icin gercek bir ikinci gelir.
    expect(rookie).toBeLessThan(wage * 0.06);
    expect(legend).toBeGreaterThan(wage * 0.2);
    expect(legend).toBeLessThan(wage * 0.4);
  });
});

describe('Sponsor iliskisinin hedefi', () => {
  it('unlu ve temiz oyuncunun hedefi YUKSEK', () => {
    expect(sponsorTarget(1, 80)).toBeGreaterThan(sponsorTarget(0.1, 20));
  });

  it('medya itibari hedefi oynatiyor', () => {
    expect(sponsorTarget(0.5, 90)).toBeGreaterThan(sponsorTarget(0.5, 10));
  });

  it('hedef makul bantta kaliyor', () => {
    for (const fame of [0, 0.5, 1]) {
      for (const media of [0, 50, 100]) {
        const t = sponsorTarget(fame, media);
        expect(t).toBeGreaterThanOrEqual(10);
        expect(t).toBeLessThanOrEqual(90);
      }
    }
  });

  it('cirak seviyesinde hedef esigin ALTINDA olabilir -- dogru', () => {
    // Taninmayan oyuncuya marka gelmez; sponsorlugun sifir olmasi bir
    // kusur degil, tasarim.
    expect(sponsorTarget(0, 10)).toBeLessThan(SPONSOR_FLOOR + 10);
  });
});

describe('Sponsor iliskisinin kaymasi', () => {
  it('hedefin altindaysa YUKARI kayiyor -- tek yonlu mandal degil', () => {
    expect(sponsorDrift(20, 60)).toBeGreaterThan(0);
  });

  it('hedefin ustundeyse asagi kayiyor', () => {
    expect(sponsorDrift(80, 30)).toBeLessThan(0);
  });

  it('kayma YAVAS -- sponsorluk yillik bir itibar meselesi', () => {
    // Moraldeki toparlanmadan (en cok 5) daha yavas olmali.
    expect(Math.abs(sponsorDrift(0, 90))).toBeLessThanOrEqual(2);
  });

  it('hedefteyken kaymiyor', () => {
    expect(sponsorDrift(45, 45)).toBe(0);
  });
});
