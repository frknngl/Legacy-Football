/**
 * EKONOMI DENETIMI -- snowball, cokus ve "basari -> gelir" baglantisi.
 *
 * Denetimin acikca sordugu sorular:
 *   - Economic snowball var mi? (100M -> 300M -> 900M -> 3B)
 *   - Permanent collapse / dead club var mi?
 *   - Lig sirasi geliri gercekten etkiliyor mu?
 *   - Gelir gelecek butceyi gercekten etkiliyor mu?
 */

import { createDbWorld } from '../../src/adapters/dbWorld.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';

const SEASONS = Number(process.argv.find((a) => a.startsWith('--seasons='))?.split('=')[1] ?? '50');

const reg = (await new ContentLoader(new FileSystemContentSource('content')).load()).registry!;
const w = createDbWorld({ dbPath: 'data/world.db', registry: reg, seed: 7777 });
const finance = (w as unknown as { finance?: never }).finance;
void finance;

const clubs = w.roster.clubs();
const nameOf = new Map(clubs.map((c) => [c.id, c.name]));
const topLeague = w.roster.leagues().find((l) => l.level === 1 && l.label.startsWith('English'))!;

/** Kulup -> sezon sezon kasa/gelir/butce. */
const history = new Map<string, { cash: number[]; revenue: number[]; budget: number[] }>();
/** Sezon sonu sirasi -> o sezonki gelir (bir sonraki sezonda okunur). */
const positionRevenue: { position: number; revenue: number; size: number }[] = [];
const revenueBudget: { revenue: number; budget: number }[] = [];

const books = (): Map<string, { cash: number; revenue: number; budget: number }> => {
  const out = new Map<string, { cash: number; revenue: number; budget: number }>();
  for (const c of clubs) {
    const b = (w.market as unknown as { deps: { finance?: { booksOf(id: string): { cash: number; revenue: number; budget: number } } } })
      .deps.finance?.booksOf(c.id);
    if (b) out.set(c.id, { cash: b.cash, revenue: b.revenue, budget: b.budget });
  }
  return out;
};

let transfers = 0;
for (let season = 1; season <= SEASONS; season += 1) {
  for (let wk = 1; wk <= 40; wk += 1) {
    w.advanceWeek(wk, '__none__');
    transfers += w.runTransferWeek(wk).length;
  }

  // Sezon sonu SIRASI -- finishSeason tabloyu sifirlamadan once.
  const order = w.league.standings(topLeague.id).map((r) => r.clubId);
  w.finishSeason();

  const b = books();
  for (const [id, v] of b) {
    const h = history.get(id) ?? { cash: [], revenue: [], budget: [] };
    h.cash.push(v.cash);
    h.revenue.push(v.revenue);
    h.budget.push(v.budget);
    history.set(id, h);
  }
  order.forEach((id, i) => {
    const v = b.get(id);
    if (v) positionRevenue.push({ position: i + 1, revenue: v.revenue, size: order.length });
  });
  for (const v of b.values()) revenueBudget.push({ revenue: v.revenue, budget: v.budget });
}

const m = (n: number): string => `${(n / 1_000_000).toFixed(1)}M`;

console.log(`=== ${SEASONS} SEZON EKONOMI DENETIMI ===`);
console.log(`kulup ${clubs.length} · transfer ${transfers} (${(transfers / SEASONS).toFixed(1)}/sezon)\n`);

console.log('--- LIG SIRASI -> GELIR  (English Division 1)');
const byPos = new Map<number, number[]>();
for (const r of positionRevenue) {
  if (r.size !== 20) continue;
  const band = r.position <= 4 ? 1 : r.position <= 8 ? 2 : r.position <= 14 ? 3 : 4;
  (byPos.get(band) ?? byPos.set(band, []).get(band)!).push(r.revenue);
}
const bandName = ['', 'ilk 4', '5-8', '9-14', '15-20'];
for (const band of [1, 2, 3, 4]) {
  const v = byPos.get(band) ?? [];
  if (v.length === 0) continue;
  console.log(`   ${bandName[band]!.padEnd(8)} ortalama gelir ${m(v.reduce((a, b2) => a + b2, 0) / v.length)}  (${v.length} gozlem)`);
}

console.log('\n--- GELIR -> BUTCE korelasyonu');
const n = revenueBudget.length;
const mr = revenueBudget.reduce((a, b2) => a + b2.revenue, 0) / n;
const mb = revenueBudget.reduce((a, b2) => a + b2.budget, 0) / n;
let cov = 0, vr = 0, vb = 0;
for (const r of revenueBudget) {
  cov += (r.revenue - mr) * (r.budget - mb);
  vr += (r.revenue - mr) ** 2;
  vb += (r.budget - mb) ** 2;
}
console.log(`   r = ${(cov / Math.sqrt(vr * vb)).toFixed(3)}   (${n} gozlem)`);

console.log('\n--- SNOWBALL / COKUS');
const growth: { id: string; first: number; last: number; ratio: number }[] = [];
for (const [id, h] of history) {
  const first = h.revenue[0] ?? 0;
  const last = h.revenue[h.revenue.length - 1] ?? 0;
  if (first > 0) growth.push({ id, first, last, ratio: last / first });
}
growth.sort((a, b) => b.ratio - a.ratio);
console.log(`   gelir carpani: min ${growth[growth.length - 1]!.ratio.toFixed(2)}x  ortanca ${growth[Math.floor(growth.length / 2)]!.ratio.toFixed(2)}x  max ${growth[0]!.ratio.toFixed(2)}x`);
console.log('   en cok buyuyen 3:');
for (const g of growth.slice(0, 3)) console.log(`      ${nameOf.get(g.id)?.padEnd(24)} ${m(g.first)} -> ${m(g.last)}  (${g.ratio.toFixed(2)}x)`);
console.log('   en cok kuculen 3:');
for (const g of growth.slice(-3)) console.log(`      ${nameOf.get(g.id)?.padEnd(24)} ${m(g.first)} -> ${m(g.last)}  (${g.ratio.toFixed(2)}x)`);

const finalBooks = books();
const cashes = [...finalBooks.values()].map((v) => v.cash).sort((a, b) => a - b);
const budgets = [...finalBooks.values()].map((v) => v.budget).sort((a, b) => a - b);
console.log(`\n   son kasa   : min ${m(cashes[0]!)}  ortanca ${m(cashes[Math.floor(cashes.length / 2)]!)}  max ${m(cashes[cashes.length - 1]!)}`);
console.log(`   son butce  : min ${m(budgets[0]!)}  ortanca ${m(budgets[Math.floor(budgets.length / 2)]!)}  max ${m(budgets[budgets.length - 1]!)}`);
console.log(`   negatif kasa: ${cashes.filter((c) => c < 0).length}/${cashes.length}`);
console.log(`   butcesi tabanda (2M) kalan: ${budgets.filter((b2) => b2 <= 2_000_000).length}/${budgets.length}`);

w.close();
