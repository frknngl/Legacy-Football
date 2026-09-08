/**
 * ITIBARIN YENIDEN HESABI -- kadro piyasa degerinden.
 *
 * IKI ASAMALI, cunku tavuk-yumurta var:
 *
 *   1. ON TAHMIN (competitions.ts) -- kulupler oyunculardan ONCE yazilmali
 *      (oyuncunun club_id'si lazim). O anda elimizde yalnizca mac basi puan
 *      var, o da lig gucunu bilmiyor; ulke katsayisi bu bosluga kosuluyor.
 *      Bu tahmin ARTIK yalnizca piyasa degeri olmayan %5 oyuncunun taban
 *      degerini uretmek icin kullaniliyor.
 *
 *   2. OTORITE (bu dosya) -- oyuncular yazildiktan sonra kadro degeri okunur
 *      ve itibar YENIDEN yazilir. clubTier'i belirleyen budur.
 *
 * NEDEN KADRO DEGERI DAHA IYI:
 *   Mac basi puan lig ICI siralamayi verir ama ligler ARASI karsilastirma
 *   yapamaz -- zayif ligde sampiyon 2.4 puan/mac alir, guclu ligde 2.1.
 *   Olculdu: katsayisiz haliyle Sporting CP, Real Madrid'in ustune cikiyordu.
 *   Piyasa degeri ise zaten kuresel olarak fiyatlanmis tek olcek.
 *
 * NEDEN TOPLAM DEGIL, EN IYI N'IN ORTALAMASI:
 *   Toplam, kalabalik kadroyu odullendirir. Kaynakta kadrolar 6 ile 38 kisi
 *   arasinda degisiyor (bazi kuluplerin verisi eksik); toplam kullanmak veri
 *   eksikligini guc farki gibi gosterirdi. Ilk 16'nin ortalamasi kadro
 *   buyuklugunden bagimsizdir.
 */

import type { IssueLog } from '../db.js';
import type { DatabaseSyncType } from '../sqlite.js';
import { tierFor, type ClubTier } from './competitions.js';

/** Ilk 11 + yedekler: bir kulubu temsil eden cekirdek. */
const CORE_SQUAD = 16;

export interface ReputationResult {
  readonly updated: number;
  readonly skipped: number;
}

interface ClubScore {
  readonly id: number;
  readonly level: number;
  readonly score: number;
}

export function recomputeReputation(db: DatabaseSyncType, log: IssueLog): ReputationResult {
  const clubs = db
    .prepare(
      `SELECT c.id, c.name_real, c.external_key, COALESCE(comp.level, 3) AS level
       FROM club c LEFT JOIN competition comp ON comp.id = c.competition_id`,
    )
    .all() as { id: number; name_real: string; external_key: string; level: number }[];

  const valuesStmt = db.prepare(
    `SELECT market_value FROM player WHERE club_id = ?
     ORDER BY market_value DESC LIMIT ${CORE_SQUAD}`,
  );

  const scored: ClubScore[] = [];
  let skipped = 0;

  for (const club of clubs) {
    const rows = valuesStmt.all(club.id) as { market_value: number }[];
    if (rows.length === 0) {
      // Kadrosu bos kulup: on tahmin itibari korunur. Zaten `error` olarak
      // isaretli; ustune bir de sifir itibar yazmak GUI'de iki ayri sorun
      // gibi gorunurdu.
      skipped += 1;
      continue;
    }
    const mean = rows.reduce((s, r) => s + r.market_value, 0) / rows.length;
    scored.push({ id: club.id, level: club.level, score: Math.log10(Math.max(mean, 1_000)) });
  }

  if (scored.length === 0) {
    log.warn('reputation', 'kadro degeri okunamadi -- itibar on tahminde birakildi');
    return { updated: 0, skipped };
  }

  // Yuzdelik: ithal evren ne olursa olsun kullanilabilir bir dagilim uretir.
  // Sabit bir esik tablosu her yeni ulkede yeniden kalibre edilmek zorunda
  // kalirdi.
  const ranked = [...scored].sort((a, b) => a.score - b.score);
  const n = ranked.length;

  const update = db.prepare('UPDATE club SET reputation = ?, tier = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    ranked.forEach((club, i) => {
      const reputation = n <= 1 ? 55 : Math.round(18 + (78 * i) / (n - 1));
      const tier: ClubTier = tierFor(reputation, club.level);
      update.run(reputation, tier, club.id);
    });

    // Turnuva itibari uyelerinin ortalamasi.
    db.exec(
      `UPDATE competition SET reputation = COALESCE((
         SELECT CAST(ROUND(AVG(c.reputation)) AS INTEGER)
         FROM club c WHERE c.competition_id = competition.id
       ), reputation)`,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  if (skipped > 0) {
    log.warn('reputation', `${skipped} kulubun kadrosu bos -- itibari on tahminde birakildi`);
  }
  log.info('reputation', `${n} kulubun itibari kadro degerinden yeniden hesaplandi`);

  return { updated: n, skipped };
}
