import { DatabaseSync } from '../../src/adapters/sqlite.js';
import { DbRosterProvider } from '../../src/adapters/DbRosterProvider.js';
import { buildTeam, coachFactor } from '../../src/simulation/TeamModel.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';

const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
const reg = loaded.registry!;
const db = new DatabaseSync('data/world.db', { readOnly: true });
const roster = new DbRosterProvider({ db, names: reg.names, slots: [...reg.slots.values()], seed: 1 });

let over99 = 0, total = 0;
const samples: string[] = [];
const dist: Record<string, number> = {};
for (const c of roster.clubs()) {
  const lines = buildTeam(c.id, c.name, roster.squad(c.id)).lines;
  total += 1;
  const mx = Math.max(lines.keeper, lines.defence, lines.midfield, lines.attack, lines.overall);
  const b = mx > 99 ? '>99' : mx > 90 ? '91-99' : mx > 80 ? '81-90' : mx > 70 ? '71-80' : '<=70';
  dist[b] = (dist[b] ?? 0) + 1;
  if (mx > 99) { over99 += 1; if (samples.length < 5) samples.push(`${c.name}: GK ${lines.keeper} DEF ${lines.defence} MID ${lines.midfield} ATK ${lines.attack} OVR ${lines.overall}`); }
}
console.log(`kulup: ${total}   herhangi bir hatti > 99 olan: ${over99}`);
console.log('en yuksek hat dagilimi:', dist);
for (const s of samples) console.log('   ', s);

// Gercek hocalarla carpan etkisi
console.log('\nGERCEK HOCA ETKISI (ilk 6 kulup, itibara gore):');
const top = [...roster.clubs()].slice(0, 6);
for (const c of top) {
  const mgr = roster.staff(c.id).find((p) => p.role === 'manager');
  const bare = buildTeam(c.id, c.name, roster.squad(c.id)).lines;
  const withC = buildTeam(c.id, c.name, roster.squad(c.id), undefined, undefined,
    mgr?.attributes ? { attributes: mgr.attributes } : undefined).lines;
  const f = mgr?.attributes ? coachFactor(mgr.attributes) : 1;
  console.log(`   ${c.name.padEnd(22)} hocasiz OVR ${String(bare.overall).padStart(3)} -> hocali ${String(withC.overall).padStart(3)}  carpan ${f.toFixed(4)}  (fark ${withC.overall - bare.overall >= 0 ? '+' : ''}${withC.overall - bare.overall})`);
}
db.close();
