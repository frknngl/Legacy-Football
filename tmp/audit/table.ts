import { createDbWorld } from '../../src/adapters/dbWorld.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';

const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
const w = createDbWorld({ dbPath: 'data/world.db', registry: loaded.registry!, seed: 4242 });
const lg = w.roster.leagues().find((l) => l.level === 1 && l.label.startsWith('English'))!;
const members = w.roster.clubs().filter((c) => c.league === lg.id);

console.log(`${lg.label}  (${members.length} kulup)`);
console.log('itibar dagilimi:', members.map((c) => c.reputation).sort((a, b) => b - a).join(', '));
console.log('  en yuksek - ikinci fark:', (() => {
  const r = members.map((c) => c.reputation).sort((a, b) => b - a);
  return `${r[0]} - ${r[1]} = ${r[0]! - r[1]!}`;
})());

for (let s = 1; s <= 3; s += 1) {
  for (let wk = 1; wk <= 40; wk += 1) w.advanceWeek(wk, '__none__');
  console.log(`\n--- Sezon ${s} SON TABLO`);
  for (const r of w.league.table(lg.id).slice(0, 6)) {
    const name = w.roster.club(r.clubId)?.name ?? r.clubId;
    console.log(
      `   ${name.padEnd(24)} O${String(r.played).padStart(3)} ` +
        `G${String(r.won).padStart(3)} B${String(r.drawn).padStart(3)} M${String(r.lost).padStart(3)} ` +
        `AV${String(r.goalsFor - r.goalsAgainst).padStart(4)} P${String(r.points).padStart(3)} ` +
        `| guc ${w.league.strength(r.clubId).toFixed(1)}`,
    );
  }
  w.finishSeason();
}
w.close();
