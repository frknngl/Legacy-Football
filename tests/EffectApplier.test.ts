import { describe, expect, it } from 'vitest';
import { EffectApplier } from '../src/evaluation/EffectApplier.js';
import { ScalableValueResolver } from '../src/evaluation/ScalableValueResolver.js';
import { CONTENT_SOURCE, SCALE, testRegistry, testState } from './helpers.js';
import type { ScaleContext } from '../src/domain/effects.js';

const registry = testRegistry();
const applier = new EffectApplier(registry);

describe('EffectApplier - clamp', () => {
  it('stat flag’ini 0-100 arasina kirpar', () => {
    const s = testState();
    s.flags['teknik'] = 95;
    applier.applyFlag({ flag: 'teknik', op: 'add', value: 30 }, s, SCALE, CONTENT_SOURCE);
    expect(s.flags['teknik']).toBe(100);

    applier.applyFlag({ flag: 'teknik', op: 'add', value: -500 }, s, SCALE, CONTENT_SOURCE);
    expect(s.flags['teknik']).toBe(0);
  });

  it('set operatoru de kirpilir', () => {
    const s = testState();
    applier.applyFlag({ flag: 'liderlik', op: 'set', value: 250 }, s, SCALE, CONTENT_SOURCE);
    expect(s.flags['liderlik']).toBe(100);
  });

  it('unset registry default’una doner', () => {
    const s = testState();
    s.flags['teknik'] = 12;
    applier.applyFlag({ flag: 'teknik', op: 'unset' }, s, SCALE, CONTENT_SOURCE);
    expect(s.flags['teknik']).toBe(50);
  });
});

describe('EffectApplier - YETERSIZLIK POLITIKASI (servet negatife dusmez)', () => {
  it('yetecek para varsa borc olusmaz', () => {
    const s = testState();
    s.flags['servet'] = 1_000_000;
    const change = applier.applyFlag(
      { flag: 'servet', op: 'add', value: -730_000 },
      s,
      SCALE,
      CONTENT_SOURCE,
    );
    expect(s.flags['servet']).toBe(270_000);
    expect(s.flags['borc']).toBe(0);
    expect(change?.shortfall).toBeUndefined();
  });

  it('para yetmezse servet 0’a kirpilir ve ACIK borca yazilir', () => {
    const s = testState();
    s.flags['servet'] = 200_000;
    const change = applier.applyFlag(
      { flag: 'servet', op: 'add', value: -730_000 },
      s,
      SCALE,
      CONTENT_SOURCE,
    );
    expect(s.flags['servet']).toBe(0);
    expect(s.flags['borc']).toBe(530_000);
    expect(change?.shortfall).toEqual({ to: 'borc', amount: 530_000 });
  });

  it('mevcut borcun uzerine eklenir', () => {
    const s = testState();
    s.flags['servet'] = 0;
    s.flags['borc'] = 50_000;
    applier.applyFlag({ flag: 'servet', op: 'add', value: -100_000 }, s, SCALE, CONTENT_SOURCE);
    expect(s.flags['borc']).toBe(150_000);
  });

  it('shortfallTo tanimlanmamis kaynak flag’i sadece kirpilir', () => {
    const s = testState();
    s.flags['piyasa_degeri'] = 100;
    applier.applyFlag({ flag: 'piyasa_degeri', op: 'add', value: -500 }, s, SCALE, CONTENT_SOURCE);
    expect(s.flags['piyasa_degeri']).toBe(0);
    expect(s.flags['borc']).toBe(0);
  });
});

describe('EffectApplier - yazma yetkisi', () => {
  it('icerik `derived` flag’e YAZAMAZ', () => {
    const s = testState();
    applier.applyFlag({ flag: 'kupa_sayisi', op: 'set', value: 99 }, s, SCALE, CONTENT_SOURCE);
    expect(s.flags['kupa_sayisi']).toBe(0);
  });

  it('icerik persona’yi SET edemez, sadece iteker', () => {
    const s = testState();
    applier.applyFlag({ flag: 'persona_durus', op: 'set', value: 100 }, s, SCALE, CONTENT_SOURCE);
    expect(s.flags['persona_durus']).toBe(50);

    applier.applyFlag({ flag: 'persona_durus', op: 'add', value: 8 }, s, SCALE, CONTENT_SOURCE);
    expect(s.flags['persona_durus']).toBe(58);
  });

  it('motor `derived` flag’e yazabilir', () => {
    const s = testState();
    applier.applyFlag({ flag: 'kupa_sayisi', op: 'set', value: 3 }, s, SCALE, {
      ...CONTENT_SOURCE,
      origin: 'engine',
    });
    expect(s.flags['kupa_sayisi']).toBe(3);
  });

  it('tanimsiz flag runtime’i dusurmez, sessizce atlanir (validator yakalar)', () => {
    const s = testState();
    expect(() =>
      applier.applyFlag({ flag: 'has_bribed_police_47', op: 'set', value: true }, s, SCALE, CONTENT_SOURCE),
    ).not.toThrow();
    expect(s.flags['has_bribed_police_47']).toBeUndefined();
  });
});

describe('EffectApplier - KELEBEK ALTYAPISI (zaman damgasi)', () => {
  it('memory flag set edilince tur ve kaynak secim damgalanir', () => {
    const s = testState({ turn: 212 });
    applier.applyFlag({ flag: 'mem_accepted_fixing', op: 'set', value: true }, s, SCALE, {
      origin: 'content',
      eventId: 'evt_dark_fixing_offer',
      choiceId: 'c_accept',
      choiceText: 'Cem Aga’nin teklifini kabul et',
    });
    expect(s.flags['mem_accepted_fixing']).toBe(true);
    expect(s.flagSetTurn['mem_accepted_fixing']).toBe(212);
    expect(s.flagSource['mem_accepted_fixing']).toMatchObject({
      eventId: 'evt_dark_fixing_offer',
      choiceId: 'c_accept',
      turn: 212,
    });
  });

  it('ILK yazma damgayi belirler, sonraki yazmalar tazelemez', () => {
    const s = testState({ turn: 100 });
    applier.applyFlag({ flag: 'mem_bribed_police', op: 'set', value: true }, s, SCALE, CONTENT_SOURCE);
    s.turn = 500;
    applier.applyFlag({ flag: 'mem_bribed_police', op: 'set', value: true }, s, SCALE, CONTENT_SOURCE);
    expect(s.flagSetTurn['mem_bribed_police']).toBe(100);
  });

  it('memory flag false’a cekilince damga silinir', () => {
    const s = testState({ turn: 100 });
    applier.applyFlag({ flag: 'mem_bribed_police', op: 'set', value: true }, s, SCALE, CONTENT_SOURCE);
    applier.applyFlag({ flag: 'mem_bribed_police', op: 'set', value: false }, s, SCALE, CONTENT_SOURCE);
    expect(s.flagSetTurn['mem_bribed_police']).toBeUndefined();
  });

  it('memory OLMAYAN flag damgalanmaz', () => {
    const s = testState({ turn: 100 });
    applier.applyFlag({ flag: 'teknik', op: 'add', value: 5 }, s, SCALE, CONTENT_SOURCE);
    expect(s.flagSetTurn['teknik']).toBeUndefined();
  });
});

describe('EffectApplier - flag olmayan efektler', () => {
  it('schedule / lifeState / suspend efektlerini cagirana geri verir', () => {
    const s = testState();
    const { changes, deferred } = applier.applyAll(
      [
        { flag: 'teknik', op: 'add', value: 5 },
        { op: 'schedule', event: 'evt_legal_pfdk_hearing', inTurns: 2, priority: 'forced' },
        { op: 'suspend', matches: 3, reason: 'PFDK cezasi' },
      ],
      s,
      SCALE,
      CONTENT_SOURCE,
    );
    expect(changes).toHaveLength(1);
    expect(deferred).toHaveLength(2);
  });
});

describe('ScalableValueResolver - tek olay, 7 seviye', () => {
  const resolver = new ScalableValueResolver();
  const bribe = { scaleBy: 'stature', base: -10_000, perTier: -120_000 } as const;

  it('2. Lig’de kucuk, ikon seviyesinde buyuk tutar dondurur', () => {
    const lower: ScaleContext = { stature: 'nobody', clubTier: 'lower', season: 1 };
    const icon: ScaleContext = { stature: 'icon', clubTier: 'elite', season: 12 };
    expect(resolver.resolve(bribe, lower)).toBe(-10_000);
    expect(resolver.resolve(bribe, icon)).toBe(-610_000);
  });

  it('spread tum seviyeleri verir - ScalableValueRule bunu denetler', () => {
    expect(resolver.spread(bribe, 1)).toHaveLength(7);
  });

  it('clampMin/clampMax uygulanir', () => {
    const capped = { scaleBy: 'stature', base: -10_000, perTier: -120_000, clampMin: -300_000 } as const;
    expect(resolver.resolve(capped, { stature: 'legend', clubTier: 'elite', season: 20 })).toBe(
      -300_000,
    );
  });

  it('olceklenen deger EffectApplier icinden cozulur', () => {
    const s = testState();
    s.flags['servet'] = 5_000_000;
    applier.applyFlag({ flag: 'servet', op: 'add', value: bribe }, s, {
      stature: 'icon',
      clubTier: 'elite',
      season: 12,
    }, CONTENT_SOURCE);
    expect(s.flags['servet']).toBe(4_390_000);
  });
});
