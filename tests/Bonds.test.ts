/**
 * ILISKI (kimya/guven) ve HAKEM sistemleri.
 *
 * Denetimde olculen durum: her ikisinin de ALTYAPISI vardi ama MEKANIK
 * ETKISI yoktu. `iliski_*` flag'leri `src/simulation/` icinde bir kez bile
 * okunmuyordu; `referee` slotu vardi ama hicbir nitelik, kokart ya da atama
 * yoktu -- yani "sadece isimden ibaret"ti.
 *
 * Bu testler o kabloyu koruyor.
 */

import { describe, expect, it } from 'vitest';
import {
  applyChemistry,
  assistWeightFactor,
  chanceFactor,
  chemistryDecay,
  chemistryGain,
  CHEMISTRY_CEILING,
} from '../src/domain/chemistry.js';
import {
  badgeRank,
  cardFactor,
  consistencyJitter,
  grudgeCardFactor,
  penaltyChance,
  requiredBadge,
  varChance,
  varCorrects,
  GRUDGE_HOSTILE,
  type RefereeAttributes,
} from '../src/domain/referee.js';
import { RefereeAssigner } from '../src/simulation/RefereeAssigner.js';
import { dressingRoomHarmony, harmonyMoraleDrift } from '../src/runtime/ChemistryTracker.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import { Rng } from '../src/selection/Rng.js';
import { createSimulatedWorld } from '../src/testing/simulatedWorld.js';
import type { Fixture } from '../src/domain/calendar.js';

// ------------------------------------------------------------------ kimya

describe('kimya', () => {
  it('DAKIKADAN dogar -- tam mac tam kazanc, yedek kalan az', () => {
    expect(chemistryGain(90)).toBeGreaterThan(chemistryGain(30));
    expect(chemistryGain(0)).toBe(0);
  });

  it('oynanmayan hafta ERITIR ama eksiye dusurmez', () => {
    expect(chemistryDecay(10, 1)).toBeLessThan(0);
    expect(applyChemistry(0.3, chemistryDecay(0.3, 5))).toBe(0);
  });

  it('tavana kirpar', () => {
    expect(applyChemistry(CHEMISTRY_CEILING, 50)).toBe(CHEMISTRY_CEILING);
  });

  it('BIR sezon "iyi anlasiyorlar"a cikarir -- kalibrasyon', () => {
    // 38 mac oynayip 38 hafta gecen bir sezon.
    let c = 0;
    for (let i = 0; i < 38; i += 1) c = applyChemistry(c, chemistryGain(90));
    expect(c).toBeGreaterThan(60);
    expect(c).toBeLessThan(CHEMISTRY_CEILING);
  });

  it('asist carpani DAR bant -- guc carpani degil TERCIH sinyali', () => {
    // Genis bant verilirse "iyi anlasan zayif ikili guclu ikiliyi gecer" olur.
    expect(assistWeightFactor(0)).toBeCloseTo(0.7, 2);
    expect(assistWeightFactor(95)).toBeLessThan(1.4);
    expect(assistWeightFactor(95) / assistWeightFactor(0)).toBeLessThan(2);
  });

  it('sans carpani asist tercihinden DAHA kucuk', () => {
    const chanceSpread = chanceFactor(95) / chanceFactor(0);
    const assistSpread = assistWeightFactor(95) / assistWeightFactor(0);
    expect(chanceSpread).toBeLessThan(assistSpread);
    expect(chanceFactor(undefined)).toBe(1);
  });
});

describe('soyunma odasi huzuru', () => {
  it('kaptan ve hoca odanin tonunu belirler -- duz ortalama DEGIL', () => {
    const withGoodCaptain = dressingRoomHarmony(
      new Map([['captain', 90], ['youngster', 30], ['keeper', 30]]),
    )!;
    const withBadCaptain = dressingRoomHarmony(
      new Map([['captain', 30], ['youngster', 90], ['keeper', 90]]),
    )!;
    expect(withGoodCaptain).toBeGreaterThan(withBadCaptain);
  });

  it('bilinmeyen slot huzuru etkilemez', () => {
    expect(dressingRoomHarmony(new Map([['fixer', 10]]))).toBeUndefined();
  });

  it('kirik oda morali yer, huzurlu oda besler', () => {
    expect(harmonyMoraleDrift(20)).toBeLessThan(0);
    expect(harmonyMoraleDrift(80)).toBeGreaterThan(0);
    expect(harmonyMoraleDrift(50)).toBe(0);
  });
});

describe('motor entegrasyonu -- baglar', () => {
  /**
   * Roster ZORUNLU: casting katmani onsuz kapalidir ve hic aktor dokulmez.
   * Baglar aktorlerin uzerinde yasadigi icin rostersiz motorla test edilemez.
   */
  async function engine(): Promise<GameEngine> {
    const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
    const sim = await createSimulatedWorld('content', loaded.registry!, 31337);
    const e = new GameEngine(loaded.registry!, {
      seed: 31337,
      roster: sim.roster,
      world: sim.world,
      worldFeed: sim.worldFeed,
    });
    e.start('academy');
    return e;
  }

  it('guven ILISKIDEN dusuk baslar -- sevmek bedava, guvenmek kazanilir', async () => {
    const e = await engine();
    const actors = Object.values(e.snapshot().actors);
    expect(actors.length).toBeGreaterThan(0);
    for (const a of actors) {
      expect(a.trust).toBeLessThanOrEqual(a.relation);
      expect(a.chemistry).toBe(0); // daha bir dakika birlikte oynanmadi
    }
  });

  it('mac oynamak kadro slotlarinda kimya BIRIKTIRIR', async () => {
    const e = await engine();
    e.beginMatch({ opponentName: 'X', importance: 'league', isStarter: true });
    e.finalizeMatch({ result: 'win', rating: 7, goals: 0, assists: 0, minutes: 90, cards: 0 });

    const squadActors = Object.values(e.snapshot().actors).filter((a) => a.minutesTogether > 0);
    expect(squadActors.length).toBeGreaterThan(0);
    for (const a of squadActors) expect(a.chemistry).toBeGreaterThan(0);
  });

  it('kimya cozucusu motorun FLAG SOZLUGUNU acmaz -- tek sayi gecer', async () => {
    const e = await engine();
    e.beginMatch({ opponentName: 'X', importance: 'league', isStarter: true });
    e.finalizeMatch({ result: 'win', rating: 7, goals: 0, assists: 0, minutes: 90, cards: 0 });

    const withMinutes = Object.values(e.snapshot().actors).find((a) => a.minutesTogether > 0)!;
    expect(withMinutes.sourceId).toBeDefined();
    const value = e.chemistryFor(withMinutes.sourceId!);
    expect(typeof value).toBe('number');
    // Bilinmeyen kimlik icin sessizce undefined -- zarif bozulma.
    expect(e.chemistryFor('yok-boyle-biri')).toBeUndefined();
  });
});

// ------------------------------------------------------------------ hakem

const REF: RefereeAttributes = {
  strictness: 60,
  cardTendency: 60,
  penaltyCourage: 60,
  varReliance: 60,
  consistency: 80,
  homeBias: 50,
};

describe('hakem nitelikleri', () => {
  it('kokart sirasi hiyerarsiyi tasir', () => {
    expect(badgeRank('regional')).toBeLessThan(badgeRank('national'));
    expect(badgeRank('national')).toBeLessThan(badgeRank('elite'));
    expect(badgeRank('elite')).toBeLessThan(badgeRank('fifa'));
  });

  it('mac onemi gereken kokarti belirler', () => {
    expect(requiredBadge('european', 1)).toBe('elite');
    expect(requiredBadge('cup_final', 1)).toBe('elite');
    expect(requiredBadge('national', 1)).toBe('fifa');
    expect(requiredBadge('league', 1)).toBe('national');
    expect(requiredBadge('league', 2)).toBe('regional');
  });

  it('kart egilimi kart olasiligini ceker', () => {
    const strict = cardFactor({ ...REF, cardTendency: 95 }, false, 0.5);
    const lenient = cardFactor({ ...REF, cardTendency: 10 }, false, 0.5);
    expect(strict).toBeGreaterThan(lenient);
  });

  it('ev sahibi kayirmasi iki tarafa TERS calisir', () => {
    const homey = { ...REF, homeBias: 75 };
    const forHome = cardFactor(homey, true, 0.5);
    const forAway = cardFactor(homey, false, 0.5);
    expect(forHome).toBeLessThan(forAway);
    // Notr hakemde fark yok.
    expect(cardFactor(REF, true, 0.5)).toBeCloseTo(cardFactor(REF, false, 0.5), 5);
  });

  it('tutarsizlik savrulma uretir, tutarlilik uretmez', () => {
    expect(consistencyJitter(100, 0)).toBeCloseTo(1, 5);
    expect(consistencyJitter(100, 1)).toBeCloseTo(1, 5);
    expect(consistencyJitter(40, 0)).toBeLessThan(1);
    expect(consistencyJitter(40, 1)).toBeGreaterThan(1);
  });

  it('buyuk macta hakem nokta gostermekte cekingen', () => {
    expect(penaltyChance(REF, 'cup_final')).toBeLessThan(penaltyChance(REF, 'league'));
  });

  it('VAR kullanimi ve duzeltme ayri seyler', () => {
    expect(varChance({ ...REF, varReliance: 100 })).toBeGreaterThan(
      varChance({ ...REF, varReliance: 0 }),
    );
    // Tutarsiz hakem VAR'a bakip yine de yanlis karar verir.
    expect(varCorrects(85)).toBe(true);
    expect(varCorrects(50)).toBe(false);
  });

  it('kin kart olasiligini DAR bir bantta kaydirir', () => {
    expect(grudgeCardFactor(GRUDGE_HOSTILE)).toBeGreaterThan(1);
    expect(grudgeCardFactor(50)).toBeLessThan(1);
    expect(grudgeCardFactor(0)).toBe(1);
    // Hakem taraf tutar ama maci TEK BASINA belirlemez.
    expect(grudgeCardFactor(GRUDGE_HOSTILE)).toBeLessThan(1.5);
  });
});

describe('hakem atama', () => {
  const referees = [
    ref(1, 'regional', 1, 30),
    ref(2, 'regional', 1, 35),
    ref(3, 'national', 1, 60),
    ref(4, 'national', 2, 62),
    ref(5, 'elite', 1, 85),
    ref(6, 'elite', 2, 88),
    ref(7, 'fifa', 3, 95),
  ];

  function ref(id: number, badge: 'regional' | 'national' | 'elite' | 'fifa', countryId: number, reputation: number) {
    return { id, name: `R${id}`, countryId, badge, reputation, attributes: REF };
  }

  function fixture(over: Partial<Fixture> = {}): Fixture {
    return {
      week: 5,
      slot: 'weekend',
      homeId: 'c1',
      awayId: 'c2',
      importance: 'league',
      competitionId: 'L1',
      ...over,
    };
  }

  const deps = {
    referees,
    countryOfClub: (id: string) => (id === 'c1' ? 1 : 2),
    leagueLevelOf: () => 1,
  };

  it('Avrupa macina ASLA dusuk kokart atanmaz', () => {
    const assigner = new RefereeAssigner(deps);
    const rng = new Rng(9);
    for (let w = 1; w <= 30; w += 1) {
      const r = assigner.assign(fixture({ week: w, importance: 'european' }), rng)!;
      expect(badgeRank(r.badge)).toBeGreaterThanOrEqual(badgeRank('elite'));
    }
  });

  it('Avrupa macinda hakem TARAFSIZ ulkeden', () => {
    const assigner = new RefereeAssigner(deps);
    const rng = new Rng(4);
    for (let w = 1; w <= 30; w += 1) {
      const r = assigner.assign(fixture({ week: w, importance: 'european' }), rng)!;
      expect(r.countryId).not.toBe(1);
      expect(r.countryId).not.toBe(2);
    }
  });

  it('ayni hakem ayni kulube ust uste cikmaz', () => {
    const assigner = new RefereeAssigner(deps);
    const rng = new Rng(2);
    const first = assigner.assign(fixture({ week: 1 }), rng)!;
    const second = assigner.assign(fixture({ week: 2 }), rng)!;
    expect(second.id).not.toBe(first.id);
  });

  it('havuz bossa fikstur yine de hakemsiz KALMAZ', () => {
    // Yalnizca bolgesel hakem var ama Avrupa maci isteniyor.
    const poor = new RefereeAssigner({ ...deps, referees: [referees[0]!] });
    const r = poor.assign(fixture({ importance: 'european' }), new Rng(1));
    expect(r).toBeDefined();
  });

  it('hakem yoksa undefined -- cokmez', () => {
    const empty = new RefereeAssigner({ ...deps, referees: [] });
    expect(empty.assign(fixture(), new Rng(1))).toBeUndefined();
  });
});
