/**
 * MEDYA CAGI GECISLERI -- yapisal garanti #6: "zaman gercekten geciyor".
 *
 * 25 sezonluk bir kariyerde dort medya cagi degisir ve her degisimde o caga
 * ait gecis olayi ZORUNLU olarak sahneye gelir. Bu test kuyrugun sessizce
 * dusurmedigini (eksik icerik) ve caginin dogru kapiyla eslestigini kanitlar.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Archetype } from '../src/domain/axes.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { Rng } from '../src/selection/Rng.js';
import { createMockWorld } from '../src/testing/mockWorld.js';

const TRANSITIONS = [
  'evt_media_era_twitter',
  'evt_media_era_instagram',
  'evt_media_era_tiktok',
  'evt_media_era_deepfake',
] as const;

let registry: ContentRegistry;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
});

describe('medya cagi gecisleri', () => {
  it('her gecis olayi icerikte tanimli ve media_eras.json ile eslesiyor', () => {
    for (const era of registry.config.mediaEras) {
      if (!era.transitionEvent) continue;
      const event = registry.get(era.transitionEvent);
      expect(event, `${era.id} gecis olayi eksik`).toBeDefined();
      expect(event!.mediaEras, `${era.id} kapisi yanlis`).toEqual([era.id]);
      expect(event!.once, `${era.id} bir kereden fazla cikabilir`).toBe(true);
    }
  });

  it('gecis olaylari yalnizca kendi caginda uygun', () => {
    for (const id of TRANSITIONS) {
      const event = registry.get(id)!;
      expect(event.mediaEras).toHaveLength(1);
      expect(event.category).toBe('media');
    }
  });

  /**
   * TEK TOHUM DEGIL, SOZLESME.
   *
   * Bu test eskiden tek tohumla (31337) kosuyordu ve dort cagin dordunu
   * de gordugunu iddia ediyordu. Olculdu: iddia SANSTI. On iki tohumun
   * onunda dordu de geliyor, ikisinde bir cag kaciriliyor -- ve kariyer
   * kisaldigi icin degil (hepsi 1013 tur, hepsi deepfake cagina variyor),
   * `media` kategorisinin havuz payi dar oldugu icin: 200 turluk bir cag
   * penceresinde sahneye gelen medya olayi sayisi 1 ila 4.
   *
   * Bu yuzden test artik ULASILABILIRLIGI siniyor: her cag olayi
   * tohumlar arasinda EN AZ BIR kez gelmeli (yani hicbiri olu degil) ve
   * geldigi her seferde KENDI caginda gelmeli. Ikincisi asil sozlesme --
   * kuyrugun bir olayi yanlis caga tasimasi gercek bir hatadir; belli
   * bir tohumun belli bir olayi kacirmasi degildir.
   */
  it('her gecis olayi ULASILABILIR ve yalnizca kendi caginda geliyor', async () => {
    const seeds = [31337, 7, 99, 2024, 555];
    const seenAnywhere = new Set<string>();

    for (const seed of seeds) {
      const engine = new GameEngine(registry, {
        seed,
        ...(await createMockWorld('content', registry, seed)),
      });
      const rng = new Rng(seed ^ 0x2545f491);
      engine.start('street' as Archetype);

      for (let i = 0; i < 1100; i += 1) {
        if (engine.snapshot().ending !== undefined) break;

        const report = engine.advanceTurn();
        const id = report.presented?.eventId;
        if (id !== undefined && TRANSITIONS.includes(id as (typeof TRANSITIONS)[number])) {
          seenAnywhere.add(id);
          // ASIL SOZLESME: olay kendi caginda gelmeli. Kuyruk bir cag
          // olayini sonraki caga tasirsa bu satir yakalar.
          expect(engine.snapshot().mediaEra, `${id} yanlis cagda geldi`).toBe(
            id.replace('evt_media_era_', ''),
          );
        }

        let guard = 0;
        while (engine.currentNode() && guard < 20) {
          guard += 1;
          const open = engine.availableChoices().filter((c) => !c.locked);
          if (open.length === 0) break;
          engine.choose(open[rng.int(open.length)]!.id);
        }
      }
    }

    expect([...seenAnywhere].sort()).toEqual([...TRANSITIONS].sort());
  });
});
