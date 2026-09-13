import { selectWorld } from './src/cli/world.js';
import { GameEngine } from './src/runtime/GameEngine.js';
import { ContentLoader } from './src/loading/ContentLoader.js';
import type { MatchContext, WorldProvider } from './src/domain/roster.js';

function weeklySelectionMatchContext(
  sim: { world: WorldProvider },
  input: { season: number; week: number; clubId: string; availability: any; hero: any }
): MatchContext | undefined {
  const c = sim.world.clubContext(input.clubId);
  if (!c || c.leagueMatches.length === 0) return undefined;
  const matchIndex = input.week % c.leagueMatches.length;
  const match = c.leagueMatches[matchIndex];
  if (!match) return undefined;
  
  return {
    ...match,
    competition: 'league',
    importance: 'normal',
    heroSelection: {
      isStarter: true,
      onBench: false,
      reason: 'As kadro secimi',
    },
  };
}
import { botTurn } from './src/cli/bot.js';
import { Rng } from './src/selection/Rng.js';

import { FileSystemContentSource } from './src/loading/FileSystemContentSource.js';

async function run() {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  const registry = loaded.registry;
  if (!registry) return;
  const seed = 12345;
  const sim = await selectWorld({ registry, seed, dbPath: '' });
  const engine = new GameEngine(registry, {
    seed,
    roster: sim.roster,
    world: sim.world,
    worldFeed: sim.worldFeed,
    selectionMatchContext: ({ season, week, clubId }) =>
      weeklySelectionMatchContext(sim, {
        season,
        week,
        clubId,
        availability: engine.availability(),
        hero: engine.heroProfile(),
      }),
  });
  
  sim.simulator.useChemistrySource((id) => engine.chemistryFor(id));
  const botRng = new Rng(seed);
  engine.start('street');
  
  console.log("Start club:", engine.snapshot().clubId, engine.snapshot().clubTier);
  console.log("Agents:", sim.roster.agents?.().length);
  
  // Set form high
  engine.snapshot().flags['form'] = 90;
  
  for (let week = 1; week <= 200; week++) {
    const out = botTurn(engine, sim.roster, botRng, week);
    if (out.agentSigned) console.log(`Week ${week}: Hired agent`);
    if (out.transferred) {
      console.log(`Week ${week}: Transferred to ${engine.snapshot().clubId} (Tier: ${engine.snapshot().clubTier})`);
    }
    if (out.agentQuit) console.log(`Week ${week}: Agent quit/fired. Current Agent Reach: ${engine.currentAgent()?.profile?.reach}, Stature: ${engine.snapshot().flags['stature']}`);
  }
}

run().catch(console.error);
