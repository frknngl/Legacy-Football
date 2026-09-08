/**
 * Kosul agaci.
 *
 * Eski sema tek yapraktan ibaretti; `servet > 1M AND currentTurn > 40` yazilamiyordu.
 * Burada kosullar OZYINELEMELI bir agactir.
 */

export const CONDITION_OPS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'isSet',
  /** `mem_*` uzerinde: flag set edildiginden bu yana gecen tur sayisi. */
  'turnsSince',
  /** [min, max] kapali aralik. */
  'between',
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface LeafCondition {
  readonly flag: string;
  readonly op: ConditionOp;
  readonly value?: unknown;
}

export interface AllOfCondition {
  readonly allOf: readonly Condition[];
}

export interface AnyOfCondition {
  readonly anyOf: readonly Condition[];
}

export interface NoneOfCondition {
  readonly noneOf: readonly Condition[];
}

export interface NotCondition {
  readonly not: Condition;
}

export type Condition =
  | LeafCondition
  | AllOfCondition
  | AnyOfCondition
  | NoneOfCondition
  | NotCondition;

export function isLeaf(c: Condition): c is LeafCondition {
  return 'flag' in c;
}

export function isAllOf(c: Condition): c is AllOfCondition {
  return 'allOf' in c;
}

export function isAnyOf(c: Condition): c is AnyOfCondition {
  return 'anyOf' in c;
}

export function isNoneOf(c: Condition): c is NoneOfCondition {
  return 'noneOf' in c;
}

export function isNot(c: Condition): c is NotCondition {
  return 'not' in c;
}

/** Kosul agacindaki tum yapraklari dolasir -- validator ve InterpolationRule kullanir. */
export function* walkLeaves(c: Condition): Generator<LeafCondition> {
  if (isLeaf(c)) {
    yield c;
    return;
  }
  const children = isAllOf(c) ? c.allOf : isAnyOf(c) ? c.anyOf : isNoneOf(c) ? c.noneOf : [c.not];
  for (const child of children) yield* walkLeaves(child);
}

/** Kosulun okudugu tum flag adlari. */
export function referencedFlags(c: Condition): Set<string> {
  const out = new Set<string>();
  for (const leaf of walkLeaves(c)) out.add(leaf.flag);
  return out;
}
