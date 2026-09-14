/**
 * DENETIM KOSUMU -- 100 bagimsiz random kariyer, HAM VERI toplar.
 *
 * SALT OKUNUR: motoru, icerigi ve veritabanini DEGISTIRMEZ. Yalnizca
 * motorun kendi genel yuzeyini (advanceTurn / choose / availability /
 * snapshot) surer ve gozlemi JSONL olarak yazar.
 *
 * Analiz burada YAPILMAZ. Bu dosyanin tek isi olcmek; yorum ayri adimda.
 */

import { ARCHETYPES, type Archetype } from '../../src/domain/axes.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';
import { GameEngine } from '../../src/runtime/GameEngine.js';
import { Rng } from '../../src/selection/Rng.js';
import { randomOpenChoice, runSimulatedMatch } from '../../src/cli/runMatch.js';
import { selectWorld, weeklySelectionMatchContext } from '../../src/cli/world.js';
import { botTurn } from '../../src/cli/bot.js';
import { EligibilityFilter } from '../../src/selection/EligibilityFilter.js';
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'tmp/audit/out';

/** Milli ara haftalari -- `src/cli/playtest.ts` ile AYNI. */
const NATIONAL_WEEKS = new Set([5, 11, 17, 26, 33]);

/**
 * Uygunluk SAYAC olarak tutulur, satir olarak degil.
 *
 * Satir basina yazilsaydi 100 kariyer x 1040 tur x 545 olay = ~50 milyon
 * satir ederdi. Denetim icin gereken bilgi "kac kez uygundu" ve "hangi
 * kapidan elendi" -- ikisi de sayacla tasinir.
 */
const ELIGIBLE = new Map<string, number>();
const ELIGIBLE_CAREERS = new Map<string, Set<number>>();
const REJECT = new Map<string, number>();
mkdirSync(OUT, { recursive: true });

const arg = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const CAREERS = Number(arg('careers', '100'));
const MAX_TURNS = Number(arg('turns', '1040'));
const SEED_BASE = Number(arg('seedBase', '90000'));
const DB = arg('world', 'data/world.db');

/** Kariyer boyunca izlenen sayisal/durum bayraklari. */
const TRACKED = [
  'form', 'moral', 'kondisyon', 'servet', 'borc', 'piyasa_degeri',
  'kariyer_mac_sayisi', 'kariyer_gol_sayisi', 'kariyer_asist_sayisi',
  'sezon_mac_sayisi', 'sezon_gol_sayisi', 'sezon_asist_sayisi',
  'kupa_sayisi', 'odul_sayisi', 'milli_mac_sayisi',
  'is_injured', 'injury_weeks', 'is_suspended', 'suspension_matches',
  'is_captain', 'retired', 'sentence_weeks',
  'liderlik', 'profesyonellik', 'teknik', 'fizik', 'mental_dayaniklilik',
  'haftalik_gelir', 'yonetim_baskisi', 'sozlesme_sezon', 'potansiyel',
] as const;

function snap(engine: GameEngine): Record<string, unknown> {
  const s = engine.snapshot();
  const out: Record<string, unknown> = {
    turn: s.turn, season: s.season, week: s.week, age: s.age,
    lifeState: s.lifeState, clubId: s.clubId, stature: s.stature,
    clubTier: s.clubTier, retiredAtTurn: s.retiredAtTurn ?? null,
  };
  for (const key of TRACKED) out[key] = s.flags[key] ?? null;
  const av = engine.availability();
  out['available'] = av.available;
  out['availReason'] = av.reason ?? null;
  return out;
}

async function runCareer(seed: number, registry: any, write: (kind: string, row: unknown) => void) {
  const archetype = ARCHETYPES[seed % ARCHETYPES.length] as Archetype;
  const sim = await selectWorld({ registry, seed, dbPath: DB });

  let engine: GameEngine;
  engine = new GameEngine(registry, {
    seed,
    roster: sim.roster,
    world: sim.world,
    worldFeed: sim.worldFeed,
    selectionMatchContext: ({ season, week, clubId }: any) =>
      weeklySelectionMatchContext(sim, {
        season, week, clubId,
        availability: engine.availability(),
        hero: engine.heroProfile(),
      }),
  });
  sim.simulator.useChemistrySource((id: string) => engine.chemistryFor(id));
  sim.useManagerSource?.((clubId: string) => engine.managerSourceIdFor(clubId));

  const rng = new Rng(seed ^ 0x5f3a);
  const botRng = new Rng(seed ^ 0x2c19);
  const filter = new EligibilityFilter();

  engine.start(archetype);
  const hero = engine.heroProfile();
  const startAge = engine.snapshot().age;
  let prevClub = engine.snapshot().clubId;
  let season = 1;
  let turns = 0;
  let transfers = 0;

  // Uygunluk sayimi icin secicinin baglamini yakala -- motoru DEGISTIRMEZ,
  // yalnizca gecen baglami kopyalar ve orijinali cagirir.
  let ctxSnapshot: any = null;
  const selector = (engine as any).selector;
  const originalSelect = selector.select.bind(selector);
  selector.select = (ctx: any, r: any) => {
    ctxSnapshot = ctx;
    return originalSelect(ctx, r);
  };

  for (let i = 0; i < MAX_TURNS; i += 1) {
    if (engine.snapshot().ending !== undefined) break;
    turns += 1;

    const before = snap(engine);
    const report = engine.advanceTurn();
    const afterTurn = snap(engine);

    // --- UYGUNLUK: bu turda hangi olaylar secilebilirdi
    if (ctxSnapshot) {
      for (const ev of registry.events) {
        if (ev.scheduledOnly || ev.momentType !== undefined) continue;
        const reason = filter.rejectReason(ev, ctxSnapshot);
        if (reason === undefined) {
          ELIGIBLE.set(ev.id, (ELIGIBLE.get(ev.id) ?? 0) + 1);
          ELIGIBLE_CAREERS.set(ev.id, (ELIGIBLE_CAREERS.get(ev.id) ?? new Set()).add(seed));
        } else {
          const key = `${ev.id}|${reason}`;
          REJECT.set(key, (REJECT.get(key) ?? 0) + 1);
        }
      }
    }

    // --- OLAY
    if (report.presented) {
      const p = report.presented;
      const choices: string[] = [];
      let guard = 0;
      while (engine.currentNode() && guard < 12) {
        guard += 1;
        const open = engine.availableChoices().filter((c: any) => !c.locked);
        if (open.length === 0) break;
        const pick = open[rng.int(open.length)]!;
        choices.push(pick.id);
        engine.choose(pick.id);
      }
      const afterEvent = snap(engine);
      const delta: Record<string, unknown> = {};
      for (const k of Object.keys(afterEvent)) {
        if (afterEvent[k] !== afterTurn[k]) delta[k] = [afterTurn[k], afterEvent[k]];
      }
      write('event', {
        seed, turn: before['turn'], season: before['season'], week: before['week'],
        age: before['age'], lifeState: before['lifeState'], stature: before['stature'],
        clubTier: before['clubTier'], position: hero.position,
        eventId: p.eventId, category: p.category, tier: p.tier,
        variantId: p.variantId ?? null, isMoment: p.isMoment,
        choices, delta,
      });
    }

    // --- MILLI TAKIM (playtest.ts ile AYNI kapi)
    //
    // Bu cagrilar HOST sorumlulugu. Ilk kosumda atlanmislardi ve sonuc
    // olculdu: `milli_mac_sayisi` ve `kupa_sayisi` 100 kariyerde de 0
    // kaldi -- yani olcumun kendisi bozuktu, oyun degil.
    if (report.week === 39 && report.season % 2 === 0 && sim.countryOfClub && sim.calledUp) {
      const h = engine.heroProfile();
      const q = Math.round((h.technical + h.physical) / 2);
      if (sim.calledUp(sim.countryOfClub(engine.snapshot().clubId), q)) {
        const deep = rng.next() < q / 130;
        engine.reportWorldEvent({
          kind: 'tournament',
          name: (report.season / 2) % 2 === 0 ? 'Dunya Kupasi' : 'Avrupa Sampiyonasi',
          matches: deep ? 7 : 4,
          won: deep && rng.next() < q / 260,
        });
      }
    }
    if (NATIONAL_WEEKS.has(report.week) && sim.countryOfClub && sim.calledUp) {
      const hero = engine.heroProfile();
      const quality = Math.round((hero.technical + hero.physical) / 2);
      if (sim.calledUp(sim.countryOfClub(engine.snapshot().clubId), quality)) {
        engine.reportWorldEvent({ kind: 'national_call', matches: 2 });
      }
    }

    // --- SEZON GECISI: sozlesme, sezon kapanisi, SAMPIYONLUK
    if (report.season !== season) {
      season = report.season;
      engine.closeAgentSeason(Number(engine.snapshot().flags['form'] ?? 0) >= 55);
      if (Number(engine.snapshot().flags['sozlesme_sezon'] ?? 0) <= 1) {
        engine.renewContract(engine.contractOffer());
      }
      const outcome = sim.finishSeason();
      const myClub = engine.snapshot().clubId;
      for (const [leagueId, clubId] of Object.entries(outcome.champions)) {
        if (clubId === myClub) {
          engine.reportWorldEvent({ kind: 'trophy', competitionId: leagueId });
          write('trophy', { seed, season, competitionId: leagueId, kind: 'league' });
        }
      }
    }

    botTurn(engine, sim.roster, botRng, report.week);

    // --- TRANSFER
    const nowClub = engine.snapshot().clubId;
    if (nowClub !== prevClub) {
      transfers += 1;
      write('transfer', {
        seed, turn: engine.snapshot().turn, season: engine.snapshot().season,
        week: engine.snapshot().week, age: engine.snapshot().age,
        from: prevClub, to: nowClub,
        fromRep: sim.roster.club(prevClub)?.reputation ?? null,
        toRep: sim.roster.club(nowClub)?.reputation ?? null,
        fromTier: sim.roster.club(prevClub)?.tier ?? null,
        toTier: sim.roster.club(nowClub)?.tier ?? null,
        value: engine.snapshot().flags['piyasa_degeri'] ?? null,
      });
      prevClub = nowClub;
    }

    // --- MACLAR
    const state = engine.snapshot();
    const fixtures = sim.schedule.fixturesFor(state.clubId, state.week);
    for (let slot = 0; slot < fixtures.length; slot += 1) {
      const fx = fixtures[slot]!;
      const availBefore = engine.availability();
      const sBefore = snap(engine);

      const result = await runSimulatedMatch(
        engine,
        sim.simulator,
        {
          chooseMoment: (node: any) => randomOpenChoice(node, (max: number) => rng.int(max)),
        },
        { season: state.season, week: state.week, slot },
      );

      if (!result) continue;
      const score = (sim.simulator as any).finalScore?.();
      const isHome = score ? score.homeId === state.clubId : null;

      sim.recordHeroMatch?.();
      write('match', {
        seed, turn: state.turn, season: state.season, week: state.week,
        age: state.age, position: hero.position,
        competitionId: fx.competitionId, importance: fx.importance,
        homeId: fx.homeId, awayId: fx.awayId, isHome,
        homeRep: sim.roster.club(fx.homeId)?.reputation ?? null,
        awayRep: sim.roster.club(fx.awayId)?.reputation ?? null,
        homeGoals: score?.homeGoals ?? null, awayGoals: score?.awayGoals ?? null,
        // Hero'nun bu mactaki ciktisi
        minutes: result.minutes, goals: result.goals, assists: result.assists,
        cards: result.cards, rating: result.rating, outcome: result.result,
        // Mac ANINDAKI durum -- "sakatken oynadi mi" sorusunun kaniti
        availableBefore: availBefore.available,
        availReason: availBefore.reason ?? null,
        lifeState: sBefore['lifeState'],
        isInjured: sBefore['is_injured'], injuryWeeks: sBefore['injury_weeks'],
        isSuspended: sBefore['is_suspended'], suspensionMatches: sBefore['suspension_matches'],
        retired: sBefore['retired'],
      });
    }

    // --- DUNYA HAFTASI: diger fiksturler + kupa/kita sampiyonluklari
    for (const competitionId of sim.advanceWeek(state.week, engine.snapshot().clubId)) {
      engine.reportWorldEvent({ kind: 'trophy', competitionId });
      write('trophy', { seed, season: state.season, competitionId, kind: 'cup' });
    }

    // --- TUR ANLIGI (her 4 turda bir; ham dosya sisirmesin)
    if (i % 4 === 0) write('turn', { seed, ...snap(engine) });
  }

  const final = engine.snapshot();
  write('career', {
    seed, archetype, position: hero.position, startAge, endAge: final.age,
    turns, seasons: final.season, transfers,
    // `ending` bir STRING -- nesne degil. '.id' okumak 100 kariyerde
    // birden null uretiyordu; olcum hatasiydi, motor hatasi degil.
    ending: final.ending ?? null,
    lifeState: final.lifeState, stature: final.stature, clubTier: final.clubTier,
    retiredAtTurn: final.retiredAtTurn ?? null,
    ...Object.fromEntries(TRACKED.map((k) => [k, final.flags[k] ?? null])),
    personaAxes: final.persona,
    clubsVisited: null,
  });
  sim.close?.();
}

async function main(): Promise<void> {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  if (!loaded.registry) throw new Error('icerik yuklenemedi');
  const registry = loaded.registry;

  const files: Record<string, string> = {};
  for (const kind of ['career', 'event', 'match', 'transfer', 'turn', 'trophy']) {
    files[kind] = `${OUT}/${kind}.jsonl`;
    writeFileSync(files[kind]!, '');
  }
  const buffers: Record<string, string[]> = {};
  const write = (kind: string, row: unknown): void => {
    (buffers[kind] ??= []).push(JSON.stringify(row));
    if (buffers[kind]!.length >= 2000) {
      appendFileSync(files[kind]!, buffers[kind]!.join('\n') + '\n');
      buffers[kind] = [];
    }
  };

  const t0 = Date.now();
  for (let i = 0; i < CAREERS; i += 1) {
    const seed = SEED_BASE + i * 37;
    await runCareer(seed, registry, write);
    if ((i + 1) % 10 === 0) {
      console.log(`  ${i + 1}/${CAREERS} kariyer  (${((Date.now() - t0) / 1000).toFixed(0)} sn)`);
    }
  }
  for (const kind of Object.keys(buffers)) {
    if (buffers[kind]!.length > 0) appendFileSync(files[kind]!, buffers[kind]!.join('\n') + '\n');
  }
  writeFileSync(
    `${OUT}/eligibility.json`,
    JSON.stringify(
      {
        eligibleTurns: Object.fromEntries(ELIGIBLE),
        eligibleCareers: Object.fromEntries(
          [...ELIGIBLE_CAREERS].map(([k, v]) => [k, v.size]),
        ),
        rejectReasons: Object.fromEntries(REJECT),
      },
      null,
      1,
    ),
  );
  console.log(`TAMAM -- ${CAREERS} kariyer, ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
}

await main();
