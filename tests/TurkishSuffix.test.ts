import { describe, expect, it } from 'vitest';
import { applySuffix, isSuffixCase, type SuffixCase } from '../src/evaluation/TurkishSuffix.js';

const CASES: readonly [string, SuffixCase, string][] = [
  // Buyuk/kucuk unlu uyumu
  ['Barış', 'gen', "Barış'ın"],
  ['Orhan', 'gen', "Orhan'ın"],
  ['Deniz', 'gen', "Deniz'in"],
  ['Ömer', 'gen', "Ömer'in"],
  ['Ufuk', 'gen', "Ufuk'un"],
  ['Gökçe', 'gen', "Gökçe'nin"],
  // Yabanci isimler ayni kurallara uyar
  ['Marco', 'gen', "Marco'nun"],
  ['Vinicius', 'gen', "Vinicius'un"],
  // Belirtme
  ['Barış', 'acc', "Barış'ı"],
  ['Marco', 'acc', "Marco'yu"],
  ['Elif', 'acc', "Elif'i"],
  // Yonelme
  ['Barış', 'dat', "Barış'a"],
  ['Elif', 'dat', "Elif'e"],
  ['Marco', 'dat', "Marco'ya"],
  // Bulunma -- sert unsuz d'yi t yapar
  ['Ankara', 'loc', "Ankara'da"],
  ['Ufuk', 'loc', "Ufuk'ta"],
  ['Elif', 'loc', "Elif'te"],
  ['Trabzon', 'loc', "Trabzon'da"],
  // Ayrilma
  ['Ufuk', 'abl', "Ufuk'tan"],
  ['Deniz', 'abl', "Deniz'den"],
  ['Münih', 'abl', "Münih'ten"],
  // Vasita
  ['Barış', 'ins', "Barış'la"],
  ['Marco', 'ins', "Marco'yla"],
  ['Elif', 'ins', "Elif'le"],
  // Cogul
  ['Barış', 'plu', "Barış'lar"],
  ['Elif', 'plu', "Elif'ler"],
];

describe('TurkishSuffix', () => {
  it.each(CASES)('%s + %s -> %s', (word, kase, expected) => {
    expect(applySuffix(word, kase)).toBe(expected);
  });

  it('cok kelimeli adlarda ek son kelimeye gore gelir', () => {
    expect(applySuffix('Barış Tekin', 'gen')).toBe("Barış Tekin'in");
    expect(applySuffix("Cem 'Ağa' Doğan", 'dat')).toBe("Cem 'Ağa' Doğan'a");
  });

  it('kisaltmalar okundugu gibi cekilir', () => {
    // "FK" = fe-KA -> kalin; "CF" = ce-FE -> ince
    expect(applySuffix('Karadeniz FK', 'gen')).toBe("Karadeniz FK'nın");
    expect(applySuffix('Karadeniz FK', 'loc')).toBe("Karadeniz FK'da");
    expect(applySuffix('Atlas CF', 'gen')).toBe("Atlas CF'nin");
    expect(applySuffix('Erciyes SK', 'dat')).toBe("Erciyes SK'ya");
  });

  it('bos isimde ek uretmez', () => {
    expect(applySuffix('', 'gen')).toBe('');
    expect(applySuffix('   ', 'acc')).toBe('   ');
  });

  it('bilinmeyen filtreyi reddeder', () => {
    expect(isSuffixCase('gen')).toBe(true);
    expect(isSuffixCase('genitive')).toBe(false);
  });
});
