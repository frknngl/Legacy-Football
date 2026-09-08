/**
 * Ilerleme takibi: sohret ve kulup seviyesi.
 *
 * Her tur `stature` yeniden turetilir. Seviye atlama ya da dusme bir OLAY
 * tetikler -- "artik yildizsin" / "telefonun calmiyor artik". Ilerleme sessiz
 * bir sayi degil, anlatilan bir andir.
 */

import { CLUB_TIERS, type ClubTier, type Stature } from '../domain/axes.js';
import type { FlagValue } from '../domain/flags.js';
import type { ProgressionConfig } from '../domain/orchestrator.js';
import { StatureCalculator } from '../evaluation/StatureCalculator.js';

export interface ProgressionChange {
  readonly stature: Stature;
  readonly clubTier: ClubTier;
  /** Seviye degistiyse tetiklenecek olay. */
  readonly triggerEvent?: string;
  readonly direction?: 'up' | 'down';
}

export class ProgressionTracker {
  private readonly calculator: StatureCalculator;

  constructor(private readonly config: ProgressionConfig) {
    this.calculator = new StatureCalculator(config);
  }

  update(
    current: { stature: Stature; clubTier: ClubTier },
    flags: Record<string, FlagValue>,
  ): ProgressionChange {
    const next = this.calculator.next(current.stature, flags);
    flags['stature'] = next;
    flags['club_tier'] = current.clubTier;

    if (next === current.stature) {
      return { stature: next, clubTier: current.clubTier };
    }

    const up = this.indexOf(next) > this.indexOf(current.stature);
    const triggerEvent = up ? this.config.promotionEvent : this.config.demotionEvent;

    return {
      stature: next,
      clubTier: current.clubTier,
      direction: up ? 'up' : 'down',
      ...(triggerEvent !== undefined ? { triggerEvent } : {}),
    };
  }

  /** Kulup seviyesini dogrudan degistirir (transfer, tahliye sonrasi dusus). */
  setClubTier(flags: Record<string, FlagValue>, tier: ClubTier): ClubTier {
    flags['club_tier'] = tier;
    return tier;
  }

  static isClubTier(v: string): v is ClubTier {
    return (CLUB_TIERS as readonly string[]).includes(v);
  }

  private indexOf(s: Stature): number {
    return this.config.statureThresholds.findIndex((t) => t.id === s);
  }
}
