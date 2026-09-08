/**
 * TEK ELEME KUPA -- DURUMLU. Kazananlari MAC SONUCU belirler.
 *
 * ESKI HATA (olculdu):
 *   Eski takvim tum bracket'i sezon basinda uretiyor ve her eslesmede
 *   `next.push(alive[i])` diyordu -- yani her zaman ciftin ILKI tur atliyordu.
 *   Kod yorumu "gercek eleme mac sonucunda uygulanir" diyordu ama uygulayan
 *   hicbir yer yoktu. Sonuc: 34 kuluplu mock dunyada final sezon basinda
 *   belliydi (Harran v Beydag) ve iki takim da hic mac oynamamisti.
 *
 * DOGRU AYRIM:
 *   Takvim, kupanin BUTUN turlarinin haftasini sezon basinda ayirir -- yoksa
 *   lig fiksturu o haftalari doldurur ve kupa bir daha sigmaz. Ama YALNIZCA
 *   1. turun eslesmeleri bilinir. Sonraki turlar `advance()` ile, gercek
 *   kazananlardan kurulur.
 *
 * BYE:
 *   Kulup sayisi ikinin kuvveti degilse ust tohumlar ilk turu bos gecer --
 *   gercek kupalarda oldugu gibi. Bu, "dev yikan amator" anlatisini korur:
 *   tum basamaklar ayni kuradadir.
 */

import type { RoundRequest, SlotKind, Tie } from '../../domain/calendar.js';
import type { MatchImportance } from '../../domain/match.js';
import type { Rng } from '../../selection/Rng.js';

export interface CupSpec {
  readonly id: string;
  readonly clubIds: readonly string[];
  readonly window: { readonly start: number; readonly end: number };
  readonly prefer?: SlotKind;
  /** Iki tur arasinda en az kac hafta. */
  readonly minGapWeeks?: number;
}

export interface CupRound {
  readonly index: number;
  readonly label: string;
  readonly ties: readonly Tie[];
  /** Bu turu bay gecen kulupler -- bir sonraki tura dogrudan katilir. */
  readonly byes: readonly string[];
}

/** Kac tur gerekir: 24 kulup -> 5 tur (16 -> 8 -> 4 -> 2 -> 1). */
export function roundCount(clubs: number): number {
  return clubs < 2 ? 0 : Math.ceil(Math.log2(clubs));
}

export function roundLabel(index: number, total: number): string {
  const remaining = total - index;
  if (remaining === 1) return 'final';
  if (remaining === 2) return 'yari final';
  if (remaining === 3) return 'ceyrek final';
  return `${index + 1}. tur`;
}

/**
 * Kupa durumu.
 *
 * Sezon basinda yalnizca `seed()` cagrilir; sonraki turlar mac sonuclari
 * geldikce `advance()` ile acilir.
 */
export class CupCompetition {
  private readonly totalRounds: number;
  private current: CupRound | undefined;
  private roundIndex = 0;
  private championId: string | undefined;

  constructor(
    private readonly spec: CupSpec,
    private readonly rng: Rng,
  ) {
    this.totalRounds = roundCount(spec.clubIds.length);
  }

  get rounds(): number {
    return this.totalRounds;
  }

  /**
   * 1. turu kurar.
   *
   * Kulup sayisi ikinin kuvvetine tamamlanacak kadar kulup bay gecer; boylece
   * ikinci turdan itibaren bracket tam ikilidir ve her tur tam yariya iner.
   */
  seed(): CupRound {
    const ids = this.rng.shuffle([...this.spec.clubIds]);
    const target = 2 ** (this.totalRounds - 1); // 1. tur sonrasi kalacak sayi
    const playing = Math.max(0, ids.length - target) * 2;

    const contenders = ids.slice(0, playing);
    const byes = ids.slice(playing);

    const ties: Tie[] = [];
    for (let i = 0; i + 1 < contenders.length; i += 2) {
      ties.push({ home: contenders[i]!, away: contenders[i + 1]! });
    }

    this.roundIndex = 0;
    this.current = { index: 0, label: roundLabel(0, this.totalRounds), ties, byes };
    return this.current;
  }

  /**
   * Kazananlardan bir sonraki turu kurar.
   *
   * `winners` sirasi ONEMSIZ degil: kura yeniden cekilir (gercek kupalarda da
   * boyle), ama tohumlu RNG ile deterministik kalir.
   */
  advance(winners: readonly string[]): CupRound | undefined {
    const previous = this.current;
    if (!previous) return undefined;

    const alive = this.rng.shuffle([...winners, ...previous.byes]);
    if (alive.length <= 1) {
      this.championId = alive[0];
      this.current = undefined;
      return undefined;
    }

    const ties: Tie[] = [];
    for (let i = 0; i + 1 < alive.length; i += 2) {
      ties.push({ home: alive[i]!, away: alive[i + 1]! });
    }
    const byes = alive.length % 2 === 1 ? [alive[alive.length - 1]!] : [];

    this.roundIndex += 1;
    this.current = {
      index: this.roundIndex,
      label: roundLabel(this.roundIndex, this.totalRounds),
      ties,
      byes,
    };
    return this.current;
  }

  round(): CupRound | undefined {
    return this.current;
  }

  champion(): string | undefined {
    return this.championId;
  }

  /**
   * Takvime verilecek tur talepleri.
   *
   * 1. tur eslesmeleriyle birlikte gider; sonraki turlar ties'SIZ -- takvim
   * onlarin yalnizca ZAMANINI ayirir. Kupanin final haftasi sezon basinda
   * bellidir, finalistleri degil.
   */
  requests(first: CupRound): RoundRequest[] {
    const out: RoundRequest[] = [];
    const gap = this.spec.minGapWeeks ?? 4;

    for (let i = 0; i < this.totalRounds; i += 1) {
      const importance: MatchImportance = i === this.totalRounds - 1 ? 'cup_final' : 'cup';
      const base = {
        competitionId: this.spec.id,
        roundIndex: i,
        totalRounds: this.totalRounds,
        roundLabel: roundLabel(i, this.totalRounds),
        importance,
        window: this.spec.window,
        prefer: this.spec.prefer ?? 'midweek',
        minGapWeeks: gap,
      };

      out.push(
        i === 0
          ? { ...base, participants: first.ties.flatMap((t) => [t.home, t.away]), ties: first.ties }
          : // Katilimci bilinmiyor: yerlestirici kapasiteye BAKAMAZ, yalnizca
            // haftanin uygunluguna bakar. Zamani ayirmak, eslesmeyi beklemekten
            // onemli -- beklersek lig fiksturu haftayi kapar.
            { ...base, participants: [] },
      );
    }

    return out;
  }
}
