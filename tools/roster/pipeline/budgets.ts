/**
 * KULUP BUTCELERI -- kadro degerinden turer.
 *
 * Semada `budget_transfer` ve `budget_wage` kolonlari vardi ama HEPSI 0'di:
 * transfer piyasasinin uzerine kurulacagi zemin bostu.
 *
 * NEDEN KADRO DEGERI:
 *   Gelir verisi kaynakta yok (Transfermarkt kulup cirosu tasimiyor). Ama
 *   kadro degeri geliri iyi bir vekildir: kulup ne kadar buyukse hem daha
 *   pahali kadro tutar hem daha cok kazanir. Ikisi ayni sinyalin iki yuzu.
 *
 * GERCEKCI ORANLAR:
 *   Transfer butcesi kadro degerinin ~%18'i. Gercekte elit kuluplerde bu oran
 *   daha DUSUK (Real Madrid'in 1.3 milyarlik kadrosu icin 235M butce cok),
 *   kucuk kuluplerde daha YUKSEK (kadrosu 5M olan kulup 2M harcayabilir).
 *   Bu yuzden oran kadro degeriyle TERS olcekleniyor: buyudukce daralir.
 *
 *   Maas butcesi kadro degerinin ~%40'i/yil. Bu, oyuncu basina yillik maasin
 *   piyasa degerinin ~%40'i olmasi demek -- gercek futbola yakin.
 */

import type { IssueLog } from '../db.js';
import type { DatabaseSyncType } from '../sqlite.js';

export interface BudgetResult {
  readonly updated: number;
  readonly totalTransfer: number;
}

/**
 * Transfer butcesi orani -- kadro degeri buyudukce DARALIR.
 *
 *   kadro 1M   -> %35   (350 bin)
 *   kadro 50M  -> %24   (12M)
 *   kadro 500M -> %17   (85M)
 *   kadro 1.3B -> %14   (185M)
 *
 * Duz bir yuzde kullansaydik elit kulupler her sezon kadrosunun besde birini
 * yenileyebilirdi; kucuk kulupler ise hicbir sey alamazdi.
 */
export function transferRatio(squadValue: number): number {
  const m = Math.max(1, squadValue / 1_000_000);
  return Math.max(0.12, Math.min(0.38, 0.38 - Math.log10(m) * 0.075));
}

/** Yillik maas butcesi -- kadro degerinin sabit orani. */
export const WAGE_RATIO = 0.4;

export function computeBudgets(db: DatabaseSyncType, log: IssueLog): BudgetResult {
  const rows = db
    .prepare(
      `SELECT c.id, COALESCE(SUM(p.market_value), 0) AS squad_value
       FROM club c LEFT JOIN player p ON p.club_id = c.id
       GROUP BY c.id`,
    )
    .all() as unknown as { id: number; squad_value: number }[];

  if (rows.length === 0) {
    log.warn('budgets', 'kulup yok -- butce hesaplanmadi');
    return { updated: 0, totalTransfer: 0 };
  }

  const update = db.prepare(
    'UPDATE club SET budget_transfer = ?, budget_wage = ? WHERE id = ?',
  );

  let total = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      // Kadrosu bos kulup bile bir taban butceye sahip olmali; yoksa transfer
      // piyasasinda hic hareket edemez ve olu kulup olur.
      const squad = Math.max(row.squad_value, 500_000);
      const transfer = Math.round(squad * transferRatio(squad));
      const wage = Math.round(squad * WAGE_RATIO);
      update.run(transfer, wage, row.id);
      total += transfer;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  log.info(
    'budgets',
    `${rows.length} kulup butcesi hesaplandi -- toplam transfer havuzu ${(total / 1e9).toFixed(2)} milyar EUR`,
  );
  return { updated: rows.length, totalTransfer: total };
}
