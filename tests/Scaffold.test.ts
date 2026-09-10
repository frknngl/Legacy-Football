/**
 * ISKELE SABLONU -- `npm run scaffold` ciktisi her zaman yesil baslamali.
 *
 * Sablon bir kez curursa yazilan her yeni olay curuk baslar. Bu test, yeni
 * bir kural eklendiginde sablonun da guncellenmesini ZORUNLU kilar.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildEventDoc, memoryFlagFor } from '../src/cli/scaffold.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { MemoryContentSource, type LoadedDocument } from '../src/loading/ContentSource.js';
import { Validator } from '../src/validation/Validator.js';

const ORCHESTRATOR = [
  'core.json',
  'eras.json',
  'axes.json',
  'progression.json',
  'media_eras.json',
  'archetypes.json',
  'roles.json',
  'names.json',
  'nemesis.json',
  'endings.json',
];

let base: LoadedDocument[];

beforeAll(async () => {
  base = await Promise.all(
    ORCHESTRATOR.map(async (name) => ({
      path: `orchestrator/${name}`,
      data: JSON.parse(
        await readFile(fileURLToPath(new URL(`../content/orchestrator/${name}`, import.meta.url)), 'utf-8'),
      ) as unknown,
    })),
  );
});

/** Iskeleyi tek basina yukleyip dogrular. */
async function validateScaffold(
  tier: 'minor' | 'major' | 'epic',
  category = 'life',
): Promise<{ errors: string[]; warnings: string[] }> {
  const id = `evt_${category}_iskele_${tier}`;
  const doc = buildEventDoc({
    id,
    category,
    tier,
    family: `fam_iskele_${tier}`,
    actor: 'manager',
  });

  // Arkin asama olaylari bu izole yuklemede yok; rakip arkini disarida birak.
  const orchestrator = base.filter((d) => !d.path.endsWith('nemesis.json'));
  const loaded = await new ContentLoader(
    new MemoryContentSource([...orchestrator, { path: `events/${category}/${id}.json`, data: doc }]),
  ).load();
  expect(loaded.issues, 'iskele ayristirilamadi').toEqual([]);

  const report = new Validator().run(loaded.registry!);
  // Izole yuklemede orkestratör kapsamasi zaten eksiktir; yalnizca dosyanin
  // KENDI bulgulari sablonun kalitesini olcer.
  const mine = report.findings.filter((f) => f.file.includes(id));
  return {
    errors: mine.filter((f) => f.severity === 'error').map((f) => `${f.rule}: ${f.message}`),
    warnings: mine.filter((f) => f.severity === 'warn').map((f) => f.rule),
  };
}

describe('iskele sablonu', () => {
  for (const tier of ['minor', 'major', 'epic'] as const) {
    it(`${tier} iskelesi YAPISAL olarak temiz`, async () => {
      // Iskelenin kendi yapisi kusursuz olmali: kirik hedef, eksik
      // secenek, kilitli cikmaz, tanimsiz bayrak YOK.
      //
      // Tek istisna kasitli: sablon bir `mem_*` izi birakir ve onu
      // okuyacak olayi YAZAR baglar. Asagidaki test tam olarak bunu
      // ayirt ediyor.
      const { errors } = await validateScaffold(tier);
      expect(errors.filter((e) => !e.startsWith('OrphanMemoryFlagRule'))).toEqual([]);
    });
  }

  it('tek engel kalir: yazarin baglamasi gereken kelebek', async () => {
    // CIRCIR: eskiden bu bir UYARIYDI ve gormezden gelinebiliyordu --
    // olculdu ki 204 memory bayragindan 180'i hic okunmuyordu. Artik
    // taban listesinde OLMAYAN her yeni yetim HATA. Iskelenin izi de
    // yeni oldugu icin hata veriyor ve bu DOGRU: sablon yaziri "bu izi
    // baglamadan bitirmedin" diye durduruyor.
    const { errors, warnings } = await validateScaffold('major');
    expect([...new Set([...errors.map((e) => e.split(':')[0]), ...warnings])]).toEqual([
      'OrphanMemoryFlagRule',
    ]);
  });

  it('iz adi olay id\'sinden turer ve yazara bildirilir', () => {
    expect(memoryFlagFor('evt_life_wedding')).toBe('mem_life_wedding');
  });

  it('her secim en az iki flag etkisi tasir -- bedelsiz secim yok', () => {
    const doc = buildEventDoc({
      id: 'evt_life_x',
      category: 'life',
      tier: 'major',
      family: 'fam_x',
      actor: 'manager',
    });
    const root = (doc['nodes'] as Record<string, { choices?: unknown[] }>)['n_root']!;
    const choices = root.choices as { effects: unknown[] }[];
    expect(choices).toHaveLength(4);
    for (const c of choices) expect(c.effects.length).toBeGreaterThanOrEqual(2);
  });

  it('her secenek kendi sonuc nodeuna gider -- dolgu secim yok', () => {
    const doc = buildEventDoc({
      id: 'evt_life_y',
      category: 'life',
      tier: 'epic',
      family: 'fam_y',
      actor: 'captain',
    });
    const nodes = doc['nodes'] as Record<string, { choices?: { target?: string }[] }>;
    const targets = nodes['n_root']!.choices!.map((c) => c.target!);
    expect(new Set(targets).size).toBe(targets.length);
    for (const t of targets) expect(nodes[t], t).toBeDefined();
  });

  it('varsayilan olarak authored: hand, repeatPolicy, story ve _yazar_notu uretir', () => {
    const doc = buildEventDoc({
      id: 'evt_business_sponsor_anlasma',
      category: 'business',
      tier: 'major',
      family: 'fam_business_sponsor',
      actor: 'sporting_director',
      era: 'rookie',
    });
    expect(doc['authored']).toBe('hand');
    expect(doc['_yazar_notu']).toBeDefined();
    expect(doc['story']).toEqual({
      signature: 'business:sporting_director:sponsor_anlasma',
      slot: 'sporting_director',
      beat: 'sponsor_anlasma',
    });
    expect(doc['repeatPolicy']).toEqual({
      arcGapTurns: 16,
      beatGapTurns: 45,
      signatureGapTurns: 30,
      maxBeatUses: 6,
    });
    expect(doc['eras']).toEqual(['rookie']);
  });
});
