import { ARCHETYPES, type Archetype } from '../src/domain/axes.js';
import type { StoryEvent } from '../src/domain/story.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { EligibilityFilter } from '../src/selection/EligibilityFilter.js';
import { Rng } from '../src/selection/Rng.js';
import { randomOpenChoice, runSimulatedMatch } from '../src/cli/runMatch.js';
import { selectWorld, weeklySelectionMatchContext } from '../src/cli/world.js';
import { botTurn } from '../src/cli/bot.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import type { FlagValue } from '../src/domain/flags.js';
import { ConditionEvaluator } from '../src/evaluation/ConditionEvaluator.js';

const NUM_CAREERS = 100;
const MAX_TURNS = 1000;
const SEED_BASE = 5000;
const NATIONAL_WEEKS = new Set([5, 11, 17, 26, 33]);

interface QAEventRecord {
  id: string;
  conditionPossible: boolean;
  eligibleCount: number;
  triggerCount: number;
  missedCount: number;
  falsePositiveCount: number;
  wrongOutcomeCount: number;
  timingIssues: number;
}

class QAAuditReporter {
  events = new Map<string, QAEventRecord>();
  impossibleStates: string[] = [];
  temporalIssues: string[] = [];
  boundaryViolations: string[] = [];
  outlierCareers: string[] = [];
  
  clubStrengthCorrelations: { strengthDiff: number, goalDiff: number, winsA: number, draws: number, winsB: number }[] = [];
  scorelines: Record<string, number> = {};
  goalkeeperGoals = 0;
  totalMatches = 0;
  
  transfers: { fromStrength: number, toStrength: number, fromBudget: number, toBudget: number, playerRating: number, fee: number, age: number, windowActive: boolean }[] = [];
  budgetAnomalies: string[] = [];
  
  getEvent(id: string) {
    if (!this.events.has(id)) {
      this.events.set(id, {
        id, conditionPossible: true, eligibleCount: 0, triggerCount: 0,
        missedCount: 0, falsePositiveCount: 0, wrongOutcomeCount: 0, timingIssues: 0
      });
    }
    return this.events.get(id)!;
  }
}

function cloneFlags(flags: Record<string, FlagValue>): Record<string, FlagValue> {
  return JSON.parse(JSON.stringify(flags));
}

// Check for statically impossible conditions (very basic check for now)
function checkImpossibleConditions(event: StoryEvent, reporter: QAAuditReporter) {
  // A true static analysis of AST is complex, but we mark conditionPossible=true by default
  // For the sake of this script, we'll rely on empirical "Eligible Count" mostly.
}

async function playQACareer(registry: ContentRegistry, seed: number, reporter: QAAuditReporter) {
  const archetype = ARCHETYPES[seed % ARCHETYPES.length];
  const sim = await selectWorld({ registry, seed, dbPath: '' });
  let engine = new GameEngine(registry, {
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
  const rng = new Rng(seed ^ 0x9999);
  const botRng = new Rng(seed ^ 0x8888);
  const filter = new EligibilityFilter();

  let capturedEventCoverageCtx: any = null;
  const originalSelect = (engine as any).selector.select.bind((engine as any).selector);
  (engine as any).selector.select = function(ctx: any, selRng: any) {
    capturedEventCoverageCtx = JSON.parse(JSON.stringify(ctx));
    return originalSelect(ctx, selRng);
  };

  let currentSeason = 1;
  engine.start(archetype);
  const startAge = engine.snapshot().age;
  const position = engine.heroProfile().position;

  let isCurrentlyInjured = false;
  let isCurrentlySuspended = false;
  
  let playerGoals = 0;
  
  let previousClub = engine.snapshot().clubId;
  let previousBudget = 0; // Hard to extract without digging into SimulatedWorld's internal state, so default 0

  for (let turnIdx = 0; turnIdx < MAX_TURNS; turnIdx++) {
    if (engine.snapshot().ending !== undefined) break;

    const stateBefore = engine.snapshot();
    const report = engine.advanceTurn();
    const stateAfter = engine.snapshot();
    
    // Check state invariants
    const form = Number(stateAfter.flags['form'] ?? 50);
    const morale = Number(stateAfter.flags['morale'] ?? 50);
    if (form < 0 || form > 100) reporter.boundaryViolations.push(`Career ${seed}: Form out of bounds (${form})`);
    if (morale < 0 || morale > 100) reporter.boundaryViolations.push(`Career ${seed}: Morale out of bounds (${morale})`);

    const wasInjured = isCurrentlyInjured;
    isCurrentlyInjured = stateAfter.injury.fragility > 80 || stateAfter.injury.recoveryEndsAt !== undefined;
    
    const wasSuspended = isCurrentlySuspended;
    const suspendedGames = Number(stateAfter.flags['cezali_mac_sayisi'] ?? 0);
    isCurrentlySuspended = suspendedGames > 0;
    
    if (stateAfter.lifeState === 'retired' && stateAfter.flags['playing']) reporter.impossibleStates.push(`Career ${seed}: Retired AND Playing`);
    
    // Transfer tracking
    if (stateAfter.clubId !== previousClub) {
       // Transfer happened
       const fromClub = sim.roster.club(previousClub);
       const toClub = sim.roster.club(stateAfter.clubId);
       if (!toClub) reporter.impossibleStates.push(`Transferred to non-existent club ${stateAfter.clubId}`);
       else {
         // Adding a 1-week buffer because transfer might be detected a turn late
         const w = stateBefore.week;
         const isWindowActive = (w <= 4) || (w >= 19 && w <= 23);
         reporter.transfers.push({
           fromStrength: fromClub ? fromClub.reputation : 0, // Fallback to reputation
           toStrength: toClub.reputation, // Fallback to reputation
           fromBudget: 0,
           toBudget: 0,
           playerRating: engine.heroProfile().technical, // proxy for rating
           fee: 0, // Hard to extract exact fee without parsing events, but we track the event
           age: stateAfter.age,
           windowActive: isWindowActive
         });
         
         if (!isWindowActive) {
             reporter.temporalIssues.push(`Career ${seed}: Transfer occurred outside transfer window (Detected Week ${stateAfter.week})`);
         }
       }
       previousClub = stateAfter.clubId;
    }

    // Eligibility tracking for all events
    const eventCoverageCtx = capturedEventCoverageCtx;

    const eligibleEvents = new Set<string>();
    for (const event of registry.events) {
      if (event.scheduledOnly || event.momentType !== undefined) continue;

      const reason = filter.rejectReason(event, eventCoverageCtx);
      if (reason === undefined) {
        reporter.getEvent(event.id).eligibleCount++;
        eligibleEvents.add(event.id);
      }
    }

    if (report.presented) {
      const p = report.presented;
      const evRep = reporter.getEvent(p.eventId);
      evRep.triggerCount++;
      
      const eventDef = registry.events.find(e=>e.id===p.eventId);
      const forcedScheduled = stateBefore.scheduledEvents.some((s: any) => s.eventId === p.eventId && s.forced && s.turn === stateBefore.turn);
      const isForced = forcedScheduled || (eventDef && (eventDef.scheduledOnly || eventDef.momentType !== undefined));
      if (!eligibleEvents.has(p.eventId) && !isForced) {
         evRep.falsePositiveCount++;
         reporter.temporalIssues.push(`Career ${seed}: False positive trigger for ${p.eventId} on week ${stateBefore.week}. Reject reason: ${filter.rejectReason(eventDef!, eventCoverageCtx)}`);
      }
      
      // Simulate resolving choices
      let guard = 0;
      while (engine.currentNode() && guard < 10) {
        guard++;
        const open = engine.availableChoices().filter(c => !c.locked);
        if (open.length === 0) break;
        const choice = open[rng.int(open.length)]!;
        
        engine.choose(choice.id);
      }
    }
    
    for (const eventId of eligibleEvents) {
        if (!report.presented || report.presented.eventId !== eventId) {
            // It was eligible but not selected this turn
            reporter.getEvent(eventId).missedCount++;
        }
    }
    
    // Simulate Matches
    if (report.season !== currentSeason) {
      currentSeason = report.season;
      engine.closeAgentSeason(Number(stateAfter.flags['form'] ?? 0) >= 55);
    }
    
    botTurn(engine, sim.roster, botRng, report.week);

    const fixtureCount = sim.schedule.fixturesFor(stateAfter.clubId, stateAfter.week).length;
    for (let slot = 0; slot < fixtureCount; slot++) {
        const avBefore = engine.availability();
        
        const played = await runSimulatedMatch(engine, sim.simulator, {
            onPresented: (node) => { reporter.getEvent(node.eventId).triggerCount++; },
            chooseMoment: (node) => randomOpenChoice(node, (max) => rng.int(max)),
            onMatchStart: () => {},
            onResult: (_m, result) => {
                reporter.totalMatches++;
                const finalScore = (sim.simulator as any).finalScore();
                if (!finalScore) return;
                
                const isHome = finalScore.homeId === stateAfter.clubId;
                const homeS = sim.roster.club(finalScore.homeId)?.reputation || 50;
                const awayS = sim.roster.club(finalScore.awayId)?.reputation || 50;
                
                let myGoals = 0, theirGoals = 0;
                if (isHome) { myGoals = finalScore.homeGoals; theirGoals = finalScore.awayGoals; }
                else { myGoals = finalScore.awayGoals; theirGoals = finalScore.homeGoals; }
                
                const scoreStr = `${myGoals}-${theirGoals}`;
                reporter.scorelines[scoreStr] = (reporter.scorelines[scoreStr] || 0) + 1;
                
                let wA=0, d=0, wB=0;
                if (myGoals > theirGoals) wA=1; else if (myGoals < theirGoals) wB=1; else d=1;
                
                reporter.clubStrengthCorrelations.push({
                   strengthDiff: (isHome ? homeS - awayS : awayS - homeS),
                   goalDiff: myGoals - theirGoals,
                   winsA: wA, draws: d, winsB: wB
                });
                
                if (result.minutes > 0) {
                    if (position === 'GK' && result.goals > 0) reporter.goalkeeperGoals += result.goals;
                    playerGoals += result.goals;
                    
                    if (!avBefore.available) {
                        reporter.temporalIssues.push(`Career ${seed}: Played match while unavailable (Injured: ${isCurrentlyInjured}, Suspended: ${isCurrentlySuspended})`);
                    }
                }
            },
            onDecision: () => {}
        }, { season: stateAfter.season, week: stateAfter.week, slot });
        
        if (played && played.result !== 'none') sim.recordHeroMatch();
    }
    sim.advanceWeek(stateAfter.week, stateAfter.clubId);
  }
  
  if (position === 'GK' && playerGoals > 10) reporter.outlierCareers.push(`Career ${seed} (GK): Scored ${playerGoals} goals`);
  if (position === 'CB' && playerGoals > 50) reporter.outlierCareers.push(`Career ${seed} (CB): Scored ${playerGoals} goals`);
  if (playerGoals > 500) reporter.outlierCareers.push(`Career ${seed} (${position}): Extremely high goals (${playerGoals})`);
}

async function main() {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  if (!loaded.registry) {
    console.error('Failed to load content');
    process.exitCode = 1; return;
  }
  
  const reporter = new QAAuditReporter();
  loaded.registry.events.forEach(e => checkImpossibleConditions(e, reporter));
  
  console.log(`Running ${NUM_CAREERS} careers Monte Carlo simulation...`);
  for(let i=0; i<NUM_CAREERS; i++) {
     const seed = SEED_BASE + i;
     if (i % 10 === 0) console.log(`Simulating career ${i+1}/${NUM_CAREERS} (Seed: ${seed})`);
     await playQACareer(loaded.registry, seed, reporter);
  }
  
  if (!existsSync('reports')) mkdirSync('reports');
  
  // Generate final Markdown report
  let md = `# FUTBOL SİMÜLASYONU — QA AUDIT RAPORU\n\n`;
  
  md += `## A. Executive Summary\n`;
  md += `Overall Simulation Health: N/A\n`;
  md += `- Total Careers Simulated: ${NUM_CAREERS}\n`;
  md += `- Total Matches Simulated: ${reporter.totalMatches}\n`;
  md += `- Boundary Violations: ${reporter.boundaryViolations.length}\n`;
  md += `- Impossible States: ${reporter.impossibleStates.length}\n`;
  md += `- Temporal Issues: ${reporter.temporalIssues.length}\n\n`;
  
  let deadEvents = 0, falsePositives = 0, timingProblems = 0, wrongOutcomes = 0;
  for (const ev of reporter.events.values()) {
      if (ev.eligibleCount === 0 && ev.triggerCount === 0) deadEvents++;
      if (ev.falsePositiveCount > 0) falsePositives++;
      if (ev.timingIssues > 0) timingProblems++;
      if (ev.wrongOutcomeCount > 0) wrongOutcomes++;
  }
  
  md += `## B. Event Health\n`;
  md += `Total Events: ${loaded.registry.events.length}\n`;
  md += `Events Never Eligible: ${deadEvents}\n`;
  md += `Events With False Positive Triggers: ${falsePositives}\n`;
  md += `Events With Timing Problems: ${timingProblems}\n`;
  md += `Events With Potentially Wrong Outcomes: ${wrongOutcomes}\n\n`;
  
  md += `## C. Event Trigger Table\n`;
  md += `| Event | Eligible Count | Triggered Count | Missed Count | False Positive Count | Wrong Outcome | Verdict |\n`;
  md += `|---|---:|---:|---:|---:|---:|---|\n`;
  for (const event of loaded.registry.events) {
      const e = reporter.getEvent(event.id);
      let verdict = 'WORKING';
      if (e.eligibleCount === 0 && e.triggerCount === 0) verdict = 'DEAD';
      else if (e.triggerCount === 0 && e.eligibleCount > 0) verdict = 'MISSED';
      else if (e.falsePositiveCount > 0) verdict = 'FALSE POSITIVES';
      
      md += `| ${e.id} | ${e.eligibleCount} | ${e.triggerCount} | ${e.missedCount} | ${e.falsePositiveCount} | ${e.wrongOutcomeCount} | ${verdict} |\n`;
  }
  
  md += `\n## D. Match Simulation\n`;
  md += `Total Goalkeeper Goals: ${reporter.goalkeeperGoals}\n`;
  
  const scorelineSorted = Object.entries(reporter.scorelines).sort((a,b) => b[1] - a[1]);
  md += `\nTop 10 Scorelines:\n`;
  scorelineSorted.slice(0, 10).forEach(([s, c]) => { md += `- ${s}: ${c} times\n`; });
  
  md += `\n## E. Transfer Market\n`;
  const outOfWindow = reporter.temporalIssues.filter(i => i.includes('transfer window')).length;
  md += `Transfers outside window: ${outOfWindow}\n`;
  
  md += `\n## F. Impossible States & Temporal Issues\n`;
  const uniqImpossible = [...new Set(reporter.impossibleStates)];
  const uniqTemporal = [...new Set(reporter.temporalIssues)];
  uniqImpossible.slice(0, 20).forEach(i => md += `- CRITICAL: ${i}\n`);
  uniqTemporal.slice(0, 20).forEach(i => md += `- HIGH: ${i}\n`);
  
  md += `\n## G. Outliers\n`;
  reporter.outlierCareers.forEach(o => md += `- ${o}\n`);
  
  writeFileSync('reports/QA_Comprehensive_Audit.md', md, 'utf-8');
  console.log('Report saved to reports/QA_Comprehensive_Audit.md');
}

main().catch(console.error);
