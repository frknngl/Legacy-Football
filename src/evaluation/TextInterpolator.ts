/**
 * Metin enterpolasyonu.
 *
 * Icerik hicbir ozel isim BILMEZ; yalnizca rol ve baglam adresler:
 *
 *   "{actor.captain.first:dat} dondu: 'Bu topu sen atmayacaksin.'"
 *   "{club.name:loc} son maci. {opponent.name} deplasmani, {minute}. dakika."
 *   "{memory.mem_betrayed_captain.actor} artik {world.title_race_leader}'da."
 *
 * Cozum sirasi (ilk eslesen kazanir):
 *   player -> club -> actor -> opponent -> world -> memory -> cast -> locals -> flags
 *
 * `:filtre` Turkce ek cekimidir; isim prosedurel oldugu icin metne elle ek
 * yazilamaz. Cozulemeyen yer tutucu SESSIZCE SILINMEZ -- ham hali korunur ve
 * `InterpolationRule` build zamaninda yakalar.
 */

import type { FlagValue } from '../domain/flags.js';
import { applySuffix, isSuffixCase } from './TurkishSuffix.js';

const PLACEHOLDER = /\{([a-zA-Z0-9_.]+)(?::([a-z]+))?\}/g;

/**
 * TOKEN EVRENI -- yazarin kullanabilecegi tum alanlar.
 * `InterpolationRule` bu listeleri okur; yeni alan eklemek tek noktadan yapilir.
 */
export const ACTOR_FIELDS = ['name', 'first', 'last', 'age', 'club', 'role', 'number'] as const;
export const PLAYER_FIELDS = ['name', 'age'] as const;
export const CLUB_FIELDS = ['name', 'city', 'stadium', 'rival'] as const;
export const OPPONENT_FIELDS = ['name', 'city', 'stadium'] as const;
export const MEMORY_FIELDS = ['actor', 'season', 'week', 'turn', 'seasonsAgo'] as const;
/** Mac baglami -- host'un sundugu moment'ten gelir. */
export const MATCH_LOCALS = [
  'opponent',
  'minute',
  'scoreline',
  'scoreline_before',
  'scoreline_after',
  'scoreline_provisional',
] as const;

/** Bir slotu dolduran aktorun metne acilan yuzu. */
export interface ActorView {
  readonly name: string;
  readonly first: string;
  readonly last: string;
  readonly age?: number;
  readonly club?: string;
  readonly role?: string;
  readonly number?: number;
}

export type ActorResolver = (slotId: string) => ActorView | undefined;
export type MemoryResolver = (flagKey: string, field: string) => string | undefined;

export interface ParsedToken {
  readonly key: string;
  readonly filter?: string;
}

/** Enterpolasyon icin gereken tum kaynaklar. */
export interface InterpolationContext {
  readonly flags: Readonly<Record<string, FlagValue>>;
  /** Mac/moment baglamı: opponent, minute, scoreline... */
  readonly locals?: Readonly<Record<string, string | number>>;
  readonly player?: Readonly<Record<string, string | number>>;
  readonly club?: Readonly<Record<string, string | number>>;
  readonly opponent?: Readonly<Record<string, string | number>>;
  readonly world?: Readonly<Record<string, string>>;
  readonly actor?: ActorResolver;
  readonly memory?: MemoryResolver;
}

export class TextInterpolator {
  interpolate(text: string, ctx: InterpolationContext): string {
    return text.replace(PLACEHOLDER, (whole, key: string, filter?: string) => {
      const resolved = this.resolve(key, ctx);
      if (resolved === undefined) return whole;
      if (filter === undefined) return resolved;
      return isSuffixCase(filter) ? applySuffix(resolved, filter) : whole;
    });
  }

  /** Metindeki tum yer tutucu anahtarlari -- validator icin. */
  static placeholders(text: string): string[] {
    return TextInterpolator.tokens(text).map((t) => t.key);
  }

  /** Anahtar + filtre ciftleri -- validator filtreyi de denetler. */
  static tokens(text: string): ParsedToken[] {
    const out: ParsedToken[] = [];
    for (const m of text.matchAll(PLACEHOLDER)) {
      const key = m[1];
      if (key === undefined) continue;
      out.push(m[2] === undefined ? { key } : { key, filter: m[2] });
    }
    return out;
  }

  private resolve(key: string, ctx: InterpolationContext): string | undefined {
    const dot = key.indexOf('.');
    if (dot > 0) {
      const scoped = this.resolveScoped(key.slice(0, dot), key.slice(dot + 1), ctx);
      if (scoped !== undefined) return scoped;
    }

    const local = ctx.locals?.[key];
    if (local !== undefined) return String(local);

    const flag = ctx.flags[key];
    if (flag !== undefined) return this.formatFlag(flag);

    return undefined;
  }

  private resolveScoped(
    head: string,
    tail: string,
    ctx: InterpolationContext,
  ): string | undefined {
    switch (head) {
      case 'player':
        return fromRecord(ctx.player, tail);
      case 'club':
        return fromRecord(ctx.club, tail);
      case 'opponent':
        return fromRecord(ctx.opponent, tail);
      case 'world':
        return ctx.world?.[tail];
      case 'actor':
        return this.resolveActor(tail, ctx);
      case 'memory':
        return this.resolveMemory(tail, ctx);
      default:
        return undefined;
    }
  }

  /** actor.<slot>.<alan> -- alan verilmezse tam ad. */
  private resolveActor(tail: string, ctx: InterpolationContext): string | undefined {
    if (!ctx.actor) return undefined;
    const dot = tail.indexOf('.');
    const view = ctx.actor(dot > 0 ? tail.slice(0, dot) : tail);
    if (!view) return undefined;
    const field = dot > 0 ? tail.slice(dot + 1) : 'name';
    const value = (view as unknown as Record<string, unknown>)[field];
    return value === undefined ? undefined : String(value);
  }

  /** memory.<mem_flag>.<alan> -- izi kim birakti, ne zaman birakti. */
  private resolveMemory(tail: string, ctx: InterpolationContext): string | undefined {
    if (!ctx.memory) return undefined;
    const dot = tail.lastIndexOf('.');
    if (dot <= 0) return undefined;
    return ctx.memory(tail.slice(0, dot), tail.slice(dot + 1));
  }

  private formatFlag(v: FlagValue): string {
    if (typeof v === 'number') {
      // Buyuk paralar okunabilir olsun: 730000 -> "730.000"
      return Number.isInteger(v) && Math.abs(v) >= 10000
        ? v.toLocaleString('tr-TR')
        : String(v);
    }
    if (typeof v === 'boolean') return v ? 'evet' : 'hayir';
    return v;
  }
}

function fromRecord(
  rec: Readonly<Record<string, string | number>> | undefined,
  field: string,
): string | undefined {
  const v = rec?.[field];
  return v === undefined ? undefined : String(v);
}
