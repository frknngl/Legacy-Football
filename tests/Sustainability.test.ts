import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LoadedDocument } from '../src/loading/ContentSource.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { MemoryContentSource } from '../src/loading/ContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { Validator } from '../src/validation/Validator.js';
import { HardcodedNameRule } from '../src/validation/rules/actors.js';
import { InterpolationRule } from '../src/validation/rules/quality.js';

const ORCHESTRATOR = [
  'core.json',
  'eras.json',
  'axes.json',
  'progression.json',
  'media_eras.json',
  'archetypes.json',
  'roles.json',
  'names.json',
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

/** Orkestratör gercek, olaylar sentetik: tek dosyanin etkisi izole olculur. */
async function loadWith(events: LoadedDocument[]): Promise<ContentRegistry> {
  const loaded = await new ContentLoader(new MemoryContentSource([...base, ...events])).load();
  expect(loaded.issues).toEqual([]);
  return loaded.registry!;
}

/** Yapisal kurallarin hepsini gecen minimal bir olay. */
function beatEvent(overrides: Record<string, unknown> = {}): LoadedDocument {
  return {
    path: 'events/life/evt_test_yeni.json',
    data: {
      id: 'evt_test_yeni',
      family: 'fam_test',
      category: 'life',
      tier: 'beat',
      weight: 10,
      cooldown: { self: 8, family: 4 },
      rootNode: 'n_root',
      nodes: {
        n_root: {
          title: 'Sessiz koridor',
          kind: 'branch',
          text: 'Tesisin alt katinda kimse yok. {actor.captain.first:gen} dolabinin kapagi acik kalmis ve icinden bir zarf gorunuyor. Uzerinde senin numaran yazili. Kimse bakmiyor, kamera yok, karar tamamen senin. Zarfi almak da almamak da bir seyi baslatir.',
          choices: [
            {
              id: 'c_open',
              text: 'Zarfi al ve ac.',
              effects: [
                { flag: 'mem_yepyeni_iz', op: 'set', value: true },
                { flag: 'moral', op: 'add', value: -6 },
                { flag: 'sokak_itibari', op: 'add', value: 8 },
              ],
            },
            {
              id: 'c_leave',
              text: 'Dokunma. Dolabi kapat ve yuru.',
              effects: [
                { flag: 'profesyonellik', op: 'add', value: 5 },
                { flag: 'moral', op: 'add', value: -3 },
              ],
            },
            {
              id: 'c_ask',
              text: 'Sor. Yuzune bakarak sor.',
              effects: [
                { flag: 'iliski_captain', op: 'add', value: 6 },
                { flag: 'medya_baskisi', op: 'add', value: 4 },
              ],
            },
          ],
        },
      },
      ...overrides,
    },
  };
}

describe('SURDURULEBILIRLIK -- yeni olay = sadece yeni JSON', () => {
  it('yeni bir mem_* izi core.json\u0027a dokunmadan calisir', async () => {
    const registry = await loadWith([beatEvent()]);

    const def = registry.flags.get('mem_yepyeni_iz');
    expect(def).toBeDefined();
    expect(def!.kind).toBe('memory');
    expect(def!.default).toBe(false);
  });

  it('slot flag\u0027leri roles.json\u0027dan turetilir', async () => {
    const registry = await loadWith([beatEvent()]);
    for (const key of ['iliski_captain', 'npc_captain_arc', 'slot_captain_bound', 'slot_captain_seasons']) {
      expect(registry.flags.has(key), key).toBe(true);
    }
  });

  it('tek dosya eklemek validator\u0027u kirmiyor', async () => {
    const registry = await loadWith([beatEvent()]);
    // Kismi icerik seti: korpus geneli kapsama kurallari atlanir.
    const report = new Validator(undefined, {}, false).run(registry);
    expect(report.findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('stat/resource gibi turler KATI kalir -- uydurulamaz', async () => {
    const registry = await loadWith([
      beatEvent({
        nodes: {
          n_root: {
            title: 'Sessiz koridor',
            kind: 'branch',
            text: 'Tesisin alt katinda kimse yok. Dolabin kapagi acik kalmis ve icinden bir zarf gorunuyor. Uzerinde senin numaran yazili. Kimse bakmiyor, kamera yok, karar tamamen senin. Zarfi almak da almamak da bir seyi baslatir.',
            choices: [
              {
                id: 'c_a',
                text: 'Al.',
                effects: [
                  { flag: 'mem_yepyeni_iz', op: 'set', value: true },
                  { flag: 'uydurma_stat', op: 'add', value: 5 },
                ],
              },
              { id: 'c_b', text: 'Birak.', effects: [{ flag: 'moral', op: 'add', value: -3 }] },
              { id: 'c_c', text: 'Sor.', effects: [{ flag: 'moral', op: 'add', value: 2 }] },
            ],
          },
        },
      }),
    ]);
    // Kismi icerik seti: korpus geneli kapsama kurallari atlanir.
    const report = new Validator(undefined, {}, false).run(registry);
    expect(
      report.findings.some(
        (f) => f.rule === 'UndeclaredFlagRule' && f.message.includes('uydurma_stat'),
      ),
    ).toBe(true);
  });
});

describe('HardcodedNameRule', () => {
  it('ad+soyad ikilisini yakalar', async () => {
    const registry = await loadWith([
      beatEvent({
        nodes: {
          n_root: {
            title: 'Koridor',
            kind: 'branch',
            text: 'Tesisin alt katinda kimse yok. Barış Tekin dolabinin kapagi acik kalmis ve icinden bir zarf gorunuyor. Uzerinde senin numaran yazili. Kimse bakmiyor, kamera yok, karar tamamen senin. Zarfi almak da almamak da bir seyi baslatir.',
            choices: [
              { id: 'c_a', text: 'Al.', effects: [{ flag: 'mem_yepyeni_iz', op: 'set', value: true }] },
              { id: 'c_b', text: 'Birak.', effects: [{ flag: 'moral', op: 'add', value: -3 }] },
              { id: 'c_c', text: 'Sor.', effects: [{ flag: 'moral', op: 'add', value: 2 }] },
            ],
          },
        },
      }),
    ]);
    const findings = HardcodedNameRule.check({ registry, events: registry.events });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('Barış Tekin');
  });

  it('sozluk kelimesiyle cakisan TEK adi yakalamaz', async () => {
    // "Deniz" hem ad hem deniz; "Kaya" hem soyad hem kaya. Tek kelime serbest.
    const registry = await loadWith([
      beatEvent({
        nodes: {
          n_root: {
            title: 'Kiyi',
            kind: 'branch',
            text: 'Otobus kiyi yolundan gecerken deniz gorunuyor ve kaya parcalari suyun icinde duruyor. Kimse konusmuyor. Camdan disari bakiyorsun, karar tamamen senin. Bu sessizlik bir seyi baslatir ya da bitirir.',
            choices: [
              { id: 'c_a', text: 'Bak.', effects: [{ flag: 'mem_yepyeni_iz', op: 'set', value: true }] },
              { id: 'c_b', text: 'Uyu.', effects: [{ flag: 'moral', op: 'add', value: -3 }] },
              { id: 'c_c', text: 'Konus.', effects: [{ flag: 'moral', op: 'add', value: 2 }] },
            ],
          },
        },
      }),
    ]);
    expect(HardcodedNameRule.check({ registry, events: registry.events })).toEqual([]);
  });
});

describe('InterpolationRule', () => {
  async function checkText(text: string) {
    const registry = await loadWith([
      beatEvent({
        nodes: {
          n_root: {
            title: 'Koridor',
            kind: 'branch',
            text,
            choices: [
              { id: 'c_a', text: 'Al.', effects: [{ flag: 'mem_yepyeni_iz', op: 'set', value: true }] },
              { id: 'c_b', text: 'Birak.', effects: [{ flag: 'moral', op: 'add', value: -3 }] },
              { id: 'c_c', text: 'Sor.', effects: [{ flag: 'moral', op: 'add', value: 2 }] },
            ],
          },
        },
      }),
    ]);
    return InterpolationRule.check({ registry, events: registry.events });
  }

  const scene =
    'Tesisin alt katinda kimse yok. Dolabin kapagi acik kalmis, icinden bir zarf gorunuyor. Uzerinde senin numaran yazili. Kimse bakmiyor, kamera yok, karar tamamen senin. Zarf bir seyi baslatir.';

  it('gecerli slot, alan ve filtreyi kabul eder', async () => {
    expect(
      await checkText(`${scene} {actor.captain.first:gen} {club.name:loc} {world.title_race_leader}`),
    ).toEqual([]);
  });

  it('bilinmeyen slotu reddeder', async () => {
    const f = await checkText(`${scene} {actor.yok_boyle_slot.name}`);
    expect(f[0]!.message).toContain('Bilinmeyen slot');
  });

  it('bilinmeyen aktor alanini reddeder', async () => {
    const f = await checkText(`${scene} {actor.captain.boyu}`);
    expect(f[0]!.message).toContain('Bilinmeyen aktor alani');
  });

  it('bilinmeyen ek filtresini reddeder', async () => {
    const f = await checkText(`${scene} {actor.captain.first:genitive}`);
    expect(f[0]!.message).toContain('Bilinmeyen ek filtresi');
  });

  it('bare {opponent} mac baglami olarak gecerlidir', async () => {
    expect(await checkText(`${scene} {opponent} deplasmani`)).toEqual([]);
  });
});
