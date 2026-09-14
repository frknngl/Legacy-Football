/**
 * GEC SEZONLARDA MAC GERCEKTEN OYNANIYOR MU?
 *
 * `world.ts` tabloyu dongu bittikten SONRA basiyor; finishSeason tabloyu
 * sifirladigi icin '0 mac' gorunuyor. Bu betik tabloyu sifirlanmadan ONCE
 * okur ve 21 LIGIN HEPSINI sayar -- eski #11 hatasinin (2. sezondan
 * itibaren hic mac yok) geri gelip gelmedigini kesin olarak soyler.
 */
import { createDbWorld } from '../../src/adapters/dbWorld.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';

const reg = (await new ContentLoader(new FileSystemContentSource('content')).load()).registry!;
const w = createDbWorld({ dbPath: 'data/world.db', registry: reg, seed: 4242 });
const leagues = w.roster.leagues();
const WATCH = [1, 2, 3, 25, 50, 100];
const champs = new Map<string, Set<string>>();

for (let season = 1; season <= 100; season += 1) {
  for (let wk = 1; wk <= 40; wk += 1) {
    w.advanceWeek(wk, '__none__');
    w.runTransferWeek(wk);
  }

  // SIFIRLANMADAN ONCE oku.
  if (WATCH.includes(season)) {
    let played = 0, empty = 0;
    for (const l of leagues) {
      const t = w.league.standings(l.id);
      const games = t.reduce((s, r) => s + r.played, 0);
      if (games === 0) empty += 1;
      played += games;
    }
    const first = w.league.standings(leagues[0]!.id)[0];
    console.log(
      `sezon ${String(season).padStart(3)}: 21 ligde toplam ${String(played).padStart(5)} mac-katilimi` +
        ` · MACSIZ lig ${empty}/21 · lider ${first?.points ?? 0} puan / ${first?.played ?? 0} mac`,
    );
  }
  for (const l of leagues) {
    const top = w.league.standings(l.id)[0];
    if (top) (champs.get(l.id) ?? champs.set(l.id, new Set()).get(l.id)!).add(top.clubId);
  }
  w.finishSeason();
}

console.log('\n--- 100 SEZONDA FARKLI SAMPIYON SAYISI (21 ligin HEPSI)');
const rows = [...champs].map(([id, s]) => ({ id, n: s.size }));
rows.sort((a, b) => a.n - b.n);
for (const r of rows) console.log(`   ${r.id.padEnd(28)} ${r.n}`);
console.log(`   TEK sampiyonlu lig: ${rows.filter((r) => r.n === 1).length}/21`);
w.close();
