/**
 * Incident defteri -- iki katmanli hafizanin KISA omurlu katmani.
 *
 *   inc_*  : sonraki maca kadar yasar. Mac sonu roportaji ve soyunma odasi
 *            tepkisi bunlari okur. HER MACIN BASINDA otomatik silinir --
 *            boylece uc hafta once kacirdigin penalti bu haftanin roportajinda
 *            sorulmaz.
 *   mem_*  : kalici ve zaman damgali. Yillar sonra belgeselde geri doner.
 *
 * Ornek: kupa finalinde penalti kacirma ->
 *   inc_missed_penalty       (bu haftanin roportaji)
 * + mem_missed_final_penalty (6 sezon sonra turnsSince >= 240 ile Sinan
 *                             Erdogan'in "kariyerinin golgesi" dosyasi)
 */

import type { FlagRegistry, FlagValue } from '../domain/flags.js';
import type { MatchIncident } from '../domain/match.js';
import type { MutableFlagState } from '../evaluation/EffectApplier.js';

export class IncidentLedger {
  constructor(private readonly registry: FlagRegistry) {}

  /** Yeni macin basinda cagrilir: tum inc_* flag'leri default'a doner. */
  clear(state: MutableFlagState): string[] {
    const cleared: string[] = [];
    for (const def of this.registry.byKind('incident')) {
      if (state.flags[def.key] !== def.default) {
        state.flags[def.key] = def.default;
        cleared.push(def.key);
      }
      // Damga da silinir; bayat bir roportaj izi kalmasin.
      delete state.flagSetTurn[def.key];
      delete state.flagSource[def.key];
    }
    return cleared;
  }

  /**
   * Mac icinde olusan incident'leri flag'lere yazar ve KAYNAK KARARI damgalar.
   *
   * Damga olmadan roportaj olayi "neden ciktim" sorusuna cevap veremez:
   * `inc_*` flag'leri EffectApplier'dan gecmedigi icin attribution'i buradan
   * almak zorundalar.
   */
  record(state: MutableFlagState, incidents: readonly MatchIncident[]): void {
    for (const inc of incidents) {
      const def = this.registry.get(inc.flag);
      if (!def || def.kind !== 'incident') continue;
      state.flags[inc.flag] = true;
      // Metin enterpolasyonu icin baglam: "{inc_opponent} deplasmaninda
      // {inc_minute}. dakikada..."
      state.flags['inc_minute'] = inc.minute;
      state.flags['inc_scoreline'] = inc.scoreline;
      state.flags['inc_opponent'] = inc.opponent;

      if (inc.causedByEventId !== undefined) {
        state.flagSetTurn[inc.flag] = state.turn;
        state.flagSource[inc.flag] = {
          eventId: inc.causedByEventId,
          choiceId: inc.causedByChoiceId ?? '',
          choiceText: inc.causedByChoiceText ?? '',
          turn: state.turn,
        };
      }
    }
  }

  /** Su an acik olan incident'ler -- roportaj olaylarinin tetigi. */
  active(flags: Readonly<Record<string, FlagValue>>): string[] {
    return this.registry
      .byKind('incident')
      .filter((d) => d.type === 'boolean' && flags[d.key] === true)
      .map((d) => d.key);
  }
}
