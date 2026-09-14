/**
 * FAUL VE PENALTI TABANI -- YENI-4 icin olcum.
 *
 * `penaltyChance` "ceza sahasindaki faul penaltiya doner mi" diyor, yani
 * tasarim niyeti faul -> hakem karari. Once faul tabanini olcelim ki
 * penalti oranini uydurmayalim.
 */
import { buildTimeline } from '../../src/simulation/Timeline.js';
import { defaultTactic, tacticProfile } from '../../src/simulation/Tactics.js';
import { Rng } from '../../src/selection/Rng.js';
import type { TeamLines } from '../../src/simulation/TeamModel.js';

const lines = (n: number, agg: number): TeamLines => ({
  keeper: n, defence: n, midfield: n, attack: n, overall: n, aggression: agg,
});
const tactic = tacticProfile(defaultTactic());
const rng = new Rng(4242);

console.log(`${'agresiflik'.padEnd(12)}${'faul/mac'.padStart(10)}${'pozisyon/mac'.padStart(14)}`);
for (const agg of [30, 50, 70, 90]) {
  let fouls = 0, chances = 0;
  const N = 4000;
  for (let i = 0; i < N; i += 1) {
    for (const e of buildTimeline(
      { home: { lines: lines(75, agg), tactic }, away: { lines: lines(75, agg), tactic } },
      rng,
    )) {
      if (e.kind === 'foul') fouls += 1;
      else if (e.kind === 'chance') chances += 1;
    }
  }
  console.log(`${String(agg).padEnd(12)}${(fouls / N).toFixed(2).padStart(10)}${(chances / N).toFixed(1).padStart(14)}`);
}
console.log('\nGERCEK FUTBOL: ~22 faul/mac (hepsi degil, KART-DEGER faul ~4)');
console.log('GERCEK FUTBOL: ~0.25 penalti/mac');
