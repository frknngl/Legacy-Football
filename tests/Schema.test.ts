/**
 * SEMA <-> AYRISTIRICI SOZLESMESI.
 *
 * Iki ayri dogruluk kaynagi var: `parse.ts` (calisma zamani, KESIN Turkce hata)
 * ve `schema/event.schema.json` (editor otomatik tamamlama, LLM'e verilen
 * makine-okunur sozlesme). Ikisi ayrisirsa yazar semaya guvenip ayristiricinin
 * reddettigi bir sey yazar -- ya da tersi.
 *
 * Bu test ikisini birbirine baglar: korpustaki her olay HER IKISINI de gecmeli.
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Ajv, type ValidateFunction } from 'ajv';
import { beforeAll, describe, expect, it } from 'vitest';
import { ParseContext, parseEvent } from '../src/loading/parse.js';

const EVENTS_DIR = fileURLToPath(new URL('../content/events', import.meta.url));

interface EventFile {
  readonly rel: string;
  readonly data: unknown;
}

let validate: ValidateFunction;
let validateCore: ValidateFunction;
let files: EventFile[];

async function collect(dir: string, prefix = ''): Promise<EventFile[]> {
  const out: EventFile[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await collect(`${dir}/${entry.name}`, rel)));
    else if (entry.name.endsWith('.json')) {
      out.push({ rel, data: JSON.parse(await readFile(`${dir}/${entry.name}`, 'utf-8')) });
    }
  }
  return out;
}

async function loadJson(relative: string): Promise<object> {
  return JSON.parse(await readFile(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')) as object;
}

beforeAll(async () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  validate = ajv.compile(await loadJson('../schema/event.schema.json'));
  validateCore = ajv.compile(await loadJson('../schema/core.schema.json'));
  files = await collect(EVENTS_DIR);
});

describe('event.schema.json', () => {
  it('korpus bos degil', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('her olay semayi geciyor', () => {
    const failures: string[] = [];
    for (const file of files) {
      if (validate(file.data)) continue;
      const detail = (validate.errors ?? [])
        .slice(0, 4)
        .map((e) => `${e.instancePath || '/'} ${e.message}`)
        .join(' | ');
      failures.push(`${file.rel}: ${detail}`);
    }
    expect(failures).toEqual([]);
  });

  it('her olay ayristiriciyi geciyor', () => {
    const failures: string[] = [];
    for (const file of files) {
      const ctx = new ParseContext(file.rel);
      parseEvent(file.data, ctx, file.rel);
      if (!ctx.ok) {
        failures.push(`${file.rel}: ${ctx.issues.map((i) => `${i.path} ${i.message}`).join(' | ')}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('semanin reddettigi seyi ayristirici da reddediyor', () => {
    // `requires` var ama `lockLabel` yok: oyuncu neyi kacirdigini goremez.
    const broken = {
      id: 'evt_test_contract',
      family: 'fam_test_contract',
      category: 'media',
      tier: 'minor',
      cooldown: { self: 10, family: 5 },
      rootNode: 'n_root',
      nodes: {
        n_root: {
          title: 'Baslik',
          kind: 'branch',
          text: 'Metin.',
          choices: [
            { id: 'c_free', text: 'Kosulsuz.', target: 'n_end' },
            {
              id: 'c_locked',
              text: 'Kilitli.',
              target: 'n_end',
              requires: { flag: 'liderlik', op: 'gte', value: 70 },
            },
          ],
        },
        n_end: { title: 'Son', kind: 'outcome', text: 'Kapanis.' },
      },
    };

    expect(validate(broken)).toBe(false);

    const ctx = new ParseContext('test');
    parseEvent(broken, ctx, 'test');
    expect(ctx.ok).toBe(false);
  });

  it('repeatPolicy.maxBeatUses sifirdan buyuk olmali', () => {
    const broken = {
      id: 'evt_test_repeat_policy',
      family: 'fam_test_repeat_policy',
      category: 'media',
      tier: 'minor',
      cooldown: { self: 10, family: 5 },
      story: {
        arc: 'agent_arc',
        beat: 'offer_1',
        signature: 'media:agent:offer_1',
      },
      repeatPolicy: {
        maxBeatUses: 0,
      },
      rootNode: 'n_root',
      nodes: {
        n_root: {
          title: 'Baslik',
          kind: 'outcome',
          text: 'Metin.',
        },
      },
    };

    expect(validate(broken)).toBe(false);

    const ctx = new ParseContext('test');
    parseEvent(broken, ctx, 'test');
    expect(ctx.ok).toBe(false);
  });
});

describe('core.schema.json', () => {
  it('flag registry semayi geciyor', async () => {
    const core = await loadJson('../content/orchestrator/core.json');
    const ok = validateCore(core);
    expect(validateCore.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('core.json semaya isaret ediyor', async () => {
    const core = (await loadJson('../content/orchestrator/core.json')) as { $schema?: string };
    expect(core.$schema).toBe('../../schema/core.schema.json');
  });
});
