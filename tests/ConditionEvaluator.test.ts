import { describe, expect, it } from 'vitest';
import { ConditionEvaluator, type EvaluationContext } from '../src/evaluation/ConditionEvaluator.js';

const evaluator = new ConditionEvaluator();

function ctx(
  flags: Record<string, number | boolean | string>,
  flagSetTurn: Record<string, number> = {},
  turn = 100,
): EvaluationContext {
  return { flags, flagSetTurn, turn };
}

describe('ConditionEvaluator - yaprak operatorleri', () => {
  it('sayisal karsilastirmalari yapar', () => {
    const c = ctx({ servet: 1_500_000 });
    expect(evaluator.evaluate({ flag: 'servet', op: 'gte', value: 1_000_000 }, c)).toBe(true);
    expect(evaluator.evaluate({ flag: 'servet', op: 'lt', value: 1_000_000 }, c)).toBe(false);
  });

  it('tanimsiz flag icin sayisal karsilastirma FALSE doner', () => {
    expect(evaluator.evaluate({ flag: 'yok_boyle', op: 'gt', value: 0 }, ctx({}))).toBe(false);
  });

  it('bool ile sayiyi normalize eder', () => {
    const c = ctx({ mem_bribed_police: true });
    expect(evaluator.evaluate({ flag: 'mem_bribed_police', op: 'eq', value: true }, c)).toBe(true);
    expect(evaluator.evaluate({ flag: 'mem_bribed_police', op: 'ne', value: false }, c)).toBe(true);
  });

  it('in / notIn calisir', () => {
    const c = ctx({ lifeState: 'incarcerated' });
    expect(
      evaluator.evaluate({ flag: 'lifeState', op: 'in', value: ['injured', 'incarcerated'] }, c),
    ).toBe(true);
    expect(evaluator.evaluate({ flag: 'lifeState', op: 'notIn', value: ['playing'] }, c)).toBe(true);
  });

  it('between kapali araliktir', () => {
    const c = ctx({ age: 33 });
    expect(evaluator.evaluate({ flag: 'age', op: 'between', value: [33, 41] }, c)).toBe(true);
    expect(evaluator.evaluate({ flag: 'age', op: 'between', value: [34, 41] }, c)).toBe(false);
  });

  it('isSet degeri 0/false/bos-string icin FALSE doner', () => {
    expect(evaluator.evaluate({ flag: 'x', op: 'isSet' }, ctx({ x: 0 }))).toBe(false);
    expect(evaluator.evaluate({ flag: 'x', op: 'isSet' }, ctx({ x: false }))).toBe(false);
    expect(evaluator.evaluate({ flag: 'x', op: 'isSet' }, ctx({ x: '' }))).toBe(false);
    expect(evaluator.evaluate({ flag: 'x', op: 'isSet' }, ctx({ x: 1 }))).toBe(true);
  });
});

describe('ConditionEvaluator - turnsSince (kelebek etkisi)', () => {
  it('yeterli sure gectiginde TRUE doner', () => {
    const c = ctx({ mem_accepted_fixing: true }, { mem_accepted_fixing: 20 }, 260);
    expect(evaluator.evaluate({ flag: 'mem_accepted_fixing', op: 'turnsSince', value: 240 }, c)).toBe(
      true,
    );
  });

  it('sure dolmadiysa FALSE doner', () => {
    const c = ctx({ mem_accepted_fixing: true }, { mem_accepted_fixing: 20 }, 259);
    expect(evaluator.evaluate({ flag: 'mem_accepted_fixing', op: 'turnsSince', value: 240 }, c)).toBe(
      false,
    );
  });

  it('hic set edilmemis flag icin FALSE doner - olmamis seyin uzerinden zaman gecmez', () => {
    const c = ctx({ mem_accepted_fixing: false }, {}, 999);
    expect(evaluator.evaluate({ flag: 'mem_accepted_fixing', op: 'turnsSince', value: 1 }, c)).toBe(
      false,
    );
  });
});

describe('ConditionEvaluator - agac birlestiricileri', () => {
  const c = ctx({ servet: 1_500_000, season: 5, taraftar_destegi: 30 });

  it('allOf: hepsi saglanmali', () => {
    expect(
      evaluator.evaluate(
        {
          allOf: [
            { flag: 'servet', op: 'gte', value: 1_000_000 },
            { flag: 'season', op: 'gte', value: 3 },
          ],
        },
        c,
      ),
    ).toBe(true);

    expect(
      evaluator.evaluate(
        {
          allOf: [
            { flag: 'servet', op: 'gte', value: 1_000_000 },
            { flag: 'season', op: 'gte', value: 9 },
          ],
        },
        c,
      ),
    ).toBe(false);
  });

  it('anyOf: biri yeter', () => {
    expect(
      evaluator.evaluate(
        {
          anyOf: [
            { flag: 'servet', op: 'lt', value: 100 },
            { flag: 'season', op: 'gte', value: 3 },
          ],
        },
        c,
      ),
    ).toBe(true);
  });

  it('noneOf: hicbiri saglanmamali', () => {
    expect(evaluator.evaluate({ noneOf: [{ flag: 'servet', op: 'lt', value: 100 }] }, c)).toBe(true);
    expect(evaluator.evaluate({ noneOf: [{ flag: 'servet', op: 'gt', value: 100 }] }, c)).toBe(false);
  });

  it('not tersler', () => {
    expect(evaluator.evaluate({ not: { flag: 'taraftar_destegi', op: 'gt', value: 80 } }, c)).toBe(
      true,
    );
  });

  it('derin ic ice gecmis agaci cozer', () => {
    expect(
      evaluator.evaluate(
        {
          allOf: [
            { flag: 'servet', op: 'gte', value: 1_000_000 },
            {
              anyOf: [
                { flag: 'taraftar_destegi', op: 'gte', value: 80 },
                { not: { flag: 'season', op: 'lt', value: 3 } },
              ],
            },
          ],
        },
        c,
      ),
    ).toBe(true);
  });

  it('bos allOf TRUE, bos anyOf FALSE', () => {
    expect(evaluator.evaluate({ allOf: [] }, c)).toBe(true);
    expect(evaluator.evaluate({ anyOf: [] }, c)).toBe(false);
  });

  it('kosulsuz (undefined) icerik herkese aciktir', () => {
    expect(evaluator.evaluate(undefined, c)).toBe(true);
  });
});

describe('ConditionEvaluator - kilit sebebi ve kelebek izi', () => {
  it('firstFailingLeaf kilitli secenegin sebebini verir', () => {
    const c = ctx({ servet: 100, liderlik: 40 });
    const fail = evaluator.firstFailingLeaf(
      {
        allOf: [
          { flag: 'servet', op: 'gte', value: 50 },
          { flag: 'liderlik', op: 'gte', value: 70 },
        ],
      },
      c,
    );
    expect(fail).toEqual({ flag: 'liderlik', op: 'gte', value: 70 });
  });

  it('saglanan kosul icin firstFailingLeaf undefined doner', () => {
    const c = ctx({ servet: 100 });
    expect(evaluator.firstFailingLeaf({ flag: 'servet', op: 'gte', value: 50 }, c)).toBeUndefined();
  });

  it('satisfyingLeaves tetigi saglayan flag’leri listeler', () => {
    const c = ctx({ mem_bribed_police: true, servet: 900 });
    const leaves = evaluator.satisfyingLeaves(
      {
        allOf: [
          { flag: 'mem_bribed_police', op: 'isSet' },
          { flag: 'servet', op: 'gte', value: 500 },
        ],
      },
      c,
    );
    expect(leaves).toEqual(['mem_bribed_police', 'servet']);
  });
});
