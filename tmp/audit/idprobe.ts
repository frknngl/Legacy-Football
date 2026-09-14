import { createDbWorld } from '../../src/adapters/dbWorld.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';
const reg = (await new ContentLoader(new FileSystemContentSource('content')).load()).registry!;
const w = createDbWorld({ dbPath: 'data/world.db', registry: reg, seed: 1 });
const club = w.roster.clubs()[0]!;
const sq = w.roster.squad(club.id);
console.log('squad id ornekleri:', sq.slice(0, 4).map((p) => `${typeof p.id}:${JSON.stringify(p.id)}`).join(' '));
const deps = (w.market as unknown as { deps: { agencyPowerOf?: (id: never) => number | undefined } }).deps;
console.log('powerOf(p.id) ilk 6:', sq.slice(0, 6).map((p) => String(deps.agencyPowerOf!(p.id as never))).join(' '));
let t: unknown;
outer: for (let s = 0; s < 3; s += 1) { for (let wk = 1; wk <= 40; wk += 1) { w.advanceWeek(wk, '__none__'); const r = w.runTransferWeek(wk); if (r.length) { t = r[0]; break outer; } } w.finishSeason(); }
console.log('transfer kaydi:', JSON.stringify(t));
w.close();
