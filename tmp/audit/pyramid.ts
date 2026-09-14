import { createDbWorld } from '../../src/adapters/dbWorld.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';

const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
const w = createDbWorld({ dbPath: 'data/world.db', registry: loaded.registry!, seed: 4242 });
const leagues = w.roster.leagues().filter((l) => l.level <= 2);
const label = new Map(leagues.map((l) => [l.id, l.label]));

function sizes(): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of leagues) m.set(l.id, w.league.standings(l.id).length);
  return m;
}
console.log('sezon | ' + leagues.map((l) => label.get(l.id)!.slice(0, 14).padStart(15)).join(''));
for (let s = 1; s <= 12; s += 1) {
  for (let wk = 1; wk <= 40; wk += 1) w.advanceWeek(wk, '__none__');
  const out = w.finishSeason();
  const sz = sizes();
  if (s <= 6 || s % 3 === 0) {
    console.log(String(s).padStart(5) + ' | ' + leagues.map((l) => String(sz.get(l.id) ?? 0).padStart(15)).join(''));
  }
  if (s === 1) {
    console.log('  --- 1. sezon terfi/dusme hedefleri:');
    for (const p of out.promoted.slice(0, 4)) console.log(`      TERFI  ${label.get(p.from) ?? p.from}  ->  ${label.get(p.to) ?? p.to}`);
    for (const r of out.relegated.slice(0, 4)) console.log(`      DUSME  ${label.get(r.from) ?? r.from}  ->  ${label.get(r.to) ?? r.to}`);
  }
}
w.close();
