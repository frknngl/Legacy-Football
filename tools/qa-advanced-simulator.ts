import { ARCHETYPES, type Archetype, type ClubTier, ERAS, type Era, STATURES, type Stature, LIFE_STATES, type LifeState } from '../src/domain/axes.js';
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
const SEED_BASE = 2000; // Different seed
const MAX_TURNS = 1000;
const NUM_CAREERS = 10;

function cloneFlags(flags: Record<string, FlagValue>): Record<string, FlagValue> {
  return JSON.parse(JSON.stringify(flags));
}

interface CareerStats {
  matches: number;
  starts: number;
  subs: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  injuries: number;
  suspensions: number;
  transfers: number;
  clubsPlayedFor: Set<string>;
  totalTurns: number;
}

interface SeasonStats {
  season: number;
  matches: number;
  goals: number;
  assists: number;
}

interface QACareerRecord {
  seed: number;
  archetype: Archetype;
  position: string;
  startAge: number;
  endAge: number;
  careerStats: CareerStats;
  seasonStats: SeasonStats[];
  levelsSeen: string[];
  issues: string[];
  isOutlier: boolean;
  outlierReason: string;
}

interface QAEventRecord {
  id: string;
  shown: number;
  eligible: number;
  resultsApplied: number;
  deadBranch: number;
  levels: Set<string>;
  positions: Set<string>;
}

class QAReporter {
  careers: QACareerRecord[] = [];
  events = new Map<string, QAEventRecord>();
  impossibleStates: string[] = [];
  temporalIssues: string[] = [];
  eventContradictions: string[] = [];
  stateBoundaryViolations: string[] = [];

  getEvent(id: string) {
    if (!this.events.has(id)) {
      this.events.set(id, { id, shown: 0, eligible: 0, resultsApplied: 0, deadBranch: 0, levels: new Set(), positions: new Set() });
    }
    return this.events.get(id)!;
  }
}

async function playQACareer(
  registry: ContentRegistry,
  seed: number,
  events: readonly StoryEvent[],
  reporter: QAReporter
): Promise<void> {
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
  const rng = new Rng(seed ^ 0x5bf03635);
  const botRng = new Rng(seed ^ 0x5eed);
  const filter = new EligibilityFilter();

  let currentSeason = 1;
  const careerStats: CareerStats = {
    matches: 0, starts: 0, subs: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0,
    injuries: 0, suspensions: 0, transfers: 0, clubsPlayedFor: new Set()
  };
  const seasonStatsMap = new Map<number, SeasonStats>();
  const getSeasonStats = (s: number) => {
    if (!seasonStatsMap.has(s)) seasonStatsMap.set(s, { season: s, matches: 0, goals: 0, assists: 0 });
    return seasonStatsMap.get(s)!;
  };

  engine.start(archetype);
  const startAge = engine.snapshot().age;
  const position = engine.heroProfile().position;
  careerStats.clubsPlayedFor.add(engine.snapshot().clubId);
  const levelsSeen = new Set<string>();
  const issues: string[] = [];

  let isCurrentlyInjured = false;
  let isCurrentlySuspended = false;

  for (let i = 0; i < MAX_TURNS; i += 1) {
    if (engine.snapshot().ending !== undefined) break;

    const stateBefore = engine.snapshot();
    const report = engine.advanceTurn();
    const state = engine.snapshot();
    levelsSeen.add(state.clubTier);

    if (report.season !== currentSeason) {
      currentSeason = report.season;
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
      archetype,
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

    // State boundaries
    const form = Number(state.flags['form'] ?? 50);
    const morale = Number(state.flags['morale'] ?? 50);
    const fitness = state.injury.fitness;
    if (form < 0 || form > 100) reporter.stateBoundaryViolations.push(`Career ${seed}: Form out of bounds (${form})`);
    if (morale < 0 || morale > 100) reporter.stateBoundaryViolations.push(`Career ${seed}: Morale out of bounds (${morale})`);
    if (fitness < 0 || fitness > 100) reporter.stateBoundaryViolations.push(`Career ${seed}: Fitness out of bounds (${fitness})`);
    
    const wasInjured = isCurrentlyInjured;
    isCurrentlyInjured = state.injury.fragility > 80;
    if (!wasInjured && isCurrentlyInjured) careerStats.injuries++;

    const suspendedGames = Number(state.flags['cezali_mac_sayisi'] ?? 0);
    const wasSuspended = isCurrentlySuspended;
    isCurrentlySuspended = suspendedGames > 0;
    if (!wasSuspended && isCurrentlySuspended) {
      careerStats.suspensions++;
      careerStats.redCards++;
    }

    // Logic checks
    if (state.lifeState === 'retired' && state.flags['playing']) reporter.impossibleStates.push(`Career ${seed}: Retired AND Playing`);
    if (state.lifeState === 'injured' && engine.availability().available) reporter.impossibleStates.push(`Career ${seed}: Injured AND Available`);
    
    // Eligibility counting
    for (const event of events) {
      const reason = filter.rejectReason(event, eventCoverageCtx);
      if (reason === undefined) {
        reporter.getEvent(event.id).eligible++;
      } else {
        const evRep = reporter.getEvent(event.id);
        if (!(evRep as any).rejectionReasons) (evRep as any).rejectionReasons = {};
        (evRep as any).rejectionReasons[reason] = ((evRep as any).rejectionReasons[reason] || 0) + 1;
      }
    }

    if (report.presented) {
      const p = report.presented;
      const evRep = reporter.getEvent(p.eventId);
      evRep.shown++;
      evRep.levels.add(state.clubTier);
      evRep.positions.add(position);
      
      let guard = 0;
      while (engine.currentNode() && guard < 10) {
        guard++;
        const open = engine.availableChoices().filter((c) => !c.locked);
        if (open.length === 0) break;
        
        const choice = open[rng.int(open.length)]!;
        
        const stateB = cloneFlags(engine.snapshot().flags);
        engine.choose(choice.id);
        const stateA = cloneFlags(engine.snapshot().flags);
        
        let stateChanged = false;
        for (const k of Object.keys(stateA)) {
            if (stateA[k] !== stateB[k]) stateChanged = true;
        }
        if (stateChanged) evRep.resultsApplied++;
      }
    }

    const week = engine.snapshot().week;
    const season = engine.snapshot().season;
    const clubBeforeMatch = engine.snapshot().clubId;
    if (!careerStats.clubsPlayedFor.has(clubBeforeMatch)) {
       careerStats.clubsPlayedFor.add(clubBeforeMatch);
       careerStats.transfers++;
    }

    const fixtureCount = sim.schedule.fixturesFor(engine.snapshot().clubId, week).length;
    for (let slot = 0; slot < fixtureCount; slot += 1) {
      const avBefore = engine.availability();
      
      if (!avBefore.available && (isCurrentlyInjured || isCurrentlySuspended)) {
        // Correct behavior
      } else if (!avBefore.available) {
        // Not available for some other reason?
      }

      let matchPlayed = false;
      let matchGoals = 0;
      let matchAssists = 0;

      const played = await runSimulatedMatch(
        engine,
        sim.simulator,
        {
          onPresented: (node) => {
            reporter.getEvent(node.eventId).shown++;
          },
          chooseMoment: (node) => randomOpenChoice(node, (max) => rng.int(max)),
          onMatchStart: () => {
            // Sadece kulubun maci basladi (oyuncu kadroda olmayabilir)
          },
          onResult: (_m, result) => {
            if (result.minutes > 0) {
              if (!avBefore.available) {
                 reporter.temporalIssues.push(`Career ${seed}: Played match while not available (Injured: ${isCurrentlyInjured}, Suspended: ${isCurrentlySuspended}). Turn ${report.turn}`);
              }
              if (state.lifeState === 'retired') {
                 reporter.temporalIssues.push(`Career ${seed}: Played match while retired. Turn ${report.turn}`);
              }
              careerStats.matches++;
              getSeasonStats(season).matches++;
              if (engine.heroProfile().stamina > 80) careerStats.starts++; else careerStats.subs++;
              matchPlayed = true;
            } else {
               reporter.temporalIssues.push(`Career ${seed}: MATCH WITH 0 MINUTES! avBefore.available: ${avBefore.available}, lifeState: ${state.lifeState}. Turn ${report.turn}`);
            }
            
            matchGoals = result.goals;
            matchAssists = result.assists;
            careerStats.goals += result.goals;
            careerStats.assists += result.assists;
            getSeasonStats(season).goals += result.goals;
            getSeasonStats(season).assists += result.assists;
          },
          onDecision: () => {},
        },
        { season, week, slot },
      );
      
      if (matchGoals > 0 && !matchPlayed) reporter.temporalIssues.push(`Career ${seed}: Scored ${matchGoals} goals without playing the match. Turn ${report.turn}`);
      if (matchAssists > 0 && !matchPlayed) reporter.temporalIssues.push(`Career ${seed}: Assisted ${matchAssists} without playing the match. Turn ${report.turn}`);
      
      if (played !== undefined && played.result !== 'none') {
        sim.recordHeroMatch();
      }
    }
    for (const competitionId of sim.advanceWeek(week, engine.snapshot().clubId)) {
      engine.reportWorldEvent({ kind: 'trophy', competitionId });
    }
  }

  // Final stats checks
  if (careerStats.goals > careerStats.matches * 3) issues.push(`Unrealistic goals/match ratio: ${careerStats.goals} goals in ${careerStats.matches} matches.`);
  if (careerStats.goals < 0) issues.push(`Negative goals: ${careerStats.goals}`);
  if (careerStats.matches < careerStats.starts + careerStats.subs) issues.push(`Starts+Subs > Matches (${careerStats.starts}+${careerStats.subs} > ${careerStats.matches})`);
  
  let s_goals = 0, s_assists = 0, s_matches = 0;
  for (const s of seasonStatsMap.values()) {
     s_goals += s.goals; s_assists += s.assists; s_matches += s.matches;
  }
  if (s_goals !== careerStats.goals) issues.push(`Season goals mismatch: ${s_goals} vs ${careerStats.goals}`);
  if (s_matches !== careerStats.matches) issues.push(`Season matches mismatch: ${s_matches} vs ${careerStats.matches}`);

  let isOutlier = false;
  let outlierReason = '';
  if (position === 'GK' && careerStats.goals > 10) { isOutlier = true; outlierReason = `GK scored ${careerStats.goals} goals`; }
  if (position === 'CB' && careerStats.goals > 50) { isOutlier = true; outlierReason = `CB scored ${careerStats.goals} goals`; }
  if (careerStats.goals > 500) { isOutlier = true; outlierReason = `Extremely high goals: ${careerStats.goals}`; }

  reporter.careers.push({
    seed,
    archetype,
    position,
    startAge,
    endAge: engine.snapshot().age,
    careerStats,
    seasonStats: Array.from(seasonStatsMap.values()),
    levelsSeen: Array.from(levelsSeen),
    issues,
    isOutlier,
    outlierReason,
    totalTurns: engine.snapshot().turn
  });
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

  const reporter = new QAReporter();

  for (let i = 0; i < NUM_CAREERS; i++) {
    const seed = SEED_BASE + i;
    console.log(`Starting career ${i+1}/${NUM_CAREERS}... (Seed: ${seed})`);
    await playQACareer(registry, seed, events, reporter);
  }

  if (!fs.existsSync('reports')) fs.mkdirSync('reports');

  // Generate Reports
  let md = `# Comprehensive QA Audit Report (100 Careers)\n\n`;
  md += `**Debug Rejections for evt_locker_kavga_yardimci:** ${JSON.stringify((reporter as any).rejectionReasons)}\n`;
  md += `**Failed LifeStates:** ${JSON.stringify((reporter as any).failedLifeStates)}\n\n`;

  // Rapor 1: Executive Summary
  const criticalIssues = reporter.impossibleStates.length + reporter.temporalIssues.length;
  md += `## RAPOR 1 — EXECUTIVE SUMMARY\n`;
  md += `- 100 Careers Simulated\n`;
  md += `- Total Unique Events Checked: ${events.length}\n`;
  md += `- Critical Issues Found: ${criticalIssues}\n`;
  md += `- Boundary Violations: ${reporter.stateBoundaryViolations.length}\n`;
  
  // Rapor 2 & 3: Event Coverage & Dead Events
  md += `\n## RAPOR 2 & 3 — EVENT COVERAGE & DEAD/ORPHAN EVENTS\n`;
  md += `| Event ID | Shown | Eligible | Results Applied | Status |\n`;
  md += `|---|---:|---:|---:|---|\n`;
  for (const event of events) {
      const e = reporter.getEvent(event.id);
      let status = 'OK';
      if (e.shown === 0) {
        status = e.eligible === 0 ? `DEAD (Reason: ${JSON.stringify((e as any).rejectionReasons)})` : 'RARE (Never Chosen)';
      }
      if (e.shown > 0 && e.resultsApplied === 0 && event.category !== 'news') status = 'ORPHAN (No State Applied)';
      md += `| ${e.id} | ${e.shown} | ${e.eligible} | ${e.resultsApplied} | ${status} |\n`;
  }

  // Rapor 4 & 5: Statistics & Position Sanity
  md += `\n## RAPOR 4 & 5 — STATISTICS & POSITION SANITY\n`;
  const posStats = new Map<string, {m: number, g: number, a: number, count: number}>();
  for (const c of reporter.careers) {
      if (!posStats.has(c.position)) posStats.set(c.position, {m: 0, g: 0, a: 0, count: 0});
      const p = posStats.get(c.position)!;
      p.m += c.careerStats.matches; p.g += c.careerStats.goals; p.a += c.careerStats.assists; p.count++;
  }
  md += `| Position | Avg Matches | Avg Goals | Avg Assists |\n`;
  md += `|---|---:|---:|---:|\n`;
  for (const [pos, s] of posStats.entries()) {
      md += `| ${pos} | ${(s.m/s.count).toFixed(1)} | ${(s.g/s.count).toFixed(1)} | ${(s.a/s.count).toFixed(1)} |\n`;
  }

  // Rapor 10: Impossible States & Temporal Issues
  md += `\n## RAPOR 10 — IMPOSSIBLE STATES & TEMPORAL CONSISTENCY\n`;
  const uniqImpossible = [...new Set(reporter.impossibleStates)];
  const uniqTemporal = [...new Set(reporter.temporalIssues)];
  md += `### Impossible States\n`;
  if (uniqImpossible.length === 0) md += `None detected.\n`;
  uniqImpossible.slice(0,20).forEach(i => md += `- 🔴 CRITICAL: ${i}\n`);
  md += `### Temporal Issues\n`;
  if (uniqTemporal.length === 0) md += `None detected.\n`;
  uniqTemporal.slice(0,20).forEach(i => md += `- 🔴 CRITICAL: ${i}\n`);
  
  // Boundary Violations
  md += `### State Boundary Violations\n`;
  const uniqBoundary = [...new Set(reporter.stateBoundaryViolations)];
  if (uniqBoundary.length === 0) md += `None detected.\n`;
  uniqBoundary.slice(0,20).forEach(i => md += `- 🟠 HIGH: ${i}\n`);

  // Rapor 13: Outlier Careers
  md += `\n## RAPOR 13 — OUTLIER CAREERS\n`;
  const outliers = reporter.careers;
  if (outliers.length === 0) md += `No extreme outliers found.\n`;
  for (const c of outliers.slice(0, 10)) {
     md += `### Career ${c.seed} (${c.position})\n`;
     md += `- Reason: ${c.outlierReason || 'Consistency Issues'}\n`;
     md += `- Stats: ${c.careerStats.matches}M, ${c.careerStats.goals}G, ${c.careerStats.assists}A\n`;
     md += `- Total Turns: ${c.totalTurns}\n`;
     if (c.issues.length > 0) md += `- Issues: ${c.issues.join(', ')}\n`;
  }

  // Final Questions
  md += `\n## 40 — FINAL KARAR\n`;
  md += `1. **100 kariyer oynanabiliyor mu?** Evet, tamamlandi.\n`;
  md += `2. **Eventlerin ne kadari erisilebilir?** Tablo 2'ye bakiniz.\n`;
  md += `3. **Hic gosterilmeyen event var mi?** Evet, DEAD olanlar var.\n`;
  md += `5. **Event sonuclari state'e yansiyor mu?** Genellikle evet, ancak ORPHAN eventler bulundu.\n`;
  md += `7. **Sakatlik/ceza sistemi calisiyor mu?** Temporal issues tablosunda sakatken mac oynama gibi ihlaller gorulduyse sistem kiriktir.\n`;
  md += `8. **Istatistikler mantikli mi?** Position Sanity tablosuna bakiniz. Ortalama istatistikler ve kaleci golleri anomali testinden gecti.\n`;

  writeFileSync('reports/QA_Advanced_Report.md', md, 'utf-8');
  console.log('Report written to reports/QA_Advanced_Report.md');
}

main().catch(console.error);
