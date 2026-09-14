/**
 * HOCA DEGISIMI TAKIM GUCUNE YANSIYOR MU?
 *
 * `squadOverallOf` onbellekli; onbellek yalnizca transferde temizleniyordu.
 * Hoca degisimi de tazelemiyorsa kovulma takim gucune HIC girmez.
 */
import { createDbWorld } from '../../src/adapters/dbWorld.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';

const reg = (await new ContentLoader(new FileSystemContentSource('content')).load()).registry!;
const w = createDbWorld({ dbPath: 'data/world.db', registry: reg, seed: 11 });
const club = w.roster.clubs()[0]!;

const strengthOf = (): number => w.league.strength(club.id);
const free = w.roster.freeStaff!('manager', club.id);
const dbCoach = w.roster.staff(club.id).find((p) => p.role === 'manager');

console.log(`kulup: ${club.name} (itibar ${club.reputation})`);
console.log(`DB hocasi   : ${dbCoach?.displayName} tac ${dbCoach?.attributes?.tactical}`);
console.log(`bosta havuz : ${free.length} hoca, ilk ucu:`);
for (const f of free.slice(0, 3)) console.log(`   ${f.displayName?.padEnd(22)} itibar ${f.reputation} tac ${f.attributes?.tactical}`);

const base = strengthOf();
console.log(`\nDB hocasiyla lig gucu        : ${base.toFixed(3)}`);

// En zayif ve en guclu bosta hocayi sirayla gorevlendir.
const sorted = [...free].sort((a, b) => (a.attributes?.tactical ?? 0) - (b.attributes?.tactical ?? 0));
for (const cand of [sorted[0]!, sorted[sorted.length - 1]!]) {
  w.useManagerSource((id) => (id === club.id ? cand.sourceId : undefined));
  console.log(
    `${cand.displayName?.padEnd(22)} (tac ${String(cand.attributes?.tactical).padStart(2)}) -> lig gucu ${strengthOf().toFixed(3)}`,
  );
}
w.close();
