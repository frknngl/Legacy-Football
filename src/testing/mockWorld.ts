/**
 * Mock dunya kurulumu -- tek cagriyla roster + world + feed.
 *
 * Kompozisyon koku burasi degil; CLI ve testler bu yardimciyi cagirir. DB
 * entegrasyonunda cagri `createDbWorld(...)` ile degistirilir, motor ve icerik
 * dosyalarinin hicbiri etkilenmez.
 */

import type { ContentRegistry } from '../loading/ContentRegistry.js';
import type { RosterProvider, WorldFeed, WorldProvider } from '../domain/roster.js';
import { loadMockClubs } from './loadMockClubs.js';
import { MockRosterProvider } from './MockRosterProvider.js';
import { MockWorldFeed } from './MockWorldFeed.js';
import { MockWorldProvider } from './MockWorldProvider.js';

export interface MockWorld {
  readonly roster: RosterProvider;
  readonly world: WorldProvider;
  readonly worldFeed: WorldFeed;
}

export async function createMockWorld(
  contentDir: string,
  registry: ContentRegistry,
  seed: number,
): Promise<MockWorld> {
  const clubs = await loadMockClubs(contentDir);
  const roster = new MockRosterProvider({
    clubs,
    names: registry.names,
    slots: [...registry.slots.values()],
    seed,
  });
  const world = new MockWorldProvider(clubs, seed);
  return { roster, world, worldFeed: new MockWorldFeed(world, clubs, seed) };
}
