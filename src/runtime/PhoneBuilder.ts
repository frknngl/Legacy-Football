/**
 * TELEFON MODELINI KURAR.
 *
 * Veri sekli `domain/phone.ts`te; burasi onu kariyer durumundan TURETIR.
 * `domain/chemistry.ts` + `runtime/ChemistryTracker.ts` ile ayni ayrim.
 *
 * HICBIR YENI DURUM ALANI YOK. Besleme, kariyerin zaten urettigi
 * verilerden hesaplanir: mac reytingleri (`ratingHistory`), cuzdan
 * hareketleri, bayraklar, aktorler. Ayrica beslenen bir kutu olsaydi
 * gunun birinde gercekle celisirdi -- ve kayit gocu gerektirirdi.
 */

import type { GameState } from '../domain/state.js';
import type { FeedItem, FeedTone, Notice, PhoneModel, Thread } from '../domain/phone.js';
import { slotRelationFlag } from '../domain/actors.js';

/** Sessizlik esigi: bu kadar tur gorusulmeyen kisi listede one cikar. */
const SILENCE_TURNS = 12;

export class PhoneBuilder {
  /**
   * @param state kariyer durumu
   * @param slotLabels slotId -> insan okunur rol adi ("Kaptan", "Menajer")
   */
  static build(state: GameState, slotLabels: ReadonlyMap<string, string>): PhoneModel {
    const feed = [...matchFeed(state), ...moneyFeed(state), ...pressureFeed(state)]
      .sort((a, b) => a.turnsAgo - b.turnsAgo)
      .slice(0, 12);

    const threads = buildThreads(state, slotLabels);
    const notifications = buildNotices(state);

    return {
      feed,
      threads,
      notifications,
      unread: threads.filter((t) => t.unread).length + notifications.length,
      followers: num(state.flags['sosyal_medya_takipci']),
    };
  }
}

/**
 * Son maclarin yankisi.
 *
 * Reyting zaten tutuluyor (`ratingHistory`, son bes mac). Taraftar
 * yorumu bu sayidan TURETILIR -- yani besleme kariyerle her zaman
 * tutarlidir, ayri bir gercek uretmez.
 */
function matchFeed(state: GameState): FeedItem[] {
  const ratings = state.ratingHistory ?? [];
  return ratings
    .slice(-4)
    .reverse()
    .map((rating, index) => {
      const tone: FeedTone = rating >= 7.2 ? 'olumlu' : rating <= 5.6 ? 'olumsuz' : 'notr';
      const text =
        tone === 'olumlu'
          ? `Adamimiz yine sahada. ${rating.toFixed(1)} aldi, hak etti.`
          : tone === 'olumsuz'
            ? `${rating.toFixed(1)}... Bu formayi kim hak ediyor tartisalim.`
            : `Fena degildi, ${rating.toFixed(1)}. Ama beklentimiz bu degildi.`;
      return {
        id: `mac_${index}`,
        source: 'taraftar' as const,
        text,
        turnsAgo: index * 2,
        tone,
      };
    });
}

/** Buyuk para hareketleri gundeme duser -- kucukleri kimse konusmaz. */
function moneyFeed(state: GameState): FeedItem[] {
  const wage = num(state.flags['haftalik_gelir']);
  const threshold = Math.max(50_000, wage * 8);
  return (state.wallet ?? [])
    .filter((entry) => Math.abs(entry.amount) >= threshold)
    .slice(-3)
    .reverse()
    .map((entry, index) => ({
      id: `para_${entry.turn}_${index}`,
      source: entry.kind === 'bahis' ? ('basin' as const) : ('kulup' as const),
      text:
        entry.kind === 'bahis'
          ? `Kulis: "${entry.label}" masasinda gorulmus. Rakam konusuluyor.`
          : `${entry.label}: ${Math.abs(entry.amount).toLocaleString('tr-TR')} TL.`,
      turnsAgo: Math.max(0, state.turn - entry.turn),
      tone: (entry.amount > 0 ? 'olumlu' : 'olumsuz') as FeedTone,
    }));
}

/** Medya baskisi yuksekse gundem senden ibarettir. */
function pressureFeed(state: GameState): FeedItem[] {
  const pressure = num(state.flags['medya_baskisi']);
  if (pressure < 55) return [];
  return [
    {
      id: 'baski',
      source: 'basin',
      text:
        pressure >= 85
          ? 'Bugun uc kanalda adin gecti. Hicbirinde iyi anlamda degil.'
          : 'Programlarda ismin dolasiyor. Henuz sert degil ama dolasiyor.',
      turnsAgo: 0,
      tone: 'olumsuz',
    },
  ];
}

/**
 * Yazisma basliklari -- sahnedeki kisilerden.
 *
 * `lastInteractionTurn` zaten tutuluyor: uzun sessizlik bir SINYALDIR
 * ("alti aydir konusmadiniz") ve icerik bunu okuyabiliyor. Telefon onu
 * gorunur kiliyor.
 */
function buildThreads(state: GameState, labels: ReadonlyMap<string, string>): Thread[] {
  const out: Thread[] = [];
  for (const [slotId, actorId] of Object.entries(state.casting ?? {})) {
    const actor = state.actors?.[actorId];
    if (!actor) continue;

    const relation = num(state.flags[slotRelationFlag(slotId)], actor.relation);
    const silent = Math.max(0, state.turn - (actor.lastInteractionTurn ?? 0));

    out.push({
      slotId,
      name: actor.name,
      preview: preview(relation, silent, labels.get(slotId) ?? slotId),
      relation,
      silentTurns: silent,
      unread: silent >= SILENCE_TURNS && relation >= 45,
    });
  }
  // Once ilgi isteyenler: uzun sessizlik, sonra bozulan iliski.
  return out
    .sort((a, b) => b.silentTurns - a.silentTurns || a.relation - b.relation)
    .slice(0, 8);
}

function preview(relation: number, silent: number, role: string): string {
  if (silent >= SILENCE_TURNS && relation >= 45) return `${role}: "Kayiplara karistin."`;
  if (relation <= 30) return `${role}: (okundu, cevap yok)`;
  if (relation >= 75) return `${role}: "Her zamanki yerde miyiz?"`;
  return `${role}: "Gorusuruz."`;
}

/** Ust bardaki bildirimler -- motorun zaten bildigi acik durumlar. */
function buildNotices(state: GameState): Notice[] {
  const out: Notice[] = [];

  const loan = state.loan;
  if (loan !== undefined) {
    out.push({
      id: 'kredi',
      text:
        loan.missed > 0
          ? `${loan.missed} taksit gecikti. ${loan.lender === 'tefeci' ? 'Arayan var.' : 'Banka yazdi.'}`
          : `Kredi: ${loan.weeksLeft} hafta kaldi.`,
      urgent: loan.missed > 0,
    });
  }

  const debt = num(state.flags['borc']);
  if (debt >= 40_000) {
    out.push({ id: 'borc', text: `Borc: ${debt.toLocaleString('tr-TR')} TL.`, urgent: debt >= 100_000 });
  }

  if (state.availability?.available === false) {
    out.push({
      id: 'ceza',
      text: `Cezalisin: ${state.availability.matchesRemaining} mac kaldi.`,
      urgent: true,
    });
  }

  return out;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}
