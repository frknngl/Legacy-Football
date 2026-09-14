/**
 * MAC ANLARI GERCEKTEN CIKIYOR MU?
 *
 * careers.ts'in olay defteri yalnizca TUR olaylarini yaziyor; mac anlari
 * `runSimulatedMatch` icinde akiyor ve deftere girmiyor. Bu yuzden '21 mac
 * ani hic cikmadi' sonucu tek basina kanit degil. Burada `chooseMoment`
 * dogrudan sayilir.
 */
import { ARCHETYPES, type Archetype } from '../../src/domain/axes.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';
import { GameEngine } from '../../src/runtime/GameEngine.js';
import { Rng } from '../../src/selection/Rng.js';
import { randomOpenChoice, runSimulatedMatch } from '../../src/cli/runMatch.js';
import { selectWorld, weeklySelectionMatchContext } from '../../src/cli/world.js';
import { botTurn } from '../../src/cli/bot.js';

const reg = (await new ContentLoader(new FileSystemContentSource('content')).load()).registry!;
const byEvent = new Map<string, number>();
let momentCalls = 0;
let matches = 0;

for (let i = 0; i < 8; i += 1) {
  const seed = 70000 + i * 53;
  const sim = await selectWorld({ registry: reg, seed, dbPath: 'data/world.db' });
  let engine: GameEngine;
  engine = new GameEngine(reg, {
    seed, roster: sim.roster, world: sim.world, worldFeed: sim.worldFeed,
    selectionMatchContext: ({ season, week, clubId }: any) =>
      weeklySelectionMatchContext(sim, { season, week, clubId, availability: engine.availability(), hero: engine.heroProfile() }),
  });
  sim.simulator.useChemistrySource((id: string) => engine.chemistryFor(id));
  sim.useManagerSource?.((clubId: string) => engine.managerSourceIdFor(clubId));
  const rng = new Rng(seed ^ 0x5f3a);
  const botRng = new Rng(seed ^ 0x2c19);
  engine.start(ARCHETYPES[seed % ARCHETYPES.length] as Archetype);

  let season = 1;
  for (let t = 0; t < 1040; t += 1) {
    if (engine.snapshot().ending !== undefined) break;
    const report = engine.advanceTurn();
    let g = 0;
    while (engine.currentNode() && g < 12) {
      g += 1;
      const open = engine.availableChoices().filter((c) => !c.locked);
      if (open.length === 0) break;
      engine.choose(open[rng.int(open.length)]!.id);
    }
    if (report.season !== season) { season = report.season; engine.closeAgentSeason(true); }
    botTurn(engine, sim.roster, botRng, report.week);
    const st = engine.snapshot();
    for (let slot = 0; slot < sim.schedule.fixturesFor(st.clubId, st.week).length; slot += 1) {
      matches += 1;
      await runSimulatedMatch(
        engine,
        sim.simulator,
        {
          chooseMoment: (n: any) => {
            momentCalls += 1;
            const id = String(n?.eventId ?? n?.id ?? 'bilinmeyen');
            byEvent.set(id, (byEvent.get(id) ?? 0) + 1);
            return randomOpenChoice(n, (m: number) => rng.int(m));
          },
        },
        { season: st.season, week: st.week, slot },
      );
    }
  }
  sim.close?.();
}

console.log(`8 kariyer · ${matches} mac`);
console.log(`chooseMoment cagrisi: ${momentCalls}  (mac basina ${(momentCalls / matches).toFixed(3)})`);
console.log(`farkli mac ani olayi : ${byEvent.size}`);
for (const [k, v] of [...byEvent].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(36)}${v}`);
