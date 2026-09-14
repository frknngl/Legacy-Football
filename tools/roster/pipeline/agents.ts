/**
 * MENAJER URETICI -- kaynakta ADI olan ama kullanilamayan kadro.
 *
 * Transfermarkt verisinde `player_agent_name` alani VAR. Kullanmiyoruz:
 * bunlar gercek, yasayan kisiler ve oyunda karakter olarak canlandirilacak.
 * Maskelemek de yetmez -- "Mino R." hala tek bir kisiyi isaret eder. Bu
 * yuzden alan ithalatta DUSURULUYOR ve menajer kadrosu sifirdan uretiliyor.
 *
 * KOD DEGIL VERI:
 *   Arketipler, nitelik bantlari, komisyon araliklari ve isim havuzlari
 *   `tools/roster/agent-pool.json`da. Yeni bir arketip eklemek bu dosyaya
 *   dokunmayi gerektirmez (yalnizca schema.ts'teki CHECK kisiti genisletilir).
 *
 * DETERMINIZM: ayni tohum + ayni havuz = ayni menajer kadrosu.
 * MASKE KILIDI: bir kere uretilen menajer adi ve ID'si degismez.
 */

import type { IssueLog } from '../db.js';
import type { DatabaseSyncType } from '../sqlite.js';
import { MaskBinder, hashString } from '../masking.js';
import { readBands, readDistribution, readNamePool, readSetting, type BandTable } from './reference.js';

export type AgentArchetype =
  | 'super_agent'
  | 'family'
  | 'developer'
  | 'opportunist'
  | 'journeyman';

type Range = readonly [number, number];





/**
 * Havuz dosyasi yoksa oyun yine calissin diye asgari varsayilan.
 *
 * Tek arketip degil BES: eksik havuzla acilan bir dunyada her menajerin
 * ayni olmasi, sistemi test ederken "calisiyor" izlenimi verirdi.
 */
export interface AgentStageInput {
  readonly db: DatabaseSyncType;
  readonly binder: MaskBinder;
  readonly log: IssueLog;
  readonly seed: number;
}

export interface AgentStageResult {
  readonly generated: number;
  readonly manual: number;
  readonly byArchetype: Readonly<Record<string, number>>;
}

/**
 * Menajer ID'leri oyuncu ve hakem maske uzayini paylasiyor.
 *
 * Hakem 1_000_000, menajer 2_000_000. Ayni `MaskBinder` uzayindan
 * `stableId` aldiklari icin ofset olmasa kaleci ile menajer ayni ID'yi
 * alabilirdi.
 */
const AGENT_ID_OFFSET = 2_000_000;

export function generateAgents(input: AgentStageInput): AgentStageResult {
  const { db, binder, log } = input;

  // KURULUM VERISI VERITABANINDAN.
  const perCountry = readSetting(db, 'agent', 'per_country', 6);
  const distribution = readDistribution(db, 'agent', 'archetype');
  const archetypeBands = new Map<string, BandTable>(
    [...distribution.keys()].map((a) => [a, readBands(db, 'agent', a)]),
  );

  const countries = db.prepare('SELECT id, name_real FROM country').all() as unknown as {
    id: number;
    name_real: string;
  }[];
  if (countries.length === 0) {
    log.warn('agents', 'ulke yok -- menajer uretilmedi');
    return { generated: 0, manual: 0, byArchetype: {} };
  }

  const leaguesPerCountry = new Map(
    (
      db
        .prepare('SELECT country_id, COUNT(*) AS n FROM competition GROUP BY country_id')
        .all() as unknown as { country_id: number; n: number }[]
    ).map((r) => [r.country_id, r.n]),
  );

  const insert = db.prepare(
    'INSERT INTO agent(' +
      'id, external_key, name_real, name_masked, archetype,' +
      'reach, negotiation, loyalty, patience, commission, country_id, reputation)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)' +
      ' ON CONFLICT(id) DO UPDATE SET' +
      ' archetype = excluded.archetype,' +
      ' reach = excluded.reach,' +
      ' negotiation = excluded.negotiation,' +
      ' loyalty = excluded.loyalty,' +
      ' patience = excluded.patience,' +
      ' commission = excluded.commission,' +
      ' reputation = excluded.reputation',
  );

  const byArchetype: Record<string, number> = {};
  let generated = 0;
  let manualCount = 0;

  const write = (
    key: string,
    realName: string,
    countryId: number,
    archetype: string,
    bands: BandTable,
    roll: (i: number) => number,
    overrides: Partial<Record<string, number>> | undefined,
    strategy: 'manual' | 'pool',
  ): void => {
    const bound = binder.resolve('player', key, realName, (salt) => ({
      name: strategy === 'manual' || salt === 0 ? realName : `${realName} ${salt}`,
      strategy,
    }));
    const num = (name: string, index: number): number =>
      overrides?.[name] ?? span(roll(index), bands.get(name));

    insert.run(
      bound.stableId + AGENT_ID_OFFSET,
      key,
      realName,
      bound.name,
      archetype,
      num('reach', 1),
      num('negotiation', 2),
      num('loyalty', 3),
      num('patience', 4),
      // Komisyon ondalikli: nitelikler gibi tamsayi bandina yuvarlanamaz,
      // %12 ile %13 arasindaki fark kariyer boyunca milyonlar eder.
      overrides?.['commission'] ?? commissionOf(bands.get('commission'), roll(5)),
      countryId,
      num('reputation', 6),
    );

    byArchetype[archetype] = (byArchetype[archetype] ?? 0) + 1;
    generated += 1;
  };

  db.exec('BEGIN');
  try {
    // --- ELLE TANIMLI MENAJERLER
    //
    // Once bunlar: kullanicinin acikca istedigi menajer cekilisle uretilen
    // kalabaligin arasinda kaybolmasin.
    // ELLE TANIMLI MENAJER YOK.
    //
    // `ref_manual_referee`in menajer karsiligi acilmadi: bugun elle
    // tanimlanmis tek bir menajer bile yok ve tuketicisi olmayan bir tablo
    // acmak bu calismanin acik kuralina aykiri. Gerekirse ayni desenle
    // (`ref_manual_agent`) tek migrationla eklenir.

    // --- TOHUMDAN URETILENLER
    //
    // Sayi lig sayisiyla olceklenir: dort ligi olan ulkede menajer piyasasi
    // da dort kat kalabaliktir. Taban 4, cunku tek ligli kucuk bir ulkede
    // bile Hero'nun secebilecegi birden fazla secenek olmali.
    for (const country of countries) {
      const leagues = leaguesPerCountry.get(country.id) ?? 1;
      const count = Math.max(4, Math.round(leagues * perCountry));
      const names = readNamePool(db, 'agent', country.name_real);
      if (names.first.length === 0 || names.last.length === 0) continue;

      for (let i = 0; i < count; i += 1) {
        const roll = pseudo(input.seed, `agent:${country.id}:${i}`);
        const archetype = pickArchetype(distribution, roll(0));
        const bands = archetypeBands.get(archetype) ?? new Map();
        const name = `${pick(names.first, roll(7))} ${pick(names.last, roll(8))}`;
        write(`agent-${country.id}-${i}`, name, country.id, archetype, bands, roll, undefined, 'pool');
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  log.info(
    'agents',
    `${generated} menajer (${manualCount} elle tanimli) -- ` +
      Object.entries(byArchetype)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${n}`)
        .join(', '),
  );

  return { generated, manual: manualCount, byArchetype };
}

/** Kumulatif dagilimdan arketip seceri. Toplam 1'e ulasmazsa journeyman. */
/** Agirlikli secim. Toplam 1.0 olmak zorunda degil -- normalize edilir. */
function pickArchetype(distribution: ReadonlyMap<string, number>, roll: number): string {
  const total = [...distribution.values()].reduce((s, w) => s + w, 0);
  if (total <= 0) return 'journeyman';
  let acc = 0;
  for (const [key, share] of distribution) {
    acc += share / total;
    if (roll <= acc) return key;
  }
  return 'journeyman';
}

function pick<T>(items: readonly T[], roll: number): T {
  return items[Math.min(items.length - 1, Math.floor(roll * items.length))]!;
}

/** Banttan cekilis. Bant tanimli degilse notr 40-70 araligina duser. */
function span(roll: number, range: Range | undefined): number {
  const [min, max] = range ?? [40, 70];
  return Math.round(min + roll * (max - min));
}

/**
 * Komisyon -- ondalikli, nitelikler gibi tamsayiya yuvarlanamaz.
 * %12 ile %13 arasindaki fark kariyer boyunca milyonlar eder.
 */
function commissionOf(range: Range | undefined, roll: number): number {
  const [min, max] = range ?? [0.05, 0.1];
  return Math.round((min + roll * (max - min)) * 1000) / 1000;
}

function pseudo(seed: number, key: string): (index: number) => number {
  return (index) => (hashString(`${key}#${index}`, seed) % 100000) / 100000;
}
