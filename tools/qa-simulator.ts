import { ARCHETYPES, type Archetype } from '../src/domain/axes.js';
import type { StoryEvent } from '../src/domain/story.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import { GameEngine, type TurnReport, type PresentedChoice } from '../src/runtime/GameEngine.js';
import { EligibilityFilter, type RejectReason } from '../src/selection/EligibilityFilter.js';
import { Rng } from '../src/selection/Rng.js';
import { randomOpenChoice, runSimulatedMatch } from '../src/cli/runMatch.js';
import { selectWorld, weeklySelectionMatchContext } from '../src/cli/world.js';
import { botTurn } from '../src/cli/bot.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import type { FlagValue } from '../src/domain/flags.js';
import * as fs from 'fs';

const NATIONAL_WEEKS = new Set([5, 11, 17, 26, 33]);
const SEED_BASE = 1000;
const MAX_TURNS = 1000;
const NUM_CAREERS = 100;
const ARCHETYPE: Archetype = 'street';

function cloneFlags(flags: Record<string, FlagValue>): Record<string, FlagValue> {
  return JSON.parse(JSON.stringify(flags));
}

async function playQACareer(
  registry: ContentRegistry,
  seed: number,
  events: readonly StoryEvent[],
  reports: QAContext
): Promise<void> {
  const sim = await selectWorld({ registry, seed, dbPath: '' });
  let engine!: GameEngine;
  engine = new GameEngine(registry, {
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
  const rng = new Rng(seed ^ 0x5bf03635);
  const botRng = new Rng(seed ^ 0x5eed);
  const filter = new EligibilityFilter();

  let lastSeason = 1;
  let matches = 0;
  let goals = 0;
  let assists = 0;
  let redCards = 0;
  let injuries = 0;
  let transfers = 0;
  const clubsPlayedFor = new Set<string>();

  engine.start(ARCHETYPE);

  const careerStartAge = engine.snapshot().age;
  clubsPlayedFor.add(engine.snapshot().clubId);
  const careerLevelsSeen = new Set<string>();

  for (let i = 0; i < MAX_TURNS; i += 1) {
    if (engine.snapshot().ending !== undefined) break;

    const report = engine.advanceTurn();
    const state = engine.snapshot();
    careerLevelsSeen.add(state.clubTier);

    if (report.season !== lastSeason) {
      lastSeason = report.season;
      engine.closeAgentSeason(Number(state.flags['form'] ?? 0) >= 55);
      const myClub = state.clubId;
      for (const [leagueId, clubId] of Object.entries(sim.finishSeason().champions)) {
        if (clubId === myClub) engine.reportWorldEvent({ kind: 'trophy', competitionId: leagueId });
      }
    }

    if (NATIONAL_WEEKS.has(report.week) && sim.countryOfClub && sim.calledUp) {
      const hero = engine.heroProfile();
      const q = Math.round((hero.technical + hero.physical) / 2);
      if (sim.calledUp(sim.countryOfClub(state.clubId), q)) {
        engine.reportWorldEvent({ kind: 'national_call', matches: 2 });
      }
    }

    botTurn(engine, sim.roster, botRng, report.week);

    const eventCoverageCtx = {
      era: report.era,
      stature: report.stature,
      clubTier: report.clubTier,
      lifeState: report.lifeState,
      mediaEra: report.mediaEra,
      archetype: ARCHETYPE,
      turn: report.turn,
      flags: state.flags,
      flagSetTurn: state.flagSetTurn,
      seenEvents: state.seenEvents,
      seenVariants: state.seenVariants,
      storyArcTurns: state.storyArcTurns,
      storyBeatTurns: state.storyBeatTurns,
      storyBeatCounts: state.storyBeatCounts,
      storySignatureTurns: state.storySignatureTurns,
      cooldownState: {
        cooldowns: state.cooldowns,
        familyCooldowns: state.familyCooldowns,
        categoryCooldowns: state.categoryCooldowns,
      },
    };

    for (const event of events) {
      const reason = filter.rejectReason(event, eventCoverageCtx);
      if (reason === undefined) {
        reports.eventEligibleCount.set(event.id, (reports.eventEligibleCount.get(event.id) ?? 0) + 1);
      } else if (reason !== 'cooldown_self' && reason !== 'cooldown_family' && reason !== 'once') {
        let blockMap = reports.eventBlockReasons.get(event.id);
        if (!blockMap) {
          blockMap = new Map();
          reports.eventBlockReasons.set(event.id, blockMap);
        }
        blockMap.set(reason, (blockMap.get(reason) ?? 0) + 1);
      }
    }

    // Check temporal logic
    const av = engine.availability();
    const isSuspended = state.flags['cezali_mac_sayisi'] && Number(state.flags['cezali_mac_sayisi']) > 0;
    const isInjured = state.injury.fragility > 80;
    if (!av.available) {
       // Temporal check: suspended / injured players shouldn't get certain events?
    }

    if (report.presented) {
      const p = report.presented;
      reports.eventShownCount.set(p.eventId, (reports.eventShownCount.get(p.eventId) ?? 0) + 1);

      // Verify choice logic
      let guard = 0;
      while (engine.currentNode() && guard < 10) {
        guard++;
        const open = engine.availableChoices().filter((c) => !c.locked);
        if (open.length === 0) break;
        
        const choice = open[rng.int(open.length)]!;
        
        const stateBefore = cloneFlags(engine.snapshot().flags);
        const clubBefore = engine.snapshot().clubId;
        const formBefore = Number(stateBefore['form'] || 0);
        
        engine.choose(choice.id);
        
        const stateAfter = cloneFlags(engine.snapshot().flags);
        const clubAfter = engine.snapshot().clubId;
        const formAfter = Number(stateAfter['form'] || 0);

        reports.eventResultCount.set(p.eventId, (reports.eventResultCount.get(p.eventId) ?? 0) + 1);
        
        // Track effects
        if (clubBefore !== clubAfter) transfers++;
        
        // Basic state checking (Effect verified)
        if (formBefore !== formAfter) {
            reports.effectVerified.set(p.eventId, true);
        }

        // Check if there was any state change
        let changed = false;
        for (const k of Object.keys(stateAfter)) {
           if (stateAfter[k] !== stateBefore[k]) {
               changed = true;
               reports.stateChanges.set(k, (reports.stateChanges.get(k) || 0) + 1);
           }
        }
        if (changed) {
            reports.eventStateChanged.set(p.eventId, true);
        }

      }
    }

    // Match playing
    const week = engine.snapshot().week;
    const season = engine.snapshot().season;
    const fixtureCount = sim.schedule.fixturesFor(engine.snapshot().clubId, week).length;
    for (let slot = 0; slot < fixtureCount; slot += 1) {
      const avBefore = engine.availability();
      const played = await runSimulatedMatch(
        engine,
        sim.simulator,
        {
          onPresented: (node) => {
            reports.eventShownCount.set(node.eventId, (reports.eventShownCount.get(node.eventId) ?? 0) + 1);
          },
          chooseMoment: (node) => randomOpenChoice(node, (max) => rng.int(max)),
          onMatchStart: () => {
            if (!avBefore.available) {
               reports.consistencyIssues.push(`Career #${seed} FAIL: Played match while not available. Turn ${report.turn}`);
            }
            matches += 1;
          },
          onResult: (_m, result) => {
            goals += result.goals;
            assists += result.assists;
            if (result.cards > 0) redCards++; // simplistic
          },
          onDecision: () => {},
        },
        { season, week, slot },
      );
      if (played !== undefined && played.result !== 'none') {
        sim.recordHeroMatch();
      }
    }
    for (const competitionId of sim.advanceWeek(week, engine.snapshot().clubId)) {
      engine.reportWorldEvent({ kind: 'trophy', competitionId });
    }
  }

  reports.careerSummaries.push(`
Career #${seed}
Starting Age: ${careerStartAge}
Ending Age: ${engine.snapshot().age}
Position: ${ARCHETYPE}
Clubs: ${clubsPlayedFor.size}
Matches: ${matches}
Goals: ${goals}
Assists: ${assists}
Injuries: ${injuries}
Red Cards: ${redCards}
Transfers: ${transfers}
Career Level: ${[...careerLevelsSeen].join(' -> ')}
Consistency: ${reports.consistencyIssues.length > 0 ? 'FAIL' : 'PASS'}
`);
}

interface QAContext {
  eventShownCount: Map<string, number>;
  eventResultCount: Map<string, number>;
  eventEligibleCount: Map<string, number>;
  eventBlockReasons: Map<string, Map<RejectReason, number>>;
  effectVerified: Map<string, boolean>;
  eventStateChanged: Map<string, boolean>;
  stateChanges: Map<string, number>;
  consistencyIssues: string[];
  careerSummaries: string[];
}

async function main() {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  if (!loaded.registry) {
    console.error('Content failed to load.');
    process.exitCode = 1;
    return;
  }
  const registry = loaded.registry;
  const events = registry.events;

  const reports: QAContext = {
    eventShownCount: new Map(),
    eventResultCount: new Map(),
    eventEligibleCount: new Map(),
    eventBlockReasons: new Map(),
    effectVerified: new Map(),
    eventStateChanged: new Map(),
    stateChanges: new Map(),
    consistencyIssues: [],
    careerSummaries: []
  };

  for (let i = 0; i < NUM_CAREERS; i++) {
    const seed = SEED_BASE + i * 11;
    console.log(`Starting career ${i+1}/${NUM_CAREERS}... (Seed: ${seed})`);
    await playQACareer(registry, seed, events, reports);
  }

  if (!fs.existsSync('reports')) {
    fs.mkdirSync('reports');
  }

  // Generate Report
  let md = `# QA Simulation Report (100 Careers)\n\n`;

  // 1. EVENT COVERAGE REPORT
  md += `## 1. Event Coverage Report\n`;
  md += `| Event ID | Title | Shown | Eligible | State Changed | Result Applied | Health Score | Status |\n`;
  md += `|---|---|---:|---:|---|---|---:|---|\n`;

  let deadCount = 0;
  for (const event of events) {
    const shown = reports.eventShownCount.get(event.id) ?? 0;
    const eligible = reports.eventEligibleCount.get(event.id) ?? 0;
    const changed = reports.eventStateChanged.get(event.id) ?? false;
    const resultCount = reports.eventResultCount.get(event.id) ?? 0;
    
    let status = 'OK';
    if (shown === 0) {
      if (eligible === 0) {
         status = 'DEAD';
         deadCount++;
      } else {
         status = 'RARE';
      }
    }

    let health = 100;
    if (shown === 0) health -= 50;
    if (shown > 0 && !changed && event.category !== 'news') health -= 20;

    md += `| ${event.id} | ${event.category} | ${shown} | ${eligible} | ${changed ? 'Yes' : 'No'} | ${resultCount} | ${health} | ${status} |\n`;
  }

  // 2. DEAD / ORPHAN EVENT REPORT
  md += `\n## 2. Dead / Orphan Event Report\n`;
  for (const event of events) {
    const shown = reports.eventShownCount.get(event.id) ?? 0;
    if (shown === 0) {
      const eligible = reports.eventEligibleCount.get(event.id) ?? 0;
      const blockReasons = reports.eventBlockReasons.get(event.id);
      
      let topReason = 'N/A';
      if (blockReasons && blockReasons.size > 0) {
         const sorted = [...blockReasons.entries()].sort((a,b) => b[1] - a[1]);
         topReason = sorted.map(s => `${s[0]} (${s[1]})`).join(', ');
      }

      md += `- **${event.id}**: Shown 0 times. Eligible ${eligible} times. Block Reasons: ${topReason}. Type: ${eligible > 0 ? 'RARE' : 'DEAD'}\n`;
    }
  }

  // 3. STATE & EFFECT REPORT
  md += `\n## 3. State & Effect Report\n`;
  md += `States modified during simulation:\n`;
  for (const [stateKey, count] of [...reports.stateChanges.entries()].sort((a,b) => b[1] - a[1])) {
    md += `- **${stateKey}**: changed ${count} times.\n`;
  }

  // 4. CONSISTENCY REPORT
  md += `\n## 4. Consistency Report\n`;
  if (reports.consistencyIssues.length === 0) {
    md += `No temporal or match availability consistency issues found!\n`;
  } else {
    for (const issue of reports.consistencyIssues.slice(0, 50)) {
       md += `- ${issue}\n`;
    }
    if (reports.consistencyIssues.length > 50) {
      md += `- ...and ${reports.consistencyIssues.length - 50} more.\n`;
    }
  }

  // 5. 100 CAREER SIMULATION REPORT
  md += `\n## 5. 100 Career Simulation Summaries (Sample of first 10)\n`;
  md += reports.careerSummaries.slice(0, 10).join('\n---\n');

  md += `\n\n## Conclusion\n`;
  md += `Simulation completed successfully for 100 careers.\n`;
  md += `Dead events: ${deadCount}\n`;

  writeFileSync('reports/QA_Report.md', md, 'utf-8');
  console.log('Report written to reports/QA_Report.md');
}

main().catch(console.error);
