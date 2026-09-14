/**
 * MENAJERLIK SIRKETI ASAMASI -- kaynakta GERCEKTEN olan veri.
 *
 * NEDEN SIMDIYE KADAR ITHAL EDILMEDI:
 *   `masking.ts` politikasi `player_agent_name` alanini "gercek kisi adi
 *   tasimamak icin" duşuruyordu. Ama olculdu: bu alan KISI adi degil
 *   SIRKET adi tasiyor -- Wasserman, CAA Stellar, Gestifute, SEG...
 *   4.842 ayri sirket, gercek musteri sayilariyla. Politikanin gerekcesi
 *   burada gecerli degil; sirket adi maskelenerek ithal edilebilir.
 *
 * NE UYDURULMUYOR:
 *   client_count   -> SAYILIR (musteri satirlari)
 *   reputation     -> musterilerin piyasa degerinden
 *   influence      -> musteri sayisi + itibar
 *   specialization -> musteri profilinden (yas, deger, ulke yayilimi)
 *   Yalnizca `negotiation_power` tohumdandir -- pazarlik gucu kaynakta
 *   olcume gelmiyor -- ve o da itibar bandindan cekilir, havadan degil.
 *
 * IKI KAYNAK KOPRUSU:
 *   Sirket verisi TRANSFERMARKT'ta, oyuncu verisi FC26'da. Ayni oyuncu iki
 *   kaynakta farkli ID tasiyor, bu yuzden ad + dogum yili + uyruk uzerinden
 *   eslestirilir ve guven skoru `identity_link` tablosuna yazilir. Zayif
 *   eslesme KABUL EDILMEZ: oyuncu sirketsiz kalir, ki bu gecerli bir
 *   durumdur ve uydurma sirket atamaktan iyidir.
 */

import { readCsv, opt, num } from '../csv.js';
import type { IssueLog } from '../db.js';
import type { DatabaseSyncType } from '../sqlite.js';
import { MaskBinder, hashString } from '../masking.js';

/** Sirket ID uzayi -- diger varliklarla cakismasin diye ofset. */
const AGENCY_ID_OFFSET = 4_000_000;

const PROFILE_COLUMNS = [
  'player_id',
  'player_name',
  'date_of_birth',
  'citizenship',
  'player_agent_id',
  'player_agent_name',
] as const;

/**
 * Sirket adi maskeleme.
 *
 * `phoneticShift` burada YANLIS arac: "Wasserman" -> "Wassermon" bir kisi
 * soyadi gibi davranir ve sirket adi olarak tuhaf durur. Bunun yerine
 * jenerik ek sozcugu DEGISTIRILIR ("Sports Group" -> "Sports Partners");
 * jenerik ek yoksa sona bir tane EKLENIR.
 */
const GENERIC_SUFFIXES = [
  'Sports', 'Group', 'Management', 'Partners', 'International',
  'Agency', 'Football', 'Talent', 'Union', 'Associates',
];

const RECOGNISED_SUFFIX = new Set(
  [...GENERIC_SUFFIXES, 'Ltd', 'GmbH', 'srl', 'SL', 'BV', 'Inc', 'LLC', 'SA'].map((s) =>
    s.toLowerCase(),
  ),
);

export function maskAgencyName(real: string, salt: number): string {
  const tokens = real.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return `Agency ${salt}`;

  const pickSuffix = (seed: number): string =>
    GENERIC_SUFFIXES[hashString(real, seed) % GENERIC_SUFFIXES.length]!;

  const lastToken = tokens[tokens.length - 1]!.toLowerCase();
  if (tokens.length > 1 && RECOGNISED_SUFFIX.has(lastToken)) {
    // Jenerik eki degistir: govde taninir kalir, ad degisir.
    const head = tokens.slice(0, -1).join(' ');
    let replacement = pickSuffix(salt);
    if (replacement.toLowerCase() === lastToken) replacement = pickSuffix(salt + 1);
    return `${head} ${replacement}`;
  }

  // Jenerik ek yok -- ekle. "Gestifute" -> "Gestifute Partners"
  return `${tokens.join(' ')} ${pickSuffix(salt)}`;
}

interface ClientRow {
  readonly agentId: string;
  readonly agentName: string;
  readonly playerName: string;
  readonly birthYear: number | undefined;
  readonly citizenship: string;
}

export interface AgencyStageInput {
  readonly db: DatabaseSyncType;
  readonly binder: MaskBinder;
  readonly log: IssueLog;
  readonly seed: number;
  /** `player_profiles.csv`. Yoksa asama atlanir. */
  readonly profilesFile: string | undefined;
}

export interface AgencyStageResult {
  readonly agencies: number;
  readonly links: number;
  readonly matchedPlayers: number;
  readonly unmatched: number;
}

const EMPTY: AgencyStageResult = { agencies: 0, links: 0, matchedPlayers: 0, unmatched: 0 };

export async function importAgencies(input: AgencyStageInput): Promise<AgencyStageResult> {
  const { db, binder, log } = input;
  if (input.profilesFile === undefined) {
    log.warn('agency', 'player_profiles.csv yok -- menajerlik sirketi asamasi atlandi');
    return EMPTY;
  }

  // --- ithal edilmis oyuncular: eslestirme anahtari -> id
  const players = db
    .prepare(
      `SELECT p.id, p.first_real, p.last_real, p.birth_year, p.nationality,
              p.external_key, p.market_value,
              COALESCE(? - p.birth_year, 26) AS age
       FROM player p`,
    )
    .all(new Date().getFullYear()) as unknown as {
    id: number;
    first_real: string;
    last_real: string;
    birth_year: number | null;
    nationality: string;
    external_key: string;
    market_value: number;
    age: number;
  }[];

  if (players.length === 0) {
    log.warn('agency', 'oyuncu yok -- sirket asamasi atlandi');
    return EMPTY;
  }

  // Iki anahtar: guclu (ad+yil) ve zayif (yalnizca ad). Zayif anahtar
  // BIRDEN COK oyuncuya isabet edebilir; o durumda eslestirme YAPILMAZ.
  const strong = new Map<string, number>();
  const weak = new Map<string, number[]>();
  const byId = new Map<number, (typeof players)[number]>();
  for (const p of players) {
    byId.set(p.id, p);
    const name = normalise(`${p.first_real} ${p.last_real}`);
    if (p.birth_year !== null) strong.set(`${name}|${p.birth_year}`, p.id);
    const list = weak.get(name);
    if (list) list.push(p.id);
    else weak.set(name, [p.id]);
  }

  // --- kaynak taramasi
  const clients = new Map<string, ClientRow[]>();
  const agencyNames = new Map<string, string>();

  for await (const row of readCsv(input.profilesFile, { requireColumns: [...PROFILE_COLUMNS] })) {
    const agentId = opt(row['player_agent_id']);
    const agentName = opt(row['player_agent_name']);
    if (agentId === undefined || agentName === undefined) continue;

    agencyNames.set(agentId, agentName);
    const entry: ClientRow = {
      agentId,
      agentName,
      playerName: opt(row['player_name']) ?? '',
      birthYear: yearOf(row['date_of_birth']),
      citizenship: opt(row['citizenship']) ?? '',
    };
    const bucket = clients.get(agentId);
    if (bucket) bucket.push(entry);
    else clients.set(agentId, [entry]);
  }

  if (agencyNames.size === 0) {
    log.warn('agency', 'kaynakta menajerlik sirketi bulunamadi');
    return EMPTY;
  }

  // --- eslestirme: sirket musterisi -> ithal edilmis oyuncu
  interface Resolved {
    readonly agentId: string;
    readonly playerId: number;
    readonly confidence: number;
    readonly method: string;
  }
  const resolved: Resolved[] = [];
  const claimed = new Set<number>();
  let unmatched = 0;

  for (const [agentId, rows] of clients) {
    for (const c of rows) {
      const name = normalise(stripSuffix(c.playerName));
      let playerId: number | undefined;
      let confidence = 0;
      let method = '';

      if (c.birthYear !== undefined) {
        const hit = strong.get(`${name}|${c.birthYear}`);
        if (hit !== undefined) {
          playerId = hit;
          confidence = 95;
          method = 'name+birth_year';
        }
      }
      if (playerId === undefined) {
        const list = weak.get(name);
        // Tek isabet varsa kabul; birden cok isabet BELIRSIZ -- reddedilir.
        if (list?.length === 1) {
          playerId = list[0]!;
          confidence = 70;
          method = 'name';
        }
      }

      if (playerId === undefined || claimed.has(playerId)) {
        unmatched += 1;
        continue;
      }
      claimed.add(playerId);
      resolved.push({ agentId, playerId, confidence, method });
    }
  }

  if (resolved.length === 0) {
    log.warn('agency', 'hicbir musteri ithal edilmis oyuncuyla eslesmedi -- sirket yazilmadi');
    return { ...EMPTY, unmatched };
  }

  // --- yalnizca ESLESEN musterisi olan sirketler yazilir
  const perAgency = new Map<string, Resolved[]>();
  for (const r of resolved) {
    const list = perAgency.get(r.agentId);
    if (list) list.push(r);
    else perAgency.set(r.agentId, [r]);
  }

  const insAgency = db.prepare(
    `INSERT INTO agency(
       id, external_key, name_real, name_masked, country_id, client_count,
       reputation, influence, negotiation_power, specialization, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
       client_count = excluded.client_count,
       reputation = excluded.reputation,
       influence = excluded.influence,
       specialization = excluded.specialization`,
  );
  const insLink = db.prepare(
    `INSERT INTO player_agency(player_id, agency_id, start_year, end_year, is_current)
     VALUES (?, ?, ?, NULL, 1)`,
  );
  const insIdentity = db.prepare(
    `INSERT INTO identity_link(entity_kind, primary_key, linked_key, confidence, method)
     VALUES ('player', ?, ?, ?, ?)
     ON CONFLICT(entity_kind, primary_key, linked_key) DO UPDATE SET
       confidence = excluded.confidence`,
  );

  const countryByName = new Map(
    (
      db.prepare('SELECT id, name_real FROM country').all() as unknown as {
        id: number;
        name_real: string;
      }[]
    ).map((r) => [r.name_real, r.id]),
  );

  // Itibar yuzdeligi icin once ham skorlari topla.
  const scored = [...perAgency.entries()].map(([agentId, list]) => {
    const values = list
      .map((r) => byId.get(r.playerId)?.market_value ?? 0)
      .sort((a, b) => b - a)
      .slice(0, 10);
    const mean = values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
    return { agentId, list, score: Math.log10(Math.max(mean, 1_000)) };
  });
  const ranked = [...scored].sort((a, b) => a.score - b.score);
  const n = ranked.length;

  let links = 0;
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM player_agency');

    ranked.forEach((entry, rank) => {
      const { agentId, list } = entry;
      const realName = agencyNames.get(agentId) ?? 'Agency';
      const external = `tm-agency:${agentId}`;
      const bound = binder.resolve('agency', external, realName, (salt) => ({
        name: maskAgencyName(realName, salt),
        strategy: 'pool',
      }));

      const clientCount = list.length;
      // Yuzdelik: hangi evreni ithal edersek edelim kullanilabilir dagilim.
      const reputation = n <= 1 ? 55 : Math.round(12 + (84 * rank) / (n - 1));
      const influence = clamp(
        Math.round(Math.log10(Math.max(clientCount, 1)) * 22 + reputation * 0.6),
        1,
        100,
      );
      const roll = (hashString(external, input.seed) % 1000) / 1000;
      // Pazarlik gucu itibar BANDINDAN cekilir -- havadan degil.
      const negotiation = clamp(Math.round(reputation * 0.7 + 15 + roll * 20), 1, 100);

      const members = list.map((r) => byId.get(r.playerId)).filter((p) => p !== undefined);
      const countryName = dominantCountry(members.map((p) => p.nationality));

      insAgency.run(
        bound.stableId + AGENCY_ID_OFFSET,
        external,
        realName,
        bound.name,
        countryByName.get(countryName) ?? null,
        clientCount,
        reputation,
        influence,
        negotiation,
        specialisationOf(members),
      );

      for (const r of list) {
        insLink.run(r.playerId, bound.stableId + AGENCY_ID_OFFSET, SOURCE_YEAR);
        const player = byId.get(r.playerId);
        if (player) {
          insIdentity.run(player.external_key, `tm-agency:${r.agentId}`, r.confidence, r.method);
        }
        links += 1;
      }
    });

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  log.info(
    'agency',
    `${n} menajerlik sirketi, ${links} oyuncu iliskisi -- ${unmatched} musteri kapsam disi`,
  );

  return { agencies: n, links, matchedPlayers: claimed.size, unmatched };
}

const SOURCE_YEAR = new Date().getFullYear();

/**
 * UZMANLIK -- musteri profilinden TURETILIR, uydurulmaz.
 *
 * Sira onemli: once en ayirt edici olan (genclik, elit) bakilir, sonra
 * cografi yayilim, en sonda buyukluk. Ters sirada butun sirketler
 * 'commercial' cikardi.
 */
function specialisationOf(
  members: readonly { age: number; market_value: number; nationality: string }[],
): string {
  if (members.length === 0) return 'regional';
  const avgAge = members.reduce((s, p) => s + p.age, 0) / members.length;
  const avgValue = members.reduce((s, p) => s + p.market_value, 0) / members.length;
  const countries = new Set(members.map((p) => p.nationality)).size;

  if (avgAge < 22) return 'youth';
  if (avgValue > 25_000_000) return 'elite';
  if (countries >= 4) return 'international';
  if (members.length < 5) return 'regional';

  const top = dominantCountry(members.map((p) => p.nationality));
  const share = members.filter((p) => p.nationality === top).length / members.length;
  return share >= 0.8 ? 'domestic' : 'commercial';
}

function dominantCountry(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) {
    if (n === '') continue;
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  let best = '';
  let most = 0;
  for (const [name, c] of counts) {
    if (c > most) {
      most = c;
      best = name;
    }
  }
  return best;
}

/** "Miroslav Klose (10)" -> "Miroslav Klose". */
function stripSuffix(raw: string): string {
  return raw.replace(/\s*\(\d+\)\s*$/, '').trim();
}

/**
 * Eslestirme icin ad normalizasyonu.
 *
 * Aksanlar duser, noktalama gider, bosluk tekillesir. Iki kaynagin ayni
 * kisiyi "Erling Haaland" ve "Erling Braut Håland" diye yazmasi yaygin --
 * normalizasyon bunu tamamen cozmez ama isabet oranini ciddi artirir.
 */
function normalise(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function yearOf(raw: string | undefined): number | undefined {
  const y = num((raw ?? '').slice(0, 4));
  return y !== undefined && y > 1900 ? y : undefined;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
