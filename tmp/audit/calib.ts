/**
 * MAC MODELI KALIBRASYONU -- olcum araci, SALT OKUNUR.
 *
 * `buildTimeline` pozisyon URETIR, `MathChanceResolver` onlari gole cevirir.
 * Bu betik ikisini ayri ayri olcer:
 *   1. Mac basina kac pozisyon uretiliyor
 *   2. Pozisyon basina ortalama xG ne
 * Carpimlari mac basina gol beklentisini verir ve gercek olcumle
 * karsilastirilabilir.
 */

import { buildTimeline } from '../../src/simulation/Timeline.js';
import { MathChanceResolver } from '../../src/simulation/MathChanceResolver.js';
import { defaultTactic, tacticProfile } from '../../src/simulation/Tactics.js';
import { Rng } from '../../src/selection/Rng.js';
import type { TeamLines } from '../../src/simulation/TeamModel.js';
import type { ChanceContext } from '../../src/domain/chance.js';

const lines = (n: number): TeamLines => ({
  keeper: n, defence: n, midfield: n, attack: n, overall: n, aggression: 50,
});

const resolver = new MathChanceResolver();
const tactic = tacticProfile(defaultTactic());

function measure(level: number, samples = 4000): {
  chances: number; meanXg: number; goals: number; homeShare: number;
} {
  const rng = new Rng(12345);
  let homeChances = 0;
  let awayChances = 0;
  let xgSum = 0;
  let n = 0;

  for (let i = 0; i < samples; i += 1) {
    const events = buildTimeline(
      { home: { lines: lines(level), tactic }, away: { lines: lines(level), tactic } },
      rng,
    );
    for (const e of events) {
      if (e.kind !== 'chance') continue;
      if (e.side === 'home') homeChances += 1;
      else awayChances += 1;

      const context: ChanceContext = {
        kind: e.chanceKind ?? 'open_play',
        minute: e.minute,
        scoreline: '0-0',
        distance: e.distance ?? 12,
        angle: e.angle ?? 40,
        pressure: e.pressure ?? 50,
        keeperQuality: level,
        // Tipik bir sutor: hat seviyesine yakin.
        shooter: { shooting: level, composure: level, isHero: false },
      };
      xgSum += resolver.expectedGoals(context);
      n += 1;
    }
  }

  const chances = (homeChances + awayChances) / samples;
  const meanXg = xgSum / n;
  return {
    chances,
    meanXg,
    goals: chances * meanXg,
    homeShare: homeChances / (homeChances + awayChances),
  };
}

console.log('=== MAC MODELI: POZISYON x DONUSUM ===');
console.log('  (denk takimlar, varsayilan taktik)\n');
console.log(`  ${'seviye'.padEnd(8)}${'pozisyon/mac'.padStart(14)}${'ort xG'.padStart(10)}${'gol/mac'.padStart(10)}${'ev payi'.padStart(10)}`);
for (const level of [60, 70, 80, 90]) {
  const r = measure(level);
  console.log(
    `  ${String(level).padEnd(8)}${r.chances.toFixed(1).padStart(14)}` +
      `${r.meanXg.toFixed(4).padStart(10)}${r.goals.toFixed(2).padStart(10)}` +
      `${(100 * r.homeShare).toFixed(1).padStart(9)}%`,
  );
}

console.log('\n  HEDEF (gercek futbol): ~24 pozisyon/mac · ~0.11 xG · ~2.7 gol/mac');

// Tur bazinda xG dokumu -- hangi pozisyon turu ne kadar kaybediyor
console.log('\n=== TUR BAZINDA ORTALAMA xG (seviye 75) ===');
const rng = new Rng(999);
const byKind = new Map<string, { n: number; xg: number; base: number }>();
const BASE: Record<string, number> = {
  penalty: 0.76, one_on_one: 0.35, rebound: 0.3, header: 0.12,
  open_play: 0.11, free_kick: 0.07, long_range: 0.04,
};
for (let i = 0; i < 3000; i += 1) {
  const events = buildTimeline(
    { home: { lines: lines(75), tactic }, away: { lines: lines(75), tactic } },
    rng,
  );
  for (const e of events) {
    if (e.kind !== 'chance') continue;
    const kind = e.chanceKind ?? 'open_play';
    const xg = resolver.expectedGoals({
      kind, minute: e.minute, scoreline: '0-0',
      distance: e.distance ?? 12, angle: e.angle ?? 40, pressure: e.pressure ?? 50,
      keeperQuality: 75,
      shooter: { shooting: 75, composure: 75, isHero: false },
    });
    const slot = byKind.get(kind) ?? { n: 0, xg: 0, base: BASE[kind] ?? 0.1 };
    slot.n += 1;
    slot.xg += xg;
    byKind.set(kind, slot);
  }
}
console.log(`  ${'tur'.padEnd(12)}${'pay'.padStart(7)}${'taban xG'.padStart(10)}${'gercek xG'.padStart(11)}${'carpan'.padStart(9)}`);
const total = [...byKind.values()].reduce((s, v) => s + v.n, 0);
for (const [kind, v] of [...byKind].sort((a, b) => b[1].n - a[1].n)) {
  const mean = v.xg / v.n;
  console.log(
    `  ${kind.padEnd(12)}${((100 * v.n) / total).toFixed(0).padStart(6)}%` +
      `${v.base.toFixed(3).padStart(10)}${mean.toFixed(4).padStart(11)}` +
      `${(mean / v.base).toFixed(3).padStart(9)}`,
  );
}
