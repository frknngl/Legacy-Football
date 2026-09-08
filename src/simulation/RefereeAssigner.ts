/**
 * HAKEM ATAMA -- kokart hiyerarsisi, tarafsizlik, tekrar onleme.
 *
 * "Sampiyonlar Ligi finaline bolgesel hakem atanmasin" gereksinimi burada
 * yapisal olarak karsilaniyor: havuz once KOKARTA gore suzuluyor, sonra
 * tarafsizliga, sonra tekrara.
 *
 * NEDEN AGIRLIKLI CEKILIS, "EN IYI" DEGIL:
 *   Deterministik "en itibarli hakem" secimi ayni uc hakemi butun buyuk
 *   maclara atardi ve havuzun geri kalani olu veri olurdu. Agirlikli cekilis
 *   hiyerarsiyi KORUR (itibarli daha sik gelir) ama cesitlilik birakir.
 *
 * KATMAN: `domain` + `selection/Rng`. Motoru bilmez.
 */

import {
  badgeRank,
  requiredBadge,
  type Referee,
  type RefereeBadge,
} from '../domain/referee.js';
import type { Fixture } from '../domain/calendar.js';
import type { Rng } from '../selection/Rng.js';

export interface AssignerDeps {
  readonly referees: readonly Referee[];
  /** Kulup -> ulke. Tarafsizlik suzgeci bunu okur. */
  readonly countryOfClub: (clubId: string) => number | undefined;
  /** Turnuva -> lig seviyesi. Kokart tabani bundan turer. */
  readonly leagueLevelOf: (competitionId: string) => number;
  /** Turnuva -> zorunlu en dusuk kokart. `referee_eligibility` tablosu. */
  readonly requiredBadgeOf?: (competitionId: string) => RefereeBadge | undefined;
  /** Ayni hakem bu kadar hafta icinde ayni kulube iki kez cikmasin. */
  readonly repeatGuardWeeks?: number;
}

const DEFAULT_REPEAT_GUARD = 4;

export class RefereeAssigner {
  /** refereeId -> son atandigi hafta. */
  private readonly lastAssigned = new Map<number, number>();
  /** `${refereeId}:${clubId}` -> son hafta. Kulup bazli tekrar onleme. */
  private readonly lastWithClub = new Map<string, number>();

  constructor(private readonly deps: AssignerDeps) {}

  /**
   * Bir fikstüre hakem atar.
   *
   * Havuz her asamada daralir; herhangi bir asamada bosalirsa o asama
   * ATLANIR. Fikstur hakemsiz kalamaz -- kisit tercihtir, kural degil.
   */
  assign(fixture: Fixture, rng: Rng): Referee | undefined {
    const all = this.deps.referees;
    if (all.length === 0) return undefined;

    // 1. KOKART
    const needed = this.neededBadge(fixture);
    let pool = all.filter((r) => badgeRank(r.badge) >= badgeRank(needed));
    if (pool.length === 0) pool = [...all]; // kokart yetersizse en iyisiyle idare et

    // 2. TARAFSIZLIK -- yalnizca kita ve milli maclarda.
    //    Lig maclarinda hakem zaten o ulkenin hakemi olmak zorunda.
    if (fixture.importance === 'european' || fixture.importance === 'national') {
      const home = this.deps.countryOfClub(fixture.homeId);
      const away = this.deps.countryOfClub(fixture.awayId);
      const neutral = pool.filter(
        (r) => r.countryId !== home && r.countryId !== away,
      );
      if (neutral.length > 0) pool = neutral;
    }

    // 3. TEKRAR ONLEME -- ayni hakem ayni kulube ust uste cikmasin.
    const guard = this.deps.repeatGuardWeeks ?? DEFAULT_REPEAT_GUARD;
    const fresh = pool.filter((r) => this.isFresh(r.id, fixture, guard));
    if (fresh.length > 0) pool = fresh;

    // 4. AGIRLIKLI CEKILIS
    const bigMatch = fixture.importance !== 'league';
    const chosen = rng.weighted(pool, (r) => 1 + (r.reputation / 50) * (bigMatch ? 1.5 : 1));
    if (!chosen) return undefined;

    this.remember(chosen.id, fixture);
    return chosen;
  }

  private neededBadge(fixture: Fixture): RefereeBadge {
    const explicit = this.deps.requiredBadgeOf?.(fixture.competitionId);
    if (explicit !== undefined) return explicit;
    return requiredBadge(fixture.importance, this.deps.leagueLevelOf(fixture.competitionId));
  }

  private isFresh(refereeId: number, fixture: Fixture, guard: number): boolean {
    const last = this.lastAssigned.get(refereeId);
    if (last !== undefined && fixture.week - last < 2) return false;

    for (const clubId of [fixture.homeId, fixture.awayId]) {
      const withClub = this.lastWithClub.get(`${refereeId}:${clubId}`);
      if (withClub !== undefined && fixture.week - withClub < guard) return false;
    }
    return true;
  }

  private remember(refereeId: number, fixture: Fixture): void {
    this.lastAssigned.set(refereeId, fixture.week);
    this.lastWithClub.set(`${refereeId}:${fixture.homeId}`, fixture.week);
    this.lastWithClub.set(`${refereeId}:${fixture.awayId}`, fixture.week);
  }

  /** Sezon donusunde temizlenir. */
  resetSeason(): void {
    this.lastAssigned.clear();
    this.lastWithClub.clear();
  }
}
