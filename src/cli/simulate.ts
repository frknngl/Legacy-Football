/**
 * SIMULASYON -- `npm run simulate`
 *
 * Yapisal garanti #1'in ("bin tur boyunca tekrar imkansiz") olculdugu yer.
 * N tohumla kariyeri sonuna kadar oynar ve uc soruya sayiyla cevap verir:
 *
 *   1. Ayni metin ikinci kez ne zaman cikti?   -> ilk tekrar turu
 *   2. Hangi olaylar hic cikmadi?              -> olu icerik + red sebebi
 *   3. Havuz kategori bazinda dengeli mi?      -> dagilim
 *
 * `--seeds`, `--turns`, `--archetype`, `--verbose` ile yonlendirilir.
 * `--strict` verilirse olu icerik bulundugunda 1 ile cikar (CI kapisi).
 */

import { ARCHETYPES, type Archetype } from '../domain/axes.js';
import type { StoryEvent } from '../domain/story.js';
import { ContentLoader } from '../loading/ContentLoader.js';
import type { ContentRegistry } from '../loading/ContentRegistry.js';
import { FileSystemContentSource } from '../loading/FileSystemContentSource.js';
import { GameEngine, type TurnReport } from '../runtime/GameEngine.js';
import { EligibilityFilter, type RejectReason } from '../selection/EligibilityFilter.js';
import { Rng } from '../selection/Rng.js';
import { randomOpenChoice, runSimulatedMatch } from './runMatch.js';
import { selectWorld } from './world.js';

const NATIONAL_WEEKS = new Set([5, 11, 17, 26, 33]);

function arg(name: string, fallback: string): string {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? (found.split('=')[1] ?? fallback) : fallback;
}

interface CareerResult {
  readonly seed: number;
  readonly turns: number;
  readonly scenes: number;
  readonly distinct: number;
  /** Ayni metnin ikinci kez ciktigi tur; hic tekrar etmediyse undefined. */
  readonly firstRepeatTurn: number | undefined;
  readonly seen: Set<string>;
  readonly byCategory: Map<string, number>;
  /** Hic uygun olamayan olaylarin en sik red sebebi. */
  readonly rejections: Map<string, Map<RejectReason, number>>;
  /** Mac istatistikleri -- simulatorun uretimi bunlarla olculur. */
  readonly matches: number;
  readonly goals: number;
  readonly cards: number;
  readonly momentsOffered: number;
}

/** Bir kariyeri sonuna kadar oynar. */
async function playCareer(
  registry: ContentRegistry,
  seed: number,
  maxTurns: number,
  archetype: Archetype,
  events: readonly StoryEvent[],
  dbPath = '',
): Promise<CareerResult> {
  const sim = await selectWorld({ registry, seed, dbPath });
  const engine = new GameEngine(registry, {
    seed,
    roster: sim.roster,
    world: sim.world,
    worldFeed: sim.worldFeed,
  });
  // Kimya kablosu: motor kuruldu, simulator artik 'kim kiminle iyi
  // anlasiyor' sorusunu sorabilir. Motorun flag sozlugu yine kapali.
  sim.simulator.useChemistrySource((id) => engine.chemistryFor(id));
  const rng = new Rng(seed ^ 0x5bf03635);
  const filter = new EligibilityFilter();

  const seen = new Set<string>();
  const byCategory = new Map<string, number>();
  const rejections = new Map<string, Map<RejectReason, number>>();
  const everEligible = new Set<string>();
  let scenes = 0;
  let firstRepeatTurn: number | undefined;
  let turns = 0;
  let lastSeason = 1;
  // Mac istatistikleri -- simulatorun uretimini olcer.
  let matches = 0;
  let goals = 0;
  let cards = 0;
  let momentsOffered = 0;

  const note = (report: TurnReport): void => {
    const p = report.presented;
    if (!p) return;
    scenes += 1;
    const key = p.variantId ? `${p.eventId}#${p.variantId}` : p.eventId;
    if (seen.has(key) && firstRepeatTurn === undefined) firstRepeatTurn = report.turn;
    seen.add(key);
    byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);
  };

  engine.start(archetype);

  for (let i = 0; i < maxTurns; i += 1) {
    if (engine.snapshot().ending !== undefined) break;
    const report = engine.advanceTurn();
    turns = report.turn;

    // Sezon kapanisi ve milli ara -- bkz. play.ts'teki uzun not.
    if (report.season !== lastSeason) {
      lastSeason = report.season;
      engine.closeAgentSeason(Number(engine.snapshot().flags['form'] ?? 0) >= 55);
      const myClub = engine.snapshot().clubId;
      for (const [leagueId, clubId] of Object.entries(sim.finishSeason().champions)) {
        if (clubId === myClub) engine.reportWorldEvent({ kind: 'trophy', competitionId: leagueId });
      }
    }
    if (NATIONAL_WEEKS.has(report.week) && sim.countryOfClub && sim.calledUp) {
      const hero = engine.heroProfile();
      const q = Math.round((hero.technical + hero.physical) / 2);
      if (sim.calledUp(sim.countryOfClub(engine.snapshot().clubId), q)) {
        engine.reportWorldEvent({ kind: 'national_call', matches: 2 });
      }
    }
    note(report);

    // Her turda TUM havuzu tara: hangi olay neden elendi?
    const state = engine.snapshot();
    const ctx = {
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
      cooldownState: {
        cooldowns: state.cooldowns,
        familyCooldowns: state.familyCooldowns,
      },
    };
    for (const event of events) {
      const reason = filter.rejectReason(event, ctx);
      if (reason === undefined) {
        everEligible.add(event.id);
        continue;
      }
      // Soguma ve "once" gecicidir; kapi sebepleri kalicidir.
      if (reason === 'cooldown_self' || reason === 'cooldown_family' || reason === 'once') continue;
      let bucket = rejections.get(event.id);
      if (!bucket) {
        bucket = new Map();
        rejections.set(event.id, bucket);
      }
      bucket.set(reason, (bucket.get(reason) ?? 0) + 1);
    }

    let guard = 0;
    while (engine.currentNode() && guard < 20) {
      guard += 1;
      const open = engine.availableChoices().filter((c) => !c.locked);
      if (open.length === 0) break;
      note(engine.choose(open[rng.int(open.length)]!.id));
    }

    const week = engine.snapshot().week;
    await runSimulatedMatch(
      engine,
      sim.simulator,
      {
        chooseMoment: (node) => randomOpenChoice(node, (max) => rng.int(max)),
        onChoiceMade: note,
        onMatchStart: () => {
          matches += 1;
        },
        onResult: (_m, result) => {
          goals += result.goals;
          cards += result.cards;
        },
        onDecision: () => {
          momentsOffered += 1;
        },
      },
      { season: engine.snapshot().season, week },
    );
    sim.recordHeroMatch();
    for (const competitionId of sim.advanceWeek(week, engine.snapshot().clubId)) {
      engine.reportWorldEvent({ kind: 'trophy', competitionId });
    }
  }

  // Bir kez bile uygun olan olayin red kaydi anlamsizdir.
  for (const id of everEligible) rejections.delete(id);

  return {
    seed, turns, scenes, distinct: seen.size, firstRepeatTurn, seen, byCategory, rejections,
    matches, goals, cards, momentsOffered,
  };
}

function ratio(part: number, total: number): string {
  return total === 0 ? '0.00' : (part / total).toFixed(2);
}

function pct(part: number, total: number): string {
  return total === 0 ? '0%' : `${Math.round((part / total) * 100)}%`;
}

function avg(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

async function main(): Promise<void> {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  if (!loaded.registry) {
    console.error('Icerik yuklenemedi.');
    process.exitCode = 1;
    return;
  }
  const registry = loaded.registry;
  const events = registry.events;

  const seeds = Number.parseInt(arg('seeds', '20'), 10);
  const maxTurns = Number.parseInt(arg('turns', '1040'), 10);
  const archetypeArg = arg('archetype', 'street');
  const archetype = ((ARCHETYPES as readonly string[]).includes(archetypeArg)
    ? archetypeArg
    : 'street') as Archetype;
  const verbose = process.argv.includes('--verbose');

  console.log(`=== SIMULASYON | ${seeds} tohum x ${maxTurns} tur | ${archetype} ===\n`);

  const results: CareerResult[] = [];
  for (let i = 0; i < seeds; i += 1) {
    results.push(await playCareer(registry, 1000 + i * 7919, maxTurns, archetype, events));
  }

  const repeats = results.filter((r) => r.firstRepeatTurn !== undefined);
  const repeatTurns = repeats.map((r) => r.firstRepeatTurn!);

  console.log('TEKRAR');
  console.log(`  Kariyer uzunlugu (ort)   : ${avg(results.map((r) => r.turns))} tur`);
  console.log(`  Sahne sayisi (ort)       : ${avg(results.map((r) => r.scenes))}`);
  console.log(`  Benzersiz metin (ort)    : ${avg(results.map((r) => r.distinct))}`);
  console.log(
    `  Tekrar yasayan kariyer   : ${repeats.length} / ${results.length}` +
      (repeats.length > 0
        ? `  (ilk tekrar ort. tur ${avg(repeatTurns)}, en erken ${Math.min(...repeatTurns)})`
        : ''),
  );

  const used = new Set<string>();
  for (const r of results) for (const k of r.seen) used.add(k.split('#')[0]!);
  const dead = events.filter((e) => !used.has(e.id));

  const totalMatches = results.reduce((n, r) => n + r.matches, 0);
  console.log('\nMAC');
  console.log(`  Oynanan mac (ort)        : ${avg(results.map((r) => r.matches))}`);
  console.log(
    `  Hero golu / mac          : ${ratio(results.reduce((n, r) => n + r.goals, 0), totalMatches)}`,
  );
  console.log(
    `  Kart / mac               : ${ratio(results.reduce((n, r) => n + r.cards, 0), totalMatches)}`,
  );
  console.log(
    `  Karar ani / mac          : ${ratio(results.reduce((n, r) => n + r.momentsOffered, 0), totalMatches)}`,
  );

  console.log('\nKAPSAMA');
  console.log(`  Kullanilan olay : ${used.size} / ${events.length}  (${pct(used.size, events.length)})`);
  console.log(`  Olu olay        : ${dead.length}`);

  if (dead.length > 0) {
    console.log('\nOLU OLAYLAR -- hicbir kariyerde sahneye gelmedi');
  console.log(
    '  (match olaylari MEVKIYE kapilidir: forvet kariyerinde stoper ani, ' +
      'stoper kariyerinde forvet ani cikmaz -- bu olu icerik degildir)',
  );
    for (const e of dead) {
      const merged = new Map<RejectReason, number>();
      for (const r of results) {
        for (const [reason, n] of r.rejections.get(e.id) ?? []) {
          merged.set(reason, (merged.get(reason) ?? 0) + n);
        }
      }
      const top = [...merged.entries()].sort((a, b) => b[1] - a[1])[0];
      const why = top ? `en sik red: ${top[0]}` : 'kuyruga hic girmedi (scheduledOnly?)';
      console.log(`  ${e.id.padEnd(34)} ${e.category}/${e.tier}  -> ${why}`);
    }
  }

  const cat = new Map<string, number>();
  let total = 0;
  for (const r of results) {
    for (const [k, n] of r.byCategory) {
      cat.set(k, (cat.get(k) ?? 0) + n);
      total += n;
    }
  }
  console.log('\nDAGILIM');
  for (const [k, n] of [...cat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(12)} ${String(n).padStart(6)}  ${pct(n, total).padStart(4)}`);
  }

  if (verbose) {
    console.log('\nTOHUM BAZINDA');
    for (const r of results) {
      const rep = r.firstRepeatTurn === undefined ? 'tekrar yok' : `ilk tekrar t${r.firstRepeatTurn}`;
      console.log(
        `  tohum ${String(r.seed).padStart(6)} | ${String(r.turns).padStart(4)} tur | ` +
          `${String(r.distinct).padStart(3)} benzersiz | ${rep}`,
      );
    }
  }

  console.log('');
  if (dead.length > 0) {
    console.log(`OLU ICERIK VAR: ${dead.length} olay hic cikmiyor.`);
    if (process.argv.includes('--strict')) process.exitCode = 1;
  } else {
    console.log('Her olay en az bir kariyerde sahneye geldi.');
  }
}

await main();
