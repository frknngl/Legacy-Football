/**
 * MILLI TAKIMLAR -- kadro, davet esigi ve milli ara fiksturu.
 *
 * NEDEN GEREKLI:
 *   Takvim milli aralari ZATEN ayiriyor (5, 11, 17, 26, 33) ve o haftalarda
 *   hicbir kulup maci yok. Ama iceri bostu: `national_duty` hayat durumu ve
 *   `milli_mac_sayisi` sayaci tanimliydi, hicbir sey onlari yazmiyordu.
 *   `progression.json` milli maci sohret hesabina 1.5 katsayiyla katiyor --
 *   yani sayac hep 0 kaldigi surece milli kariyer sohreti HIC etkilemiyordu.
 *
 * KADRO:
 *   Uyruktan gelir. `player.nationality` birincil, `second_nationality` ikincil
 *   -- kaynakta "France  Nigeria" gibi cifte vatandaslik gercekten var ve iki
 *   milli takim da o oyuncuyu cagirabilir.
 *
 * DAVET ESIGI:
 *   Oyuncu, o ulkenin en iyi 23'une girecek kadar iyiyse cagrilir. Sabit bir
 *   sayi (ornegin "quality >= 75") kucuk futbol ulkelerinde kimseyi
 *   cagirmazdi; esik ULKEYE gore degisir ve bu dogrudur -- zayif bir milli
 *   takima girmek kolaydir.
 */

import type { Rng } from '../../selection/Rng.js';

/** Bir milli takimin o anki durumu. */
export interface NationalTeam {
  readonly countryId: number;
  readonly name: string;
  /** En iyi 23 oyuncunun kalite ortalamasi -- guc olcutu. */
  readonly strength: number;
  /** Kadroya girmek icin gereken en dusuk kalite. */
  readonly threshold: number;
  readonly squadSize: number;
}

export interface NationalFixture {
  readonly week: number;
  readonly homeCountry: number;
  readonly awayCountry: number;
  readonly label: string;
}

/** Milli kadro buyuklugu. */
const SQUAD_SIZE = 23;

export interface NationalPlayer {
  readonly countryId: number;
  readonly quality: number;
}

/**
 * Uyruk listelerinden milli takimlari kurar.
 *
 * `players` her oyuncuyu KAC kez iceriyorsa o kadar milli takima adaydir:
 * cifte vatandas iki satirla gelir. Bu, cagiranin isini basitlestirir ve
 * "hangi milli takim once davet eder" sorusunu veri katmanina birakir.
 */
export function buildNationalTeams(
  players: readonly NationalPlayer[],
  countryNames: ReadonlyMap<number, string>,
): Map<number, NationalTeam> {
  const byCountry = new Map<number, number[]>();
  for (const p of players) {
    const list = byCountry.get(p.countryId);
    if (list) list.push(p.quality);
    else byCountry.set(p.countryId, [p.quality]);
  }

  const teams = new Map<number, NationalTeam>();
  for (const [countryId, qualities] of byCountry) {
    const sorted = [...qualities].sort((a, b) => b - a);
    const squad = sorted.slice(0, SQUAD_SIZE);
    if (squad.length === 0) continue;

    teams.set(countryId, {
      countryId,
      name: countryNames.get(countryId) ?? `Ulke ${countryId}`,
      strength: Math.round(squad.reduce((s, q) => s + q, 0) / squad.length),
      // Kadro 23'ten azsa esik dusuktur -- herkes cagrilir, ki dogru.
      threshold: squad.length < SQUAD_SIZE ? 0 : (squad[squad.length - 1] ?? 0),
      squadSize: squad.length,
    });
  }

  return teams;
}

/**
 * Milli ara fiksturu.
 *
 * Her pencerede takimlar eslesir; ayni pencerede iki mac oynanir (gercek FIFA
 * penceresi de boyle isler). Eslesme her pencerede yeniden cekilir -- eleme
 * gruplari sonraki is, su an amac milli maclarin GERCEKTEN oynanmasi.
 */
export function buildNationalFixtures(
  teams: ReadonlyMap<number, NationalTeam>,
  windows: readonly number[],
  rng: Rng,
): NationalFixture[] {
  const ids = [...teams.keys()];
  if (ids.length < 2) return [];

  const out: NationalFixture[] = [];
  for (const week of windows) {
    const shuffled = rng.shuffle([...ids]);
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      out.push({
        week,
        homeCountry: shuffled[i]!,
        awayCountry: shuffled[i + 1]!,
        label: 'milli mac',
      });
    }
  }
  return out;
}

/**
 * Bu kalitedeki bir oyuncu bu milli takima cagrilir mi.
 *
 * Esik kadronun 23. oyuncusudur; ona esit ya da ustundeyse kadroya girer.
 * Milli takimi olmayan bir ulke icin false -- uydurma bir davet uretmeyiz.
 */
export function isCalledUp(team: NationalTeam | undefined, quality: number): boolean {
  if (team === undefined) return false;
  return quality >= team.threshold;
}
