/**
 * Kosul operatorleri: saf fonksiyon tablosu.
 *
 * OCP: yeni bir operator eklemek = bu tabloya bir satir. Hicbir `switch`
 * genisletilmez, hicbir mevcut fonksiyon degistirilmez.
 */

import type { ConditionOp } from '../domain/conditions.js';
import type { FlagValue } from '../domain/flags.js';

/** Operatore verilen baglam. `turnsSince` gibi zaman operatorleri bunu kullanir. */
export interface OperatorContext {
  readonly currentTurn: number;
  /** Flag en son hangi turda set edildi. Hic set edilmediyse undefined. */
  readonly setTurn: number | undefined;
}

export type OperatorFn = (
  actual: FlagValue | undefined,
  expected: unknown,
  ctx: OperatorContext,
) => boolean;

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return undefined;
}

/** Bir flag "set edilmis" sayilir mi? false / 0 / "" set edilmemis sayilir. */
function isTruthy(v: FlagValue | undefined): boolean {
  if (v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return v.length > 0;
}

function numericCompare(
  actual: FlagValue | undefined,
  expected: unknown,
  cmp: (a: number, b: number) => boolean,
): boolean {
  const a = toNumber(actual);
  const b = toNumber(expected);
  if (a === undefined || b === undefined) return false;
  return cmp(a, b);
}

export const OPERATORS: Readonly<Record<ConditionOp, OperatorFn>> = {
  eq: (actual, expected) => {
    // Bool/sayi karsilastirmasini normalize et: true == 1 gecerli olmali.
    if (typeof actual === 'boolean' || typeof expected === 'boolean') {
      return isTruthy(actual) === isTruthy(expected as FlagValue);
    }
    return actual === expected;
  },

  ne: (actual, expected, ctx) => !OPERATORS.eq(actual, expected, ctx),

  gt: (actual, expected) => numericCompare(actual, expected, (a, b) => a > b),
  gte: (actual, expected) => numericCompare(actual, expected, (a, b) => a >= b),
  lt: (actual, expected) => numericCompare(actual, expected, (a, b) => a < b),
  lte: (actual, expected) => numericCompare(actual, expected, (a, b) => a <= b),

  in: (actual, expected) => Array.isArray(expected) && expected.includes(actual),
  notIn: (actual, expected) => Array.isArray(expected) && !expected.includes(actual),

  /**
   * Flag set edilmis mi?
   * `value` verilirse (true/false) beklenen set-durumuyla karsilastirilir.
   */
  isSet: (actual, expected) => {
    const set = isTruthy(actual);
    if (expected === undefined) return set;
    return set === Boolean(expected);
  },

  /**
   * Flag set edildiginden bu yana en az N tur gecti mi?
   *
   * KELEBEK ETKISININ MOTORU. Hic set edilmemis flag icin FALSE doner --
   * "hic olmamis sey"in uzerinden zaman gecmis sayilmaz.
   */
  turnsSince: (actual, expected, ctx) => {
    if (!isTruthy(actual)) return false;
    if (ctx.setTurn === undefined) return false;
    const n = toNumber(expected);
    if (n === undefined) return false;
    return ctx.currentTurn - ctx.setTurn >= n;
  },

  /** [min, max] KAPALI aralik. */
  between: (actual, expected) => {
    if (!Array.isArray(expected) || expected.length !== 2) return false;
    const a = toNumber(actual);
    const lo = toNumber(expected[0]);
    const hi = toNumber(expected[1]);
    if (a === undefined || lo === undefined || hi === undefined) return false;
    return a >= lo && a <= hi;
  },
};

export function hasOperator(op: string): op is ConditionOp {
  return Object.prototype.hasOwnProperty.call(OPERATORS, op);
}
