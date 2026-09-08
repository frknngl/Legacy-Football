/**
 * ACIK OLAY ONCELIGI -- zamana duyarli sahneler havuzda kaybolmamali.
 *
 * OLCULEN SORUN:
 *   `evt_react_var_controversy` gibi bir `inc_*` izine bagli olay,
 *   siradan hikaye olaylariyla ayni havuzda yarisiyordu. Havuz her yeni
 *   icerikle buyudugu icin bu olaylarin payi KACINILMAZ olarak eriyor.
 *
 *   Iki ayri seferde, yalnizca yeni olay eklemek VAR roportajini sekiz
 *   turluk penceresinden disari itti ve zincir testi patladi. Agirliklari
 *   tek tek kismak bunu cozmez -- icerik buyudukce yine kirilir.
 *
 * Bu test kuralin kendisini korur: acik bir incident'e bagli olay,
 * ayni agirliktaki siradan bir olaydan ONCELIKLI olmali.
 */

import { describe, expect, it } from 'vitest';
import { WeightedPicker } from '../src/selection/WeightedPicker.js';
import type { StoryEvent } from '../src/domain/story.js';
import type { PersonaState } from '../src/domain/state.js';

const persona = {} as PersonaState;

function event(id: string, trigger?: StoryEvent['trigger']): StoryEvent {
  return {
    id,
    family: `fam_${id}`,
    category: 'reaction',
    tier: 'major',
    weight: 50,
    cooldown: { self: 10, family: 5 },
    rootNode: 'n_root',
    nodes: {},
    ...(trigger ? { trigger } : {}),
  } as unknown as StoryEvent;
}

const picker = new WeightedPicker();
const base = { turn: 10, history: [], persona };

describe('acik olay onceligi', () => {
  const incident = event('evt_react_var', { flag: 'inc_var_against', op: 'isSet' });
  const ordinary = event('evt_locker_normal');

  it('ACIK incident agirligi YUKSELTIR', () => {
    const flags = { inc_var_against: true };
    const boosted = picker.effectiveWeight(incident, { ...base, flags });
    const plain = picker.effectiveWeight(ordinary, { ...base, flags });
    expect(boosted).toBeGreaterThan(plain * 5);
  });

  it('KAPALI incident hicbir sey degistirmez', () => {
    const flags = { inc_var_against: false };
    expect(picker.effectiveWeight(incident, { ...base, flags })).toBeCloseTo(
      picker.effectiveWeight(ordinary, { ...base, flags }),
      5,
    );
  });

  it('flags verilmezse davranis ESKISI gibi kalir', () => {
    // Geriye donuk uyum: `flags` opsiyonel; vermeyen cagri yerleri
    // (testler, arac kodu) eskisi gibi calismali.
    expect(picker.effectiveWeight(incident, base)).toBe(
      picker.effectiveWeight(ordinary, base),
    );
  });

  it('inc_ ONEKI olmayan tetik prim ALMAZ', () => {
    // Prim "onemli olay" primi degil ZAMANLAMA primi. Kalici bir
    // `mem_` izine bagli olay zamana duyarli degildir; acele etmemeli.
    const memory = event('evt_hatira', { flag: 'mem_bir_sey', op: 'eq', value: true });
    const flags = { mem_bir_sey: true };
    expect(picker.effectiveWeight(memory, { ...base, flags })).toBeCloseTo(
      picker.effectiveWeight(ordinary, { ...base, flags }),
      5,
    );
  });

  it('ic ice tetiklerde de bulur (allOf/anyOf)', () => {
    const nested = event('evt_karmasik', {
      allOf: [
        { flag: 'liderlik', op: 'gte', value: 50 },
        { anyOf: [{ flag: 'inc_var_against', op: 'isSet' }] },
      ],
    } as StoryEvent['trigger']);
    const flags = { inc_var_against: true, liderlik: 60 };
    expect(picker.effectiveWeight(nested, { ...base, flags })).toBeGreaterThan(
      picker.effectiveWeight(ordinary, { ...base, flags }) * 5,
    );
  });
});
