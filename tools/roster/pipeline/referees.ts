/**
 * HAKEM URETICI -- kaynakta olmayan tek kadro.
 *
 * Kulupler ve oyuncular CSV'den geliyor; hakemler gelmiyor. Transfermarkt
 * kazimasinda hakem verisi hic yok.
 *
 * KOD DEGIL VERI:
 *   Ilk surumde isim havuzlari, kokart dagilimi ve nitelik araliklari bu
 *   dosyada SABIT dizilerdi -- yani yeni bir hakem eklemek TypeScript
 *   degistirmeyi gerektiriyordu. Bu, projenin kendi ilkesine aykiriydi
 *   ("yeni bir basamak eklemek kod degil satir gerektirir").
 *
 *   Artik hepsi `tools/roster/referee-pool.json`da. Yeni hakem eklemek,
 *   kokart dagilimini degistirmek ya da bir ulkeye ozel isim havuzu tanimlamak
 *   icin kod degismez.
 *
 * DETERMINIZM: ayni tohum + ayni havuz = ayni hakem kadrosu.
 * MASKE KILIDI: bir kere uretilen hakem adi ve ID'si degismez; havuza yeni
 * isim eklemek eski hakemleri yeniden adlandirmaz.
 */

import { readFileSync, existsSync } from 'node:fs';
import type { IssueLog } from '../db.js';
import type { DatabaseSyncType } from '../sqlite.js';
import { MaskBinder, hashString } from '../masking.js';

export type RefereeBadge = 'regional' | 'national' | 'elite' | 'fifa';
const BADGES: readonly RefereeBadge[] = ['regional', 'national', 'elite', 'fifa'];

type Range = readonly [number, number];

interface BadgeProfile {
  readonly consistency: Range;
  readonly bias: number;
  readonly reputation: Range;
}

interface NamePool {
  readonly first: readonly string[];
  readonly last: readonly string[];
}

/** Elle tanimlanmis hakem -- `manual` dizisinden. */
interface ManualReferee {
  readonly name: string;
  readonly country: string;
  readonly badge: RefereeBadge;
  readonly attributes?: Partial<Record<string, number>>;
}

export interface RefereePool {
  readonly refereesPerLeague: number;
  readonly badgeDistribution: Readonly<Record<RefereeBadge, number>>;
  readonly badgeProfiles: Readonly<Record<RefereeBadge, BadgeProfile>>;
  readonly attributeRanges: Readonly<Record<string, Range>>;
  readonly namePools: Readonly<Record<string, NamePool>>;
  readonly manual: readonly ManualReferee[];
}

/** Havuz dosyasi yoksa oyun yine calissin diye asgari varsayilan. */
const FALLBACK_POOL: RefereePool = {
  refereesPerLeague: 8,
  badgeDistribution: { regional: 0.45, national: 0.35, elite: 0.15, fifa: 0.05 },
  badgeProfiles: {
    regional: { consistency: [35, 65], bias: 12, reputation: [20, 45] },
    national: { consistency: [50, 78], bias: 8, reputation: [40, 70] },
    elite: { consistency: [65, 88], bias: 5, reputation: [65, 88] },
    fifa: { consistency: [75, 95], bias: 3, reputation: [80, 99] },
  },
  attributeRanges: {
    strictness: [35, 85],
    cardTendency: [30, 85],
    penaltyCourage: [30, 90],
    varReliance: [20, 90],
    experience: [0, 250],
  },
  namePools: {
    default: { first: ['Marco', 'Felix', 'Michael'], last: ['Rossi', 'Weber', 'Oliver'] },
  },
  manual: [],
};

export function loadRefereePool(path: string, log: IssueLog): RefereePool {
  if (!existsSync(path)) {
    log.warn('referees', `havuz dosyasi yok, varsayilana dusuluyor: ${path}`);
    return FALLBACK_POOL;
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<RefereePool>;
  return {
    refereesPerLeague: raw.refereesPerLeague ?? FALLBACK_POOL.refereesPerLeague,
    badgeDistribution: raw.badgeDistribution ?? FALLBACK_POOL.badgeDistribution,
    badgeProfiles: raw.badgeProfiles ?? FALLBACK_POOL.badgeProfiles,
    attributeRanges: raw.attributeRanges ?? FALLBACK_POOL.attributeRanges,
    namePools: raw.namePools ?? FALLBACK_POOL.namePools,
    manual: raw.manual ?? [],
  };
}

export interface RefereeStageInput {
  readonly db: DatabaseSyncType;
  readonly binder: MaskBinder;
  readonly log: IssueLog;
  readonly seed: number;
  readonly poolPath: string;
}

export interface RefereeStageResult {
  readonly generated: number;
  readonly manual: number;
  readonly byBadge: Readonly<Record<RefereeBadge, number>>;
}

/** Hakem ID'leri oyuncu maske uzayini paylasiyor; carpismasin diye ofset. */
const REFEREE_ID_OFFSET = 1_000_000;

export function generateReferees(input: RefereeStageInput): RefereeStageResult {
  const { db, binder, log } = input;
  const pool = loadRefereePool(input.poolPath, log);

  const countries = db.prepare('SELECT id, name_real FROM country').all() as unknown as {
    id: number;
    name_real: string;
  }[];
  const empty = { generated: 0, manual: 0, byBadge: badgeCounter() };
  if (countries.length === 0) {
    log.warn('referees', 'ulke yok -- hakem uretilmedi');
    return empty;
  }

  const countryIdByName = new Map(countries.map((c) => [c.name_real, c.id]));
  const leaguesPerCountry = new Map(
    (
      db
        .prepare('SELECT country_id, COUNT(*) AS n FROM competition GROUP BY country_id')
        .all() as unknown as { country_id: number; n: number }[]
    ).map((r) => [r.country_id, r.n]),
  );

  const insert = db.prepare(
    `INSERT INTO referee(
       id, external_key, name_real, name_masked, country_id, badge,
       strictness, card_tendency, penalty_courage, var_reliance,
       consistency, home_bias, experience, reputation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       badge = excluded.badge,
       strictness = excluded.strictness,
       card_tendency = excluded.card_tendency,
       penalty_courage = excluded.penalty_courage,
       var_reliance = excluded.var_reliance,
       consistency = excluded.consistency,
       home_bias = excluded.home_bias,
       reputation = excluded.reputation`,
  );

  const byBadge = badgeCounter();
  let generated = 0;
  let manualCount = 0;

  db.exec('BEGIN');
  try {
    // --- ELLE TANIMLI HAKEMLER
    //
    // Once bunlar: kullanicinin acikca istedigi hakemler cekilisle uretilen
    // kadronun arasinda kaybolmasin.
    pool.manual.forEach((entry, index) => {
      const countryId = countryIdByName.get(entry.country);
      if (countryId === undefined) {
        log.warn(
          'referees',
          `elle hakem "${entry.name}" atlandi: "${entry.country}" ithal edilen ulkeler arasinda yok`,
          'referee',
          entry.name,
        );
        return;
      }
      const profile = pool.badgeProfiles[entry.badge] ?? FALLBACK_POOL.badgeProfiles.national;
      const roll = pseudo(input.seed, `manual:${index}`);
      const attr = (key: string, fallbackRoll: number): number =>
        entry.attributes?.[key] ?? span(roll(fallbackRoll), pool.attributeRanges[key] ?? [40, 70]);

      const bound = binder.resolve('player', `ref-manual-${index}`, entry.name, () => ({
        name: entry.name,
        strategy: 'manual',
      }));

      insert.run(
        bound.stableId + REFEREE_ID_OFFSET,
        `ref-manual-${index}`,
        entry.name,
        bound.name,
        countryId,
        entry.badge,
        attr('strictness', 1),
        attr('cardTendency', 2),
        attr('penaltyCourage', 3),
        attr('varReliance', 4),
        entry.attributes?.['consistency'] ?? span(roll(5), profile.consistency),
        entry.attributes?.['homeBias'] ?? 50 + Math.round((roll(6) * 2 - 1) * profile.bias),
        attr('experience', 7),
        entry.attributes?.['reputation'] ?? span(roll(8), profile.reputation),
      );
      byBadge[entry.badge] += 1;
      manualCount += 1;
      generated += 1;
    });

    // --- TOHUMDAN URETILENLER
    for (const country of countries) {
      const leagues = leaguesPerCountry.get(country.id) ?? 1;
      const count = Math.max(6, Math.round(leagues * pool.refereesPerLeague));
      const names = pool.namePools[country.name_real] ?? pool.namePools['default'];
      if (!names || names.first.length === 0 || names.last.length === 0) continue;

      for (let i = 0; i < count; i += 1) {
        const roll = pseudo(input.seed, `ref:${country.id}:${i}`);
        const badge = pickBadge(pool.badgeDistribution, roll(0));
        const profile = pool.badgeProfiles[badge] ?? FALLBACK_POOL.badgeProfiles.national;

        const name = `${pick(names.first, roll(1))} ${pick(names.last, roll(2))}`;
        const bound = binder.resolve('player', `ref-${country.id}-${i}`, name, (salt) => ({
          name: salt === 0 ? name : `${name} ${salt}`,
          strategy: 'pool',
        }));

        insert.run(
          bound.stableId + REFEREE_ID_OFFSET,
          `ref-${country.id}-${i}`,
          name,
          bound.name,
          country.id,
          badge,
          span(roll(3), pool.attributeRanges['strictness'] ?? [35, 85]),
          span(roll(4), pool.attributeRanges['cardTendency'] ?? [30, 85]),
          span(roll(5), pool.attributeRanges['penaltyCourage'] ?? [30, 90]),
          span(roll(6), pool.attributeRanges['varReliance'] ?? [20, 90]),
          span(roll(7), profile.consistency),
          50 + Math.round((roll(8) * 2 - 1) * profile.bias),
          span(roll(9), pool.attributeRanges['experience'] ?? [0, 250]),
          span(roll(10), profile.reputation),
        );

        byBadge[badge] += 1;
        generated += 1;
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  log.info(
    'referees',
    `${generated} hakem (${manualCount} elle tanimli) -- ` +
      BADGES.map((b) => `${b} ${byBadge[b]}`).join(', '),
  );

  return { generated, manual: manualCount, byBadge };
}

function badgeCounter(): Record<RefereeBadge, number> {
  return { regional: 0, national: 0, elite: 0, fifa: 0 };
}

/** Kumulatif dagilimdan kokart seceri. Toplam 1'e ulasmazsa en dusuge duser. */
function pickBadge(distribution: Readonly<Record<RefereeBadge, number>>, roll: number): RefereeBadge {
  let acc = 0;
  for (const badge of BADGES) {
    acc += distribution[badge] ?? 0;
    if (roll <= acc) return badge;
  }
  return 'regional';
}

function pick<T>(items: readonly T[], roll: number): T {
  return items[Math.min(items.length - 1, Math.floor(roll * items.length))]!;
}

function span(roll: number, range: Range): number {
  return Math.round(range[0] + roll * (range[1] - range[0]));
}

/** (tohum, anahtar) ikilisinden tekrar edilebilir cekilis dizisi. */
function pseudo(seed: number, key: string): (index: number) => number {
  return (index) => (hashString(`${key}#${index}`, seed) % 100000) / 100000;
}
