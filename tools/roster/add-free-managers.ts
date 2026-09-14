/**
 * MEVCUT world.db'YE BOSTA HOCA HAVUZU EKLER.
 *
 * NEDEN AYRI BIR BETIK: tam import kaynak CSV'leri ister (sofifa,
 * Transfermarkt) ve onlar bu makinede yok; `import.ts`i calistirmak var
 * olan oyuncu verisini yeniden uretmeye kalkardi. Bu asama ise EKLEMELI --
 * tek yaptigi `club_id IS NULL` satirlari yazmak. Var olan hicbir satira
 * dokunmaz ve iki kez calistirilabilir (`ON CONFLICT DO NOTHING`).
 *
 * Tam import'a da baglandi: bundan sonra sifirdan kurulan her world.db
 * havuzu kendiliginden tasir.
 *
 *   npx tsx tools/roster/add-free-managers.ts [--db data/world.db]
 */

import { DatabaseSync } from './sqlite.js';
import { IssueLog } from './db.js';
import { MaskBinder, EMPTY_RULES } from './masking.js';
import { generateFreeManagers } from './pipeline/staff.js';

const dbPath = process.argv.find((a) => a.startsWith('--db='))?.split('=')[1] ?? 'data/world.db';
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

const log = new IssueLog();
const before = (db.prepare('SELECT count(*) AS n FROM staff WHERE club_id IS NULL').get() as unknown as { n: number }).n;

// Kuratorlu maske kurallari yalnizca kulup/turnuva/ulke icindir; hoca
// adlari algoritmik maskelenir, o yuzden bos kural seti yeterli.
const result = generateFreeManagers({
  db,
  binder: new MaskBinder(db, EMPTY_RULES),
  log,
  seed: 2026,
});

const after = (db.prepare('SELECT count(*) AS n FROM staff WHERE club_id IS NULL').get() as unknown as { n: number }).n;
console.log(`bosta hoca: ${before} -> ${after}  (bu calistirmada ${result.created} yazildi)`);
for (const issue of log.all()) console.log(`  [${issue.severity}] ${issue.stage}: ${issue.message}`);
db.close();
