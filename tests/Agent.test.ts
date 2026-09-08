/**
 * MENAJER SISTEMI -- arketip dengesi, memnuniyet dongusu, pazarlik.
 *
 * En kritik degismez: HICBIR ARKETIP BASKIN DEGIL. Bir arketip her eksende
 * digerlerinden iyiyse secim ortadan kalkar ve sistem sustuk bir menu olur.
 * Asagidaki ilk test tam olarak bunu koruyor.
 */

import { describe, expect, it } from 'vitest';
import {
  AGENT_QUIT_THRESHOLD,
  AGENT_START_SATISFACTION,
  agentQuits,
  applySatisfaction,
  archetypeBias,
  negotiationChance,
  newAgentSatisfaction,
  newAgentState,
  offerChance,
  reachFit,
  satisfactionDelta,
  satisfactionFactor,
  terminationFee,
  type AgentArchetype,
  type AgentProfile,
  type OfferContext,
} from '../src/domain/agent.js';

function agent(archetype: AgentArchetype, over: Partial<AgentProfile> = {}): AgentProfile {
  const base: Record<AgentArchetype, Omit<AgentProfile, 'id' | 'name' | 'archetype'>> = {
    super_agent: { reach: 92, negotiation: 88, loyalty: 25, patience: 30, commission: 0.15, reputation: 90 },
    family: { reach: 30, negotiation: 40, loyalty: 95, patience: 90, commission: 0.04, reputation: 20 },
    developer: { reach: 55, negotiation: 60, loyalty: 72, patience: 78, commission: 0.075, reputation: 52 },
    opportunist: { reach: 70, negotiation: 75, loyalty: 35, patience: 40, commission: 0.115, reputation: 60 },
    journeyman: { reach: 45, negotiation: 50, loyalty: 62, patience: 68, commission: 0.065, reputation: 35 },
  };
  return { id: 1, name: 'Test', archetype, ...base[archetype], ...over };
}

const ARCHETYPES: readonly AgentArchetype[] = [
  'super_agent',
  'family',
  'developer',
  'opportunist',
  'journeyman',
];

describe('arketip dengesi', () => {
  it('HICBIR arketip her eksende iyi degil -- her birinin bir ZAYIFLIGI var', () => {
    // "Iyi olmak": erisim ve pazarlik yuksek, sadakat ve sabir yuksek,
    // komisyon dusuk. Bes eksende de iyi olan bir arketip, digerlerini
    // secilemez kilardi.
    for (const kind of ARCHETYPES) {
      const a = agent(kind);
      const strengths = [
        a.reach >= 70,
        a.negotiation >= 70,
        a.loyalty >= 80,
        a.patience >= 80,
        a.commission <= 0.06,
      ];
      expect(strengths.filter(Boolean).length).toBeLessThan(5);
      // Ve en az bir eksende gercekten zayif olmali.
      //
      // Zayifligi sayiyla degil SONUCLA olcuyoruz: "reach 50'nin altinda"
      // keyfi bir esik, "elit kulubun kapisini acamiyor" ise oyuncunun
      // hissettigi sey. developer tam olarak buradan zayif -- nitelikleri
      // ortalamanin ustunde ama tavani 90 itibarli kulube yetmiyor.
      const weaknesses = [
        reachFit(a.reach, 90) < 0.7, // elit kapi kapali ya da zor
        a.loyalty <= 45, // seni satmaya hevesli
        a.patience <= 50, // ilk redde kirilir
        a.commission >= 0.11, // pahali
      ];
      expect(weaknesses.some(Boolean)).toBe(true);
    }
  });

  it('super_agent KAPIYI acar ama PAHALI -- family tersi', () => {
    const supr = agent('super_agent');
    const fam = agent('family');
    expect(supr.reach).toBeGreaterThan(fam.reach + 40);
    expect(supr.commission).toBeGreaterThan(fam.commission * 3);
    expect(fam.loyalty).toBeGreaterThan(supr.loyalty * 2);
  });
});

describe('erisim uyumu', () => {
  it('family ELIT kapiyi ACAMAZ', () => {
    expect(reachFit(30, 95)).toBe(0);
  });

  it('asagi dogru sinir YOK -- guclu menajer kucuk kulubu de acar', () => {
    expect(reachFit(92, 55)).toBe(1);
    expect(reachFit(92, 92)).toBe(1);
  });

  it('bir basamak yukarisi ULASILABILIR kalir', () => {
    // reach 70, kulup 85 -> kapali degil ama zor. Sert kesme olsaydi
    // oyuncu hicbir zaman sinif atlayamazdi.
    expect(reachFit(70, 85)).toBeGreaterThan(0);
    expect(reachFit(70, 85)).toBeLessThan(1);
  });
});

describe('arketip egilimi', () => {
  const ctx = (over: Partial<OfferContext> = {}): OfferContext => ({
    clubReputation: 70,
    currentClubReputation: 60,
    playingChance: 50,
    form: 60,
    seasonGoals: 5,
    windowOpen: true,
    ...over,
  });

  it('developer FORMA SANSINA bakar, kulup buyuklugune degil', () => {
    const bench = archetypeBias('developer', ctx({ clubReputation: 95, playingChance: 20 }));
    const starter = archetypeBias('developer', ctx({ clubReputation: 60, playingChance: 80 }));
    expect(starter).toBeGreaterThan(bench * 4);
  });

  it('super_agent KUCUK kulube burun kivirir', () => {
    expect(archetypeBias('super_agent', ctx({ clubReputation: 50 }))).toBeLessThan(0.5);
    expect(archetypeBias('super_agent', ctx({ clubReputation: 90 }))).toBeGreaterThan(1.5);
  });

  it('family yalnizca acik YUKSELIS icin masaya oturur', () => {
    const up = archetypeBias('family', ctx({ clubReputation: 80, currentClubReputation: 60 }));
    const sideways = archetypeBias('family', ctx({ clubReputation: 60, currentClubReputation: 60 }));
    expect(up).toBeGreaterThan(sideways * 4);
  });

  it('ayni erisimde iki arketip AYNI teklifleri getirmez', () => {
    const dev = agent('developer', { reach: 70 });
    const opp = agent('opportunist', { reach: 70 });
    const bigClubNoMinutes = ctx({ clubReputation: 88, playingChance: 25 });
    expect(offerChance(opp, newAgentState(opp, 0), bigClubNoMinutes)).toBeGreaterThan(
      offerChance(dev, newAgentState(dev, 0), bigClubNoMinutes),
    );
  });
});

describe('memnuniyet', () => {
  it('SABIRSIZ menajer reddedilince sert duser, sabirli omuz silker', () => {
    const impatient = satisfactionDelta('offer_rejected', agent('super_agent'));
    const patient = satisfactionDelta('offer_rejected', agent('family'));
    expect(impatient).toBeLessThan(patient);
    expect(impatient).toBeLessThan(-20);
    expect(patient).toBeGreaterThan(-15);
  });

  it('super_agent UC redde dayanamaz -- family dayanir', () => {
    const supr = agent('super_agent');
    let s = newAgentState(supr, 0);
    for (let i = 0; i < 3; i += 1) s = applySatisfaction(s, 'offer_rejected', supr);
    expect(agentQuits(s)).toBe(true);

    const fam = agent('family');
    let f = newAgentState(fam, 0);
    for (let i = 0; i < 3; i += 1) f = applySatisfaction(f, 'offer_rejected', fam);
    expect(agentQuits(f)).toBe(false);
  });

  it('memnun olmayan menajer TELEFONA BAKMAZ', () => {
    expect(satisfactionFactor(15)).toBeLessThan(satisfactionFactor(30) * 0.5);
  });

  it('memnuniyet 0-100 arasinda KALIR', () => {
    const fam = agent('family');
    let s = newAgentState(fam, 0);
    for (let i = 0; i < 20; i += 1) s = applySatisfaction(s, 'transfer_done', fam);
    expect(s.satisfaction).toBe(100);
  });
});

describe('komisyon pazarligi', () => {
  it('ne kadar KIRPARSAN o kadar zor', () => {
    const a = agent('journeyman');
    const s = newAgentState(a, 0);
    expect(negotiationChance(a, s, 0.06)).toBeGreaterThan(negotiationChance(a, s, 0.03));
  });

  it('BIRLIKTE gecen sezon ve memnuniyet kolaylastirir', () => {
    const a = agent('journeyman');
    const fresh = newAgentState(a, 0);
    const veteran = { ...fresh, seasonsTogether: 6, satisfaction: 95 };
    expect(negotiationChance(a, veteran, 0.05)).toBeGreaterThan(
      negotiationChance(a, fresh, 0.05),
    );
  });

  it('guclu PAZARLIKCI menajeri ikna etmek daha zor', () => {
    const weak = agent('family');
    const strong = agent('super_agent');
    const s = newAgentState(weak, 0);
    expect(negotiationChance(strong, s, s.commission - 0.02)).toBeLessThan(
      negotiationChance(weak, s, s.commission - 0.02),
    );
  });

  it('hicbir pazarlik GARANTI ya da IMKANSIZ degil', () => {
    const a = agent('super_agent');
    const s = newAgentState(a, 0);
    expect(negotiationChance(a, s, 0.001)).toBeGreaterThanOrEqual(0.02);
    expect(negotiationChance(a, s, s.commission - 0.0001)).toBeLessThanOrEqual(0.95);
  });
});

describe('menajer degistirmenin bedeli', () => {
  it('fesih BEDAVA degil', () => {
    const a = agent('super_agent');
    expect(terminationFee(newAgentState(a, 0), 50_000, 3)).toBeGreaterThan(0);
  });

  it('pahali menajeri feshetmek daha PAHALI', () => {
    const supr = newAgentState(agent('super_agent'), 0);
    const fam = newAgentState(agent('family'), 0);
    expect(terminationFee(supr, 50_000, 3)).toBeGreaterThan(terminationFee(fam, 50_000, 3));
  });

  it('sik menajer degistirene piyasa SOGUK bakar', () => {
    expect(newAgentSatisfaction(0)).toBe(AGENT_START_SATISFACTION);
    expect(newAgentSatisfaction(5)).toBeLessThan(newAgentSatisfaction(1));
    // Ama dibe vurmaz: yeni menajer daha imzalamadan birakmasin.
    expect(newAgentSatisfaction(50)).toBeGreaterThan(AGENT_QUIT_THRESHOLD);
  });
});

describe('teklif olasiligi', () => {
  const ctx: OfferContext = {
    clubReputation: 75,
    currentClubReputation: 60,
    playingChance: 60,
    form: 70,
    seasonGoals: 8,
    windowOpen: false,
  };

  it('PENCERE acikken teklif uce katlanir', () => {
    const a = agent('opportunist');
    const s = newAgentState(a, 0);
    expect(offerChance(a, s, { ...ctx, windowOpen: true })).toBeCloseTo(
      offerChance(a, s, ctx) * 3,
      5,
    );
  });

  it('olasilik hicbir zaman 1i asmaz', () => {
    const a = agent('super_agent');
    const s = { ...newAgentState(a, 0), satisfaction: 100 };
    const extreme: OfferContext = {
      clubReputation: 95,
      currentClubReputation: 40,
      playingChance: 95,
      form: 100,
      seasonGoals: 60,
      windowOpen: true,
    };
    expect(offerChance(a, s, extreme)).toBeLessThanOrEqual(1);
  });

  it('formsuz oyuncuya teklif GELMEZ denecek kadar azalir', () => {
    const a = agent('journeyman');
    const s = newAgentState(a, 0);
    const cold = offerChance(a, s, { ...ctx, form: 0, seasonGoals: 0 });
    const hot = offerChance(a, s, { ...ctx, form: 100, seasonGoals: 20 });
    expect(hot).toBeGreaterThan(cold * 4);
  });
});
