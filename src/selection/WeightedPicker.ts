/**
 * Agirlikli secim + ritim duzelticileri.
 *
 * Ham agirlik yetmez. Uc duzeltici olmadan oyun "ayni kategoriden ard arda
 * bes olay" ya da "ust uste iki epic" gibi kotu bir ritim uretir:
 *
 *  1. ANTI-TEKRAR   : son N olayda ayni kategori gectiyse agirlik cezalandirilir
 *  2. TIER DENGESI  : epic'ten hemen sonra epic gelmez; nefes alma araligi
 *  3. PERSONA BONUSU: kimligine uyan olaylar daha sik cikar
 */

import type { Tier } from '../domain/axes.js';
import type { StoryEvent } from '../domain/story.js';
import type { HistoryEntry, PersonaState } from '../domain/state.js';
import { PersonaAccumulator } from '../evaluation/PersonaAccumulator.js';
import type { Rng } from './Rng.js';

/** Son kac olay anti-tekrar penceresine girer. */
const RECENCY_WINDOW = 6;
/** Ayni kategori penceredeyse agirlik bu carpanla azalir (her tekrar icin). */
const CATEGORY_PENALTY = 0.45;
/** Ayni aile penceredeyse ek ceza -- cooldown'u atlatmis olsa bile. */
const FAMILY_PENALTY = 0.3;
/** Persona uyumunun agirliga en fazla katabilecegi carpan. */
const PERSONA_BONUS = 0.6;

const TIER_BASE: Record<Tier, number> = {
  epic: 0.6,
  major: 1,
  minor: 1.2,
  beat: 1.4,
};

/** Bir epic ciktiktan sonra kac tur boyunca ikinci epic bastirilir. */
const EPIC_BREATHER = 8;

/**
 * Acik bir incident'e bagli olayin agirlik carpani.
 *
 * 12 kasitli olarak BUYUK: bu olaylarin siradan bir sahneyle yarismasi
 * degil, siranin onune gecmesi gerekiyor. Incident'ler suresizdir degil
 * -- sonerler; kacirilan tepki sahnesi bir daha hic cikmaz.
 */
const INCIDENT_PRIORITY = 12;

/** Olayin tetigi ACIK bir `inc_*` izine mi bakiyor. */
function referencesOpenIncident(
  event: StoryEvent,
  flags: Readonly<Record<string, unknown>>,
): boolean {
  const trigger = event.trigger;
  if (trigger === undefined) return false;
  let found = false;
  const walk = (node: unknown): void => {
    if (found || node === null || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    const flag = rec['flag'];
    if (typeof flag === 'string' && flag.startsWith('inc_') && flags[flag] === true) {
      found = true;
      return;
    }
    for (const value of Object.values(rec)) {
      if (Array.isArray(value)) value.forEach(walk);
      else walk(value);
    }
  };
  walk(trigger);
  return found;
}

export class WeightedPicker {
  constructor(private readonly persona: PersonaAccumulator = new PersonaAccumulator()) {}

  /** Duzelticiler uygulandiktan sonraki etkin agirlik. */
  effectiveWeight(
    event: StoryEvent,
    ctx: {
      turn: number;
      history: readonly HistoryEntry[];
      persona: PersonaState;
      flags?: Readonly<Record<string, unknown>>;
    },
  ): number {
    let w = event.weight * (TIER_BASE[event.tier] ?? 1);
    if (w <= 0) return 0;

    const recent = ctx.history.slice(-RECENCY_WINDOW);

    for (const entry of recent) {
      if (entry.category === event.category) w *= CATEGORY_PENALTY;
      if (entry.family === event.family) w *= FAMILY_PENALTY;
    }

    if (event.tier === 'epic') {
      const lastEpic = [...ctx.history].reverse().find((h) => h.tier === 'epic');
      if (lastEpic !== undefined && ctx.turn - lastEpic.turn < EPIC_BREATHER) {
        w *= 0.15;
      }
    }

    const affinity = this.persona.affinity(ctx.persona, event.personaAffinity);
    w *= 1 + affinity * PERSONA_BONUS;

    // ACIK OLAY (incident) ONCELIGI.
    //
    // Bir `inc_*` izine bagli olay ZAMANA DUYARLIDIR: VAR tartismasi
    // roportaji mactan iki hafta sonra cikmali, on iki hafta sonra
    // degil. Ama bu olaylar siradan havuzda yarisiyor ve havuz her yeni
    // icerikle buyudugu icin paylari KACINILMAZ olarak eriyor.
    //
    // Olculdu: iki ayri seferde, yalnizca yeni olay eklemek
    // `evt_react_var_controversy`yi sekiz turluk penceresinden disari
    // itti ve zincir testi patladi. Agirliklari surekli kismak bunu
    // cozmez -- icerik buyudukce yine kirilir.
    //
    // Cozum tek noktada: acik bir incident'e bagli olay havuzda
    // ONCELIKLI olur. Bu bir "onemlilik" primi degil, ZAMANLAMA primi.
    if (ctx.flags !== undefined && referencesOpenIncident(event, ctx.flags)) {
      w *= INCIDENT_PRIORITY;
    }

    return w;
  }

  pick(
    events: readonly StoryEvent[],
    rng: Rng,
    ctx: {
      turn: number;
      history: readonly HistoryEntry[];
      persona: PersonaState;
      flags?: Readonly<Record<string, unknown>>;
    },
  ): StoryEvent | undefined {
    if (events.length === 0) return undefined;

    // ACIK INCIDENT VARSA HAVUZ DARALIR -- carpan degil, SIRA.
    //
    // OLCULEN SORUN: incident onceligi bir agirlik carpaniydi (x12) ve
    // korpus buyudukce SEYRELDI. 165 olayken yeterliydi; 215 olayken
    // `evt_react_var_controversy` (60 x 12 = 720) siradan olaylarin
    // toplamina karsi ~%14'te kaldi ve zincir testi 8 turluk pencereyi
    // kacirdi (olay 11. turda cikti).
    //
    // Bu, kodun kendi yorumunun soyledigi seyle celisiyordu: "bu
    // olaylarin siradan bir sahneyle YARISMASI degil, siranin onune
    // GECMESI gerekiyor". Carpan "daha guclu yaris" demektir; niyet
    // "once sen" idi.
    //
    // Artik acik bir incident'e bagli aday VARSA secim yalnizca onlarin
    // arasinda yapilir. Icerik buyudukce bozulmaz: oran degil KUME.
    if (ctx.flags !== undefined) {
      const urgent = events.filter((e) => referencesOpenIncident(e, ctx.flags!));
      if (urgent.length > 0) {
        return rng.weighted(urgent, (e) => this.effectiveWeight(e, ctx));
      }
    }

    return rng.weighted(events, (e) => this.effectiveWeight(e, ctx));
  }
}
