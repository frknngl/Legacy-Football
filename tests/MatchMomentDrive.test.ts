/**
 * MAC ANI SURUSU -- host'un geri cagrim vermemesi secimi YUTMAMALI.
 *
 * Gercek bir hatanin nobetcisi:
 *   `ui.onChoiceMade?.(engine.choose(id))` yazilmisti. JavaScript'te
 *   `a?.(b())` ifadesi `a` tanimsizsa `b()`yi HIC calistirmaz --
 *   opsiyonel cagri argumanlariyla birlikte kisa devre yapar.
 *
 *   Sonuc: `onChoiceMade` vermeyen bir host'ta mac ani secimi sessizce
 *   yutuluyor, dugum ilerlemiyor, ic dongu bosa donuyor ve dugum ACIK
 *   kaliyordu. Bir sonraki `presentMoment` "onceki mac ani hala acik"
 *   diye patliyordu: MAC ORTASINDA cokme.
 *
 *   `npm run simulate` bunu hic gormedi cunku tesadufen `onChoiceMade`
 *   veriyor. Hata yalnizca geri cagrimsiz host'ta gorunuyordu.
 *
 * Bu test iki host'u karsilastirir: geri cagrimli ve geri cagrimsiz.
 * Ikisi de AYNI sayida secim uygulamali.
 */

import { describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { Rng } from '../src/selection/Rng.js';
import { randomOpenChoice, runSimulatedMatch } from '../src/cli/runMatch.js';
import { selectWorld } from '../src/cli/world.js';

async function playOneMatch(withCallback: boolean): Promise<number> {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  const registry = loaded.registry!;
  const world = await selectWorld({ registry, seed: 3, dbPath: '' });
  const engine = new GameEngine(registry, {
    seed: 3,
    roster: world.roster,
    world: world.world,
    worldFeed: world.worldFeed,
  });
  engine.start('street');

  const rng = new Rng(99);
  let applied = 0;

  // Bir mac cikana kadar ilerle; her turda acik sahneleri kapat.
  for (let turn = 0; turn < 60; turn += 1) {
    engine.advanceTurn();
    for (let guard = 0; guard < 20 && engine.currentNode(); guard += 1) {
      const open = engine.availableChoices().filter((c) => !c.locked);
      if (open.length === 0) break;
      engine.choose(open[rng.int(open.length)]!.id);
    }
    const week = engine.snapshot().week;
    await runSimulatedMatch(
      engine,
      world.simulator,
      {
        chooseMoment: (node) => randomOpenChoice(node, (max) => rng.int(max)),
        ...(withCallback ? { onChoiceMade: () => { applied += 1; } } : {}),
      },
      { season: engine.snapshot().season, week },
    );
    world.recordHeroMatch();
    world.advanceWeek(week, engine.snapshot().clubId);
  }
  return engine.snapshot().turn;
}

describe('mac ani surusu', () => {
  it('geri cagrimsiz host da 60 turu TAMAMLAR -- secimler yutulmaz', async () => {
    // Kisa devre hatasi varken bu cagri ikinci mac aninda
    // "Onceki mac ani hala acik" ile PATLIYORDU.
    await expect(playOneMatch(false)).resolves.toBeGreaterThan(1);
  });

  it('geri cagrimli ve geri cagrimsiz host AYNI noktaya varir', async () => {
    const [withCb, without] = await Promise.all([playOneMatch(true), playOneMatch(false)]);
    expect(without).toBe(withCb);
  });
});
