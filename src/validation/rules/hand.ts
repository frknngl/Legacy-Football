/**
 * ELLE YAZILMIS OLAYLAR ICIN OZEL KURALLAR (Editör Kapısı).
 *
 * `authored: "hand"` olarak isaretlenen olaylar otomatik uretimlerden
 * daha yuksek bir kalite ve sozlesme standardina tabidir:
 *
 * 1. `HandTemplateIdRule` (error):
 *    Elle yazilan olay mekanik model kombinasyon semasi
 *    (`evt_<kategori>_<slot>_<beat>`) ile adlandirilamaz. Olayin ruhunu
 *    anlatan ozgun ve sahici bir isim tasimalidir.
 *
 * 2. `HandContractRule` (error):
 *    Elle yazilan her olay:
 *    - `repeatPolicy` sozlesmesi tasimalidir (tekrarsizlik freni).
 *    - `story.signature` imzasina sahip olmalidir.
 *    - `epic` ise kariyerde en fazla 1 kez cikabilir (`once: true` veya `repeatPolicy.maxBeatUses: 1`).
 */

import { finding, type Finding, type RuleContext, type ValidationRule } from '../Rule.js';

const STANDARD_BEATS: ReadonlySet<string> = new Set([
  'ihanet',
  'ayartma',
  'borc',
  'kayip',
  'sinav',
  'itiraf',
  'yuzlesme',
  'terk_edilis',
  'zafer_bedeli',
  'sadakat_sinavi',
  'maske_dusmesi',
  'devir_teslim',
  'geri_donus',
  'golge',
  'kirilma',
  'suc_ortakligi',
  'taninma',
  'reddedilis',
]);

export const HandTemplateIdRule: ValidationRule = {
  name: 'HandTemplateIdRule',
  defaultSeverity: 'error',
  description: "Elle yazilan olaylar mekanik model kombinasyon ID'si (evt_<cat>_<slot>_<beat>) kullanamaz.",
  check({ events, registry }: RuleContext): Finding[] {
    const out: Finding[] = [];
    const validSlots = new Set(registry.slots.keys());

    for (const event of events) {
      if (event.authored !== 'hand') continue;

      // evt_<cat>_<slot>_<beat> seklinde parcalara bak
      const rest = event.id.replace(/^evt_/, '');

      // Slot birden cok kelime olabilir (or. star_teammate, fan_leader, sporting_director)
      // Beat birden cok kelime olabilir (or. sadakat_sinavi, maske_dusmesi, zafer_bedeli, terk_edilis, devir_teslim, geri_donus, suc_ortakligi)
      let matchesTemplate = false;
      for (const slot of validSlots) {
        for (const beat of STANDARD_BEATS) {
          const pattern1 = `${event.category}_${slot}_${beat}`;
          if (rest === pattern1 || rest.startsWith(`${pattern1}_`)) {
            matchesTemplate = true;
            break;
          }
        }
        if (matchesTemplate) break;
      }

      if (matchesTemplate) {
        out.push(
          finding(
            HandTemplateIdRule,
            event,
            `Elle yazilan "${event.id}" olayi mekanik model sablonu (evt_<cat>_<slot>_<beat>) tasiyor.`,
            {
              path: 'id',
              fix: 'Olayin ozgun ruhunu anlatan bir isim verin (or: evt_business_ilk_sozlesme_veli, evt_personal_cousin_istek). docs/editor-kapisi.md Kural 3.',
            },
          ),
        );
      }
    }

    return out;
  },
};

export const HandContractRule: ValidationRule = {
  name: 'HandContractRule',
  defaultSeverity: 'error',
  description: 'Elle yazilan olaylar story.signature, repeatPolicy ve epic tek-seferlik kurallarina uymalidir.',
  check({ events }: RuleContext): Finding[] {
    const out: Finding[] = [];

    for (const event of events) {
      if (event.authored !== 'hand') continue;

      if (!event.repeatPolicy) {
        out.push(
          finding(
            HandContractRule,
            event,
            `Elle yazilan "${event.id}" olayinda repeatPolicy tanimli degil.`,
            {
              path: 'repeatPolicy',
              fix: 'docs/tekrar-sozlesmesi.md tablosuna gore repeatPolicy ekleyin.',
            },
          ),
        );
      }

      if (!event.story?.signature) {
        out.push(
          finding(
            HandContractRule,
            event,
            `Elle yazilan "${event.id}" olayinda story.signature tanimli degil.`,
            {
              path: 'story.signature',
              fix: 'story altina "signature": "<kategori>:<slot>:<konu>" ekleyin.',
            },
          ),
        );
      }

      if (event.tier === 'epic') {
        const isCapped = event.once === true || event.repeatPolicy?.maxBeatUses === 1;
        if (!isCapped) {
          out.push(
            finding(
              HandContractRule,
              event,
              `Epic elle yazilan "${event.id}" olayi kariyerde en fazla 1 kez gorulebilir (once: true veya maxBeatUses: 1 eksik).`,
              {
                path: 'once',
                fix: 'Olaya "once": true ekleyin ya da repeatPolicy.maxBeatUses = 1 yapin.',
              },
            ),
          );
        }
      }
    }

    return out;
  },
};
