/**
 * YAZMA ASAMASI -- taslaklari world.db'ye isler ve maskeleri KILITLER.
 *
 * Tek islemde (transaction) calisir: yarim kalmis bir import, yarisi maskeli
 * bir dunya birakmaz. Maske baglamalari bu islemde kilitlendigi icin bu
 * ozellikle onemli -- yarim kilitlenmis bir tablo sonraki import'ta
 * "bazi oyuncular yeniden adlandirildi" demek olurdu.
 */

import type { DatabaseSyncType } from '../sqlite.js';
import type { IssueLog } from '../db.js';
import { MaskBinder, poolClubMask, poolCompetitionMask, hashString } from '../masking.js';
import type { ImportScope } from '../scope.js';
import { declaredMatches, type CompetitionDraft } from './competitions.js';

export interface EmitResult {
  readonly countries: number;
  readonly competitions: number;
  readonly clubs: number;
  readonly freshMasks: number;
  readonly reusedMasks: number;
}

export function emitWorld(
  db: DatabaseSyncType,
  drafts: readonly CompetitionDraft[],
  binder: MaskBinder,
  scope: ImportScope,
  log: IssueLog,
): EmitResult {
  const insCountry = db.prepare(
    `INSERT INTO country(id, name_real, name_masked, confederation) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name_real = excluded.name_real`,
  );
  const insCompetition = db.prepare(
    `INSERT INTO competition(
       id, external_key, country_id, kind, level, name_real, name_masked,
       format_kind, legs, matches_per_club, club_count,
       window_start, window_end, slot_preference, promoted, relegated, reputation)
     VALUES (?, ?, ?, 'league', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name_real = excluded.name_real,
       club_count = excluded.club_count,
       format_kind = excluded.format_kind,
       legs = excluded.legs,
       matches_per_club = excluded.matches_per_club,
       reputation = excluded.reputation`,
  );
  const insClub = db.prepare(
    `INSERT INTO club(
       id, external_key, name_real, name_masked, short_masked, country_id,
       competition_id, tier, reputation, matches_per_club, foreign_ratio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name_real = excluded.name_real,
       competition_id = excluded.competition_id,
       tier = excluded.tier,
       reputation = excluded.reputation,
       matches_per_club = excluded.matches_per_club`,
  );

  let fresh = 0;
  let reused = 0;
  const countryIds = new Map<string, number>();

  db.exec('BEGIN');
  try {
    // --- ulkeler
    for (const name of scope.countries) {
      const bound = binder.resolve('country', name, name, (salt) => ({
        name: `Ulke ${hashString(name, salt) % 997}`,
        strategy: 'pool',
      }));
      bound.fresh ? (fresh += 1) : (reused += 1);
      insCountry.run(bound.stableId, name, bound.name, null);
      countryIds.set(name, bound.stableId);
    }

    // --- turnuvalar
    for (const d of drafts) {
      const bound = binder.resolve('competition', d.externalKey, d.nameReal, (salt) => ({
        name: poolCompetitionMask(d.nameReal, salt),
        strategy: 'pool',
      }));
      bound.fresh ? (fresh += 1) : (reused += 1);

      const countryId = countryIds.get(d.countryName);
      if (countryId === undefined) {
        log.error('emit', `${d.nameReal}: ulke kaydi yok (${d.countryName})`, 'competition', d.externalKey);
        continue;
      }

      insCompetition.run(
        bound.stableId,
        d.externalKey,
        countryId,
        d.level,
        d.nameReal,
        bound.name,
        d.format.kind,
        d.format.kind === 'round_robin' ? d.format.legs : null,
        declaredMatches(d.format) ?? null,
        d.clubCount,
        scope.leagueWindow.start,
        scope.leagueWindow.end,
        scope.leagueWindow.slot,
        d.promoted,
        d.relegated,
        d.reputation,
      );

      // --- kulupler
      for (const c of d.clubs) {
        const cb = binder.resolve('club', c.externalKey, c.nameReal, (salt) => ({
          name: poolClubMask(c.nameReal, salt),
          strategy: 'pool',
        }));
        cb.fresh ? (fresh += 1) : (reused += 1);

        insClub.run(
          cb.stableId,
          c.externalKey,
          c.nameReal,
          cb.name,
          shortName(cb.name),
          countryId,
          bound.stableId,
          c.tier,
          c.reputation,
          c.matchesPerClub ?? null,
          0,
        );
      }
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    countries: countryIds.size,
    competitions: drafts.length,
    clubs: drafts.reduce((s, d) => s + d.clubs.length, 0),
    freshMasks: fresh,
    reusedMasks: reused,
  };
}

/** Tablo/skor gosterimi icin kisa ad. "Manchester Blue" -> "MAN BLU". */
function shortName(masked: string): string {
  const tokens = masked.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 1) return tokens[0]!.slice(0, 3).toUpperCase();
  return tokens
    .slice(0, 2)
    .map((t) => t.slice(0, 3).toUpperCase())
    .join(' ');
}
