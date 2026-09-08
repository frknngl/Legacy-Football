/**
 * LIG -- tur uretimi. Hafta BILMEZ.
 *
 * MAC SAYISI FORMULLE HESAPLANMAZ. Gercek veride (Transfermarkt, sezon 2024):
 *
 *   Championship   24 kulup -> 46 mac    2x(N-1) tutuyor
 *   Premier League 20 kulup -> 38 mac    tutuyor
 *   J1 League      20 kulup -> 34 mac    TUTMUYOR
 *   MLS            30 kulup -> 33 mac    konferans
 *   Torneo Apert.  30 kulup -> 16 mac    grup asamasi
 *   USL Champ.     26 kulup -> 27/28/29  ayni ligde kulupten kulube DEGISIYOR
 *
 * Bu yuzden `matchesPerClub` DISARIDAN gelir (world.db'den okunur) ve tur
 * sayisini o belirler. Berger tablosu her turda her kulube tam bir mac verir;
 * istenen sayiya ULASILDIGINDA kesilir. Boylece konferans ve grup formatlari
 * da dogru mac sayisini uretir -- kim kimle oynadigi yaklasiktir, kac mac
 * oynadigi KESINDIR. Takvim tutarliligi ikincisine baglidir.
 */

import type { RoundRequest, SlotKind, Tie } from '../../domain/calendar.js';
import type { Rng } from '../../selection/Rng.js';

export interface LeagueSpec {
  readonly id: string;
  readonly clubIds: readonly string[];
  /** Kulup basina mac sayisi. Verilmezse cift devre varsayilir. */
  readonly matchesPerClub?: number;
  readonly window: { readonly start: number; readonly end: number };
  readonly prefer?: SlotKind;
}

/**
 * Berger tablosu -- tek devre. Her tur, her kulube tam bir mac verir.
 *
 * Tek sayida kulupte bir "bay" eklenir; o kulup o tur oynamaz. Bu bilinclidir
 * ve gercektir: 17 kuluplu bir ligde her hafta bir takim bos gecer.
 */
export function roundRobin(ids: readonly string[]): Tie[][] {
  const teams = [...ids];
  if (teams.length % 2 === 1) teams.push(BYE);

  const half = teams.length / 2;
  const rounds: Tie[][] = [];
  const rotating = teams.slice(1);

  for (let r = 0; r < teams.length - 1; r += 1) {
    const order = [teams[0]!, ...rotating];
    const ties: Tie[] = [];
    for (let i = 0; i < half; i += 1) {
      const a = order[i]!;
      const b = order[order.length - 1 - i]!;
      if (a === BYE || b === BYE) continue;
      // Ev sahipligi tur paritesine gore donur -- her kulup dengeye yaklasir.
      ties.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
    }
    rounds.push(ties);
    rotating.unshift(rotating.pop()!);
  }

  return rounds;
}

const BYE = '__bye__';

/**
 * Istenen MAC sayisini TUR listesine cevirir.
 *
 * TUR != MAC. Cift sayida kulupte her tur herkese bir mac verir, dolayisiyla
 * ikisi esittir. TEK sayida kulupte her turda bir takim bay geciyor: N kuluplu
 * bir devre N tur surer ama her kulube yalnizca N-1 mac verir.
 *
 * Bu ayrimi atlamak olculebilir bir hata uretiyordu: 19 kuluplu Super Lig icin
 * 36 TUR uretiliyor, ama devre ortasinda kesildigi icin kulupler 34 ya da 35
 * mac oynuyordu -- ayni ligde farkli mac sayisi, yani takvimin cozmesi
 * gereken sorunun ta kendisi.
 *
 * KURAL:
 *   cift kulup -> istenen sayida tur alinir (kesme serbest, esitlik bozulmaz)
 *   tek kulup  -> yalnizca TAM DEVRE alinir; yarim devre bay dagilimini bozar
 *
 * Tek kulupte istenen sayi tam devreye bolunmuyorsa ULASILABILIR en yakin
 * degere yuvarlanir. Uydurmak yerine eksik oynatmak dogru: kaynakta kulup
 * eksikse (Eredivisie 17 kulup / 34 mac beyani) o beyan zaten tutarsizdir ve
 * importer bunu ayrica `error` olarak raporluyor.
 */
function buildRounds(
  clubCount: number,
  single: readonly Tie[][],
  matchesPerClub: number | undefined,
): Tie[][] {
  const matchesPerLeg = clubCount - 1;
  const wanted = matchesPerClub ?? matchesPerLeg * 2;
  const odd = clubCount % 2 === 1;

  const rounds: Tie[][] = [];
  const pushLeg = (leg: number, limit: number): void => {
    for (const round of single) {
      if (rounds.length >= limit) return;
      // Tek numarali devrelerde ev sahipligi ters.
      rounds.push(leg % 2 === 0 ? round : round.map((t) => ({ home: t.away, away: t.home })));
    }
  };

  if (odd) {
    // Yalnizca tam devre: her devre her kulube tam olarak matchesPerLeg mac verir.
    const legs = Math.max(1, Math.round(wanted / matchesPerLeg));
    for (let leg = 0; leg < legs; leg += 1) pushLeg(leg, Number.POSITIVE_INFINITY);
    return rounds;
  }

  for (let leg = 0; rounds.length < wanted; leg += 1) {
    const before = rounds.length;
    pushLeg(leg, wanted);
    if (rounds.length === before) break; // guvenlik: ilerlemiyorsa dur
  }
  return rounds;
}

/**
 * Ligin tur taleplerini uretir.
 *
 * Tur sayisi `matchesPerClub`ten gelir; gereken tur sayisi tek devrenin
 * uzunlugunu asiyorsa ikinci devre (ev sahipligi ters) eklenir ve gerekirse
 * dongu devam eder. Kesme her zaman TUR sinirindadir, bu yuzden hicbir kulup
 * digerlerinden fazla ya da eksik mac oynamaz.
 */
export function buildLeagueRounds(spec: LeagueSpec, rng: Rng): RoundRequest[] {
  const ids = rng.shuffle([...spec.clubIds]);
  if (ids.length < 2) return [];

  const single = roundRobin(ids);
  if (single.length === 0) return [];

  const rounds = buildRounds(ids.length, single, spec.matchesPerClub);

  return rounds.map((ties, index) => ({
    competitionId: spec.id,
    roundIndex: index,
    totalRounds: rounds.length,
    roundLabel: `${index + 1}. hafta`,
    importance: 'league' as const,
    window: spec.window,
    prefer: spec.prefer ?? 'weekend',
    participants: ids,
    ties,
  }));
}
