import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { overallFor, type SlotDefinition } from '../src/domain/actors.js';
import type { NameConfig } from '../src/evaluation/NameForge.js';
import { loadMockClubs } from '../src/testing/loadMockClubs.js';
import { MockRosterProvider } from '../src/testing/MockRosterProvider.js';
import { MockWorldProvider } from '../src/testing/MockWorldProvider.js';
import { MockWorldFeed } from '../src/testing/MockWorldFeed.js';

const CONTENT_DIR = fileURLToPath(new URL('../content', import.meta.url));

async function readJson<T>(relPath: string): Promise<T> {
  const file = fileURLToPath(new URL(`../content/${relPath}`, import.meta.url));
  return JSON.parse(await readFile(file, 'utf-8')) as T;
}

async function build(seed: number) {
  const clubs = await loadMockClubs(CONTENT_DIR);
  const names = await readJson<NameConfig>('orchestrator/names.json');
  const roles = await readJson<{ slots: SlotDefinition[] }>('orchestrator/roles.json');
  const roster = new MockRosterProvider({ clubs, names, slots: roles.slots, seed });
  return { clubs, names, roster };
}

describe('MockRosterProvider', () => {
  it('ayni tohum ayni kadroyu dokar', async () => {
    const a = await build(1234);
    const b = await build(1234);
    expect(a.roster.squad('clb_yildiz').map((p) => p.displayName)).toEqual(
      b.roster.squad('clb_yildiz').map((p) => p.displayName),
    );
  });

  it('farkli tohum tamamen farkli bir kadro verir', async () => {
    const a = await build(1);
    const b = await build(2);
    const namesA = new Set(a.roster.squad('clb_yildiz').map((p) => p.displayName));
    const overlap = b.roster
      .squad('clb_yildiz')
      .filter((p) => namesA.has(p.displayName)).length;
    expect(overlap).toBeLessThan(3);
  });

  it('casting kurallari icin gereken uc noktayi garanti eder', async () => {
    const { roster } = await build(99);
    const squad = roster.squad('clb_bogazici');
    expect(squad).toHaveLength(18);
    expect(squad.some((p) => p.position === 'GK')).toBe(true);
    expect(Math.min(...squad.map((p) => p.age))).toBe(17);
    expect(Math.max(...squad.map((p) => p.age))).toBe(35);
  });

  it('kulup seviyesi yabanci isim oranindan hissedilir', async () => {
    const { roster } = await build(7);
    const foreign = (id: string): number =>
      roster.squad(id).filter((p) => p.origin !== 'tr').length;
    expect(foreign('clb_demirspor')).toBe(0);
    expect(foreign('clb_atlas')).toBeGreaterThan(foreign('clb_karadeniz'));
  });

  it('personel kadrosu tam ve cozulebilir', async () => {
    const { roster } = await build(42);
    const staff = roster.staff('clb_sancak');
    expect(staff.map((s) => s.role)).toContain('manager');
    const manager = staff.find((s) => s.role === 'manager');
    expect(roster.lookup(manager!.sourceId)).toEqual(manager);
  });

  it('nitelikler mevkiye gore sekillenir', async () => {
    const { roster } = await build(11);
    const squad = roster.squad('clb_yildiz');
    const avg = (pos: string, key: keyof (typeof squad)[number]['attributes']): number => {
      const group = squad.filter((p) => p.position === pos);
      return group.reduce((sum, p) => sum + p.attributes[key], 0) / group.length;
    };

    // Kaleci kurtarir, forvet bitirir, stoper keser. Tersi olamaz.
    expect(avg('GK', 'goalkeeping')).toBeGreaterThan(avg('FW', 'goalkeeping') + 30);
    expect(avg('FW', 'shooting')).toBeGreaterThan(avg('DF', 'shooting'));
    expect(avg('DF', 'defending')).toBeGreaterThan(avg('FW', 'defending'));
    expect(avg('MF', 'passing')).toBeGreaterThan(avg('FW', 'passing'));
  });

  it('quality niteliklerden TURETILIR, elle yazilmaz', async () => {
    const { roster } = await build(11);
    for (const p of roster.squad('clb_sancak')) {
      expect(p.quality).toBe(overallFor(p.position, p.attributes));
    }
  });

  it('mevki egilimi quality`yi carpitmaz -- kaleciler sistematik ustun degil', async () => {
    // Duzeltme olmasaydi `highest:quality` casting kurali her kulupte kaleciyi
    // secer, kaptan/yildiz slotlari hep kaleciye dokulurdu.
    const { roster, clubs } = await build(23);
    let gkTotal = 0;
    let gkCount = 0;
    let outTotal = 0;
    let outCount = 0;
    for (const club of clubs) {
      for (const p of roster.squad(club.id)) {
        if (p.position === 'GK') {
          gkTotal += p.quality;
          gkCount += 1;
        } else {
          outTotal += p.quality;
          outCount += 1;
        }
      }
    }
    expect(Math.abs(gkTotal / gkCount - outTotal / outCount)).toBeLessThan(5);
  });

  it('nitelikler de deterministik', async () => {
    const a = await build(777);
    const b = await build(777);
    expect(a.roster.squad('clb_toros').map((p) => p.attributes)).toEqual(
      b.roster.squad('clb_toros').map((p) => p.attributes),
    );
  });

  it('soguk onbellekte lookup kulubu isitip cozer', async () => {
    const { roster } = await build(5);
    expect(roster.lookup('mock:clb_toros:p3')).toBeDefined();
    expect(roster.lookup('mock:yok_boyle_kulup:p1')).toBeUndefined();
  });
});

describe('MockWorldProvider / MockWorldFeed', () => {
  it('puan durumu itibarla korele ama deterministik', async () => {
    const { clubs } = await build(3);
    const world = new MockWorldProvider(clubs, 3);
    const first = world.standings('tr_1');
    expect(first.length).toBeGreaterThan(0);
    expect(first[0]!.position).toBe(1);
    expect(new MockWorldProvider(clubs, 3).standings('tr_1')).toEqual(first);
  });

  it('sohret yukseldikce transfer menzili genisler', async () => {
    const { clubs } = await build(3);
    const world = new MockWorldProvider(clubs, 3);
    expect(world.transferTargets('lower', 'icon').length).toBeGreaterThan(
      world.transferTargets('lower', 'nobody').length,
    );
  });

  it('world tokenleri bos birakilmaz', async () => {
    const { clubs } = await build(3);
    const feed = new MockWorldFeed(new MockWorldProvider(clubs, 3), clubs, 3);
    const tokens = feed.tokens(1, 1);
    for (const value of Object.values(tokens)) expect(value).not.toBe('');
    expect(feed.headlines(1, 1).length).toBeGreaterThan(0);
  });
});
