/**
 * TUR YERLESTIRICI -- takvimin tek hakemi.
 *
 * Turnuvalar hafta secmez; burasi secer. Boylece "her lig kendi ritmini
 * uyduruyor" sorunu yapisal olarak ortadan kalkar.
 *
 * FARKLI BOYUTLU LIGLERI ESITLEYEN FIKIR -- ORANSAL YAYILIM:
 *
 *   Eski kod sabit adim kullaniyordu:
 *     step = floor(weeks / (rounds + 1))
 *   40 hafta / 22 tur icin step = 1 cikiyor ve lig 1-22. haftalara
 *   sikisiyordu; 18 turluk amator lig icin step = 2 cikiyor ve 35. haftaya
 *   yayiliyordu. Ayni dunyada iki farkli takvim.
 *
 *   Yerine tur KESRI:
 *     hafta = uygunHaftalar[ round( i * (uygun-1) / (tur-1) ) ]
 *   Bu, tur sayisi ne olursa olsun ligi pencerenin TAMAMINA yayar. 18 turluk
 *   lig de 46 turluk lig de ayni hafta baslar, ayni hafta biter; boyut farki
 *   takvime degil YOGUNLUGA yansir.
 *
 * SESSIZ DUSME YOK:
 *   Bir tur pencereye sigmiyorsa `CalendarError` atilir. Eski davranis
 *   (sessizce ayni haftaya yigmak ya da `forClub`ta yutmak) hatayi gorunmez
 *   yapiyordu.
 */

import {
  CalendarError,
  type CalendarConstraints,
  type Fixture,
  type MatchSlot,
  type ReservedRound,
  type RoundRequest,
} from '../domain/calendar.js';
import { FixtureIndex } from './FixtureIndex.js';

export interface PlacementResult {
  readonly index: FixtureIndex;
  readonly reserved: readonly ReservedRound[];
}

/**
 * Talepleri verilen SIRAYLA yerlestirir.
 *
 * Sira onceliktir: once ligler (hafta sonu slotunu kaparlar), sonra kupa ve
 * Avrupa (hafta ici slotlara duserler). Ters sirada kupa lig gununu isgal
 * eder ve lig turu bir sonraki haftaya kayar -- sezon uzar.
 */
export function placeRounds(
  requests: readonly RoundRequest[],
  constraints: CalendarConstraints,
): PlacementResult {
  const index = new FixtureIndex();
  const reserved: ReservedRound[] = [];
  /** Turnuva basina en son kullanilan hafta -- minGapWeeks icin. */
  const lastWeekOf = new Map<string, number>();

  for (const request of requests) {
    const available = availableWeeks(request, constraints);
    if (available.length === 0) {
      throw new CalendarError(
        `${request.competitionId} ${request.roundLabel}: pencerede (${request.window.start}-${request.window.end}) uygun hafta yok`,
      );
    }

    const ideal = idealWeek(request, available);
    const slot = findSlot(request, ideal, available, index, constraints, lastWeekOf);

    lastWeekOf.set(request.competitionId, slot.week);

    if (request.ties === undefined) {
      // Eslesme henuz bilinmiyor: yalnizca ZAMAN ayrildi.
      reserved.push({
        competitionId: request.competitionId,
        roundIndex: request.roundIndex,
        totalRounds: request.totalRounds,
        roundLabel: request.roundLabel,
        importance: request.importance,
        slot,
      });
      continue;
    }

    for (const tie of request.ties) {
      const fixture: Fixture = {
        week: slot.week,
        slot: slot.kind,
        homeId: tie.home,
        awayId: tie.away,
        importance: request.importance,
        competitionId: request.competitionId,
        round: request.roundLabel,
        roundIndex: request.roundIndex,
        // Puan durumunu yalnizca lig maclari etkiler.
        ...(request.importance === 'league' ? { league: request.competitionId } : {}),
      };
      index.add(fixture);
    }
  }

  return { index, reserved };
}

/** Pencere icindeki, milli araya denk gelmeyen haftalar. */
function availableWeeks(
  request: RoundRequest,
  constraints: CalendarConstraints,
): number[] {
  const blocked = new Set(constraints.internationalWindows);
  const out: number[] = [];
  const start = Math.max(1, request.window.start);
  const end = Math.min(constraints.weeks, request.window.end);
  for (let w = start; w <= end; w += 1) {
    if (!blocked.has(w)) out.push(w);
  }
  return out;
}

/**
 * Turun ideal haftasi -- uygun haftalar uzerinde ORANSAL.
 *
 * Hafta indeksi uzerinden degil UYGUN HAFTA indeksi uzerinden hesaplanir;
 * boylece milli aralar otomatik atlanir ve yayilim yine pencerenin tamamini
 * kaplar.
 */
function idealWeek(request: RoundRequest, available: readonly number[]): number {
  const i = Math.max(0, request.roundIndex);
  const count = request.totalRounds;
  if (count <= 1) return available[Math.min(i, available.length - 1)]!;

  const position = Math.round((i * (available.length - 1)) / (count - 1));
  return available[Math.max(0, Math.min(available.length - 1, position))]!;
}

/**
 * Ideal haftadan baslayip disari dogru tarayarak uygun slot bulur.
 *
 * Tarama sirasi 0, +1, -1, +2, -2 ... -- ideale en yakin cozum tercih edilir.
 * Katilimci listesi bos olan turlarda (kupanin ileri turlari) kapasite
 * kontrolu yapilamaz; yalnizca tur araligi (`minGapWeeks`) uygulanir.
 */
function findSlot(
  request: RoundRequest,
  ideal: number,
  available: readonly number[],
  index: FixtureIndex,
  constraints: CalendarConstraints,
  lastWeekOf: ReadonlyMap<string, number>,
): MatchSlot {
  const idealPos = available.indexOf(ideal);
  const gap = request.minGapWeeks ?? 0;
  const last = lastWeekOf.get(request.competitionId);

  for (let step = 0; step < available.length; step += 1) {
    for (const direction of step === 0 ? [0] : [1, -1]) {
      const position = idealPos + direction * step;
      if (position < 0 || position >= available.length) continue;

      const week = available[position]!;
      if (last !== undefined && gap > 0 && week - last < gap) continue;

      if (request.participants.length === 0) {
        // Eslesmesi bilinmeyen tur: yalnizca zaman ayriliyor.
        return { week, kind: request.prefer };
      }

      if (!index.hasCapacity(request.participants, week, constraints.maxFixturesPerClubPerWeek)) {
        continue;
      }
      const kind = index.freeSlot(request.participants, week, request.prefer);
      if (kind === undefined) continue;

      return { week, kind };
    }
  }

  throw new CalendarError(
    `${request.competitionId} ${request.roundLabel}: ${available.length} uygun haftanin hicbirine sigmadi ` +
      `(kulup basina hafta siniri ${constraints.maxFixturesPerClubPerWeek}). ` +
      `Pencereyi genislet ya da siniri yukselt.`,
  );
}
