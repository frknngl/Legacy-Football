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

import { readFileSync, existsSync } from 'node:fs';
import type { IssueLog } from '../db.js';
import type { DatabaseSyncType } from '../sqlite.js';
import { MaskBinder, hashString } from '../masking.js';

export type AgentArchetype =
  | 'super_agent'
  | 'family'
  | 'developer'
  | 'opportunist'
  | 'journeyman';

type Range = readonly [number, number];

interface ArchetypeProfile {
  readonly label: string;
  readonly reach: Range;
  readonly negotiation: Range;
  readonly loyalty: Range;
  readonly patience: Range;
  readonly commission: Range;
  readonly reputation: Range;
}

interface NamePool {
  readonly first: readonly string[];
  readonly last: readonly string[];
}

interface ManualAgent {
  readonly name: string;
  readonly country: string;
  readonly archetype: AgentArchetype;
  readonly attributes?: Partial<Record<string, number>>;
}

export interface AgentPool {
  readonly agentsPerCountry: number;
  readonly distribution: Readonly<Record<string, number>>;
  readonly archetypes: Readonly<Record<string, ArchetypeProfile>>;
  readonly namePools: Readonly<Record<string, NamePool>>;
  readonly manual: readonly ManualAgent[];
}

/**
 * Havuz dosyasi yoksa oyun yine calissin diye asgari varsayilan.
 *
 * Tek arketip degil BES: eksik havuzla acilan bir dunyada her menajerin
 * ayni olmasi, sistemi test ederken "calisiyor" izlenimi verirdi.
 */
const FALLBACK_POOL: AgentPool = {
  agentsPerCountry: 6,
  distribution: {
    journeyman: 0.34,
    opportunist: 0.24,
    developer: 0.2,
    family: 0.12,
    super_agent: 0.1,
  },
  archetypes: {
    super_agent: {
      label: 'Super Ajan',
      reach: [85, 98], negotiation: [80, 95], loyalty: [15, 35],
      patience: [20, 40], commission: [0.12, 0.18], reputation: [75, 99],
    },
    family: {
      label: 'Aile Uyesi',
      reach: [20, 40], negotiation: [30, 50], loyalty: [90, 99],
      patience: [85, 95], commission: [0.03, 0.05], reputation: [10, 35],
    },
    developer: {
      label: 'Gelisim Odakli',
      reach: [45, 65], negotiation: [50, 70], loyalty: [65, 80],
      patience: [70, 85], commission: [0.06, 0.09], reputation: [40, 65],
    },
    opportunist: {
      label: 'Firsatci',
      reach: [60, 80], negotiation: [65, 85], loyalty: [25, 45],
      patience: [30, 50], commission: [0.09, 0.14], reputation: [45, 75],
    },
    journeyman: {
      label: 'Siradan',
      reach: [35, 55], negotiation: [40, 60], loyalty: [55, 70],
      patience: [60, 75], commission: [0.05, 0.08], reputation: [20, 50],
    },
  },
  namePools: {
    default: {
      first: ['Daniel', 'Marco', 'Peter', 'Victor'],
      last: ['Brandt', 'Nowak', 'Keller', 'Duarte'],
    },
  },
  manual: [],
};

export function loadAgentPool(path: string, log: IssueLog): AgentPool {
  if (!existsSync(path)) {
    log.warn('agents', `havuz dosyasi yok, varsayilana dusuluyor: ${path}`);
    return FALLBACK_POOL;
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AgentPool>;
  return {
    agentsPerCountry: raw.agentsPerCountry ?? FALLBACK_POOL.agentsPerCountry,
    distribution: raw.distribution ?? FALLBACK_POOL.distribution,
    archetypes: raw.archetypes ?? FALLBACK_POOL.archetypes,
    namePools: raw.namePools ?? FALLBACK_POOL.namePools,
    manual: raw.manual ?? [],
  };
}

export interface AgentStageInput {
  readonly db: DatabaseSyncType;
  readonly binder: MaskBinder;
  readonly log: IssueLog;
  readonly seed: number;
  readonly poolPath: string;
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
  const pool = loadAgentPool(input.poolPath, log);

  const countries = db.prepare('SELECT id, name_real FROM country').all() as unknown as {
    id: number;
    name_real: string;
  }[];
  if (countries.length === 0) {
    log.warn('agents', 'ulke yok -- menajer uretilmedi');
    return { generated: 0, manual: 0, byArchetype: {} };
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
    profile: ArchetypeProfile,
    roll: (i: number) => number,
    overrides: Partial<Record<string, number>> | undefined,
    strategy: 'manual' | 'pool',
  ): void => {
    const bound = binder.resolve('player', key, realName, (salt) => ({
      name: strategy === 'manual' || salt === 0 ? realName : `${realName} ${salt}`,
      strategy,
    }));
    const num = (name: string, index: number, range: Range): number =>
      overrides?.[name] ?? span(roll(index), range);

    insert.run(
      bound.stableId + AGENT_ID_OFFSET,
      key,
      realName,
      bound.name,
      archetype,
      num('reach', 1, profile.reach),
      num('negotiation', 2, profile.negotiation),
      num('loyalty', 3, profile.loyalty),
      num('patience', 4, profile.patience),
      // Komisyon ondalikli: nitelikler gibi tamsayi bandina yuvarlanamaz,
      // %12 ile %13 arasindaki fark kariyer boyunca milyonlar eder.
      overrides?.['commission'] ??
        Math.round(
          (profile.commission[0] + roll(5) * (profile.commission[1] - profile.commission[0])) *
            1000,
        ) / 1000,
      countryId,
      num('reputation', 6, profile.reputation),
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
    pool.manual.forEach((entry, index) => {
      const countryId = countryIdByName.get(entry.country);
      if (countryId === undefined) {
        log.warn(
          'agents',
          `elle menajer "${entry.name}" atlandi: "${entry.country}" ithal edilen ulkeler arasinda yok`,
          'agent',
          entry.name,
        );
        return;
      }
      const profile = pool.archetypes[entry.archetype] ?? FALLBACK_POOL.archetypes['journeyman']!;
      write(
        `agent-manual-${index}`,
        entry.name,
        countryId,
        entry.archetype,
        profile,
        pseudo(input.seed, `agent-manual:${index}`),
        entry.attributes,
        'manual',
      );
      manualCount += 1;
    });

    // --- TOHUMDAN URETILENLER
    //
    // Sayi lig sayisiyla olceklenir: dort ligi olan ulkede menajer piyasasi
    // da dort kat kalabaliktir. Taban 4, cunku tek ligli kucuk bir ulkede
    // bile Hero'nun secebilecegi birden fazla secenek olmali.
    for (const country of countries) {
      const leagues = leaguesPerCountry.get(country.id) ?? 1;
      const count = Math.max(4, Math.round(leagues * pool.agentsPerCountry));
      const names = pool.namePools[country.name_real] ?? pool.namePools['default'];
      if (!names || names.first.length === 0 || names.last.length === 0) continue;

      for (let i = 0; i < count; i += 1) {
        const roll = pseudo(input.seed, `agent:${country.id}:${i}`);
        const archetype = pickArchetype(pool.distribution, roll(0));
        const profile = pool.archetypes[archetype] ?? FALLBACK_POOL.archetypes['journeyman']!;
        const name = `${pick(names.first, roll(7))} ${pick(names.last, roll(8))}`;
        write(`agent-${country.id}-${i}`, name, country.id, archetype, profile, roll, undefined, 'pool');
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
function pickArchetype(distribution: Readonly<Record<string, number>>, roll: number): string {
  let acc = 0;
  for (const [key, share] of Object.entries(distribution)) {
    acc += share;
    if (roll <= acc) return key;
  }
  return 'journeyman';
}

function pick<T>(items: readonly T[], roll: number): T {
  return items[Math.min(items.length - 1, Math.floor(roll * items.length))]!;
}

function span(roll: number, range: Range): number {
  return Math.round(range[0] + roll * (range[1] - range[0]));
}

function pseudo(seed: number, key: string): (index: number) => number {
  return (index) => (hashString(`${key}#${index}`, seed) % 100000) / 100000;
}
