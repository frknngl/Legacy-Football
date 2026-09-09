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
    const state = structuredClone(envelope.state);
    state.flags = this.reconcileFlags(state.flags);
    // Dizi/nesne alanlari eski kayitta eksik olabilir.
    state.flagSetTurn ??= {};
    state.flagSource ??= {};
    state.scheduledEvents ??= [];
    state.consequenceLog ??= [];
    state.history ??= [];
    state.seenEvents ??= {};
    state.seenVariants ??= {};
    state.cooldowns ??= {};
    state.familyCooldowns ??= {};
    // v2 -> v3: bu alanlar sonradan eklendi. Eski kayitta YOKLAR ve
    // eksik olduklarinda sessizce degil SERT bicimde bozarlar:
    // `signAgent` icindeki `formerAgents.length` "Cannot read
    // properties of undefined" ile oyunu cokertiyordu. Kanitlandi.
    state.categoryCooldowns ??= {};
    state.formerAgents ??= [];
    // Cuzdan defteri: eski kayitlarda yok. Bos dizi dogru anlamdir --
    // gecmis hareketler kaydedilmemis, ama bundan sonrakiler yazilir.
    state.wallet ??= [];
    state.walletTotals ??= {};
    state.assets ??= [];
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

  /** Kayitta olup registry'de olmayan flag'ler -- uyari amacli. */
  unknownFlags(state: GameState): string[] {
    return Object.keys(state.flags).filter((k) => !this.registry.has(k));
  }
}
