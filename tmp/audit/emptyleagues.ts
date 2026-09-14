import { createDbWorld } from '../../src/adapters/dbWorld.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';
const reg = (await new ContentLoader(new FileSystemContentSource('content')).load()).registry!;
const w = createDbWorld({ dbPath: 'data/world.db', registry: reg, seed: 4242 });
for (let wk = 1; wk <= 40; wk += 1) { w.advanceWeek(wk, '__none__'); }
console.log(`${'lig'.padEnd(10)}${'etiket'.padEnd(26)}${'ulke'.padEnd(10)}${'sev'.padStart(4)}${'kulup'.padStart(7)}${'mac'.padStart(7)}`);
for (const l of w.roster.leagues()) {
  const t = w.league.standings(l.id);
  const games = t.reduce((s, r) => s + r.played, 0);
  console.log(
    `${l.id.padEnd(10)}${l.label.padEnd(26)}${(l.country ?? '-').padEnd(10)}` +
      `${String(l.level).padStart(4)}${String(t.length).padStart(7)}${String(games).padStart(7)}${games === 0 ? '   <-- MACSIZ' : ''}`,
  );
}
w.close();
