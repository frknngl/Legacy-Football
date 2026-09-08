/**
 * OTOMATIK DEMO -- `npm run demo`
 *
 * Etkilesim olmadan bir kariyer oynar ve anlatiyi basar. Iki isi var:
 *   1. Icerigin gercekten calistigini boru hattinda (CI) kanitlamak
 *   2. Yazilan sahneleri okuyup kalitesini gormek
 *
 * `--seed`, `--archetype`, `--turns` ile yonlendirilir. Secimler tohumlu
 * RNG ile yapilir; ayni tohum ayni kariyeri uretir.
 */

import { ARCHETYPES, type Archetype } from '../domain/axes.js';
import { ContentLoader } from '../loading/ContentLoader.js';
import { FileSystemContentSource } from '../loading/FileSystemContentSource.js';
import { GameEngine, type TurnReport } from '../runtime/GameEngine.js';
import { Rng } from '../selection/Rng.js';
import { randomOpenChoice, runSimulatedMatch } from './runMatch.js';
import { selectWorld, describeWorld } from './world.js';

function arg(name: string, fallback: string): string {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? (found.split('=')[1] ?? fallback) : fallback;
}

function wrap(text: string, width = 76, indent = '   '): string {
  return text
    .split('\n')
    .map((paragraph) => {
      const words = paragraph.split(' ');
      const lines: string[] = [];
      let line = '';
      for (const w of words) {
        if ((line + w).length > width) {
          lines.push(indent + line.trimEnd());
          line = '';
        }
        line += `${w} `;
      }
      lines.push(indent + line.trimEnd());
      return lines.join('\n');
    })
    .join('\n');
}

function printReport(r: TurnReport): void {
  for (const n of r.notices) console.log(`   * ${n}`);
  const p = r.presented;
  if (!p) return;
  console.log('');
  console.log(`   == ${p.title}  [${p.category}/${p.tier}${p.isMoment ? ' | MAC ANI' : ''}]`);
  console.log(wrap(p.text));
}

async function main(): Promise<void> {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  if (!loaded.registry) {
    console.error('Icerik yuklenemedi.');
    process.exitCode = 1;
    return;
  }
  if (loaded.issues.length > 0) {
    console.error(`UYARI: ${loaded.issues.length} icerik sorunu var.`);
    for (const i of loaded.issues) console.error(`  [${i.file}] ${i.path}: ${i.message}`);
  }

  const seed = Number.parseInt(arg('seed', '20260907'), 10);
  const turns = Number.parseInt(arg('turns', '30'), 10);
  const archetypeArg = arg('archetype', 'street');
  const archetype = (ARCHETYPES as readonly string[]).includes(archetypeArg)
    ? (archetypeArg as Archetype)
    : ('street' as Archetype);

  const dbPath = arg('world', '');
  const sim = await selectWorld({ registry: loaded.registry, seed, dbPath });
  const engine = new GameEngine(loaded.registry, {
    seed,
    roster: sim.roster,
    world: sim.world,
    worldFeed: sim.worldFeed,
  });
  // Kimya kablosu: motor kuruldu, simulator artik 'kim kiminle iyi
  // anlasiyor' sorusunu sorabilir. Motorun flag sozlugu yine kapali.
  sim.simulator.useChemistrySource((id) => engine.chemistryFor(id));
  const rng = new Rng(seed ^ 0x5f3759df);

  console.log(`=== ${archetype} | tohum ${seed} | ${turns} hafta ===`);
  console.log(`    dunya: ${describeWorld(sim, dbPath)}\n`);
  let report = engine.start(archetype);
  console.log(
    `S${report.season} H${report.week} | ${report.age} yas | ${report.stature} | ${report.clubTier}`,
  );

  let matchesPlayed = 0;
  let decisionsMade = 0;
  let caps = 0;

  // Hero'nun milli takimi = ILK kulubunun ulkesi. Kariyer boyunca degismez;
  // transfer olsa da memleket degismez.
  const heroCountry = sim.countryOfClub?.(engine.snapshot().clubId ?? '');

  for (let i = 0; i < turns; i += 1) {
    if (engine.snapshot().ending !== undefined) break;

    report = engine.advanceTurn();
    console.log(
      `\nS${report.season} H${report.week} | ${report.age} yas | ${report.stature} | ${report.lifeState}`,
    );
    printReport(report);

    // Acik olan tum kararlari kapat.
    let guard = 0;
    while (engine.currentNode() && guard < 20) {
      guard += 1;
      const open = engine.availableChoices().filter((c) => !c.locked);
      const locked = engine.availableChoices().filter((c) => c.locked);
      for (const l of locked) console.log(`      x ${l.lockLabel ?? ''} ${l.text}  (${l.lockReason})`);
      if (open.length === 0) break;
      const pick = open[rng.int(open.length)]!;
      console.log(`      -> ${pick.text}`);
      decisionsMade += 1;
      const next = engine.choose(pick.id);
      printReport(next);
    }

    // MILLI ARA: kulup maci yok, davet varsa kamp var.
    const currentWeek = engine.snapshot().week;
    if (sim.calledUp !== undefined && sim.schedule.isInternationalWeek(currentWeek)) {
      const quality = engine.heroProfile().technical;
      if (sim.calledUp(heroCountry, quality)) {
        const matches = 2;
        engine.reportWorldEvent({ kind: 'national_call', matches });
        caps += matches;
        console.log(`      [MILLI TAKIM] kampa cagrildin -- ${matches} mac (toplam ${caps})`);
      } else {
        console.log('      [MILLI ARA] kadroya alinmadin');
      }
      continue;
    }

    // TAKVIME BAGLI: o hafta fikstur ne diyorsa o kadar mac.
    //
    // Onceki hali "iki turda bir mac" idi ve 60 haftada 13 mac uretiyordu;
    // gercek takvim ~44 mac/sezon uretiyor. Yorgunluk ancak GERCEK yuk
    // altinda anlam tasir, o yuzden demo artik fiksturu takip ediyor.
    const week = engine.snapshot().week;
    const fixtureCount = sim.schedule.fixturesFor(engine.snapshot().clubId, week).length;

    for (let slot = 0; slot < fixtureCount; slot += 1) {
      const played = await runSimulatedMatch(
        engine,
        sim.simulator,
        {
          onUnavailable: (av) =>
            console.log(`      [kadroda yok: ${av.reason}, kalan ${av.matchesRemaining}]`),
          onMatchStart: (match) => {
            matchesPlayed += 1;
            console.log(
              `      [MAC] ${match.context.opponentName} (${match.context.importance})`,
            );
          },
          onHighlight: (h) => console.log(`        ${String(h.minute).padStart(2)}'  ${h.text}`),
          chooseMoment: (node) => {
            console.log('');
            console.log(`   == ${node.title}  [MAC ANI]`);
            console.log(wrap(node.text));
            for (const l of node.choices.filter((c) => c.locked)) {
              console.log(`      x ${l.lockLabel ?? ''} ${l.text}  (${l.lockReason})`);
            }
            const id = randomOpenChoice(node, (max) => rng.int(max));
            const chosen = node.choices.find((c) => c.id === id);
            if (chosen) {
              console.log(`      -> ${chosen.text}`);
              decisionsMade += 1;
            }
            return id;
          },
          onChoiceMade: (report) => {
            for (const n of report.notices) console.log(`   * ${n}`);
          },
          onResult: (_match, result, delta) => {
            console.log(
              `      [SONUC] ${result.result} | reyting ${result.rating} | ${result.goals} gol` +
                (delta.goalsDelta !== 0 ? ` (motor deltasi ${delta.goalsDelta})` : '') +
                (delta.redCard ? ' | KIRMIZI' : ''),
            );
          },
        },
        { season: engine.snapshot().season, week, slot },
      );
      void played;
      sim.recordHeroMatch();
    }
    sim.advanceWeek(week, engine.snapshot().clubId);
  }

  const s = engine.snapshot();
  console.log('\n=== OZET ===');
  console.log(`tur ${s.turn} | ${matchesPlayed} mac | ${decisionsMade} karar`);
  console.log(`sohret=${s.stature} kulup=${s.clubTier} hayat=${s.lifeState} medya=${s.mediaEra}`);
  console.log(
    `kimlik: sadakat=${s.persona.sadakat} mizac=${s.persona.mizac} durus=${s.persona.durus} dogruluk=${s.persona.dogruluk}`,
  );
  console.log(
    `servet=${s.flags['servet']} borc=${s.flags['borc']} form=${s.flags['form']} taraftar=${s.flags['taraftar_destegi']} disiplin=${s.flags['disiplin_sicili']}`,
  );
  console.log(
    `kondisyon=${s.flags['kondisyon']} tukenmislik=${s.flags['tukenmislik']} ` +
      `sakatlik_riski=${s.flags['sakatlik_riski']} milli_mac=${s.flags['milli_mac_sayisi']} kupa=${s.flags['kupa_sayisi']}`,
  );

  const memories = Object.keys(s.flagSetTurn).filter((k) => k.startsWith('mem_'));
  console.log(`kalici hafiza izleri (${memories.length}): ${memories.join(', ') || '-'}`);

  const seen = Object.keys(s.seenEvents);
  console.log(`gorulen olay: ${seen.length}/${loaded.eventCount}`);

  if (s.consequenceLog.length > 0) {
    console.log('\nKELEBEK GUNLUGU:');
    for (const t of s.consequenceLog.slice(-6)) {
      console.log(
        `  ${t.eventId} <- S${t.causedBySeason} H${t.causedByWeek} "${t.causedByChoiceText}"`,
      );
    }
  }
}

await main();
