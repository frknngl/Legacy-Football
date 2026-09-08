/**
 * OYUNCU ASAMASI -- profiller + piyasa degeri -> maskeli, nitelikli kadro.
 *
 * KAPSAM DARALTMA:
 *   Kaynakta 92.671 oyuncu var; bunlarin 7.276'si ithal ettigimiz 303 kulubun
 *   kadrosunda. Gerisi ithal EDILMEZ -- oynanmayacak bir ligin oyuncusu
 *   world.db'yi sisirir ve maske havuzunu bosuna tuketir.
 *
 * ISIM MASKELEME:
 *   Ad KORUNUR, soyad KAYDIRILIR: "Leroy Sane" -> "Leroy Sano",
 *   "Bruno Fernandes" -> "Bruno Fernandos". Ikisini birden degistirmek kisiyi
 *   taninmaz yapardi ve oyunun "gercek dunyaya benziyor" hissini oldururdu;
 *   hicbirini degistirmemek zaten lisans sorunudur.
 *
 * KILIT:
 *   Maskeli tam ad `mask_binding`e yazilir ve DONAR. Guncel bir CSV
 *   yuklendiginde yas, deger, kulup ve nitelikler guncellenir; ad ve
 *   stable_id AYNEN kalir.
 */

import { readCsv, readCsvAll, num, opt } from '../csv.js';
import type { IssueLog } from '../db.js';
import type { DatabaseSyncType } from '../sqlite.js';
import { MaskBinder, phoneticShift } from '../masking.js';
import {
  deriveAttributes,
  fallbackValue,
  potentialFor,
  targetOverall,
  toPosition,
} from './attributes.js';

const PROFILE_COLUMNS = [
  'player_id',
  'player_name',
  'date_of_birth',
  'citizenship',
  'position',
  'main_position',
  'foot',
  'height',
  'current_club_id',
  'contract_expires',
] as const;

const VALUE_COLUMNS = ['player_id', 'value'] as const;

/** Kaynakta kulupsuzlugu isaretleyen sahte kulup adlari. */
const SENTINEL_CLUB_NAMES = new Set(['Retired', 'Without Club', 'Unknown']);

/**
 * Soyad ONCESINDE gelen ve soyadin PARCASI olan ekler.
 * "Virgil van Dijk" -> soyad "van Dijk", "Bruno Fernandes" -> "Fernandes".
 */
const SURNAME_PARTICLES = new Set([
  'van', 'von', 'de', 'del', 'della', 'da', 'dos', 'das', 'di', 'du',
  'la', 'le', 'el', 'al', 'bin', 'ibn', "d'", 'ter', 'ten', 'op', 'aan',
  'mc', 'mac', 'san', 'santa', 'st',
]);

export interface NameParts {
  readonly first: string;
  readonly last: string;
}

/** Kaynak adindaki ID ekini atar: "Miroslav Klose (10)" -> "Miroslav Klose". */
export function cleanPlayerName(raw: string): string {
  return raw.replace(/\s*\(\d+\)\s*$/, '').trim();
}

/**
 * Adi ad/soyad olarak ayirir.
 *
 * Tek kelimelik adlar (Brezilya'da yaygin: "Rodrygo", "Casemiro") soyad
 * sayilir ve ad bos kalir -- maskeleme yine soyada uygulanir.
 */
export function splitPlayerName(fullName: string): NameParts {
  const tokens = cleanPlayerName(fullName).split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return { first: '', last: '' };
  if (tokens.length === 1) return { first: '', last: tokens[0]! };

  // Sondan geriye giderek ek topla: "van Dijk", "de la Fuente".
  let start = tokens.length - 1;
  while (start > 1 && SURNAME_PARTICLES.has(tokens[start - 1]!.toLowerCase())) start -= 1;

  return { first: tokens.slice(0, start).join(' '), last: tokens.slice(start).join(' ') };
}

interface ClubRow {
  readonly id: number;
  readonly reputation: number;
}

export interface PlayerStageInput {
  readonly profilesFile: string;
  readonly valuesFile: string;
  readonly db: DatabaseSyncType;
  readonly binder: MaskBinder;
  readonly log: IssueLog;
}

export interface PlayerStageResult {
  readonly imported: number;
  readonly fallbackValues: number;
  readonly freshMasks: number;
  readonly reusedMasks: number;
}

export async function importPlayers(input: PlayerStageInput): Promise<PlayerStageResult> {
  const { db, binder, log } = input;

  // Kulup haritasi: kaynak ID -> world.db ID + itibar.
  const clubs = new Map<string, ClubRow>();
  for (const row of db
    .prepare('SELECT external_key, id, reputation FROM club')
    .all() as { external_key: string; id: number; reputation: number }[]) {
    clubs.set(row.external_key, { id: row.id, reputation: row.reputation });
  }
  if (clubs.size === 0) {
    log.error('players', 'world.db icinde kulup yok -- once turnuva asamasi calismali');
    return { imported: 0, fallbackValues: 0, freshMasks: 0, reusedMasks: 0 };
  }

  // Piyasa degerleri: 69k satir, tamami bellege alinir (1,6 MB).
  const values = new Map<string, number>();
  for (const r of await readCsvAll(input.valuesFile, { requireColumns: [...VALUE_COLUMNS] })) {
    const id = opt(r['player_id']);
    const v = num(r['value']);
    if (id !== undefined && v !== undefined && v > 0) values.set(id, v);
  }
  log.info('players', `${values.size} piyasa degeri okundu`);

  const insPlayer = db.prepare(
    `INSERT INTO player(
       id, external_key, first_real, last_real, first_masked, last_masked,
       birth_year, nationality, second_nationality, position, sub_position,
       foot, height_cm, club_id, market_value, contract_expires, value_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       birth_year = excluded.birth_year,
       club_id = excluded.club_id,
       market_value = excluded.market_value,
       contract_expires = excluded.contract_expires,
       position = excluded.position,
       sub_position = excluded.sub_position,
       value_source = excluded.value_source`,
  );
  const insAttributes = db.prepare(
    `INSERT INTO player_attributes(
       player_id, pace, shooting, passing, defending, physical, goalkeeping, overall, potential)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(player_id) DO UPDATE SET
       pace = excluded.pace, shooting = excluded.shooting, passing = excluded.passing,
       defending = excluded.defending, physical = excluded.physical,
       goalkeeping = excluded.goalkeeping, overall = excluded.overall,
       potential = excluded.potential`,
  );

  const currentYear = new Date().getFullYear();
  let imported = 0;
  let fallbacks = 0;
  let fresh = 0;
  let reused = 0;
  let noPosition = 0;

  db.exec('BEGIN');
  try {
    for await (const r of readCsv(input.profilesFile, { requireColumns: [...PROFILE_COLUMNS] })) {
      const externalKey = opt(r['player_id']);
      const clubKey = opt(r['current_club_id']);
      if (externalKey === undefined || clubKey === undefined) continue;

      const club = clubs.get(clubKey);
      if (!club) continue; // kapsam disi kulup -- ithal edilmez
      if (SENTINEL_CLUB_NAMES.has(opt(r['current_club_name']) ?? '')) continue;

      const position = toPosition(r['main_position'] ?? '');
      if (position === undefined) {
        noPosition += 1;
        continue;
      }

      const name = splitPlayerName(r['player_name'] ?? '');
      const birthYear = parseBirthYear(r['date_of_birth']);
      const age = birthYear === undefined ? undefined : currentYear - birthYear;

      const market = values.get(externalKey);
      const value = market ?? fallbackValue(club.reputation);
      if (market === undefined) fallbacks += 1;

      // --- maskeleme: ad korunur, soyad kaydirilir; sonuc KILITLENIR
      const bound = binder.resolve('player', externalKey, `${name.first} ${name.last}`.trim(), (salt) => {
        const shifted = phoneticShift(name.last);
        const suffixed = salt === 0 ? shifted : `${shifted}${'aeiou'[salt % 5]}`;
        return {
          name: `${name.first} ${suffixed}`.trim(),
          strategy: 'phonetic',
        };
      });
      bound.fresh ? (fresh += 1) : (reused += 1);
      const masked = splitPlayerName(bound.name);

      const subPosition = opt(r['position']) ?? '';
      const heightCm = parseHeight(r['height']);
      const target = targetOverall(value, age);
      const { attributes, overall } = deriveAttributes(position, subPosition, target, heightCm);
      const nationalities = parseCitizenship(r['citizenship']);

      insPlayer.run(
        bound.stableId,
        externalKey,
        name.first,
        name.last,
        masked.first,
        masked.last,
        birthYear ?? null,
        nationalities[0] ?? '',
        nationalities[1] ?? null,
        position,
        subPosition,
        normaliseFoot(r['foot']),
        heightCm ?? null,
        club.id,
        Math.round(value),
        opt(r['contract_expires']) ?? null,
        market === undefined ? 'fallback' : 'market',
      );

      insAttributes.run(
        bound.stableId,
        attributes.pace,
        attributes.shooting,
        attributes.passing,
        attributes.defending,
        attributes.physical,
        attributes.goalkeeping,
        overall,
        potentialFor(overall, age),
      );

      imported += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  if (noPosition > 0) log.warn('players', `${noPosition} oyuncu mevkisiz -- atlandi`);
  if (fallbacks > 0) {
    log.warn(
      'players',
      `${fallbacks} oyuncunun piyasa degeri yok; kulup itibarindan tahmin edildi (value_source='fallback')`,
    );
  }
  log.info('players', `${imported} oyuncu ithal edildi`);

  flagThinSquads(db, log);
  return { imported, fallbackValues: fallbacks, freshMasks: fresh, reusedMasks: reused };
}

/** "1988-08-04" -> 1988. TAM TARIH tutulmaz: maskeli ad + gercek dogum gunu maskeyi bozar. */
function parseBirthYear(raw: string | undefined): number | undefined {
  const v = opt(raw);
  if (v === undefined) return undefined;
  const year = Number(v.slice(0, 4));
  return Number.isFinite(year) && year > 1930 && year < 2030 ? year : undefined;
}

/** Kaynak boyu "184.0" olarak veriyor; eksik degerler 0.0. */
function parseHeight(raw: string | undefined): number | undefined {
  const v = num(raw);
  return v !== undefined && v >= 140 && v <= 220 ? Math.round(v) : undefined;
}

function normaliseFoot(raw: string | undefined): string {
  const v = (opt(raw) ?? '').toLowerCase();
  return v === 'right' || v === 'left' || v === 'both' ? v : '';
}

/**
 * "France  Nigeria" -> ['France', 'Nigeria'].
 *
 * Cifte vatandaslik kaynakta CIFT BOSLUKLA ayriliyor. Milli takim uygunlugu
 * (Faz B) bu ikinci degeri okuyacak: hangi milli takimlar bu oyuncuyu
 * cagirabilir.
 */
export function parseCitizenship(raw: string | undefined): string[] {
  const v = opt(raw);
  if (v === undefined) return [];
  return v
    .split(/\s{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Kadrosu ince kulupleri isaretler.
 *
 * 11v11 simulasyonu icin en az 16 kisi gerekiyor (11 + yedek). Kaynak
 * anliginda bazi kuluplerin kadrosu eksik geliyor; sessizce birakmak
 * `TeamModel`in ilk 11'i kuramamasi demek.
 */
function flagThinSquads(db: DatabaseSyncType, log: IssueLog): void {
  const rows = db
    .prepare(
      `SELECT c.name_real, c.external_key, COUNT(p.id) AS n
       FROM club c LEFT JOIN player p ON p.club_id = c.id
       GROUP BY c.id HAVING n < 16 ORDER BY n`,
    )
    .all() as { name_real: string; external_key: string; n: number }[];

  for (const row of rows) {
    log.error(
      'players',
      `${row.name_real}: kadroda ${row.n} oyuncu -- 11v11 icin en az 16 gerekli`,
      'club',
      row.external_key,
    );
  }
}
