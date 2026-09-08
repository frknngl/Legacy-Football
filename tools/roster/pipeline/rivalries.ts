/**
 * EZELI RAKIPLIK -- kaynakta olmayan, turetilmesi gereken bag.
 *
 * `club.rival_club_id` semada vardi ama gercek dunyada 0/303 doluydu:
 * mock dunyada elle yazilmisti, ithal edilen dunyada hic kurulmuyordu.
 *
 * NEDEN ONEMLI:
 *   Rakiplik yalnizca bir anlati susu degil, transfer piyasasinin gercekci
 *   olmasi icin sart. Gercek futbolda bir kulup en buyuk rakibine oyuncu
 *   SATMAZ -- satarsa da fahis fiyata ve taraftar ayaklanir. Bu kural
 *   olmadan piyasa "en iyi teklif kazanir"a doner ve derbi anlamini yitirir.
 *
 * TURETME KURALI (siraya gore):
 *   1. AYNI SEHIR, ayni lig  -> en guclu rakiplik (sehir derbisi)
 *   2. Ayni lig, itibarca EN YAKIN buyuk kulup -> klasik rakiplik
 *   3. Ayni ulke, komsu basamak -> zayif rakiplik
 *
 * Rakiplik KARSILIKLIDIR: A'nin rakibi B ise B'nin rakibi de A.
 */

import type { IssueLog } from '../db.js';
import type { DatabaseSyncType } from '../sqlite.js';

export interface RivalryResult {
  readonly pairs: number;
  readonly cityDerbies: number;
}

interface ClubRow {
  id: number;
  city: string;
  country_id: number;
  competition_id: number | null;
  reputation: number;
}

export function deriveRivalries(db: DatabaseSyncType, log: IssueLog): RivalryResult {
  const clubs = db
    .prepare('SELECT id, city, country_id, competition_id, reputation FROM club')
    .all() as unknown as ClubRow[];

  if (clubs.length < 2) {
    log.warn('rivalries', 'rakiplik kurmak icin yeterli kulup yok');
    return { pairs: 0, cityDerbies: 0 };
  }

  const rival = new Map<number, number>();
  let cityDerbies = 0;

  // --- 1. SEHIR DERBILERI
  //
  // En guclu rakiplik ayni sehirdedir. Ayni sehirde ikiden fazla kulup varsa
  // itibarca en yakin ikisi eslesir; kalanlar sonraki asamaya duser.
  const byCity = new Map<string, ClubRow[]>();
  for (const club of clubs) {
    if (club.city === '') continue;
    const key = `${club.country_id}:${club.city}`;
    const list = byCity.get(key);
    if (list) list.push(club);
    else byCity.set(key, [club]);
  }

  for (const group of byCity.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => b.reputation - a.reputation);
    for (let i = 0; i + 1 < sorted.length; i += 2) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      if (rival.has(a.id) || rival.has(b.id)) continue;
      rival.set(a.id, b.id);
      rival.set(b.id, a.id);
      cityDerbies += 1;
    }
  }

  // --- 2. LIG ICI KLASIK RAKIPLIK
  //
  // Itibarca en yakin kulup: iki dev birbirinin rakibidir, dev ile kume
  // dusme adayi degil.
  const byCompetition = new Map<number, ClubRow[]>();
  for (const club of clubs) {
    if (club.competition_id === null || rival.has(club.id)) continue;
    const list = byCompetition.get(club.competition_id);
    if (list) list.push(club);
    else byCompetition.set(club.competition_id, [club]);
  }

  for (const group of byCompetition.values()) {
    const sorted = [...group].sort((a, b) => b.reputation - a.reputation);
    for (let i = 0; i + 1 < sorted.length; i += 2) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      if (rival.has(a.id) || rival.has(b.id)) continue;
      rival.set(a.id, b.id);
      rival.set(b.id, a.id);
    }
  }

  const update = db.prepare('UPDATE club SET rival_club_id = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const [clubId, rivalId] of rival) update.run(rivalId, clubId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const pairs = rival.size / 2;
  log.info(
    'rivalries',
    `${pairs} rakiplik kuruldu (${cityDerbies} sehir derbisi), ${clubs.length - rival.size} kulup rakipsiz`,
  );
  return { pairs, cityDerbies };
}
