/**
 * UC SEVIYELI COOLDOWN.
 *
 * Eski sistemin en gorunur hatasi cooldown'un yalnizca OLAY bazli olmasiydi:
 * "gece kulubu skandali" olayinin 100 kopyasi vardi, her birinin kendi
 * cooldown'u vardi ve oyuncu ust uste 100 hafta gece kulubune gidebiliyordu.
 *
 * Cozum: her olay bir AILEYE aittir. Ayni aileden bir olay ciktiginda tum aile
 * birden soguma suresine girer.
 *
 * UCUNCU SEVIYE -- KATEGORI:
 *   Aile sogumasi ayni SAHNENIN tekrarini engelliyordu ama ayni TONUN
 *   tekrarini engellemiyordu. Soyunma odasinda bes ayri aileye ait bes olay
 *   var; her birinin aile sogumasi bagimsiz oldugu icin ust uste dordu birden
 *   cikabiliyordu (olculdu: 7 haftada 4 locker sahnesi, 16 yasindaki bir
 *   oyuncuya). Kategori sogumasi bu bosluğu kapatir ve `cadence.json`dan
 *   VERI olarak gelir -- kod degil.
 */

import type { StoryEvent } from '../domain/story.js';
import type { CadenceConfig } from '../domain/orchestrator.js';

export interface CooldownState {
  /** eventId -> son gorulme turu. */
  readonly cooldowns: Record<string, number>;
  /** family -> son gorulme turu. */
  readonly familyCooldowns: Record<string, number>;
  /** category -> son gorulme turu. Eski kayitlarda olmayabilir. */
  readonly categoryCooldowns?: Record<string, number>;
}

export type CooldownBlockReason = 'self' | 'family' | 'category' | 'once';

export class CooldownTracker {
  /**
   * @param cadence Kategori sogumalari. Verilmezse kategori kapisi KAPALI
   *   kalir -- eski davranis, zarif bozulma.
   */
  constructor(private readonly cadence: CadenceConfig = { defaultCooldown: 0, categories: {} }) {}

  /** Bu kategorinin soguma suresi. Tabloda yoksa varsayilan. */
  categoryCooldown(category: string): number {
    return this.cadence.categories[category] ?? this.cadence.defaultCooldown;
  }

  /** Olay su anda soguma nedeniyle bloklu mu? Blokluysa SEBEBINI dondurur. */
  blockedBy(
    event: StoryEvent,
    turn: number,
    state: CooldownState,
    seenEvents: Readonly<Record<string, number>>,
  ): CooldownBlockReason | undefined {
    if (event.once === true && seenEvents[event.id] !== undefined) return 'once';

    const lastSelf = state.cooldowns[event.id];
    if (lastSelf !== undefined && turn - lastSelf < event.cooldown.self) return 'self';

    const lastFamily = state.familyCooldowns[event.family];
    if (lastFamily !== undefined && turn - lastFamily < event.cooldown.family) return 'family';

    const window = this.categoryCooldown(event.category);
    if (window > 0) {
      const lastCategory = state.categoryCooldowns?.[event.category];
      if (lastCategory !== undefined && turn - lastCategory < window) return 'category';
    }

    return undefined;
  }

  isAvailable(
    event: StoryEvent,
    turn: number,
    state: CooldownState,
    seenEvents: Readonly<Record<string, number>>,
  ): boolean {
    return this.blockedBy(event, turn, state, seenEvents) === undefined;
  }

  /** Olay gosterildikten sonra hem kendisini hem AILESINI isaretler. */
  mark(
    event: StoryEvent,
    turn: number,
    state: {
      cooldowns: Record<string, number>;
      familyCooldowns: Record<string, number>;
      categoryCooldowns?: Record<string, number>;
    },
  ): void {
    state.cooldowns[event.id] = turn;
    state.familyCooldowns[event.family] = turn;
    if (state.categoryCooldowns === undefined) state.categoryCooldowns = {};
    state.categoryCooldowns[event.category] = turn;
  }
}
