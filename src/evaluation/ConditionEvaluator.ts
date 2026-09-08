/**
 * Ozyinelemeli kosul degerlendirici.
 *
 * Eski semada `servet > 1M AND currentTurn > 40` YAZILAMIYORDU. Burada kosul
 * bir agactir: allOf / anyOf / noneOf / not istenildigi kadar ic ice gecebilir.
 */

import {
  isAllOf,
  isAnyOf,
  isLeaf,
  isNoneOf,
  isNot,
  type Condition,
} from '../domain/conditions.js';
import type { FlagValue } from '../domain/flags.js';
import { hasOperator, OPERATORS } from './operators.js';

/** Degerlendiricinin ihtiyac duydugu okuma yuzeyi (ISP: yalnizca okuma). */
export interface EvaluationContext {
  readonly flags: Readonly<Record<string, FlagValue>>;
  readonly flagSetTurn: Readonly<Record<string, number>>;
  readonly turn: number;
}

export class ConditionEvaluator {
  /**
   * Bos `allOf` TRUE, bos `anyOf` FALSE doner -- klasik bosluk semantigi.
   * Kosul verilmemisse (undefined) TRUE doner: kapisiz icerik herkese acik.
   */
  evaluate(condition: Condition | undefined, ctx: EvaluationContext): boolean {
    if (condition === undefined) return true;

    if (isLeaf(condition)) {
      if (!hasOperator(condition.op)) return false;
      const fn = OPERATORS[condition.op];
      return fn(ctx.flags[condition.flag], condition.value, {
        currentTurn: ctx.turn,
        setTurn: ctx.flagSetTurn[condition.flag],
      });
    }

    if (isAllOf(condition)) {
      return condition.allOf.every((c) => this.evaluate(c, ctx));
    }

    if (isAnyOf(condition)) {
      return condition.anyOf.some((c) => this.evaluate(c, ctx));
    }

    if (isNoneOf(condition)) {
      return !condition.noneOf.some((c) => this.evaluate(c, ctx));
    }

    if (isNot(condition)) {
      return !this.evaluate(condition.not, ctx);
    }

    return false;
  }

  /**
   * Kosulun HANGI yaprakta patladigini dondurur.
   * Kilitli secenegin sebebini oyuncuya gostermek ve kelebek gunlugunu
   * kurmak icin kullanilir.
   */
  firstFailingLeaf(
    condition: Condition | undefined,
    ctx: EvaluationContext,
  ): { flag: string; op: string; value: unknown } | undefined {
    if (condition === undefined) return undefined;

    if (isLeaf(condition)) {
      return this.evaluate(condition, ctx)
        ? undefined
        : { flag: condition.flag, op: condition.op, value: condition.value };
    }

    if (isAllOf(condition)) {
      for (const c of condition.allOf) {
        const fail = this.firstFailingLeaf(c, ctx);
        if (fail) return fail;
      }
      return undefined;
    }

    if (isAnyOf(condition)) {
      if (this.evaluate(condition, ctx)) return undefined;
      // Hicbiri saglanmadi; ilk dalin sebebi temsili olarak yeterli.
      const first = condition.anyOf[0];
      return first ? this.firstFailingLeaf(first, ctx) : undefined;
    }

    if (isNoneOf(condition) || isNot(condition)) {
      return this.evaluate(condition, ctx) ? undefined : { flag: '-', op: 'not', value: undefined };
    }

    return undefined;
  }

  /**
   * Kosulun saglanmasini SAGLAYAN yapraklari dondurur.
   * ConsequenceLedger bunlari kullanarak "bu olay neden cikti" izini kurar.
   */
  satisfyingLeaves(condition: Condition | undefined, ctx: EvaluationContext): string[] {
    if (condition === undefined) return [];
    const out: string[] = [];
    this.collectSatisfying(condition, ctx, out);
    return out;
  }

  private collectSatisfying(condition: Condition, ctx: EvaluationContext, out: string[]): void {
    if (isLeaf(condition)) {
      if (this.evaluate(condition, ctx)) out.push(condition.flag);
      return;
    }
    if (isAllOf(condition)) {
      for (const c of condition.allOf) this.collectSatisfying(c, ctx, out);
      return;
    }
    if (isAnyOf(condition)) {
      for (const c of condition.anyOf) {
        if (this.evaluate(c, ctx)) this.collectSatisfying(c, ctx, out);
      }
      return;
    }
    // noneOf / not: saglanmalari bir seyin YOKLUGUNA dayanir, iz birakmazlar.
  }
}
