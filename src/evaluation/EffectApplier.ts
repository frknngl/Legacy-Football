/**
 * Efekt uygulayici.
 *
 * Uc yapisal garantiyi burada kuruyoruz:
 *
 *  1. CLAMP        -- her sayisal yazma registry sinirlarina kirpilir.
 *  2. ZAMAN DAMGASI -- bir `mem_*` flag'i set edildiginde o anin turu ve onu
 *                      yazan secim kaydedilir. Kelebek etkisinin tum altyapisi budur.
 *  3. YETERSIZLIK  -- `servet` eksiye dusmez; acik `borc’a yazilir (shortfallTo).
 */

import { CONTENT_READONLY_KINDS, NUDGE_ONLY_KINDS, type FlagRegistry, type FlagValue } from '../domain/flags.js';
import {
  isFlagEffect,
  isScalableValue,
  type Effect,
  type FlagEffect,
  type ScaleContext,
} from '../domain/effects.js';
import { ScalableValueResolver } from './ScalableValueResolver.js';

/** Efekti kim uyguluyor -- yetki denetimi ve kelebek izi icin. */
export interface EffectSource {
  readonly origin: 'content' | 'engine' | 'host';
  readonly eventId: string;
  readonly choiceId: string;
  readonly choiceText: string;
}

/** EffectApplier'in yazdigi mutable durum yuzeyi (ISP). */
export interface MutableFlagState {
  flags: Record<string, FlagValue>;
  flagSetTurn: Record<string, number>;
  flagSource: Record<
    string,
    { eventId: string; choiceId: string; choiceText: string; turn: number }
  >;
  turn: number;
}

/** Uygulanan tek bir yazmanin kaydi -- CLI ve testler icin. */
export interface AppliedChange {
  readonly flag: string;
  readonly before: FlagValue | undefined;
  readonly after: FlagValue;
  /** Yetersizlik nedeniyle baska flag'e aktarilan miktar. */
  readonly shortfall?: { readonly to: string; readonly amount: number };
}

export class EffectApplier {
  constructor(
    private readonly registry: FlagRegistry,
    private readonly scalable: ScalableValueResolver = new ScalableValueResolver(),
  ) {}

  /** Flag efektlerini uygular; flag olmayan efektleri (schedule/lifeState/suspend) dondurur. */
  applyAll(
    effects: readonly Effect[],
    state: MutableFlagState,
    scale: ScaleContext,
    source: EffectSource,
  ): { changes: AppliedChange[]; deferred: Effect[] } {
    const changes: AppliedChange[] = [];
    const deferred: Effect[] = [];
    for (const effect of effects) {
      if (isFlagEffect(effect)) {
        const applied = this.applyFlag(effect, state, scale, source);
        if (applied) changes.push(applied);
      } else {
        deferred.push(effect);
      }
    }
    return { changes, deferred };
  }

  applyFlag(
    effect: FlagEffect,
    state: MutableFlagState,
    scale: ScaleContext,
    source: EffectSource,
  ): AppliedChange | undefined {
    const def = this.registry.get(effect.flag);
    // Tanimsiz flag SESSIZCE YUTULMAZ; ama runtime'i dusurmemek icin de
    // burada atlanir -- validator bunu build zamaninda hata olarak yakalar.
    if (!def) return undefined;

    if (source.origin === 'content') {
      if (CONTENT_READONLY_KINDS.includes(def.kind)) return undefined;
      if (NUDGE_ONLY_KINDS.includes(def.kind) && effect.op === 'set') return undefined;
    }

    const before = state.flags[effect.flag];

    if (effect.op === 'unset') {
      const after = def.default;
      state.flags[effect.flag] = after;
      delete state.flagSetTurn[effect.flag];
      delete state.flagSource[effect.flag];
      return { flag: effect.flag, before, after };
    }

    const raw = this.scalable.resolveEffectValue(effect.value, scale);

    if (def.type === 'boolean') {
      const after = effect.op === 'set' ? Boolean(raw) : Boolean(raw ?? true);
      state.flags[effect.flag] = after;
      this.stamp(effect.flag, after, def.kind, state, source);
      return { flag: effect.flag, before, after };
    }

    if (def.type === 'string') {
      if (effect.op !== 'set' || typeof raw !== 'string') return undefined;
      state.flags[effect.flag] = raw;
      this.stamp(effect.flag, raw, def.kind, state, source);
      return { flag: effect.flag, before, after: raw };
    }

    // number
    const delta = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(delta)) return undefined;

    const current = typeof before === 'number' ? before : Number(def.default) || 0;
    // AZALAN GETIRI: yalnizca `add` ile gelen POZITIF degisim sonumlenir.
    // `set` bir otoritedir (motor/host "bu deger artik budur" der),
    // `mul` zaten oransaldir; ikisine de dokunulmaz.
    const applied =
      effect.op === 'add' ? this.registry.dampen(effect.flag, current, delta) : delta;
    const target =
      effect.op === 'set' ? applied : effect.op === 'add' ? current + applied : current * applied;

    const { min, max } = this.registry.bounds(effect.flag);
    let after = target;
    let shortfall: AppliedChange['shortfall'];

    if (min !== undefined && after < min) {
      const deficit = min - after;
      after = min;
      // YETERSIZLIK POLITIKASI: acik baska bir flag'e aktarilir.
      if (def.shortfallTo && deficit > 0) {
        const sinkDef = this.registry.get(def.shortfallTo);
        if (sinkDef) {
          const sinkBefore =
            typeof state.flags[def.shortfallTo] === 'number'
              ? (state.flags[def.shortfallTo] as number)
              : Number(sinkDef.default) || 0;
          const sinkBounds = this.registry.bounds(def.shortfallTo);
          let sinkAfter = sinkBefore + deficit;
          if (sinkBounds.max !== undefined) sinkAfter = Math.min(sinkBounds.max, sinkAfter);
          if (sinkBounds.min !== undefined) sinkAfter = Math.max(sinkBounds.min, sinkAfter);
          state.flags[def.shortfallTo] = sinkAfter;
          shortfall = { to: def.shortfallTo, amount: deficit };
        }
      }
    }
    if (max !== undefined && after > max) after = max;

    state.flags[effect.flag] = after;
    this.stamp(effect.flag, after, def.kind, state, source);

    return shortfall
      ? { flag: effect.flag, before, after, shortfall }
      : { flag: effect.flag, before, after };
  }

  /**
   * KELEBEK ALTYAPISI.
   *
   * `memory` flag'i anlamli bir degere set edildiginde o anin turu ve onu yazan
   * secim kaydedilir. `turnsSince` bu damgayi okur; ConsequenceLedger bu kaynagi
   * okuyarak "bu olay su yuzden cikti" cumlesini kurar.
   */
  private stamp(
    flag: string,
    value: FlagValue,
    kind: string,
    state: MutableFlagState,
    source: EffectSource,
  ): void {
    if (kind !== 'memory') return;
    const meaningful =
      typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : value !== '';
    if (!meaningful) {
      delete state.flagSetTurn[flag];
      delete state.flagSource[flag];
      return;
    }
    // Ilk yazma damgayi belirler; ayni ani tekrar tekrar taze gostermeyiz.
    if (state.flagSetTurn[flag] === undefined) {
      state.flagSetTurn[flag] = state.turn;
      state.flagSource[flag] = {
        eventId: source.eventId,
        choiceId: source.choiceId,
        choiceText: source.choiceText,
        turn: state.turn,
      };
    }
  }
}

export { isScalableValue };
