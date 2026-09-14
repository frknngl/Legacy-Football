import { ARCHETYPES, type Archetype } from '../../src/domain/axes.js';
import { ContentLoader } from '../../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../../src/loading/FileSystemContentSource.js';
import { GameEngine } from '../../src/runtime/GameEngine.js';
import { Rng } from '../../src/selection/Rng.js';
import { randomOpenChoice, runSimulatedMatch } from '../../src/cli/runMatch.js';
import { selectWorld, weeklySelectionMatchContext } from '../../src/cli/world.js';
import { botTurn } from '../../src/cli/bot.js';

const reg = (await new ContentLoader(new FileSystemContentSource('content')).load()).registry!;
let sackings = 0;
let careersWithSacking = 0;
const attrChanged: number[] = [];
const incoming: string[] = [];
const coachAfter: string[] = [];

for (let i = 0; i < 12; i += 1) {
  const seed = 90000 + i * 37;
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

  let seen = 0;
  let changes = 0;
  let lastAttr = '';
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
    // Kovulma izi
    const s = engine.snapshot();
    if (s.flags['mem_hoca_kovuldu'] === true && s.flagSetTurn['mem_hoca_kovuldu'] === s.turn) {
      seen += 1;
      // YENI HOCA KIM? Anlatidaki aktor gercek bir personele mi baglandi?
      const actorId = (s as unknown as { casting: Record<string, string> }).casting['manager'];
      const actor = (s as unknown as { actors: Record<string, { sourceId?: string; name: string }> }).actors[actorId ?? ''];
      const src = actor?.sourceId;
      const person = src === undefined ? undefined : sim.roster.staff(s.clubId).find((p) => p.sourceId === src);
      incoming.push(src === undefined ? 'PROSEDUREL (kaynaksiz)' : person?.attributes ? 'PERSONEL + nitelik' : person ? 'PERSONEL ama niteliksiz' : 'kaynakli ama kulup disi');
      // Kovulmadan HEMEN SONRA motorun takim gucune verdigi hoca:
      const srcNow = engine.managerSourceIdFor(s.clubId);
      const engineCoach = srcNow === undefined ? undefined : sim.roster.lookup(srcNow);
      const attr = (engineCoach as { attributes?: { tactical: number } } | undefined)?.attributes;
      coachAfter.push(
        `motor: ${(engineCoach as { displayName?: string } | undefined)?.displayName ?? 'YOK'}` +
          ` (tac ${attr?.tactical ?? '-'}) | anlatida: ${actor?.name ?? 'yok'}`,
      );
    }

    // Takim gucune giren hocanin nitelikleri degisti mi?
    const src = engine.managerSourceIdFor(s.clubId);
    const mgr = (src === undefined ? undefined : sim.roster.lookup(src)) as
      | { attributes?: { tactical: number; motivation: number } }
      | undefined;
    const sig = `${s.clubId}|${mgr?.attributes ? `${mgr.attributes.tactical}/${mgr.attributes.motivation}` : 'YOK'}`;
    if (lastAttr !== '' && sig !== lastAttr) changes += 1;
    lastAttr = sig;

    if (report.season !== season) { season = report.season; engine.closeAgentSeason(true); }
    botTurn(engine, sim.roster, botRng, report.week);
    const st = engine.snapshot();
    for (let slot = 0; slot < sim.schedule.fixturesFor(st.clubId, st.week).length; slot += 1) {
      await runSimulatedMatch(engine, sim.simulator,
        { chooseMoment: (n: any) => randomOpenChoice(n, (m: number) => rng.int(m)) },
        { season: st.season, week: st.week, slot });
    }
  }
  sackings += seen;
  if (seen > 0) careersWithSacking += 1;
  attrChanged.push(changes);
  sim.close?.();
}
console.log(`12 kariyer:`);
console.log(`  teknik direktor KOVULMASI      : ${sackings} kez, ${careersWithSacking}/12 kariyerde`);
console.log(`  takim gucune giren hoca DEGISIMI: ${attrChanged.reduce((a, b) => a + b, 0)} kez`);
console.log(`  (bu degisimler yalnizca Hero TRANSFER olunca -- kulup degistiginden)`);
console.log('');
console.log('--- KOVULMADAN SONRA GELEN HOCA');
const tally = new Map<string, number>();
for (const k of incoming) tally.set(k, (tally.get(k) ?? 0) + 1);
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(26)} ${v}`);
console.log('');
console.log('--- MOTORUN TAKIM GUCUNE VERDIGI HOCA vs ANLATIDAKI HOCA (ilk 6)');
for (const l of coachAfter.slice(0, 6)) console.log(`  ${l}`);
