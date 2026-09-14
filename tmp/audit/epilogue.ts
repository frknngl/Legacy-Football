import { ARCHETYPES, type Archetype } from '../../src/domain/axes.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';
import { GameEngine } from '../../src/runtime/GameEngine.js';
import { Rng } from '../../src/selection/Rng.js';
import { selectWorld, weeklySelectionMatchContext } from '../../src/cli/world.js';
import { randomOpenChoice, runSimulatedMatch } from '../../src/cli/runMatch.js';
import { botTurn } from '../../src/cli/bot.js';

const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
const registry = loaded.registry!;
for (let i = 0; i < 5; i += 1) {
  const seed = 90000 + i * 37;
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
  const botRng = new Rng(seed ^ 0x2c19);
  let season = 1;
  const rng = new Rng(seed ^ 0x5f3a);
  engine.start(ARCHETYPES[seed % ARCHETYPES.length] as Archetype);
  let firstRetiredTurn: number | undefined;
  let firstRetiredAge: number | undefined;
  for (let t = 0; t < 1400; t += 1) {
    if (engine.snapshot().ending !== undefined) break;
    const report = engine.advanceTurn();
    const s = engine.snapshot();
    if (firstRetiredTurn === undefined && s.retiredAtTurn !== undefined) {
      firstRetiredTurn = s.retiredAtTurn; firstRetiredAge = s.age;
    }
    let g = 0;
    while (engine.currentNode() && g < 12) {
      g += 1;
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
  console.log(
    `seed=${seed} retiredAtTurn=${firstRetiredTurn} (yas ${firstRetiredAge}) ` +
      `bitisTur=${f.turn} fark=${firstRetiredTurn ? f.turn - firstRetiredTurn : '-'} ` +
      `ending=${f.ending} sonYas=${f.age} retiredFlag=${f.flags['retired']}`,
  );
  sim.close?.();
}
