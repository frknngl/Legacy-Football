/**
 * TEKNIK HEYET ASAMASI -- kimlik GERCEK, nitelik URETILMIS.
 *
 * BU IKILIK NEDEN BOYLE:
 *   `male_coaches.csv` 1.369 gercek teknik direktor tasiyor -- ad, dogum
 *   tarihi, uyruk. Ama nitelik TASIMIYOR: tek bir yetenek kolonu yok.
 *   Dolayisiyla kimligi ithal edip niteligi uretiyoruz. Hakem ve menajer
 *   asamalarinda da nitelik uretiliyor; fark, orada kimligin de uretilmesi.
 *
 * ROL AYRIMI (kritik):
 *   Bu oyunda Hero bir FUTBOLCU. `roles.json`daki `manager` slotu
 *   "Teknik direktor" demek -- yani Ingilizce "manager" = "coach" = ayni
 *   kisi. Ayri bir `managers` tablosu ACILMADI; bkz. schema.ts `staff`.
 *   Turkce "menajer" bambaska bir sey: oyuncunun temsilcisi (`agent`).
 *
 * KURULUM VERISI VERITABANINDAN:
 *   Rol tanimlari, nitelik bantlari, isim havuzlari ve stil dagilimi
 *   `ref_staff_role`, `ref_attribute_band`, `ref_name_pool` ve
 *   `ref_distribution` tablolarindan okunur. Once JSON dosyasindaydilar;
 *   gercek veri veritabaninda yasar ve tek dogruluk kaynagi olur.
 *
 * DETERMINIZM:
 *   Ayni tohum + ayni referans satirlari + ayni CSV = ayni kadro. Kulup basina cekilis
 *   `pseudo(seed, 'staff:<kulup>:<rol>')` uzerinden yapilir; bir kulubun
 *   eklenmesi digerlerinin hocalarini DEGISTIRMEZ.
 *
 * UYRUK ESLESTIRME:
 *   Bir kulube once KENDI ulkesinden hoca dokulur. Havuz tukendiginde
 *   yabanci hocaya, o da bittiginde `ref_name_pool` havuzuna dusulur.
 *   Gercek futbolda da sira boyle.
 */

import { existsSync } from 'node:fs';
import { readCsvAll, opt } from '../csv.js';
import type { IssueLog } from '../db.js';
import type { DatabaseSyncType } from '../sqlite.js';
import { MaskBinder, phoneticShift, hashString } from '../masking.js';
import { staffOverall, type StaffAttributes } from '../../../src/domain/actors.js';
import {
  readBands,
  readDistribution,
  readNamePool,
  readStaffRoles,
  type BandTable,
} from './reference.js';

/** Teknik heyet ID uzayi -- oyuncu/hakem/menajer ile cakismasin diye ofset. */
const STAFF_ID_OFFSET = 3_000_000;

const COACH_COLUMNS = ['coach_id', 'short_name', 'long_name', 'dob', 'nationality_name'] as const;

type Range = readonly [number, number];

interface CoachIdentity {
  readonly sourceId: string;
  readonly nameReal: string;
  readonly birthYear: number | undefined;
  readonly nationality: string;
}

export interface StaffStageInput {
  readonly db: DatabaseSyncType;
  readonly binder: MaskBinder;
  readonly log: IssueLog;
  readonly seed: number;
  /** `male_coaches.csv`. Yoksa butun kimlikler havuzdan uretilir. */
  readonly coachesFile: string | undefined;
}

export interface StaffStageResult {
  readonly created: number;
  readonly fromSource: number;
  readonly generated: number;
  readonly withAttributes: number;
}

export async function generateStaff(input: StaffStageInput): Promise<StaffStageResult> {
  const { db, binder, log } = input;

  // KURULUM VERISI VERITABANINDAN OKUNUR.
  const roles = readStaffRoles(db);
  const styles = readDistribution(db, 'staff', 'style');
  const formations = readDistribution(db, 'staff', 'formation');
  if (roles.length === 0) {
    log.error('staff', 'ref_staff_role tablosu bos -- teknik heyet uretilemedi');
    return { created: 0, fromSource: 0, generated: 0, withAttributes: 0 };
  }

  // Bant tablolari kulup tier'i basina BIR KEZ okunur; her kulup icin
  // yeniden sorgulamak 300 kulupte 1.500 gereksiz sorgu demekti.
  const bandCache = new Map<string, BandTable>();
  const bandsFor = (tier: string): BandTable => {
    const hit = bandCache.get(tier);
    if (hit) return hit;
    const loaded = readBands(db, 'staff', tier);
    const table = loaded.size > 0 ? loaded : readBands(db, 'staff', 'mid');
    bandCache.set(tier, table);
    return table;
  };

  const clubs = db
    .prepare(
      `SELECT c.id, c.tier, c.country_id, n.name_real AS country_name
       FROM club c LEFT JOIN country n ON n.id = c.country_id
       ORDER BY c.id`,
    )
    .all() as unknown as {
    id: number;
    tier: string;
    country_id: number | null;
    country_name: string | null;
  }[];

  if (clubs.length === 0) {
    log.warn('staff', 'kulup yok -- teknik heyet uretilmedi');
    return { created: 0, fromSource: 0, generated: 0, withAttributes: 0 };
  }

  // --- gercek kimlikler, uyruga gore kovalara ayrilir
  const byNationality = new Map<string, CoachIdentity[]>();
  let identityCount = 0;
  if (input.coachesFile !== undefined && existsSync(input.coachesFile)) {
    const rows = await readCsvAll(input.coachesFile, { requireColumns: [...COACH_COLUMNS] });
    for (const r of rows) {
      const id = opt(r['coach_id']);
      const name = opt(r['long_name']) ?? opt(r['short_name']);
      if (id === undefined || name === undefined) continue;
      const nationality = opt(r['nationality_name']) ?? '';
      const year = Number((r['dob'] ?? '').slice(0, 4));
      const identity: CoachIdentity = {
        sourceId: id,
        nameReal: name,
        birthYear: Number.isFinite(year) && year > 1900 ? year : undefined,
        nationality,
      };
      const bucket = byNationality.get(nationality);
      if (bucket) bucket.push(identity);
      else byNationality.set(nationality, [identity]);
      identityCount += 1;
    }
    log.info('staff', `${identityCount} gercek teknik direktor kimligi okundu`);
  } else {
    log.warn('staff', 'male_coaches.csv yok -- butun kimlikler havuzdan uretilecek');
  }

  // Kovalardan sirayla tuketmek icin imlecler. Bir kimlik IKI kulube
  // atanamaz -- ayni kisi iki takimi birden calistiramaz.
  const cursor = new Map<string, number>();

  const insStaff = db.prepare(
    `INSERT INTO staff(
       id, external_key, name_real, name_masked, first_masked, last_masked,
       role, birth_year, nationality, country_id, club_id, reputation,
       experience, active, origin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(id) DO UPDATE SET
       club_id = excluded.club_id,
       role = excluded.role,
       reputation = excluded.reputation,
       experience = excluded.experience`,
  );
  const insAttr = db.prepare(
    `INSERT INTO staff_attributes(
       staff_id, tactical, training, development, motivation,
       man_management, discipline, preferred_formation, preferred_style, overall)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(staff_id) DO UPDATE SET
       tactical = excluded.tactical, training = excluded.training,
       development = excluded.development, motivation = excluded.motivation,
       man_management = excluded.man_management, discipline = excluded.discipline,
       overall = excluded.overall`,
  );
  const insAssign = db.prepare(
    `INSERT INTO staff_assignment(staff_id, club_id, role, start_year, end_year, is_current)
     VALUES (?, ?, ?, ?, NULL, 1)`,
  );

  let created = 0;
  let fromSource = 0;
  let generated = 0;
  let withAttributes = 0;

  db.exec('BEGIN');
  try {
    // Yeniden import: atamalar YENIDEN kurulur (kulup degismis olabilir),
    // ama `mask_binding` dokunulmaz -- ad ve ID sabit kalir.
    db.exec('DELETE FROM staff_assignment');

    for (const club of clubs) {
      const bands = bandsFor(club.tier);

      for (const spec of roles) {
        const role = spec.role;
        for (let i = 0; i < spec.perClub; i += 1) {
          const key = `staff:${club.id}:${role}:${i}`;
          const roll = pseudo(input.seed, key);

          // Once kendi ulkesinden gercek bir kimlik ara.
          const identity = takeIdentity(byNationality, cursor, club.country_name ?? '', roll(0));
          const external = identity
            ? `fc-coach:${identity.sourceId}`
            : `gen-staff:${club.id}:${role}:${i}`;

          const nationality = identity?.nationality ?? club.country_name ?? '';
          const names = readNamePool(db, 'staff', nationality);
          const realName =
            identity?.nameReal ??
            (names.first.length > 0 && names.last.length > 0
              ? `${pick(names.first, roll(1))} ${pick(names.last, roll(2))}`
              : `Coach ${club.id}${i}`);

          const bound = binder.resolve('staff', external, realName, (salt) =>
            maskStaffName(realName, salt),
          );

          const parts = splitName(bound.name);
          const birthYear =
            identity?.birthYear ??
            CURRENT_YEAR - (spec.minAge + Math.floor(roll(3) * (spec.maxAge - spec.minAge)));

          const reputation = span(roll(4), bands.get('reputation'));
          const experience = span(roll(5), bands.get('experience'));

          insStaff.run(
            bound.stableId + STAFF_ID_OFFSET,
            external,
            realName,
            bound.name,
            parts.first,
            parts.last,
            role,
            birthYear,
            nationality,
            club.country_id,
            club.id,
            reputation,
            experience,
            originFor(nationality),
          );

          insAssign.run(bound.stableId + STAFF_ID_OFFSET, club.id, role, SOURCE_YEAR);

          if (spec.attributed) {
            const attributes: StaffAttributes = {
              tactical: span(roll(6), bands.get('tactical')),
              training: span(roll(7), bands.get('training')),
              development: span(roll(8), bands.get('development')),
              motivation: span(roll(9), bands.get('motivation')),
              manManagement: span(roll(10), bands.get('man_management')),
              discipline: span(roll(11), bands.get('discipline')),
            };
            insAttr.run(
              bound.stableId + STAFF_ID_OFFSET,
              attributes.tactical,
              attributes.training,
              attributes.development,
              attributes.motivation,
              attributes.manManagement,
              attributes.discipline,
              weighted(formations, roll(12), '4-4-2'),
              styleFor(styles, attributes.tactical, roll(13)),
              // TURETILMIS -- elle yazilmaz.
              staffOverall(attributes),
            );
            withAttributes += 1;
          }

          created += 1;
          if (identity) fromSource += 1;
          else generated += 1;
        }
      }
    }

    // GUNCEL HOCA ONBELLEGI -- atamalardan yeniden yazilir.
    // Onbellek ile kaynak arasindaki tek senkron noktasi burasi.
    db.exec(
      `UPDATE club SET current_manager_id = (
         SELECT a.staff_id FROM staff_assignment a
         WHERE a.club_id = club.id AND a.role = 'manager' AND a.is_current = 1
       )`,
    );

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  log.info(
    'staff',
    `${created} teknik heyet uyesi (${fromSource} gercek kimlik, ${generated} havuzdan) -- ` +
      `${withAttributes} nitelikli`,
  );

  return { created, fromSource, generated, withAttributes };
}

const CURRENT_YEAR = new Date().getFullYear();
/** Atamalarin baslangic yili. world.db baslangic durumunu tasir. */
const SOURCE_YEAR = CURRENT_YEAR;

/**
 * Kovadan bir kimlik alir ve TUKETIR.
 *
 * Once istenen uyruk; o kova bittiyse en dolu yabanci kova. Hicbiri yoksa
 * `undefined` doner ve cagiran havuzdan isim uretir.
 */
function takeIdentity(
  buckets: Map<string, CoachIdentity[]>,
  cursor: Map<string, number>,
  nationality: string,
  roll: number,
): CoachIdentity | undefined {
  const order = [nationality, ...[...buckets.keys()].filter((k) => k !== nationality)];
  for (const key of order) {
    const bucket = buckets.get(key);
    if (!bucket || bucket.length === 0) continue;
    const at = cursor.get(key) ?? 0;
    if (at >= bucket.length) continue;
    // Tohumlu kayma: ayni uyruktan hocalar her zaman ayni sirayla
    // dagilmasin diye kovaya rastgele bir noktadan girilir.
    const index = at === 0 ? Math.floor(roll * bucket.length) % bucket.length : at;
    cursor.set(key, Math.max(at, index) + 1);
    return bucket[index];
  }
  return undefined;
}

/** Ad korunur, soyad kaydirilir -- oyuncu maskelemesiyle ayni ilke. */
function maskStaffName(realName: string, salt: number): { name: string; strategy: 'phonetic' } {
  const { first, last } = splitName(realName);
  const shifted = phoneticShift(last);
  return {
    name: `${first} ${salt === 0 ? shifted : `${shifted}${salt}`}`.trim(),
    strategy: 'phonetic',
  };
}

function splitName(full: string): { first: string; last: string } {
  const tokens = full.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return { first: '', last: '' };
  if (tokens.length === 1) return { first: '', last: tokens[0]! };
  return { first: tokens.slice(0, -1).join(' '), last: tokens[tokens.length - 1]! };
}

/** Uyruk -> isim havuzu kokeni. `NameForge` ile ayni etiketler. */
function originFor(nationality: string): string {
  const map: Readonly<Record<string, string>> = {
    Türkiye: 'tr', Turkey: 'tr',
    Brazil: 'br', Portugal: 'br',
    Spain: 'es', Argentina: 'es',
    France: 'fr', Belgium: 'fr',
    Serbia: 'rs', Croatia: 'rs',
  };
  return map[nationality] ?? 'tr';
}

/**
 * Oyun felsefesi -- taktik degeriyle ILISKILI, tamamen rastgele degil.
 *
 * Taktik degeri yuksek hoca daha sik topa sahip olma ve pres oynar; dusuk
 * olan savunma ve uzun topa kacar. Dagilim yine de havuzdan gelir, yani
 * iyi bir hocanin savunmaci olmasi mumkundur -- sadece daha nadir.
 */
function styleFor(
  distribution: ReadonlyMap<string, number>,
  tactical: number,
  roll: number,
): string {
  const weights: Record<string, number> = {};
  const bias = (tactical - 50) / 100; // -0.5 .. +0.5
  for (const [style, base] of distribution) {
    const lift =
      style === 'possession' || style === 'pressing'
        ? 1 + bias
        : style === 'defensive' || style === 'direct'
          ? 1 - bias
          : 1;
    weights[style] = Math.max(0.01, base * lift);
  }
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  let acc = 0;
  for (const [style, w] of Object.entries(weights)) {
    acc += w / total;
    if (roll <= acc) return style;
  }
  return 'balanced';
}

function pick<T>(items: readonly T[], roll: number): T {
  return items[Math.min(items.length - 1, Math.floor(roll * items.length))]!;
}

/** Banttan cekilis. Bant tanimli degilse notr 40-70 araligina duser. */
function span(roll: number, range: Range | undefined): number {
  const [min, max] = range ?? [40, 70];
  return Math.round(min + roll * (max - min));
}

/** Agirlikli secim. Toplam 1.0 olmak zorunda degil -- normalize edilir. */
function weighted(table: ReadonlyMap<string, number>, roll: number, fallback: string): string {
  const total = [...table.values()].reduce((s, w) => s + w, 0);
  if (total <= 0) return fallback;
  let acc = 0;
  for (const [key, w] of table) {
    acc += w / total;
    if (roll <= acc) return key;
  }
  return fallback;
}

/** (tohum, anahtar) ikilisinden tekrar edilebilir cekilis dizisi. */
function pseudo(seed: number, key: string): (index: number) => number {
  return (index) => (hashString(`${key}#${index}`, seed) % 100000) / 100000;
}

// ---------------------------------------------------------------------------
// ISSIZ TEKNIK DIREKTOR HAVUZU
// ---------------------------------------------------------------------------

/**
 * BOSTA HOCALAR -- kovulma bir SONUC uretebilsin diye.
 *
 * OLCULEN SORUN (12 kariyer, 17 kovulma):
 *   Kovulma calisiyordu ama yerine gelen hoca 17/17 kez PROSEDUREL bir
 *   isimdi -- hicbir personel satirina baglanmiyordu, dolayisiyla niteligi
 *   de yoktu. Sebep basit: `staff` tablosundaki 1.512 kisinin TAMAMI bir
 *   kulube atanmisti (club_id IS NULL sayisi: 0). Oyunun secebilecegi
 *   bosta tek bir hoca yoktu, o yuzden isim havuzdan uyduruluyordu --
 *   ustelik Ingiliz kulubune Turk isimli hoca olarak (`origin: 'tr'`
 *   varsayilani).
 *
 * BU ASAMA ne yapar: her ulkeye, kulup sayisiyla orantili sayida ATANMAMIS
 * teknik direktor uretir. Bunlarin `club_id` alani NULL'dur ve
 * `staff_assignment` satirlari YOKTUR -- tablonun "guncel gorev" anlami
 * boylece ilk kez gercek bir ayrim tasir: atanmis olan ile bosta olan.
 *
 * SEVIYE DAGILIMI bilerek carpik: bosta bekleyen hocalarin cogu orta ve alt
 * seviyedir, ama arada bir "hala is arayan buyuk isim" cikar. Gercek
 * futbolun transfer donemi de boyle gorunur.
 *
 * EKLEMELIDIR: var olan hicbir satira dokunmaz, yeniden calistirilabilir.
 */
export function generateFreeManagers(input: {
  readonly db: DatabaseSyncType;
  readonly binder: MaskBinder;
  readonly log: IssueLog;
  readonly seed: number;
}): { readonly created: number } {
  const { db, binder, log, seed } = input;

  const styles = readDistribution(db, 'staff', 'style');
  const formations = readDistribution(db, 'staff', 'formation');

  const countries = db
    .prepare(
      `SELECT c.country_id AS id, n.name_real AS name, count(*) AS clubs
       FROM club c JOIN country n ON n.id = c.country_id
       WHERE c.country_id IS NOT NULL
       GROUP BY c.country_id ORDER BY c.country_id`,
    )
    .all() as unknown as { id: number; name: string; clubs: number }[];

  if (countries.length === 0) {
    log.warn('staff', 'kulubu olan ulke yok -- bosta hoca uretilmedi');
    return { created: 0 };
  }

  const bandCache = new Map<string, BandTable>();
  const bandsFor = (tier: string): BandTable => {
    const hit = bandCache.get(tier);
    if (hit) return hit;
    const loaded = readBands(db, 'staff', tier);
    const table = loaded.size > 0 ? loaded : readBands(db, 'staff', 'mid');
    bandCache.set(tier, table);
    return table;
  };

  const insStaff = db.prepare(
    `INSERT INTO staff(
       id, external_key, name_real, name_masked, first_masked, last_masked,
       role, birth_year, nationality, country_id, club_id, reputation,
       experience, origin)
     VALUES (?,?,?,?,?,?, 'manager', ?,?,?, NULL, ?,?,?)
     ON CONFLICT(external_key) DO NOTHING`,
  );
  const insAttr = db.prepare(
    `INSERT INTO staff_attributes(
       staff_id, tactical, training, development, motivation, man_management,
       discipline, preferred_formation, preferred_style, overall)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(staff_id) DO NOTHING`,
  );

  // KULLANILMIS MASKELI ADLAR.
  //
  // `ref_name_pool` ulke basina 10 ad x 10 soyad tasiyor -- yuz kombinasyon.
  // 1.512 personel bu havuzu coktan doyurmus durumda (atanmis kadronun
  // %29'unun adinda zaten cakisma eki var). Onune bakmadan cekersek bosta
  // hocalarin neredeyse tamami 'Marlowo4' gibi cikar. O yuzden once BOSTA
  // kombinasyon araniyor; havuz gercekten bittiyse eke dusuluyor.
  const usedMasks = new Set(
    (db.prepare('SELECT name_masked FROM staff').all() as unknown as { name_masked: string }[]).map(
      (r) => r.name_masked,
    ),
  );

  let created = 0;
  db.exec('BEGIN');
  try {
    for (const country of countries) {
      // Kulup sayisiyla orantili, ama her ulkede en az uc isim: tek hoca
      // olsa ikinci kovulmada havuz yine biterdi.
      const want = Math.max(3, Math.ceil(country.clubs / 6));

      for (let i = 0; i < want; i += 1) {
        const key = `free-staff:${country.id}:${i}`;
        const roll = pseudo(seed, key);
        const external = `free-coach:${country.id}:${i}`;

        const names = readNamePool(db, 'staff', country.name);
        const realName = freeName(names, roll, usedMasks, `Coach Free ${country.id}${i}`);

        const bound = binder.resolve('staff', external, realName, (salt) =>
          maskStaffName(realName, salt),
        );
        usedMasks.add(bound.name);
        const parts = splitName(bound.name);
        const tier = freeTier(roll(0));
        const bands = bandsFor(tier);

        const written = insStaff.run(
          bound.stableId + STAFF_ID_OFFSET,
          external,
          realName,
          bound.name,
          parts.first,
          parts.last,
          CURRENT_YEAR - (40 + Math.floor(roll(3) * 22)),
          country.name,
          country.id,
          span(roll(4), bands.get('reputation')),
          span(roll(5), bands.get('experience')),
          originFor(country.name),
        );

        const attributes: StaffAttributes = {
          tactical: span(roll(6), bands.get('tactical')),
          training: span(roll(7), bands.get('training')),
          development: span(roll(8), bands.get('development')),
          motivation: span(roll(9), bands.get('motivation')),
          manManagement: span(roll(10), bands.get('man_management')),
          discipline: span(roll(11), bands.get('discipline')),
        };
        insAttr.run(
          bound.stableId + STAFF_ID_OFFSET,
          attributes.tactical,
          attributes.training,
          attributes.development,
          attributes.motivation,
          attributes.manManagement,
          attributes.discipline,
          weighted(formations, roll(12), '4-4-2'),
          styleFor(styles, attributes.tactical, roll(13)),
          staffOverall(attributes),
        );
        // Yalnizca GERCEKTEN yazilan satir sayilir -- betik tekrar
        // calistirilabilir ve ikinci kez '43 yazildi' demesi yanlis olurdu.
        created += written.changes > 0 ? 1 : 0;
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  log.info('staff', `${created} bosta teknik direktor (${countries.length} ulke)`);
  return { created };
}

/**
 * Bosta bekleyen hocanin seviyesi.
 *
 * Carpik bilerek: %8 elit, %17 ust, %40 orta, %35 alt. Isini kaybetmis bir
 * hocanin cogunlukla orta siklet olmasi gercekcidir; ama arada bir bosta
 * bir buyuk isim bulunmasi kovulmayi ilginc kilar.
 */
function freeTier(roll: number): string {
  if (roll < 0.08) return 'elite';
  if (roll < 0.25) return 'contender';
  if (roll < 0.65) return 'mid';
  return 'lower';
}

/**
 * Bosta bir kombinasyon arar.
 *
 * On iki deneme: havuz 10x10 oldugu icin bos bir eslesme varsa bu kadar
 * cekiliste yuksek olasilikla bulunur; yoksa ilk cekilis dondurulur ve
 * `MaskBinder` cakisma ekini kendisi koyar.
 */
function freeName(
  names: { readonly first: readonly string[]; readonly last: readonly string[] },
  roll: (index: number) => number,
  used: ReadonlySet<string>,
  fallback: string,
): string {
  if (names.first.length === 0 || names.last.length === 0) return fallback;
  let firstTry = '';
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = `${pick(names.first, roll(20 + attempt * 2))} ${pick(names.last, roll(21 + attempt * 2))}`;
    if (firstTry === '') firstTry = candidate;
    if (!used.has(maskStaffName(candidate, 0).name)) return candidate;
  }
  return firstTry;
}
