/**
 * SAHTE MAC HOST'U.
 *
 * Gercek host (fizik, simulasyon, skor, lig tablosu) henuz yok. Mac sozlesmesi
 * bir spesifikasyon olarak kagitta kalmasin diye tohumlu bir taklit yaziyoruz:
 * `MatchContext` + `PendingMoment[]` uretir, `MatchOutcomeDelta’yi tuketir,
 * `PlayerAvailability’ye uyar.
 *
 * Bu sayede penalti ve VAR zincirleri gercek bir simulator olmadan uctan uca
 * OYNANABILIR. Gercek host geldiginde ayni arayuzu uygular; motor tarafinda
 * tek satir degismez.
 */

import type {
  HostMatch,
  MatchBuildInput,
  MatchContext,
  MatchHost,
  MatchImportance,
  MatchOutcomeDelta,
  MatchResultReport,
  MomentType,
  PendingMoment,
} from '../domain/match.js';
import { Rng } from '../selection/Rng.js';

const OPPONENTS = [
  'Goztepe',
  'Karsiyaka',
  'Altinordu',
  'Boluspor',
  'Kecioren',
  'Sariyer',
  'Menemen',
  'Erzurum',
  'Kastamonu',
  'Bandirma',
];
const IMPORTANCE: readonly { type: MatchImportance; weight: number }[] = [
  { type: 'league', weight: 70 },
  { type: 'derby', weight: 10 },
  { type: 'cup', weight: 10 },
  { type: 'european', weight: 6 },
  { type: 'cup_final', weight: 2 },
  { type: 'national', weight: 2 },
];

/** Momentlerin ne siklikta sunuldugu. Toplam ~1.4 moment/mac. */
const MOMENT_TABLE: readonly { type: MomentType; weight: number }[] = [
  { type: 'penalty_for', weight: 12 },
  { type: 'var_review_against', weight: 10 },
  { type: 'one_on_one', weight: 10 },
  { type: 'red_card_provocation', weight: 8 },
  { type: 'last_minute_chance', weight: 8 },
  { type: 'injury_in_match', weight: 6 },
  { type: 'dive_opportunity', weight: 6 },
  { type: 'racist_abuse', weight: 4 },
  { type: 'celebration_choice', weight: 5 },
  { type: 'captain_armband', weight: 3 },
];

/** Geriye donuk ad. `HostMatch` ile ayni sey. */
export type FakeMatch = HostMatch;

export class FakeMatchHost implements MatchHost {
  private readonly rng: Rng;
  private readonly opponents: readonly string[];
  private seasonGoals = 0;
  private seasonAssists = 0;
  private seasonApps = 0;
  private unbeaten = 0;
  private scoreless = 0;

  /**
   * `opponents` verilirse rakipler DUNYADAN gelir; motor rakip adini kulup
   * kimligine cozebilir ve "eski kulubunle mac" tetigi calisir.
   */
  constructor(seed = 1337, opponents: readonly string[] = OPPONENTS) {
    this.rng = new Rng(seed);
    this.opponents = opponents.length > 0 ? opponents : OPPONENTS;
  }

  /** Yeni sezon: birikimli istatistikler sifirlanir. */
  resetSeason(): void {
    this.seasonGoals = 0;
    this.seasonAssists = 0;
    this.seasonApps = 0;
  }

  /**
   * Bir mac uretir. Oyuncu cezali/sakatsa mac URETILMEZ (host kadroya yazmaz) --
   * motor ceza verdiginde host buna uymak zorundadir.
   */
  buildMatch(input: MatchBuildInput): HostMatch | undefined {
    if (!input.availability.available) return undefined;

    const opponent = this.opponents[this.rng.int(this.opponents.length)]!;
    const importance =
      this.rng.weighted(IMPORTANCE, (i) => i.weight)?.type ?? ('league' as MatchImportance);

    this.seasonApps += 1;

    const context: MatchContext = {
      opponentName: opponent,
      importance,
      isStarter: this.rng.next() > 0.15,
      teamLeaguePosition: 1 + this.rng.int(18),
      unbeatenStreak: this.unbeaten,
      scorelessStreak: this.scoreless,
      seasonGoals: this.seasonGoals,
      seasonAssists: this.seasonAssists,
      seasonApps: this.seasonApps,
    };

    const momentCount = this.rng.next() < 0.55 ? 1 : this.rng.next() < 0.85 ? 2 : 0;
    const moments: PendingMoment[] = [];
    for (let i = 0; i < momentCount; i += 1) {
      const pick = this.rng.weighted(MOMENT_TABLE, (m) => m.weight);
      if (!pick) continue;
      const minute = 3 + this.rng.int(88);
      moments.push({
        type: pick.type,
        minute,
        scoreline: `${this.rng.int(3)}-${this.rng.int(3)}`,
        opponent,
        importance,
      });
    }
    moments.sort((a, b) => a.minute - b.minute);

    return { context, pendingMoments: moments };
  }

  /**
   * Motorun dondurdugu deltayi skora uygular ve gercek sonucu uretir.
   * Motor YOKTAN GOL ICAT ETMEZ; buradaki temel gol dagilimi host'un isidir,
   * delta yalnizca onun uzerine biner.
   */
  applyDelta(match: HostMatch, delta: MatchOutcomeDelta): MatchResultReport {
    const baseGoals = this.rng.next() < 0.25 ? 1 : 0;
    const goals = Math.max(0, baseGoals + delta.goalsDelta);
    const assists = Math.max(0, (this.rng.next() < 0.18 ? 1 : 0) + delta.assistsDelta);

    this.seasonGoals += goals;
    this.seasonAssists += assists;
    this.scoreless = goals > 0 ? 0 : this.scoreless + 1;

    const roll = this.rng.next();
    const result = delta.redCard
      ? roll < 0.6
        ? 'loss'
        : 'draw'
      : roll < 0.45
        ? 'win'
        : roll < 0.75
          ? 'draw'
          : 'loss';
    this.unbeaten = result === 'loss' ? 0 : this.unbeaten + 1;

    const rating = Math.max(
      1,
      Math.min(
        10,
        5.5 + goals * 1.4 + assists * 0.8 + delta.ratingModifier - (delta.redCard ? 2.5 : 0),
      ),
    );

    return {
      result,
      rating: Math.round(rating * 10) / 10,
      goals,
      assists,
      minutes: match.context.isStarter ? 90 : 20 + this.rng.int(45),
      cards: delta.yellowCards + (delta.redCard ? 1 : 0),
    };
  }
}
