/**
 * AZALAN GETIRI -- kapi sisteminin ayakta kalmasi.
 *
 * OLCULEN SORUN:
 *   `liderlik` bayragina icerikte 237 etki dokunuyor ve 233'u ARTI
 *   (+1113'e karsilik -23). 50'den baslayan bayrak dort sahnede 70'i
 *   asiyor, 900 turluk kariyerin ortasinda 100'e yapisiyordu. Icerikteki
 *   219 kilitli secim kosulunun neredeyse tamami bu bayraga bagli ve
 *   esikler 55-70 bandinda -- yani oyunun TEK gercek kapi sistemi
 *   kariyerin ortasinda tamamen kayboluyordu. Olculen kilit orani: %1.
 *
 * Bu testler o cozumun nobetcisi.
 */

import { describe, expect, it } from 'vitest';
import { FlagRegistry } from '../src/domain/flags.js';
import type { FlagDefinition } from '../src/domain/flags.js';

function registry(defs: Partial<FlagDefinition>[]): FlagRegistry {
  return FlagRegistry.from(
    defs.map((d) => ({
      key: 'x', kind: 'stat', type: 'number', default: 50, label: 'X', ...d,
    })) as FlagDefinition[],
  );
}

describe('azalan getiri', () => {
  const reg = registry([{ key: 'liderlik', softCap: 70, min: 0, max: 100 }]);

  it('dizin ALTINDA artis tam uygulanir', () => {
    expect(reg.dampen('liderlik', 50, 5)).toBe(5);
    expect(reg.dampen('liderlik', 70, 5)).toBe(5);
  });

  it('dizin USTUNDE kalan bosluga gore sonumlenir', () => {
    // 85: kalan bosluk 15/30 = yarim
    expect(reg.dampen('liderlik', 85, 10)).toBeCloseTo(5, 5);
    // 95: 5/30
    expect(reg.dampen('liderlik', 95, 30)).toBeCloseTo(5, 5);
  });

  it('tavanda artis SIFIRLANIR -- 100e yapisip kalmak imkansiz', () => {
    expect(reg.dampen('liderlik', 100, 20)).toBe(0);
  });

  it('AZALISLAR sonumlenmez -- kaybetmek kolay kalir', () => {
    // Kazanmak zorlasir, kaybetmek kolay kalir: yuksek bir degeri
    // KORUMAK da bir secim olmali.
    expect(reg.dampen('liderlik', 95, -10)).toBe(-10);
    expect(reg.dampen('liderlik', 50, -10)).toBe(-10);
  });

  it('softCap tanimsizsa hicbir sey degismez -- opt-in', () => {
    const plain = registry([{ key: 'moral', min: 0, max: 100 }]);
    expect(plain.dampen('moral', 99, 20)).toBe(20);
  });

  it('bilinmeyen bayrak delta"yi oldugu gibi dondurur', () => {
    expect(reg.dampen('yok_boyle_bir_sey', 90, 7)).toBe(7);
  });

  it('175 kez +5 alan bir kariyer 100e YAPISMAZ', () => {
    // Icerikte tam olarak bu var: 175 adet "+5 liderlik" etkisi.
    let value = 50;
    for (let i = 0; i < 175; i += 1) {
      value = Math.min(100, value + reg.dampen('liderlik', value, 5));
    }
    // Tavana yaklasir ama esikler anlamli kalacak kadar yol vardir:
    // sonum olmadan 25. sahnede 100 olurdu.
    expect(value).toBeLessThan(100);
    expect(value).toBeGreaterThan(70);
  });
});
