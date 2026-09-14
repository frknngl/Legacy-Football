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
 *   Artik hepsi VERITABANINDA: `ref_name_pool`, `ref_attribute_band`,
 *   `ref_distribution`, `ref_setting` ve `ref_manual_referee`. Once JSON
 *   dosyasindaydilar; gercek veri veritabaninda yasar ve editorden
 *   duzenlenebilir. Yeni hakem eklemek, kokart dagilimini degistirmek ya da
 *   bir ulkeye ozel isim havuzu tanimlamak icin kod degismez -- SATIR eklenir.
 *
 * DETERMINIZM: ayni tohum + ayni havuz = ayni hakem kadrosu.
 * MASKE KILIDI: bir kere uretilen hakem adi ve ID'si degismez; havuza yeni
 * isim eklemek eski hakemleri yeniden adlandirmaz.
 */

import type { IssueLog } from '../db.js';
import type { DatabaseSyncType } from '../sqlite.js';
import { MaskBinder, hashString } from '../masking.js';
import {
  readBands,
  readDistribution,
  readManualReferees,
  readNamePool,
  readSetting,
  type BandTable,
} from './reference.js';

export type RefereeBadge = 'regional' | 'national' | 'elite' | 'fifa';
const BADGES: readonly RefereeBadge[] = ['regional', 'national', 'elite', 'fifa'];

type Range = readonly [number, number];

export interface RefereeStageInput {
  readonly db: DatabaseSyncType;
  readonly binder: MaskBinder;
  readonly log: IssueLog;
  readonly seed: number;
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

  // KURULUM VERISI VERITABANINDAN.
  const perLeague = readSetting(db, 'referee', 'per_league', 8);
  const badgeDistribution = readDistribution(db, 'referee', 'badge');
  const globalRanges = readBands(db, 'referee', '*');
  const manualReferees = readManualReferees(db);
  const badgeBands = new Map<RefereeBadge, BandTable>(
    BADGES.map((b) => [b, readBands(db, 'referee', b)]),
  );

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
    manualReferees.forEach((entry, index) => {
      const countryId = countryIdByName.get(entry.countryName);
      if (countryId === undefined) {
        log.warn(
          'referees',
          `elle hakem "${entry.name}" atlandi: "${entry.countryName}" ithal edilen ulkeler arasinda yok`,
          'referee',
          entry.name,
        );
        return;
      }
      const badge = entry.badge as RefereeBadge;
      const bands = badgeBands.get(badge) ?? new Map();
      const roll = pseudo(input.seed, `manual:${index}`);
      // Elle verilen deger varsa o; yoksa banttan cekilis.
      const attr = (key: string, index2: number, band?: Range): number =>
        entry.overrides.get(key) ?? span(roll(index2), band ?? globalRanges.get(key));
      const bias = bands.get('bias')?.[0] ?? 8;

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
        badge,
        attr('strictness', 1),
        attr('card_tendency', 2),
        attr('penalty_courage', 3),
        attr('var_reliance', 4),
        attr('consistency', 5, bands.get('consistency')),
        entry.overrides.get('home_bias') ?? 50 + Math.round((roll(6) * 2 - 1) * bias),
        attr('experience', 7),
        attr('reputation', 8, bands.get('reputation')),
      );
      byBadge[badge] += 1;
      manualCount += 1;
      generated += 1;
    });

    // --- TOHUMDAN URETILENLER
    for (const country of countries) {
      const leagues = leaguesPerCountry.get(country.id) ?? 1;
      const count = Math.max(6, Math.round(leagues * perLeague));
      const names = readNamePool(db, 'referee', country.name_real);
      if (names.first.length === 0 || names.last.length === 0) continue;

      for (let i = 0; i < count; i += 1) {
        const roll = pseudo(input.seed, `ref:${country.id}:${i}`);
        const badge = pickBadge(badgeDistribution, roll(0));
        const bands = badgeBands.get(badge) ?? new Map();
        const bias = bands.get('bias')?.[0] ?? 8;

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
          span(roll(3), globalRanges.get('strictness')),
          span(roll(4), globalRanges.get('cardTendency')),
          span(roll(5), globalRanges.get('penaltyCourage')),
          span(roll(6), globalRanges.get('varReliance')),
          span(roll(7), bands.get('consistency')),
          50 + Math.round((roll(8) * 2 - 1) * bias),
          span(roll(9), globalRanges.get('experience')),
          span(roll(10), bands.get('reputation')),
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
function pickBadge(distribution: ReadonlyMap<string, number>, roll: number): RefereeBadge {
  const total = [...distribution.values()].reduce((s, w) => s + w, 0);
  if (total <= 0) return 'regional';
  let acc = 0;
  for (const badge of BADGES) {
    acc += (distribution.get(badge) ?? 0) / total;
    if (roll <= acc) return badge;
  }
  return 'regional';
}

function pick<T>(items: readonly T[], roll: number): T {
  return items[Math.min(items.length - 1, Math.floor(roll * items.length))]!;
}

/** Banttan cekilis. Bant tanimli degilse notr 40-70 araligina duser. */
function span(roll: number, range: Range | undefined): number {
  const [min, max] = range ?? [40, 70];
  return Math.round(min + roll * (max - min));
}

/** (tohum, anahtar) ikilisinden tekrar edilebilir cekilis dizisi. */
function pseudo(seed: number, key: string): (index: number) => number {
  return (index) => (hashString(`${key}#${index}`, seed) % 100000) / 100000;
}
