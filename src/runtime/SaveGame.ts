/**
 * Kaydet / yukle.
 *
 * IKI YONLU UYUM:
 *   - Bilinmeyen flag KORUNUR. Eski bir kayitta artik silinmis bir flag varsa
 *     atilmaz; icerik geri gelirse kaldigi yerden calisir.
 *   - Eksik flag registry default'uyla doldurulur. Yeni eklenen flag eski
 *     kaydi bozmaz.
 *
 * Bu iki kural olmadan icerik gelistirme sirasinda her kayit cope gider.
 */

import type { FlagRegistry, FlagValue } from '../domain/flags.js';
import { SAVE_SCHEMA_VERSION, type GameState, type SaveEnvelope } from '../domain/state.js';

const MIN_SUPPORTED_SCHEMA_VERSION = 1;
const MAX_RNG_CURSOR = 5_000_000;

export class SaveGame {
  constructor(private readonly registry: FlagRegistry) {}

  save(state: GameState): SaveEnvelope {
    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      // Derin kopya: kaydettikten sonra oyuna devam edilirse kayit bozulmasin.
      state: structuredClone(state),
    };
  }

  serialize(state: GameState): string {
    return JSON.stringify(this.save(state), null, 2);
  }

  load(envelope: SaveEnvelope): GameState {
    const migrated = this.migrate(envelope);
    this.assertEnvelope(migrated);

    const state = structuredClone(migrated.state);
    state.flags = this.reconcileFlags(state.flags);
    state.rngStreams = this.reconcileRngStreams(
      (state as unknown as Record<string, unknown>)['rngStreams'],
      state.rngSeed,
      state.rngCursor,
    );
    // Geriye donuk uyum: legacy alan secim akisinin imlecini tasir.
    state.rngCursor = state.rngStreams.selection.cursor;
    // Dizi/nesne alanlari eski kayitta eksik olabilir.
    state.flagSetTurn ??= {};
    state.flagSource ??= {};
    state.scheduledEvents ??= [];
    state.consequenceLog ??= [];
    state.history ??= [];
    state.history = this.reconcileHistory(state.history);
    state.nextOccurrenceId = this.nextOccurrenceCursor(
      (state as unknown as Record<string, unknown>)['nextOccurrenceId'],
      state.history,
    );
    state.seenEvents ??= {};
    state.seenVariants ??= {};
    state.cooldowns ??= {};
    state.familyCooldowns ??= {};
    // v2 -> v3: bu alanlar sonradan eklendi. Eski kayitta YOKLAR ve
    // eksik olduklarinda sessizce degil SERT bicimde bozarlar:
    // `signAgent` icindeki `formerAgents.length` "Cannot read
    // properties of undefined" ile oyunu cokertiyordu. Kanitlandi.
    state.categoryCooldowns ??= {};
    state.storyArcTurns ??= {};
    state.storyBeatTurns ??= {};
    state.storyBeatCounts ??= {};
    state.storySignatureTurns ??= {};
    state.formerAgents ??= [];
    // Cuzdan defteri: eski kayitlarda yok. Bos dizi dogru anlamdir --
    // gecmis hareketler kaydedilmemis, ama bundan sonrakiler yazilir.
    state.wallet ??= [];
    state.walletTotals ??= {};
    state.assets ??= [];
    // Piyasa: eski kayitlarda yok. Bos fiyat tablosu dogru anlam --
    // `tickMarkets` ilk haftada katalog fiyatlarindan tohumlar.
    state.market ??= { prices: {}, holdings: [] };
    state.market.prices ??= {};
    state.market.holdings ??= [];
    state.favors ??= [];
    // Ozel hayat: eski kayitlarda yok. `tanisma` dogru baslangic --
    // kariyer yalniz baslar ve tanisma hikayenin kendisi.
    state.privateLife ??= {
      stage: 'tanisma',
      closeness: 40,
      strain: 0,
      lastContactTurn: 0,
      stageSince: 0,
      unanswered: 0,
      usedThisWeek: {},
      highStrainWeeks: 0,
    };
    state.injury ??= { fragility: 0 };
    state.injury.fragility ??= 0;
    state.privateLife.usedThisWeek ??= {};
    state.privateLife.highStrainWeeks ??= 0;
    state.ratingHistory ??= [];
    state.availability ??= { available: true, matchesRemaining: 0 };
    // v1 -> v2: kimlik katmani. Eski kayitta kadro yoktur; bos baslar ve
    // motor bir sonraki casting cagrisinda slotlari yeniden doldurur.
    state.flagActor ??= {};
    state.actors ??= {};
    state.casting ??= {};
    state.clubId ??= '';
    // v1'de rakip silinmis kadro katmanina (`castRef: "marco"`) isaret ediyordu.
    state.nemesis ??= {
      arcId: '',
      slotRef: 'nemesis',
      stature: 'nobody',
      arcStage: 0,
      relation: 30,
      lastStageTurn: 0,
    };
    state.nemesis.arcId ??= '';
    state.nemesis.slotRef ??= 'nemesis';
    state.nemesis.lastStageTurn ??= 0;
    return state;
  }

  deserialize(json: string): GameState {
    return this.load(JSON.parse(json) as SaveEnvelope);
  }

  /**
   * Eksik flag'e default, bilinmeyene DOKUNMA.
   * Bilinmeyeni silmek, icerik gelistirme sirasinda geri alinamaz veri kaybidir.
   */
  private reconcileFlags(saved: Record<string, FlagValue>): Record<string, FlagValue> {
    const out: Record<string, FlagValue> = { ...saved };
    for (const def of this.registry.all()) {
      if (!(def.key in out)) out[def.key] = def.default;
    }
    return out;
  }

  private migrate(envelope: SaveEnvelope): SaveEnvelope {
    const raw = (envelope as unknown as Record<string, unknown>)['schemaVersion'];
    if (!isFiniteInt(raw)) {
      throw new Error('Kayit bozuk: schemaVersion sayisal degil.');
    }
    if (raw < MIN_SUPPORTED_SCHEMA_VERSION) {
      throw new Error(`Kayit surumu desteklenmiyor: v${raw}.`);
    }
    if (raw > SAVE_SCHEMA_VERSION) {
      throw new Error(
        `Kayit daha yeni bir surumle uretilmis: v${raw} > v${SAVE_SCHEMA_VERSION}.`,
      );
    }
    // v1 -> v2 gecisinde alan backfill'i zaten load asamasinda yapiliyor.
    return raw === SAVE_SCHEMA_VERSION
      ? envelope
      : { ...envelope, schemaVersion: SAVE_SCHEMA_VERSION };
  }

  private assertEnvelope(envelope: SaveEnvelope): void {
    if (!isRecord(envelope) || !isRecord(envelope.state)) {
      throw new Error('Kayit bozuk: state bulunamadi.');
    }

    const state = envelope.state as unknown as Record<string, unknown>;
    if (!isRecord(state.flags)) throw new Error('Kayit bozuk: flags nesnesi yok.');

    this.assertNonNegativeInt(state.turn, 'turn');
    this.assertNonNegativeInt(state.season, 'season');
    this.assertNonNegativeInt(state.week, 'week');
    this.assertNonNegativeInt(state.age, 'age');
    this.assertNonNegativeInt(state.startAge, 'startAge');
    this.assertNonNegativeInt(state.rngSeed, 'rngSeed');
    this.assertNonNegativeInt(state.rngCursor, 'rngCursor');

    const streams = state['rngStreams'];
    if (streams !== undefined && !isRecord(streams)) {
      throw new Error('Kayit bozuk: rngStreams nesnesi gecerli degil.');
    }

    if ((state.rngCursor as number) > MAX_RNG_CURSOR) {
      throw new Error(
        `Kayit bozuk: rngCursor siniri asildi (${state.rngCursor} > ${MAX_RNG_CURSOR}).`,
      );
    }
  }

  private reconcileRngStreams(
    raw: unknown,
    seed: number,
    selectionCursor: number,
  ): GameState['rngStreams'] {
    const defaults: GameState['rngStreams'] = {
      selection: { seed: this.streamSeed(seed, 0x9e3779b9), cursor: selectionCursor },
      casting: { seed: this.streamSeed(seed, 0x7f4a7c15), cursor: 0 },
      simulation: { seed: this.streamSeed(seed, 0x243f6a88), cursor: 0 },
    };

    if (!isRecord(raw)) return defaults;

    return {
      selection: this.reconcileOneStream(raw['selection'], defaults.selection),
      casting: this.reconcileOneStream(raw['casting'], defaults.casting),
      simulation: this.reconcileOneStream(raw['simulation'], defaults.simulation),
    };
  }

  private reconcileOneStream(
    raw: unknown,
    fallback: GameState['rngStreams']['selection'],
  ): GameState['rngStreams']['selection'] {
    if (!isRecord(raw)) return fallback;
    const seed = isFiniteInt(raw['seed']) && raw['seed'] >= 0 ? (raw['seed'] as number) : fallback.seed;
    const cursor =
      isFiniteInt(raw['cursor']) && raw['cursor'] >= 0 && raw['cursor'] <= MAX_RNG_CURSOR
        ? (raw['cursor'] as number)
        : fallback.cursor;
    return { seed, cursor };
  }

  private streamSeed(seed: number, salt: number): number {
    return (seed ^ salt) >>> 0;
  }

  private reconcileHistory(history: GameState['history']): GameState['history'] {
    const taken = new Set<string>();
    let cursor = 1;

    return history.map((entry) => {
      const raw = (entry as unknown as Record<string, unknown>)['occurrenceId'];
      if (typeof raw === 'string' && raw !== '' && !taken.has(raw)) {
        taken.add(raw);
        const parsed = this.parseOccurrenceCursor(raw);
        if (parsed !== undefined) cursor = Math.max(cursor, parsed + 1);
        return { ...entry, occurrenceId: raw };
      }

      let generated = `occ_${cursor}`;
      while (taken.has(generated)) {
        cursor += 1;
        generated = `occ_${cursor}`;
      }
      taken.add(generated);
      cursor += 1;
      return { ...entry, occurrenceId: generated };
    });
  }

  private nextOccurrenceCursor(raw: unknown, history: GameState['history']): number {
    let next = isFiniteInt(raw) && raw > 0 ? raw : 1;
    for (const entry of history) {
      const parsed = this.parseOccurrenceCursor(entry.occurrenceId);
      if (parsed !== undefined) next = Math.max(next, parsed + 1);
    }
    return next;
  }

  private parseOccurrenceCursor(value: string): number | undefined {
    const match = /^occ_(\d+)$/.exec(value);
    if (!match) return undefined;
    const parsed = Number.parseInt(match[1] ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private assertNonNegativeInt(value: unknown, field: string): void {
    if (!isFiniteInt(value) || value < 0) {
      throw new Error(`Kayit bozuk: ${field} gecerli bir tamsayi degil.`);
    }
  }

  /** Kayitta olup registry'de olmayan flag'ler -- uyari amacli. */
  unknownFlags(state: GameState): string[] {
    return Object.keys(state.flags).filter((k) => !this.registry.has(k));
  }
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
