/**
 * Isim dokumhanesi.
 *
 * Icerik ozel isim YAZMAZ; her isim burada uretilir. 115 ad x 110 soyad =
 * 12.650 benzersiz Turkce kombinasyon -- 25 sezonluk kariyerde ayni ismin iki
 * kez dokulmesi pratikte imkansizdir.
 *
 * SAFTIR: `Rng` yerine bir `roll: () => number` alir. Boylece hem `selection`
 * katmanindaki motor RNG'si hem de `testing` altindaki mock saglayici ayni
 * dokumhaneyi kullanabilir ve katman yonu bozulmaz.
 */

import type { Gender, NameConfig, NamePool } from '../domain/actors.js';

export type { Gender, NameConfig, NamePool };

export interface ForgeOptions {
  readonly gender?: Gender | 'any';
  readonly origin?: string;
  /** "Cem 'Aga' Dogan" bicimi. */
  readonly nicknamed?: boolean;
  /** "Dr. Nalan Kurt" bicimi. */
  readonly titled?: string;
}

export interface ForgedName {
  readonly first: string;
  readonly last: string;
  readonly displayName: string;
  readonly origin: string;
  readonly gender: Gender;
}

export type Roll = () => number;

function pick<T>(items: readonly T[], roll: Roll): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(roll() * items.length)];
}

/** Kararli 32-bit string hash -- kulup/aktor basina tohum turetmek icin. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class NameForge {
  constructor(private readonly config: NameConfig) {}

  /** Kulup seviyesine gore yabanci mi yerli mi bir koken secer. */
  originFor(clubTier: string, roll: Roll): string {
    const ratio = this.config.foreignRatioByClubTier[clubTier] ?? 0;
    if (ratio <= 0 || roll() >= ratio) return 'tr';
    return pick(this.config.foreignOrigins, roll) ?? 'tr';
  }

  forge(opts: ForgeOptions, roll: Roll): ForgedName {
    const origin = opts.origin ?? 'tr';
    const pool = this.config.pools[origin] ?? this.config.pools['tr'];
    if (!pool) throw new Error(`Isim havuzu bulunamadi: "${origin}"`);

    const gender: Gender =
      opts.gender === 'female'
        ? 'female'
        : opts.gender === 'male'
          ? 'male'
          : roll() < 0.5
            ? 'male'
            : 'female';

    const firstPool = gender === 'female' && pool.female.length > 0 ? pool.female : pool.male;
    const first = pick(firstPool, roll) ?? 'Adsiz';
    const last = pick(pool.last, roll) ?? 'Bilinmeyen';

    let displayName = `${first} ${last}`;
    if (opts.nicknamed === true) {
      const nick = pick(this.config.nicknames, roll);
      if (nick !== undefined) displayName = `${first} '${nick}' ${last}`;
    }
    if (opts.titled !== undefined) displayName = `${opts.titled} ${displayName}`;

    return { first, last, displayName, origin, gender };
  }
}
