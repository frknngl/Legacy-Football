/**
 * AJANS KANCASI DENETIMI -- player_agency motora gercekten giriyor mu,
 * girerken piyasayi bozuyor mu?
 */
import { createDbWorld } from '../../src/adapters/dbWorld.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';
import { askingPrice } from '../../src/domain/transfer.js';

const reg = (await new ContentLoader(new FileSystemContentSource('content')).load()).registry!;
const w = createDbWorld({ dbPath: 'data/world.db', registry: reg, seed: 4242 });

const deps = (w.market as unknown as {
  deps: { agencyPowerOf?: (id: number) => number | undefined; players: readonly { id: number; baseValue: number }[] };
}).deps;
const powerOf = deps.agencyPowerOf!;
const valueOf = new Map(deps.players.map((p) => [p.id, p.baseValue]));

// 1. Kapsam -- PIYASANIN kendi havuzu uzerinden (roster.squad farkli bir tip)
let withAgency = 0;
const total = deps.players.length;
const powers: number[] = [];
for (const p of deps.players) {
  const v = powerOf(p.id);
  if (v !== undefined) { withAgency += 1; powers.push(v); }
}
powers.sort((a, b) => a - b);
console.log('=== KAPSAM ===');
console.log(`  sirketi olan oyuncu: ${withAgency}/${total} (%${((100*withAgency)/total).toFixed(1)})`);
console.log(`  pazarlik gucu: min ${powers[0]} ortanca ${powers[Math.floor(powers.length/2)]} max ${powers[powers.length-1]}`);

// 2. Fiyat etkisi -- ayni oyuncu, farkli sirket
console.log('\n=== FIYAT ETKISI (deger 20M) ===');
console.log(`  ${'keepDesire'.padEnd(12)}${'guc 25'.padStart(10)}${'notr'.padStart(10)}${'guc 100'.padStart(10)}${'fark'.padStart(9)}`);
for (const kd of [0, 30, 60, 90]) {
  const lo = askingPrice(20_000_000, kd, false, 25);
  const mid = askingPrice(20_000_000, kd, false);
  const hi = askingPrice(20_000_000, kd, false, 100);
  const f = (n: number) => `${(n/1e6).toFixed(1)}M`;
  console.log(`  ${String(kd).padEnd(12)}${f(lo).padStart(10)}${f(mid).padStart(10)}${f(hi).padStart(10)}${((100*(hi-lo))/mid).toFixed(1).padStart(8)}%`);
}

// 3. Piyasa saglikli mi + sirketli oyuncular daha cok mu tasiniyor
const bands = new Map<string, number[]>();
const bandOf = (pw: number): string => (pw < 60 ? 'zayif <60' : pw < 85 ? 'orta 60-84' : 'guclu 85+');
const band = (pw: number): number[] => {
  const k = bandOf(pw);
  const cur = bands.get(k);
  if (cur) return cur;
  const fresh: number[] = [];
  bands.set(k, fresh);
  return fresh;
};

const SEASONS = 30;
let moves = 0, movesWithAgency = 0;
const feeRatio: number[] = [];
for (let s = 1; s <= SEASONS; s += 1) {
  for (let wk = 1; wk <= 40; wk += 1) {
    w.advanceWeek(wk, '__none__');
    for (const t of w.runTransferWeek(wk)) {
      moves += 1;
      if (powerOf(t.playerId) !== undefined) movesWithAgency += 1;
      const val = valueOf.get(t.playerId);
      const pw = powerOf(t.playerId);
      if (val && val > 0) {
        feeRatio.push(t.fee / val);
        if (pw !== undefined) band(pw).push(t.fee / val);
      }
    }
  }
  w.finishSeason();
}
feeRatio.sort((a, b) => a - b);
console.log(`\n=== ${SEASONS} SEZON PIYASA ===`);
console.log(`  transfer ${moves} (${(moves/SEASONS).toFixed(1)}/sezon)`);
console.log(`  sirketli oyuncu payi: %${((100*movesWithAgency)/moves).toFixed(1)}  (havuzdaki pay %${((100*withAgency)/total).toFixed(1)})`);
console.log(`  bonservis/deger: p10 ${feeRatio[Math.floor(feeRatio.length*0.1)]?.toFixed(2)} ortanca ${feeRatio[Math.floor(feeRatio.length/2)]?.toFixed(2)} p90 ${feeRatio[Math.floor(feeRatio.length*0.9)]?.toFixed(2)}`);
console.log('');
console.log('=== GERCEKLESEN BONSERVIS / DEGER -- AJANS GUCUNE GORE');
for (const k of ['zayif <60', 'orta 60-84', 'guclu 85+']) {
  const v = (bands.get(k) ?? []).slice().sort((a, b) => a - b);
  if (v.length === 0) continue;
  console.log(`  ${k.padEnd(12)} ortanca ${v[Math.floor(v.length/2)]!.toFixed(2)}  ortalama ${(v.reduce((a,b2)=>a+b2,0)/v.length).toFixed(2)}  (${v.length} transfer)`);
}
w.close();
