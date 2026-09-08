/**
 * Oyun durumu ve zamanlama yapilari.
 */

import type { Archetype, ClubTier, LifeState, MediaEra, PersonaAxis, Stature } from './axes.js';
import type { ActorState, Casting, NemesisResolution } from './actors.js';
import type { FlagValue } from './flags.js';
import type { PlayerAvailability } from './match.js';
import type { AgentState } from './agent.js';

/** Kuyruga alinmis, vadesi gelince calisacak olay. */
export interface ScheduledEvent {
  readonly eventId: string;
  readonly dueTurn: number;
  readonly priority: 'forced' | 'weighted';
  readonly onIneligible: 'defer' | 'fire' | 'cancel';
  readonly maxDeferTurns: number;
  readonly replaceWith?: string;
  /** Kelebek izi: bunu kim zamanladi? */
  readonly sourceEventId: string;
  readonly sourceTurn: number;
  /** Kac tur ertelendi -- maxDeferTurns denetimi icin. */
  readonly deferredTurns: number;
}

/**
 * KELEBEK GUNLUGU kaydi.
 *
 * "Bu olay su yuzden cikti: Sezon 5, Hafta 12 -- Cem Aga'nin teklifini kabul ettin."
 */
export interface ConsequenceTrace {
  readonly eventId: string;
  readonly viaFlag: string;
  readonly causedByTurn: number;
  readonly causedBySeason: number;
  readonly causedByWeek: number;
  readonly causedByEventId: string;
  readonly causedByChoiceId: string;
  readonly causedByChoiceText: string;
}

/** Gecmis halka tamponundaki bir kayit. */
export interface HistoryEntry {
  readonly turn: number;
  readonly eventId: string;
  readonly variantId?: string;
  readonly family: string;
  readonly category: string;
  readonly tier: string;
  readonly choiceIds: readonly string[];
}

/** Baskarakterin paralel kariyer yasayan rakibi. */
export interface NemesisState {
  /** Hangi ark oynaniyor (nemesis.json id'si). Ark yoksa bos. */
  arcId: string;
  /** roles.json'daki world-scope slot. */
  slotRef: string;
  stature: Stature;
  /** 0-N arasi, tamamlanmis asama sayisi. */
  arcStage: number;
  /** 0-100, senin ona bakisin. */
  relation: number;
  /** Son ark sahnesinin turu -- asamalar bir sezona sikismasin diye. */
  lastStageTurn: number;
  /** Su an kuyruga alinmis asama (varsa) -- iki kez planlanmasin diye. */
  queuedStage?: number;
  /** Ark sonuclandiysa hangi finalle. */
  resolution?: NemesisResolution;
}

export type PersonaState = Record<PersonaAxis, number>;

/**
 * Tum oyun durumu. SaveGame bunu serilestirir.
 *
 * `flagSetTurn` kelebek altyapisidir: bir memory flag set edildiginde
 * o anin turu buraya yazilir; `turnsSince` operatoru bunu okur.
 */
export interface GameState {
  flags: Record<string, FlagValue>;
  /** memory flag'lerinin set edildigi tur -- turnsSince ve ConsequenceLedger icin. */
  flagSetTurn: Record<string, number>;
  /** Bir flag'i en son hangi olay/secim yazdi -- kelebek gunlugu icin. */
  flagSource: Record<string, { eventId: string; choiceId: string; choiceText: string; turn: number }>;
  /**
   * Bir `mem_*` izini KIM'in yuzunden tasidigin.
   *
   * Isimler prosedurel oldugu icin iz kalici olsa da yuz kaybolurdu; bu damga
   * olmadan "alti sezon once seni satan kaptan" cumlesi kurulamaz.
   */
  flagActor: Record<string, string>;

  turn: number;
  season: number;
  week: number;
  age: number;
  startAge: number;
  archetype: Archetype;

  lifeState: LifeState;
  /** Gecici hayat durumunun bitecegi tur (suresizse undefined). */
  lifeStateUntil?: number;
  /**
   * Zorunlu emekliligin gerceklestigi tur. `undefined` = henuz emekli degil.
   *
   * Optional oldugu icin ESKI KAYITLAR backfill gerektirmez: eksik olmasi
   * "emekli olmamis" demektir ve dogru anlamdir.
   */
  retiredAtTurn?: number;

  stature: Stature;
  clubTier: ClubTier;
  /** Su an hangi kulupte. Kadro ve teknik heyet buradan cozulur. */
  clubId: string;
  mediaEra: MediaEra;
  persona: PersonaState;
  nemesis: NemesisState;

  /** Tanidigin herkes. Transferde SILINMEZ, arsive gider. */
  actors: Record<string, ActorState>;
  /** slotId -> actorId. Bos slot = su an sahnede degil. */
  casting: Casting;

  availability: PlayerAvailability;

  /** Kariyer boyunca gorulen olay id'leri (once ve anti-tekrar icin). */
  seenEvents: Record<string, number>;
  /** Gorulen varyantlar: "eventId#variantId" -> gorulme turu. */
  seenVariants: Record<string, number>;
  /** eventId -> son gorulme turu. */
  cooldowns: Record<string, number>;
  /** family -> son gorulme turu. */
  familyCooldowns: Record<string, number>;
  /** category -> son gorulme turu. Ayni TONUN ust uste tekrarini engeller. */
  categoryCooldowns: Record<string, number>;

  scheduledEvents: ScheduledEvent[];
  consequenceLog: ConsequenceTrace[];
  history: HistoryEntry[];

  /** Son bes macin reytingi -- `form` bundan turetilir. */
  ratingHistory: number[];

  rngSeed: number;
  /** RNG kac kez cagrildi -- kaydet/yukle sonrasi determinizm icin. */
  rngCursor: number;

  /**
   * MENAJER -- su anki. Yoksa Hero menajersiz.
   *
   * Menajersizlik gecerli bir durum, hata degil: kariyer menajersiz
   * baslar (kimse ilk sozlesmesini menajerle imzalamaz), menajer
   * memnuniyetsizlikten birakabilir, oyuncu fesih edebilir.
   */
  agent?: AgentState | undefined;
  /**
   * Daha once calisilan menajerlerin ID'leri.
   *
   * Sayisi yeni menajerin baslangic memnuniyetini DUSURUR: sik menajer
   * degistiren oyuncuya piyasa soguk bakar.
   */
  formerAgents: number[];

  /** Kariyer sonlandiysa hangi sonla. */
  ending?: string;
}

/** Kaydedilmis oyun zarfi. Bilinmeyen flag'ler KORUNUR. */
export interface SaveEnvelope {
  readonly schemaVersion: number;
  readonly savedAt: string;
  readonly state: GameState;
}

export const SAVE_SCHEMA_VERSION = 2;
