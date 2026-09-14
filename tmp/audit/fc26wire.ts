import { DatabaseSync } from '../../src/adapters/sqlite.js';
import { DbRosterProvider } from '../../src/adapters/DbRosterProvider.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';

const reg = (await new ContentLoader(new FileSystemContentSource('content')).load()).registry!;
const db = new DatabaseSync('data/world.db', { readOnly: true });
const roster = new DbRosterProvider({ db, names: reg.names, slots: [...reg.slots.values()], seed: 1 });

const club = roster.clubs()[0]!;
const squad = roster.squad(club.id);
const rows = db.prepare(
  `SELECT id, first_masked, last_masked, aggression, composure, intl_reputation, shirt_number
   FROM player WHERE club_id = ? ORDER BY id LIMIT 200`,
).all(Number(club.id)) as any[];
const byId = new Map(rows.map((r) => [`db:${club.id}:p${r.id}`, r]));

console.log(`${club.name} -- DB degeri vs MOTORA ULASAN deger\n`);
console.log('oyuncu                 | DB agg  motor agg | DB comp  motor comp | DB no  motor no');
let ok = 0, total = 0;
for (const p of squad.slice(0, 8)) {
  const r = byId.get(p.sourceId);
  if (!r) continue;
  total += 1;
  const match = r.aggression === p.aggression && r.composure === p.composure && r.shirt_number === p.shirtNumber;
  if (match) ok += 1;
  console.log(
    `${p.displayName.padEnd(22)} | ${String(r.aggression).padStart(6)} ${String(p.aggression).padStart(9)} ` +
      `| ${String(r.composure).padStart(7)} ${String(p.composure).padStart(11)} ` +
      `| ${String(r.shirt_number).padStart(5)} ${String(p.shirtNumber).padStart(8)}  ${match ? 'OK' : 'FARKLI'}`,
  );
}

// Tum kadroda dogrulama
let agg = 0, comp = 0, shirt = 0, n = 0;
for (const p of squad) {
  const r = byId.get(p.sourceId);
  if (!r) continue;
  n += 1;
  if (r.aggression === p.aggression) agg += 1;
  if (r.composure === p.composure) comp += 1;
  if (r.shirt_number === p.shirtNumber) shirt += 1;
}
console.log(`\ntum kadro (${n} oyuncu): aggression ${agg}/${n} · composure ${comp}/${n} · forma no ${shirt}/${n}`);

// Sertligin eski tahminle FARKLI oldugunu goster
const positional: Record<string, number> = { DF: 62, MF: 52, FW: 44, GK: 36 };
const drift = squad.filter((p) => byId.has(p.sourceId))
  .map((p) => Math.abs(p.aggression - (positional[p.position] ?? 50)));
console.log(`mevki tahmininden ortalama sapma: ${(drift.reduce((a, b) => a + b, 0) / drift.length).toFixed(1)} puan`);
db.close();
