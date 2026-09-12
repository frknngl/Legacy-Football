import { ContentLoader } from './src/loading/ContentLoader.js';
import { FileSystemContentSource } from './src/loading/FileSystemContentSource.js';
import { GameEngine } from './src/runtime/GameEngine.js';
import { ARCHETYPES } from './src/domain/axes.js';
import { Rng } from './src/selection/Rng.js';
import { selectWorld, weeklySelectionMatchContext } from './src/cli/world.js';
import { runSimulatedMatch, randomOpenChoice } from './src/cli/runMatch.js';
import { botTurn } from './src/cli/bot.js';
import { EligibilityFilter } from './src/selection/EligibilityFilter.js';

async function main() {
  const source = new FileSystemContentSource('content');
  const loader = new ContentLoader(source);
  const result = await loader.load();
  const registry = result.registry!;
  
  const seed = 2000;
  const sim = await selectWorld({ registry, seed });
  
  const engine = new GameEngine(registry, {
    worldFeed: sim.worldFeed,
    selectionMatchContext: ({ season, week, clubId }) =>
      weeklySelectionMatchContext(sim, { season, week, clubId, availability: engine.availability(), hero: engine.heroProfile() })
  });
  
  sim.simulator.useChemistrySource((id) => engine.chemistryFor(id));
  const rng = new Rng(seed);
  const filter = new EligibilityFilter();
  
  engine.start(ARCHETYPES[0]);
  
  let matches = 0;
  let matchesNotAvailable = 0;
  let matchesNoFixture = 0;
  let matchesStarted = 0;
  let matchesSubbed = 0;
  
  for (let i = 0; i < 1000; i++) {
    if (engine.snapshot().ending !== undefined) break;
    
    engine.advanceTurn();
    const week = engine.snapshot().week;
    const season = engine.snapshot().season;
    
    const fixtureCount = sim.schedule.fixturesFor(engine.snapshot().clubId, week).length;
    if (fixtureCount === 0) {
       matchesNoFixture++;
    }
    
    for (let slot = 0; slot < fixtureCount; slot++) {
       const avBefore = engine.availability();
       if (!avBefore.available) {
          matchesNotAvailable++;
       }
       
       const played = await runSimulatedMatch(
         engine, sim.simulator,
         {
           chooseMoment: (node) => randomOpenChoice(node, max => rng.int(max)),
           onResult: (m, res) => {
             if (res.minutes > 0) {
               matches++;
               if (res.minutes === 90) matchesStarted++;
               else matchesSubbed++;
             }
           }
         },
         { season, week, slot }
       );
    }
    
    sim.advanceWeek(week, engine.snapshot().clubId);
  }
  
  console.log(`Total Turns: ${engine.snapshot().turn}`);
  console.log(`Matches Played: ${matches}`);
  console.log(`Matches Started: ${matchesStarted}`);
  console.log(`Matches Subbed: ${matchesSubbed}`);
  console.log(`Matches Not Available: ${matchesNotAvailable}`);
  console.log(`Weeks No Fixture: ${matchesNoFixture}`);
}

main().catch(console.error);
