/**
 * YORGUNLUK -- uretim tarafi.
 *
 * Tuketen taraf yillardir bagliydi (`heroProfile().stamina` tam olarak
 * `kondisyon - tukenmislik*0.5`), ama URETEN taraf yoktu: hicbir sey bu
 * flag'lere yazmiyordu. Takvim uc maclik hafta uretse de oyuncu ayni
 * tazelikte sahaya cikiyordu.
 *
 * En kritik testler kalibrasyonu koruyanlar: tukenmislik ne tavana yapismali
 * (eksen bilgi tasimayi birakir) ne de anlamsizca sifirda kalmali.
 */

import { describe, expect, it } from 'vitest';
import {
  injuryRisk,
  injuryWeeks,
  matchLoad,
  weeklyInjuryChance,
  weeklyRecovery,
} from '../src/runtime/FatigueModel.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';

const load = (over: Partial<Parameters<typeof matchLoad>[0]> = {}): number =>
  matchLoad({ minutes: 90, importance: 'league', age: 25, professionalism: 50, ...over })
    .tukenmislik;

const recover = (matches: number, over: Partial<Parameters<typeof weeklyRecovery>[0]> = {}): number =>
  weeklyRecovery({
    matchesThisWeek: matches,
    age: 26,
    professionalism: 50,
    lifeState: 'playing',
    currentKondisyon: 75,
    currentTukenmislik: 60,
    ...over,
  }).tukenmislik;

describe('mac yuku', () => {
  it('buyuk maclar daha cok yorar', () => {
    expect(load({ importance: 'cup_final' })).toBeGreaterThan(load({ importance: 'league' }));
    expect(load({ importance: 'european' })).toBeGreaterThan(load({ importance: 'league' }));
  });

  it('yas yuku agirlastirir, profesyonellik hafifletir', () => {
    expect(load({ age: 34 })).toBeGreaterThan(load({ age: 24 }));
    expect(load({ professionalism: 95 })).toBeLessThan(load({ professionalism: 20 }));
    // Ama disiplin maci oynamamis gibi yapmaz.
    expect(load({ professionalism: 100 })).toBeGreaterThan(load({ professionalism: 50 }) * 0.7);
  });

  it('yedek kalan az yorulur', () => {
    expect(load({ minutes: 20 })).toBeLessThan(load({ minutes: 90 }) / 3);
  });
});

describe('haftalik toparlanma', () => {
  it('YOGUNLUGA duyarli -- takvimin uc maclik haftalari anlam kazanir', () => {
    expect(recover(0)).toBeLessThan(recover(1));
    expect(recover(1)).toBeLessThan(recover(2));
    expect(recover(2)).toBeLessThan(recover(3));
  });

  it('tek maclik hafta DENGEDE -- tukenmislik tavana yapismaz', () => {
    // Kalibrasyonun kalbi. Toparlanma yuku karsilamazsa tukenmislik sezon
    // ortasinda 100'e dayanir ve eksen bilgi tasimayi birakir (olculdu).
    const net = load() + recover(1);
    expect(Math.abs(net)).toBeLessThan(2);
  });

  it('uc maclik hafta BIRIKTIRIR', () => {
    const net = load() * 3 + recover(3);
    expect(net).toBeGreaterThan(15);
  });

  it('sakatken dinlenilir ama kondisyon ERIR', () => {
    const injured = weeklyRecovery({
      matchesThisWeek: 0,
      age: 26,
      professionalism: 50,
      lifeState: 'injured',
      currentKondisyon: 80,
      currentTukenmislik: 40,
    });
    expect(injured.tukenmislik).toBeLessThan(0); // dinleniyor
    expect(injured.kondisyon).toBeLessThan(0); // ama antrenman yok
  });

  it('toparlanma mevcut tukenmisligi asamaz -- eksiye dusmez', () => {
    expect(recover(0, { currentTukenmislik: 3 })).toBe(-3);
  });
});

describe('sakatlik riski', () => {
  it('tukenmislikle artar, dinlenince DUSER -- birikmez', () => {
    expect(injuryRisk(50, 75, 25)).toBeGreaterThan(injuryRisk(10, 75, 25));
    // Ayni oyuncu dinlendiginde risk geri iner.
    expect(injuryRisk(5, 75, 25)).toBeLessThan(injuryRisk(50, 75, 25));
  });

  it('yas ve dusuk kondisyon riski yukseltir', () => {
    expect(injuryRisk(20, 75, 35)).toBeGreaterThan(injuryRisk(20, 75, 25));
    expect(injuryRisk(20, 45, 25)).toBeGreaterThan(injuryRisk(20, 85, 25));
  });

  it('haftalik olasilik MAKUL -- risk dogrudan olasilik degil', () => {
    // Risk 30 dogrudan olasilik olsaydi kimse sezonu bitiremezdi.
    expect(weeklyInjuryChance(30)).toBeLessThan(0.03);
    expect(weeklyInjuryChance(95)).toBeLessThan(0.07);
    expect(weeklyInjuryChance(0)).toBe(0);
  });

  it('sakatlik suresi risk arttikca uzar ve sinirlidir', () => {
    expect(injuryWeeks(80, 0.99)).toBeGreaterThan(injuryWeeks(10, 0.99));
    for (const risk of [0, 40, 95]) {
      for (const roll of [0, 0.5, 0.999]) {
        const w = injuryWeeks(risk, roll);
        expect(w).toBeGreaterThanOrEqual(1);
        expect(w).toBeLessThanOrEqual(12);
      }
    }
  });
});

describe('motor entegrasyonu', () => {
  async function engine(seed = 99): Promise<GameEngine> {
    const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
    const e = new GameEngine(loaded.registry!, { seed });
    e.start('academy');
    return e;
  }

  it('mac oynamak tukenmisligi ARTIRIR', async () => {
    const e = await engine();
    const before = e.snapshot().flags['tukenmislik'] as number;

    e.beginMatch({ opponentName: 'X', importance: 'league', isStarter: true });
    e.finalizeMatch({ result: 'win', rating: 7, goals: 0, assists: 0, minutes: 90, cards: 0 });

    expect(e.snapshot().flags['tukenmislik'] as number).toBeGreaterThan(before);
  });

  /**
   * Bir tur ilerletir ve acik kalan kararlari kapatir.
   * `advanceTurn` acik karar varken hata atar -- bu dogru davranis; testin
   * ona uymasi gerekiyor.
   */
  function step(e: GameEngine): void {
    e.advanceTurn();
    let guard = 0;
    while (e.currentNode() && guard < 20) {
      guard += 1;
      const open = e.availableChoices().filter((c) => !c.locked);
      if (open.length === 0) break;
      e.choose(open[0]!.id);
    }
  }

  it('bos hafta tukenmisligi DUSURUR', async () => {
    const e = await engine();
    e.beginMatch({ opponentName: 'X', importance: 'european', isStarter: true });
    e.finalizeMatch({ result: 'win', rating: 7, goals: 0, assists: 0, minutes: 90, cards: 0 });
    const afterMatch = e.snapshot().flags['tukenmislik'] as number;

    // Mac oynamadan iki tur ilerlet.
    step(e);
    step(e);

    expect(e.snapshot().flags['tukenmislik'] as number).toBeLessThan(afterMatch);
  });

  it('sakatlik riski her tur YENIDEN hesaplanir', async () => {
    const e = await engine();
    step(e);
    const risk = e.snapshot().flags['sakatlik_riski'];
    expect(typeof risk).toBe('number');
    expect(risk as number).toBeGreaterThan(0);
  });

  it('stamina yorgunlugu YANSITIR -- simulatorun okudugu sayi', async () => {
    const e = await engine();
    const fresh = e.heroProfile().stamina;

    // Ust uste uc buyuk mac: uc maclik hafta.
    for (let i = 0; i < 3; i += 1) {
      e.beginMatch({ opponentName: 'X', importance: 'european', isStarter: true });
      e.finalizeMatch({ result: 'win', rating: 7, goals: 0, assists: 0, minutes: 90, cards: 0 });
    }

    expect(e.heroProfile().stamina).toBeLessThan(fresh);
  });

  it('milli davet de YORAR -- milli ara tatil degil', async () => {
    const e = await engine();
    const before = e.snapshot().flags['tukenmislik'] as number;
    e.reportWorldEvent({ kind: 'national_call', matches: 2 });
    expect(e.snapshot().flags['tukenmislik'] as number).toBeGreaterThan(before);
  });

  it('yorgunluk cekilisi ANA rng akisini kaydirmaz', async () => {
    // Ana akisa dokunsaydik mevcut tohumlarin urettigi butun kariyerler
    // kayardi. Iki motor ayni tohumla ayni imleci gostermeli.
    const a = await engine(4242);
    const b = await engine(4242);
    for (let i = 0; i < 5; i += 1) {
      step(a);
      step(b);
    }
    expect(a.snapshot().rngCursor).toBe(b.snapshot().rngCursor);
    expect(a.snapshot().flags['tukenmislik']).toBe(b.snapshot().flags['tukenmislik']);
  });
});
