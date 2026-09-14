/**
 * HERO KULUP DEGISIMI HANGI YOLDAN GELIYOR?
 *
 *   1. HOST   -- botTurn -> reportWorldEvent({kind:'transfer'})
 *   2. ICERIK -- ClubTierEffect -> transferToTier()
 *
 * Duzeltmenin nereye konacagi buna bagli.
 */
import { ARCHETYPES, type Archetype } from '../../src/domain/axes.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';
import { GameEngine } from '../../src/runtime/GameEngine.js';
import { Rng } from '../../src/selection/Rng.js';
import { randomOpenChoice, runSimulatedMatch } from '../../src/cli/runMatch.js';
import { selectWorld, weeklySelectionMatchContext } from '../../src/cli/world.js';
import { botTurn } from '../../src/cli/bot.js';
import { windowAt } from '../../src/domain/transfer.js';

const reg = (await new ContentLoader(new FileSystemContentSource('content')).load()).registry!;
let viaContent = 0, viaHost = 0, inWindow = 0, outWindow = 0;
const perCareer: number[] = [];

for (let i = 0; i < 10; i += 1) {
  const seed = 60000 + i * 41;
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

  let season = 1, mine = 0;
  for (let t = 0; t < 1040; t += 1) {
    if (engine.snapshot().ending !== undefined) break;
    const before = engine.snapshot().clubId;
    const report = engine.advanceTurn();
    let g = 0;
    while (engine.currentNode() && g < 12) {
      g += 1;
      const open = engine.availableChoices().filter((c) => !c.locked);
      if (open.length === 0) break;
      engine.choose(open[rng.int(open.length)]!.id);
    }
    // ICERIK yolu: tur + olay cozumunden sonra kulup degistiyse
    const afterEvents = engine.snapshot().clubId;
    if (afterEvents !== before) {
      viaContent += 1; mine += 1;
      if (windowAt(engine.snapshot().week)) inWindow += 1; else outWindow += 1;
    }

    if (report.season !== season) { season = report.season; engine.closeAgentSeason(true); }
    botTurn(engine, sim.roster, botRng, report.week);
    const afterBot = engine.snapshot().clubId;
    if (afterBot !== afterEvents) {
      viaHost += 1; mine += 1;
      if (windowAt(engine.snapshot().week)) inWindow += 1; else outWindow += 1;
    }

    const st = engine.snapshot();
    for (let slot = 0; slot < sim.schedule.fixturesFor(st.clubId, st.week).length; slot += 1) {
      await runSimulatedMatch(engine, sim.simulator,
        { chooseMoment: (n: any) => randomOpenChoice(n, (m: number) => rng.int(m)) },
        { season: st.season, week: st.week, slot });
    }
  }
  perCareer.push(mine);
  sim.close?.();
}

const tot = viaContent + viaHost;
console.log(`10 kariyer, toplam ${tot} kulup degisimi (kariyer basina ${(tot / 10).toFixed(1)})`);
console.log(`   ICERIK (ClubTierEffect)  : ${viaContent}  %${((100 * viaContent) / tot).toFixed(1)}`);
console.log(`   HOST   (menajer teklifi) : ${viaHost}  %${((100 * viaHost) / tot).toFixed(1)}`);
console.log(`   PENCERE ICINDE : ${inWindow}  %${((100 * inWindow) / tot).toFixed(1)}`);
console.log(`   PENCERE DISINDA: ${outWindow}  %${((100 * outWindow) / tot).toFixed(1)}`);
console.log(`   kariyer basina: ${perCareer.join(' ')}`);
