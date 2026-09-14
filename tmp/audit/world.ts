/**
 * UZUN VADELI DUNYA SIMULASYONU -- Hero olmadan.
 *
 * Amac: dunyanin KENDI BASINA nasil yasadigini olcmek.
 *   - Ayni kulupler sonsuza kadar domine ediyor mu?
 *   - Transfer piyasasi likit mi, yoksa donuyor mu?
 *   - Butceler patliyor mu (snowball) ya da cokuyor mu?
 *   - Kadro gucu zaman icinde degisiyor mu?
 *
 * SALT OKUNUR: world.db acilirken readOnly. Hicbir yazma yok.
 */

import { createDbWorld } from '../../src/adapters/dbWorld.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';
import { buildTeam } from '../../src/simulation/TeamModel.js';

const SEASONS = Number(process.argv.find((a) => a.startsWith('--seasons='))?.split('=')[1] ?? '100');
const SEED = Number(process.argv.find((a) => a.startsWith('--seed='))?.split('=')[1] ?? '4242');

const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
const registry = loaded.registry!;
const world = createDbWorld({ dbPath: 'data/world.db', registry, seed: SEED });

const clubs = world.roster.clubs();
const leagues = world.roster.leagues();
const nameOf = new Map(clubs.map((c) => [c.id, c.name]));

/** Sezon basi lig sampiyonlari -- ayni kulup ne siklikla kazaniyor. */
const titles = new Map<string, Map<string, number>>();
/** Transfer hacmi. */
let totalTransfers = 0;
const transfersPerSeason: number[] = [];
/** Kadro gucu anliklari -- ilk ve son sezon. */
function strengthSnapshot(): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of clubs) {
    world.roster.invalidate?.(c.id);
    out.set(c.id, buildTeam(c.id, c.name, world.roster.squad(c.id)).lines.overall);
  }
  return out;
}

const before = strengthSnapshot();
const t0 = Date.now();
let played = 0;

for (let season = 1; season <= SEASONS; season += 1) {
  let seasonTransfers = 0;
  for (let week = 1; week <= 40; week += 1) {
    // Hero yok -> skipClubId undefined; butun fiksturler cozulur.
    world.advanceWeek(week, '__none__');
    seasonTransfers += world.runTransferWeek(week).length;
    played += 1;
  }
  totalTransfers += seasonTransfers;
  transfersPerSeason.push(seasonTransfers);

  const outcome = world.finishSeason();
  for (const [leagueId, clubId] of Object.entries(outcome.champions)) {
    const m = titles.get(leagueId) ?? new Map<string, number>();
    m.set(clubId, (m.get(clubId) ?? 0) + 1);
    titles.set(leagueId, m);
  }
  if (season % 25 === 0) {
    console.log(`  sezon ${season}/${SEASONS}  (${((Date.now() - t0) / 1000).toFixed(0)} sn)`);
  }
}

const after = strengthSnapshot();

console.log(`\n=== ${SEASONS} SEZON TAMAMLANDI (${((Date.now() - t0) / 1000).toFixed(0)} sn) ===`);
console.log(`kulup: ${clubs.length}  lig: ${leagues.length}  oynatilan hafta: ${played}`);

console.log(`\n--- TRANSFER PIYASASI`);
console.log(`  toplam transfer   : ${totalTransfers}`);
console.log(`  sezon basina ort  : ${(totalTransfers / SEASONS).toFixed(1)}`);
console.log(`  ilk 10 sezon ort  : ${(transfersPerSeason.slice(0, 10).reduce((a, b) => a + b, 0) / 10).toFixed(1)}`);
console.log(`  son 10 sezon ort  : ${(transfersPerSeason.slice(-10).reduce((a, b) => a + b, 0) / 10).toFixed(1)}`);

console.log(`\n--- SAMPIYONLUK YOGUNLASMASI`);
for (const [leagueId, m] of [...titles].slice(0, 6)) {
  const sorted = [...m].sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  const label = leagues.find((l) => l.id === leagueId)?.label ?? leagueId;
  console.log(
    `  ${label.padEnd(24)} ${m.size} farkli sampiyon / ${total} sezon` +
      `  | en cok: ${nameOf.get(top![0]) ?? top![0]} (${top![1]}x, %${((100 * top![1]) / total).toFixed(0)})`,
  );
}

console.log(`\n--- KADRO GUCU KAYMASI (${SEASONS} sezon)`);
const drift: { id: string; b: number; a: number }[] = [];
for (const c of clubs) drift.push({ id: c.id, b: before.get(c.id) ?? 0, a: after.get(c.id) ?? 0 });
const changed = drift.filter((d) => d.a !== d.b);
console.log(`  kadro gucu DEGISEN kulup: ${changed.length}/${clubs.length}`);
if (changed.length > 0) {
  const deltas = changed.map((d) => d.a - d.b);
  console.log(`  degisim: min ${Math.min(...deltas)}  max ${Math.max(...deltas)}  ort ${(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2)}`);
  const up = [...changed].sort((x, y) => y.a - y.b - (x.a - x.b)).slice(0, 3);
  const down = [...changed].sort((x, y) => x.a - x.b - (y.a - y.b)).slice(0, 3);
  for (const d of up) console.log(`     yukselen: ${nameOf.get(d.id)} ${d.b} -> ${d.a}`);
  for (const d of down) console.log(`     dusen   : ${nameOf.get(d.id)} ${d.b} -> ${d.a}`);
}

console.log(`\n--- LIG TABLOSU (son sezon, ilk lig)`);
const first = leagues.find((l) => l.level === 1);
if (first) {
  const table = world.league.standings(first.id).slice(0, 5);
  for (const r of table) {
    console.log(`  ${String(r.position).padStart(2)}. ${(nameOf.get(r.clubId) ?? r.clubId).padEnd(24)} ${r.points} puan / ${r.played} mac`);
  }
}
world.close();
