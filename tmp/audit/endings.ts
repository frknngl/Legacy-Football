/**
 * ODAKLI OLCUM -- kariyer sonu, veda donemi ve transfer_listed suresi.
 *
 * Ana kosumda `ending` yanlis okunmustu (`ending` bir STRING, nesne degil);
 * bu dosya o olcumu duzeltir ve iki soruyu daha cevaplar:
 *   1. Veda donemi gercekten `retirementEpilogueTurns` kadar mi suruyor?
 *   2. Kariyerin ne kadari `transfer_listed` gecip sahaya cikamiyor?
 */

import { ARCHETYPES, type Archetype } from '../../src/domain/axes.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';
import { GameEngine } from '../../src/runtime/GameEngine.js';
import { Rng } from '../../src/selection/Rng.js';
import { randomOpenChoice, runSimulatedMatch } from '../../src/cli/runMatch.js';
import { selectWorld, weeklySelectionMatchContext } from '../../src/cli/world.js';
import { botTurn } from '../../src/cli/bot.js';

const N = Number(process.argv.find((a) => a.startsWith('--n='))?.split('=')[1] ?? '20');

const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
const registry = loaded.registry!;
console.log(`retirementEpilogueTurns (config) = ${registry.config.turn.retirementEpilogueTurns}`);
console.log(`forcedRetirementAge     (config) = ${registry.config.turn.forcedRetirementAge}`);
console.log(`tanimli son sayisi               = ${registry.config.endings.length}\n`);

const rows: {
  seed: number; turns: number; ending: string | undefined; endAge: number;
  retiredAt: number | undefined; postRetirement: number;
  lifeStateTurns: Record<string, number>;
}[] = [];

for (let i = 0; i < N; i += 1) {
  const seed = 90000 + i * 37;
  const archetype = ARCHETYPES[seed % ARCHETYPES.length] as Archetype;
  const sim = await selectWorld({ registry, seed, dbPath: 'data/world.db' });
  let engine: GameEngine;
  engine = new GameEngine(registry, {
    seed, roster: sim.roster, world: sim.world, worldFeed: sim.worldFeed,
    selectionMatchContext: ({ season, week, clubId }: any) =>
      weeklySelectionMatchContext(sim, {
        season, week, clubId,
        availability: engine.availability(), hero: engine.heroProfile(),
      }),
  });
  sim.simulator.useChemistrySource((id: string) => engine.chemistryFor(id));
  sim.useManagerSource?.((clubId: string) => engine.managerSourceIdFor(clubId));
  const rng = new Rng(seed ^ 0x5f3a);
  const botRng = new Rng(seed ^ 0x2c19);
  engine.start(archetype);

  const lifeStateTurns: Record<string, number> = {};
  let season = 1;
  let turns = 0;

  for (let t = 0; t < 1400; t += 1) {
    if (engine.snapshot().ending !== undefined) break;
    turns += 1;
    const report = engine.advanceTurn();
    const s = engine.snapshot();
    lifeStateTurns[s.lifeState] = (lifeStateTurns[s.lifeState] ?? 0) + 1;

    let guard = 0;
    while (engine.currentNode() && guard < 12) {
      guard += 1;
      const open = engine.availableChoices().filter((c) => !c.locked);
      if (open.length === 0) break;
      engine.choose(open[rng.int(open.length)]!.id);
    }
    if (report.season !== season) {
      season = report.season;
      engine.closeAgentSeason(Number(engine.snapshot().flags['form'] ?? 0) >= 55);
    }
    botTurn(engine, sim.roster, botRng, report.week);

    const st = engine.snapshot();
    const fixtures = sim.schedule.fixturesFor(st.clubId, st.week);
    for (let slot = 0; slot < fixtures.length; slot += 1) {
      await runSimulatedMatch(
        engine, sim.simulator,
        { chooseMoment: (node: any) => randomOpenChoice(node, (max: number) => rng.int(max)) },
        { season: st.season, week: st.week, slot },
      );
    }
  }

  const f = engine.snapshot();
  rows.push({
    seed, turns, ending: f.ending, endAge: f.age,
    retiredAt: f.retiredAtTurn,
    postRetirement: f.retiredAtTurn === undefined ? 0 : f.turn - f.retiredAtTurn,
    lifeStateTurns,
  });
  sim.close?.();
}

const counts: Record<string, number> = {};
for (const r of rows) counts[r.ending ?? 'YOK'] = (counts[r.ending ?? 'YOK'] ?? 0) + 1;
console.log('SON DAGILIMI:', counts);

const post = rows.map((r) => r.postRetirement);
console.log(
  `\nVEDA DONEMI (tur): min ${Math.min(...post)} max ${Math.max(...post)} ` +
    `ort ${(post.reduce((a, b) => a + b, 0) / post.length).toFixed(1)}`,
);

const agg: Record<string, number> = {};
let total = 0;
for (const r of rows) {
  for (const [k, v] of Object.entries(r.lifeStateTurns)) {
    agg[k] = (agg[k] ?? 0) + v;
    total += v;
  }
}
console.log('\nHAYAT DURUMU (tur pay):');
for (const [k, v] of Object.entries(agg).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${k.padEnd(16)} ${String(v).padStart(6)}  ${((100 * v) / total).toFixed(1)}%`);
}
