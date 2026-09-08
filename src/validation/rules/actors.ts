/**
 * KIMLIK KURALLARI -- "hicbir ozel isim yazilmaz" disiplininin makineyle zorlanmasi.
 *
 * Isimler prosedurel uretildigi icin metne "Baris Tekin" yazmak sessiz bir
 * hatadir: bir sonraki tohumda o kisi baska biri olur ama metin ayni adi
 * soylemeye devam eder. Bu dosyadaki kurallar o hatayi BUILD HATASI yapar.
 */

import { allNodes, type StoryEvent } from '../../domain/story.js';
import { TextInterpolator } from '../../evaluation/TextInterpolator.js';
import { finding, isWaived, type Finding, type ValidationRule } from '../Rule.js';

/** Bir olaydaki tum metinler: baslik, sahne, secenek. */
function* texts(event: StoryEvent): Generator<{ text: string; path: string }> {
  for (const [id, node] of allNodes(event)) {
    yield { text: node.title, path: `nodes.${id}.title` };
    yield { text: node.text, path: `nodes.${id}.text` };
    for (const [i, c] of (node.choices ?? []).entries()) {
      yield { text: c.text, path: `nodes.${id}.choices[${i}].text` };
    }
  }
}

/** Metinde gecen slot adlari: {actor.captain.first} -> captain */
function referencedSlots(event: StoryEvent): Map<string, string> {
  const out = new Map<string, string>();
  for (const { text, path } of texts(event)) {
    for (const { key } of TextInterpolator.tokens(text)) {
      if (!key.startsWith('actor.')) continue;
      const slotId = key.slice('actor.'.length).split('.')[0];
      if (slotId !== undefined && !out.has(slotId)) out.set(slotId, path);
    }
  }
  return out;
}

/** "bir muhabir", "bir takim arkadasi" -- isimsiz figuran, sureklilik tasimaz. */
const GENERIC_PLACEHOLDER =
  /\bbir (muhabir|takim arkadasi|takım arkadaşı|gazeteci|yonetici|yönetici|hoca|oyuncu|doktor|avukat)\b/i;

export const ActorPresenceRule: ValidationRule = {
  name: 'ActorPresenceRule',
  defaultSeverity: 'warn',
  description: 'major/epic olaylar en az bir SLOT referansi icermeli -- surekliligi tasiyan sey rollerdir.',
  check({ events }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (event.tier !== 'major' && event.tier !== 'epic') continue;
      if (isWaived(event, 'ActorPresenceRule')) continue;

      if (referencedSlots(event).size === 0) {
        out.push(
          finding(ActorPresenceRule, event, `tier "${event.tier}" olayinda {actor.*} referansi yok.`, {
            fix: 'Sahneye bir rol sokun: {actor.captain.name}, {actor.manager.first:dat}...',
          }),
        );
      }

      for (const { text, path } of texts(event)) {
        const match = GENERIC_PLACEHOLDER.exec(text);
        if (!match) continue;
        out.push(
          finding(ActorPresenceRule, event, `Jenerik kalip kullanilmis: "${match[0]}"`, {
            path,
            fix: 'Bir slot referansiyla degistirin. Isimsiz figuran sureklilik tasimaz.',
          }),
        );
      }
    }
    return out;
  },
};

/**
 * ELLE YAZILMIS TURKCE EKI.
 *
 * `{actor.captain.name}'in` yazmak, Turkce'nin unlu uyumunu YOK SAYAR.
 * Isimler tohumdan uretildigi icin ayni sablon "Ocak'in" (yanlis) ya da
 * "Demir'in" (dogru) uretebilir -- ve hangisi olacagini yazar bilemez.
 *
 * Projede bunun icin bir ek motoru var (`TurkishSuffix`):
 *   {actor.captain.first:gen}  -> Baris'in | Oktay'in | Vinicius'un
 *   {actor.manager.name:dat}   -> Fatma Ocak'a
 *   {club.name:loc}            -> Karadeniz FK'da
 *
 * Olculdu: icerikte 48 elle yazilmis ek vardi, 32 dosyada -- 41'i `'in`,
 * 7'si `'e`. Hepsi duzeltildi. Bu kural geri gelmelerini engelliyor.
 */
export const HandwrittenSuffixRule: ValidationRule = {
  name: 'HandwrittenSuffixRule',
  defaultSeverity: 'error',
  description: "Slot referansindan sonra elle Turkce eki yazilamaz; :gen/:dat/:loc kullanin.",
  check({ events }): Finding[] {
    const out: Finding[] = [];
    // Kesme isaretinden SONRA harf gelmeli. `'{actor...}'` gibi tirnak
    // kullanimlari yanlis pozitif olmasin diye kapanis tirnagi elenir.
    const pattern = /\{actor\.[a-z_]+\.[a-z]+\}'(\p{L}+)/gu;

    for (const event of events) {
      if (isWaived(event, 'HandwrittenSuffixRule')) continue;
      for (const { text, path } of texts(event)) {
        for (const m of text.matchAll(pattern)) {
          out.push(
            finding(HandwrittenSuffixRule, event, `Elle yazilmis ek: "'${m[1]}"`, {
              path,
              fix: "Ek motorunu kullanin: {actor.x.name:gen} / :dat / :acc / :loc / :abl. Elle yazilan ek isimlerin yarisinda unlu uyumunu bozar.",
            }),
          );
        }
      }
    }
    return out;
  },
};

export const HardcodedNameRule: ValidationRule = {
  name: 'HardcodedNameRule',
  defaultSeverity: 'warn',
  description: 'Isim havuzundaki bir ad+soyad ikilisi metinde GECEMEZ; isimler tohumdan uretilir.',
  check({ events, registry }): Finding[] {
    const out: Finding[] = [];

    const firsts = new Set<string>();
    const lasts = new Set<string>();
    for (const pool of Object.values(registry.names.pools)) {
      for (const n of pool.male) firsts.add(n);
      for (const n of pool.female) firsts.add(n);
      for (const n of pool.last) lasts.add(n);
    }
    if (firsts.size === 0 || lasts.size === 0) return out;

    // Tek kelime aranmaz: "Deniz", "Demir", "Kaya", "Can" ayni zamanda sozluk
    // kelimesidir. AD + SOYAD ikilisi ise tesaduf olamaz.
    const bigram = /(\p{Lu}[\p{L}]+)\s+(\p{Lu}[\p{L}]+)/gu;

    for (const event of events) {
      if (isWaived(event, 'HardcodedNameRule')) continue;
      const seen = new Set<string>();
      for (const { text, path } of texts(event)) {
        for (const m of text.matchAll(bigram)) {
          const [whole, first, last] = m;
          if (first === undefined || last === undefined) continue;
          if (!firsts.has(first) || !lasts.has(last)) continue;
          if (seen.has(whole)) continue;
          seen.add(whole);
          out.push(
            finding(HardcodedNameRule, event, `Sabit ozel isim: "${whole}"`, {
              path,
              fix: 'Bir slot referansiyla degistirin ({actor.captain.name}). Isimler names.json havuzundan uretilir; sabit yazilan ad bir sonraki tohumda yanlis kisiyi gosterir.',
            }),
          );
        }
      }
    }
    return out;
  },
};

export const SlotScopeRule: ValidationRule = {
  name: 'SlotScopeRule',
  defaultSeverity: 'warn',
  description: 'Olay, o hayat durumunda sahnede OLMAYAN bir slota referans veremez.',
  check({ events, registry }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (isWaived(event, 'SlotScopeRule')) continue;

      for (const [slotId, path] of referencedSlots(event)) {
        const slot = registry.slots.get(slotId);
        if (!slot) continue; // Bilinmeyen slot InterpolationRule'un isi.
        if (slot.lifeStates === undefined || event.lifeStates === undefined) continue;

        const overlap = event.lifeStates.some((s) => slot.lifeStates!.includes(s));
        if (!overlap) {
          out.push(
            finding(
              SlotScopeRule,
              event,
              `"${slotId}" yalnizca [${slot.lifeStates.join(', ')}] durumunda sahnede, olay ise [${event.lifeStates.join(', ')}] icin yazilmis.`,
              {
                path,
                fix: 'Olayin lifeStates alanini duzeltin ya da baska bir slot kullanin.',
              },
            ),
          );
        }
      }
    }
    return out;
  },
};
