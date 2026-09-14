/**
 * FC26 ITHALAT ASAMASI -- dunyanin yeni besleme hatti.
 *
 * NEDEN YENI KAYNAK:
 *   Transfermarkt hatti calisiyordu ama tek bir guc sinyali tasiyordu:
 *   PIYASA DEGERI. Nitelikler ondan TAHMIN ediliyordu (`attributes.ts`:
 *   log olcek + yas duzeltmesi + mevki profili). Tahmin iyiydi ama
 *   tahmindi.
 *
 *   FC26 anligi ayni oyuncular icin GERCEK nitelikleri tasiyor. Ustelik
 *   motorun bugun UYDURDUGU uc degeri daha veriyor:
 *     aggression  <- mentality_aggression   (eskiden mevkiden tahmin)
 *     composure   <- mentality_composure    (eskiden `quality` vekildi)
 *     shirt_number<- club_jersey_number     (eskiden tohumdan cekiliyordu)
 *   ve `leadership` turetmesine `international_reputation` girdisini katar.
 *
 * NE DEGISMEDI:
 *   `quality` yine `overallFor(position, attributes)` ile TURETILIR.
 *   FC26'nin kendi `overall` degeri saklanir ama motorun sozlesmesini
 *   EZMEZ -- yoksa "kaliteli ama sut atamayan santrfor" sorunu geri
 *   gelirdi ve simulator her macta gosterirdi.
 *
 * KAPSAM:
 *   `ref_league` TABLOSUNDAKI ligler + `scope` filtresi. Tabloda olmayan
 *   lig ITHAL EDILMEZ: FC26 ulke tasimadigi icin uydurmak yerine disarida
 *   birakmak dogru.
 *
 *   Lig-ulke eslemesi bir JSON dosyasinda DEGIL veritabaninda durur --
 *   bir ligin hangi ulkede oldugu gercek veridir ve gercek veri DB'de
 *   yasar. Yeni lig eklemek = `ref_league` tablosuna satir eklemek.
 */

import { readCsv, num, opt } from '../csv.js';
import type { IssueLog } from '../db.js';
import type { DatabaseSyncType } from '../sqlite.js';
import {
  MaskBinder,
  phoneticShift,
  poolClubMask,
  poolCompetitionMask,
  splitClubName,
} from '../masking.js';
import type { ImportScope } from '../scope.js';
import { splitPlayerName } from './players.js';
import { readLeagues, type LeagueRef } from './reference.js';
import type { Position } from '../../../src/domain/actors.js';

/**
 * Zorunlu kolonlar.
 *
 * FC26 110 kolon tasiyor; burada yalnizca OKUDUKLARIMIZ listeleniyor.
 * Kaynak yeni kolon eklerse bu liste bozulmaz (fazlalik serbest), ama
 * okudugumuz bir kolon kaybolursa import BASLAMADAN durur.
 */
const FC26_COLUMNS = [
  'player_id',
  'short_name',
  'long_name',
  'player_positions',
  'overall',
  'potential',
  'value_eur',
  'dob',
  'height_cm',
  'league_id',
  'league_name',
  'league_level',
  'club_team_id',
  'club_name',
  'club_jersey_number',
  'club_contract_valid_until_year',
  'nationality_name',
  'preferred_foot',
  'international_reputation',
  'pace',
  'shooting',
  'passing',
  'dribbling',
  'defending',
  'physic',
  'mentality_aggression',
  'mentality_composure',
  'goalkeeping_diving',
  'goalkeeping_handling',
  'goalkeeping_positioning',
  'goalkeeping_reflexes',
] as const;

/**
 * FC26 mevki kodu -> motorun dort mevkisi.
 *
 * `player_positions` virgullu bir liste ("ST, LW"); ILKI ana mevkidir.
 */
export function toPosition(positions: string): Position | undefined {
  const first = positions.split(',')[0]?.trim().toUpperCase();
  if (first === undefined || first === '') return undefined;
  if (first === 'GK') return 'GK';
  if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(first)) return 'DF';
  if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(first)) return 'MF';
  if (['ST', 'CF', 'LW', 'RW', 'LF', 'RF'].includes(first)) return 'FW';
  return undefined;
}

/**
 * KALECI TUZAGI.
 *
 * FC26'da kaleciler icin `pace / shooting / passing / dribbling / defending /
 * physic` kolonlari BOSTUR -- kalecinin alti degeri tamamen ayri kolonlarda
 * (`goalkeeping_*`) durur. Bu ayrimi kacirmak butun kalecileri sifir nitelikli
 * yapardi ve her macta 6-0 yenilirlerdi.
 *
 * Kaleci icin saha nitelikleri GK sextetinden makul degerlere cevrilir;
 * `goalkeeping` ise dort GK kolonunun agirlikli ortalamasidir.
 */
interface RawAttributes {
  pace: number;
  shooting: number;
  passing: number;
  defending: number;
  physical: number;
  goalkeeping: number;
}

export function readAttributes(
  row: Record<string, string>,
  position: Position,
  overall: number,
): RawAttributes {
  const gkDiving = num(row['goalkeeping_diving']) ?? 0;
  const gkHandling = num(row['goalkeeping_handling']) ?? 0;
  const gkPositioning = num(row['goalkeeping_positioning']) ?? 0;
  const gkReflexes = num(row['goalkeeping_reflexes']) ?? 0;

  if (position === 'GK') {
    // Refleks ve elleme kurtarisin kalbi; duruş ve dalis onu tamamliyor.
    const goalkeeping = Math.round(
      gkReflexes * 0.35 + gkDiving * 0.3 + gkHandling * 0.2 + gkPositioning * 0.15,
    );
    return {
      // Kalecinin saha nitelikleri simulasyonda yalnizca kenar durumlarda
      // okunur; overall'a orantili makul degerler yeterli ve gercekci.
      pace: Math.round(overall * 0.5),
      shooting: Math.round(overall * 0.2),
      passing: Math.round(overall * 0.65),
      defending: Math.round(overall * 0.35),
      physical: Math.round(overall * 0.85),
      goalkeeping: goalkeeping > 0 ? goalkeeping : overall,
    };
  }

  return {
    pace: num(row['pace']) ?? Math.round(overall * 0.85),
    shooting: num(row['shooting']) ?? Math.round(overall * 0.7),
    passing: num(row['passing']) ?? Math.round(overall * 0.8),
    defending: num(row['defending']) ?? Math.round(overall * 0.6),
    // Kaynak adi `physic`, motorunki `physical`.
    physical: num(row['physic']) ?? Math.round(overall * 0.8),
    // Saha oyuncusunun kalecilik degeri kaynakta 5-15 bandinda; motor da
    // boyle bekliyor (POSITION_WEIGHTS'te GK disi agirlik 0).
    goalkeeping: Math.max(1, Math.round((gkDiving + gkHandling + gkReflexes) / 3)),
  };
}

export interface Fc26StageInput {
  readonly file: string;
  readonly db: DatabaseSyncType;
  readonly binder: MaskBinder;
  readonly log: IssueLog;
  readonly scope: ImportScope;
}

export interface Fc26StageResult {
  readonly countries: number;
  readonly competitions: number;
  readonly clubs: number;
  readonly players: number;
  readonly skippedLeagues: number;
  readonly skippedPlayers: number;
}

interface ClubDraft {
  readonly externalKey: string;
  readonly nameReal: string;
  readonly leagueId: string;
  squadValue: number;
  count: number;
}

interface PlayerDraft {
  readonly externalKey: string;
  readonly nameReal: string;
  readonly clubKey: string | undefined;
  readonly birthYear: number | undefined;
  readonly nationality: string;
  readonly position: Position;
  readonly subPosition: string;
  readonly foot: string;
  readonly heightCm: number | undefined;
  readonly marketValue: number;
  readonly contractExpires: string | undefined;
  readonly attributes: RawAttributes;
  readonly overall: number;
  readonly potential: number;
  readonly aggression: number | undefined;
  readonly composure: number | undefined;
  readonly intlReputation: number | undefined;
  readonly shirtNumber: number | undefined;
}

export async function importFc26(input: Fc26StageInput): Promise<Fc26StageResult> {
  const { db, binder, log, scope } = input;
  // LIG-ULKE ESLEMESI VERITABANINDAN OKUNUR.
  const leagueRefs = readLeagues(db, 'fc26');

  const wantedCountries = new Set(scope.countries);
  const wantedLevels = new Set(scope.levels);

  // Kapsam icindeki ligler -- harita + ulke filtresi + seviye filtresi.
  const activeLeagues = new Map<string, LeagueRef>();
  for (const [id, entry] of leagueRefs) {
    if (!wantedCountries.has(entry.countryName)) continue;
    if (!wantedLevels.has(entry.level)) continue;
    activeLeagues.set(id, entry);
  }

  if (activeLeagues.size === 0) {
    log.error(
      'fc26',
      `kapsamda lig kalmadi -- ulkeler: ${scope.countries.join(', ')}, seviyeler: ${scope.levels.join(', ')}`,
    );
    return { countries: 0, competitions: 0, clubs: 0, players: 0, skippedLeagues: 0, skippedPlayers: 0 };
  }

  const clubs = new Map<string, ClubDraft>();
  const players: PlayerDraft[] = [];
  const unmappedLeagues = new Set<string>();
  let skippedPlayers = 0;

  for await (const row of readCsv(input.file, { requireColumns: [...FC26_COLUMNS] })) {
    const leagueId = opt(row['league_id']);
    if (leagueId === undefined) {
      // Kulupsuz/serbest oyuncu -- ligi yok. Ithal edilmez.
      skippedPlayers += 1;
      continue;
    }
    if (!activeLeagues.has(leagueId)) {
      if (!leagueRefs.has(leagueId)) unmappedLeagues.add(leagueId);
      continue;
    }

    const position = toPosition(row['player_positions'] ?? '');
    if (position === undefined) {
      skippedPlayers += 1;
      continue;
    }

    const playerId = opt(row['player_id']);
    if (playerId === undefined) {
      skippedPlayers += 1;
      continue;
    }

    const clubId = opt(row['club_team_id'])?.replace(/\.0$/, '');
    let clubKey: string | undefined;
    if (clubId !== undefined) {
      clubKey = `fc:${clubId}`;
      const existing = clubs.get(clubKey);
      const value = num(row['value_eur']) ?? 0;
      if (existing) {
        existing.squadValue += value;
        existing.count += 1;
      } else {
        clubs.set(clubKey, {
          externalKey: clubKey,
          nameReal: opt(row['club_name']) ?? 'Unknown',
          leagueId,
          squadValue: value,
          count: 1,
        });
      }
    }

    const overall = num(row['overall']) ?? 60;
    const contractYear = num(row['club_contract_valid_until_year']);

    players.push({
      externalKey: `fc:${playerId}`,
      nameReal: opt(row['long_name']) ?? opt(row['short_name']) ?? '',
      clubKey,
      birthYear: birthYearOf(row['dob']),
      nationality: opt(row['nationality_name']) ?? '',
      position,
      subPosition: (row['player_positions'] ?? '').split(',')[0]?.trim() ?? '',
      foot: (opt(row['preferred_foot']) ?? '').toLowerCase(),
      heightCm: num(row['height_cm']),
      marketValue: Math.round(num(row['value_eur']) ?? 0),
      // Motor "2027-06-30" bicimli metin bekliyor; kaynakta yalnizca YIL var.
      contractExpires: contractYear === undefined ? undefined : `${contractYear}-06-30`,
      attributes: readAttributes(row, position, overall),
      overall,
      potential: num(row['potential']) ?? overall,
      aggression: num(row['mentality_aggression']),
      composure: num(row['mentality_composure']),
      intlReputation: num(row['international_reputation']),
      shirtNumber: num(row['club_jersey_number']),
    });
  }

  if (unmappedLeagues.size > 0) {
    log.warn(
      'fc26',
      `${unmappedLeagues.size} lig haritada yok, ithal edilmedi: ${[...unmappedLeagues].slice(0, 12).join(', ')}` +
        ` -- eklemek icin ref_league tablosuna satir ekleyin`,
    );
  }

  return writeAll(db, binder, log, scope, activeLeagues, clubs, players, {
    skippedLeagues: unmappedLeagues.size,
    skippedPlayers,
  });
}

/** "2003-06-29" -> 2003. Tam tarih ITHAL EDILMEZ (maske politikasi). */
function birthYearOf(dob: string | undefined): number | undefined {
  const y = Number((dob ?? '').slice(0, 4));
  return Number.isFinite(y) && y > 1900 ? y : undefined;
}

/** Ulke -> turnuva -> kulup -> oyuncu sirasiyla yazar. Tek islem. */
function writeAll(
  db: DatabaseSyncType,
  binder: MaskBinder,
  log: IssueLog,
  scope: ImportScope,
  activeLeagues: ReadonlyMap<string, LeagueRef>,
  clubs: ReadonlyMap<string, ClubDraft>,
  players: readonly PlayerDraft[],
  skipped: { skippedLeagues: number; skippedPlayers: number },
): Fc26StageResult {
  const insCountry = db.prepare(
    `INSERT INTO country(id, name_real, name_masked, confederation) VALUES (?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET name_real = excluded.name_real`,
  );
  const insCompetition = db.prepare(
    `INSERT INTO competition(
       id, external_key, country_id, kind, level, name_real, name_masked,
       format_kind, legs, matches_per_club, club_count,
       window_start, window_end, slot_preference, promoted, relegated,
       reputation, source_league_id)
     VALUES (?, ?, ?, 'league', ?, ?, ?, 'round_robin', 2, ?, ?, ?, ?, ?, ?, ?, 50, ?)
     ON CONFLICT(id) DO UPDATE SET
       name_real = excluded.name_real,
       club_count = excluded.club_count,
       matches_per_club = excluded.matches_per_club,
       level = excluded.level`,
  );
  const insClub = db.prepare(
    `INSERT INTO club(
       id, external_key, name_real, name_masked, short_masked, country_id,
       competition_id, tier, reputation, squad_value, city, city_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'mid', 50, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name_real = excluded.name_real,
       competition_id = excluded.competition_id,
       squad_value = excluded.squad_value,
       city = excluded.city,
       city_id = excluded.city_id`,
  );
  const insCity = db.prepare(
    `INSERT INTO city(country_id, name_real, name_masked) VALUES (?, ?, ?)
     ON CONFLICT(country_id, name_real) DO NOTHING`,
  );
  const selCity = db.prepare('SELECT id FROM city WHERE country_id = ? AND name_real = ?');
  const insPlayer = db.prepare(
    `INSERT INTO player(
       id, external_key, first_real, last_real, first_masked, last_masked,
       birth_year, nationality, second_nationality, position, sub_position,
       foot, height_cm, club_id, market_value, contract_expires, value_source,
       aggression, composure, intl_reputation, shirt_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       birth_year = excluded.birth_year,
       club_id = excluded.club_id,
       market_value = excluded.market_value,
       contract_expires = excluded.contract_expires,
       position = excluded.position,
       aggression = excluded.aggression,
       composure = excluded.composure,
       intl_reputation = excluded.intl_reputation,
       shirt_number = excluded.shirt_number`,
  );
  const insAttributes = db.prepare(
    `INSERT INTO player_attributes(
       player_id, pace, shooting, passing, defending, physical, goalkeeping,
       overall, potential)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(player_id) DO UPDATE SET
       pace = excluded.pace, shooting = excluded.shooting,
       passing = excluded.passing, defending = excluded.defending,
       physical = excluded.physical, goalkeeping = excluded.goalkeeping,
       overall = excluded.overall, potential = excluded.potential`,
  );

  const countryIds = new Map<string, number>();
  const competitionIds = new Map<string, number>();
  const clubIds = new Map<string, number>();
  const cityIds = new Map<string, number>();
  let playerCount = 0;

  db.exec('BEGIN');
  try {
    // --- ulkeler (yalnizca kapsamdaki liglerin ulkeleri)
    // ULKE ADI MASKELENMEZ -- cografya tescilli degil.
    //
    // Eski surum burayi da maskeliyordu ve 'England' -> 'Ulke 738' gibi
    // anlamsiz adlar uretiyordu. Korunacak bir marka yoktu; uretilen tek
    // sonuc, milli takim adinin okunamaz olmasiydi.
    const countries = new Set([...activeLeagues.values()].map((l) => l.countryName));
    for (const name of countries) {
      const bound = binder.resolve('country', name, name, () => ({
        name,
        strategy: 'manual',
      }));
      insCountry.run(bound.stableId, name, bound.name);
      countryIds.set(name, bound.stableId);
    }

    // --- turnuvalar
    const clubsPerLeague = new Map<string, number>();
    for (const c of clubs.values()) {
      clubsPerLeague.set(c.leagueId, (clubsPerLeague.get(c.leagueId) ?? 0) + 1);
    }

    for (const [leagueId, entry] of activeLeagues) {
      const key = `fc-league:${leagueId}`;
      // PES MANTIGI: lig adi ulke + basamaktan turer.
      // 'Premier League' -> 'English Division 1'
      const bound = binder.resolve('competition', key, entry.leagueName, (salt) => ({
        name: poolCompetitionMask(entry.leagueName, salt, {
          country: entry.countryName,
          level: entry.level,
          kind: 'league',
        }),
        strategy: 'pool',
      }));
      const countryId = countryIds.get(entry.countryName);
      if (countryId === undefined) continue;

      const clubCount = clubsPerLeague.get(leagueId) ?? 0;

      insCompetition.run(
        bound.stableId,
        key,
        countryId,
        entry.level,
        entry.leagueName,
        bound.name,
        // Cift devre: kulup sayisindan turer. FC26 ligleri duzenli
        // round-robin -- Transfermarkt'taki MLS/konferans tuhafliklari yok.
        Math.max(0, (clubCount - 1) * 2),
        clubCount,
        scope.leagueWindow.start,
        scope.leagueWindow.end,
        scope.leagueWindow.slot,
        entry.promoted,
        entry.relegated,
        leagueId,
      );
      competitionIds.set(leagueId, bound.stableId);
    }

    // --- kulupler
    for (const club of clubs.values()) {
      const entry = activeLeagues.get(club.leagueId);
      if (!entry) continue;
      const countryId = countryIds.get(entry.countryName);
      const competitionId = competitionIds.get(club.leagueId);
      if (countryId === undefined || competitionId === undefined) continue;

      const bound = binder.resolve('club', club.externalKey, club.nameReal, (salt) => ({
        name: poolClubMask(club.nameReal, salt),
        strategy: 'pool',
      }));

      // SEHIR -- kulup adindaki yer tokeninden turetilir.
      //
      // Iki kaynagin ikisi de sehir tasimiyor, bu yuzden `club.city` HER
      // ZAMAN bostu. Ama kulup adlarinin cogu sehri zaten iceriyor
      // ('Manchester City', 'Athletic Club Bilbao'): jenerik ekler
      // (FC/United/City) atilinca geriye kalan token yerdir. Uydurma degil,
      // var olan veriden CIKARIM.
      //
      // Sehir adi MASKELENMEZ -- cografya tescilli degil.
      const place = splitClubName(club.nameReal).place;
      let cityId: number | null = null;
      let cityName = '';
      if (place !== undefined && place.length > 0) {
        cityName = place;
        const cacheKey = `${countryId}:${place}`;
        let known = cityIds.get(cacheKey);
        if (known === undefined) {
          insCity.run(countryId, place, place);
          const row = selCity.get(countryId, place) as { id: number } | undefined;
          if (row) {
            known = row.id;
            cityIds.set(cacheKey, known);
          }
        }
        cityId = known ?? null;
      }

      insClub.run(
        bound.stableId,
        club.externalKey,
        club.nameReal,
        bound.name,
        shortOf(bound.name),
        countryId,
        competitionId,
        Math.round(club.squadValue),
        cityName,
        cityId,
      );
      clubIds.set(club.externalKey, bound.stableId);
    }

    // --- oyuncular
    for (const p of players) {
      const { first, last } = splitPlayerName(p.nameReal);
      const bound = binder.resolve('player', p.externalKey, p.nameReal, (salt) => ({
        // Ad KORUNUR, soyad KAYDIRILIR -- Transfermarkt hattiyla ayni ilke.
        name: `${first} ${salt === 0 ? phoneticShift(last) : `${phoneticShift(last)}${salt}`}`.trim(),
        strategy: 'phonetic',
      }));

      const maskedParts = splitPlayerName(bound.name);
      const clubId = p.clubKey === undefined ? null : (clubIds.get(p.clubKey) ?? null);

      insPlayer.run(
        bound.stableId,
        p.externalKey,
        first,
        last,
        maskedParts.first,
        maskedParts.last,
        p.birthYear ?? null,
        p.nationality,
        p.position,
        p.subPosition,
        p.foot,
        p.heightCm ?? null,
        clubId,
        p.marketValue,
        p.contractExpires ?? null,
        // FC26 her oyuncuya deger veriyor; sifir olan gercekten degersiz
        // (amator/genc) demek, eksik veri degil.
        p.marketValue > 0 ? 'market' : 'fallback',
        p.aggression ?? null,
        p.composure ?? null,
        p.intlReputation ?? null,
        p.shirtNumber ?? null,
      );

      insAttributes.run(
        bound.stableId,
        p.attributes.pace,
        p.attributes.shooting,
        p.attributes.passing,
        p.attributes.defending,
        p.attributes.physical,
        p.attributes.goalkeeping,
        p.overall,
        p.potential,
      );
      playerCount += 1;
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  log.info(
    'fc26',
    `${countryIds.size} ulke, ${competitionIds.size} lig, ${clubIds.size} kulup, ${playerCount} oyuncu`,
  );
  if (skipped.skippedPlayers > 0) {
    log.info('fc26', `${skipped.skippedPlayers} oyuncu atlandi (ligsiz ya da mevkisi cozulemedi)`);
  }

  return {
    countries: countryIds.size,
    competitions: competitionIds.size,
    clubs: clubIds.size,
    players: playerCount,
    ...skipped,
  };
}

/** "Manchester Blue" -> "MAN BLU". Kulup kisaltmasi. */
function shortOf(masked: string): string {
  return masked
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.slice(0, 3).toUpperCase())
    .join(' ');
}
