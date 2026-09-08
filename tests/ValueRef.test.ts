/**
 * BAYRAKTAN OKUNAN DEGER (`ValueRef`).
 *
 * OLCULEN SORUN: efekt degerleri ya sabitti ya da `ScalableValue` ile
 * yalnizca `stature`/`clubTier`/`season` eksenlerinde olcekleniyordu.
 * Yani "yatirdigin kadar kaybet" cumlesi efekt dilinde KURULAMIYORDU --
 * cunku yatirilan miktari oyuncu secer, yazar degil. Kumar, kredi
 * taksiti, maasa oranli prim ve borcun bir kismini kapatma gibi her
 * mekanik ayni duvara carpiyordu.
 *
 * `ValueRef` tek bir ilkelle hepsini aciyor:
 *   deger = flags[ref] * (mul ?? 1) + (add ?? 0), sonra kirpma.
 *
 * Sessiz sifir en kotu sonuc olurdu (bahis kaybi 0 TL, taksit hic
 * kesilmez, hicbir yerde hata gorunmez) -- bu yuzden `ValueRefRule`
 * referansi BUILD ZAMANINDA denetliyor.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { EffectApplier, resolveValueRef } from '../src/evaluation/EffectApplier.js';
import { isValueRef, isScalableValue } from '../src/domain/effects.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { MemoryContentSource } from '../src/loading/ContentSource.js';
import type { LoadedDocument } from '../src/loading/ContentSource.js';
import { Validator } from '../src/validation/Validator.js';
import { ValueRefRule } from '../src/validation/rules/structure.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CONTENT_SOURCE, SCALE, testRegistry, testState } from './helpers.js';

describe('ValueRef cozumu', () => {
  const flags = { son_bahis_tutari: 5000, borc: 20000, yok_boyle_sey_degil: 0, bayrak_bool: true };

  it('duz okuma', () => {
    expect(resolveValueRef({ ref: 'son_bahis_tutari' }, flags)).toBe(5000);
  });

  it('carpan -- "yatirdigin kadar kaybet"', () => {
    expect(resolveValueRef({ ref: 'son_bahis_tutari', mul: -1 }, flags)).toBe(-5000);
  });

  it('carpan -- "35`e 1 rulet"', () => {
    expect(resolveValueRef({ ref: 'son_bahis_tutari', mul: 35 }, flags)).toBe(175000);
  });

  it('kesirli carpan -- "borcun yarisi"', () => {
    expect(resolveValueRef({ ref: 'borc', mul: -0.5 }, flags)).toBe(-10000);
  });

  it('add ile birlikte', () => {
    expect(resolveValueRef({ ref: 'son_bahis_tutari', mul: 2, add: 1000 }, flags)).toBe(11000);
  });

  it('kirpma uygulaniyor', () => {
    expect(resolveValueRef({ ref: 'son_bahis_tutari', mul: 100, clampMax: 50000 }, flags)).toBe(50000);
    expect(resolveValueRef({ ref: 'borc', mul: -10, clampMin: -1000 }, flags)).toBe(-1000);
  });

  it('boolean 0/1 veriyor', () => {
    expect(resolveValueRef({ ref: 'bayrak_bool', mul: 250 }, flags)).toBe(250);
  });

  it('yazilmamis bayrak 0 -- zarif bozulma (bahis oynanmadan tutar 0`dir)', () => {
    expect(resolveValueRef({ ref: 'hic_yazilmadi', mul: -1 }, flags)).toBe(0);
  });

  it('tam sayiya yuvarlaniyor', () => {
    expect(Number.isInteger(resolveValueRef({ ref: 'borc', mul: 0.333 }, flags))).toBe(true);
  });
});

describe('Sekil ayrimi', () => {
  it('ValueRef ile ScalableValue birbirine karismiyor', () => {
    const ref = { ref: 'servet', mul: 2 };
    const scalable = { scaleBy: 'stature' as const, base: 100, perTier: 50 };
    expect(isValueRef(ref)).toBe(true);
    expect(isScalableValue(ref)).toBe(false);
    expect(isValueRef(scalable)).toBe(false);
    expect(isScalableValue(scalable)).toBe(true);
  });
});

// --------------------------------------------------------------- kural

const ORCHESTRATOR = [
  'core.json', 'eras.json', 'axes.json', 'progression.json',
  'media_eras.json', 'archetypes.json', 'roles.json', 'names.json',
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

/** Verilen ValueRef'i tasiyan minimal bir olay kurar ve kurali calistirir. */
async function findingsFor(value: unknown): Promise<string[]> {
  const doc: LoadedDocument = {
    path: 'events/money/evt_money_ref_testi.json',
    data: {
      id: 'evt_money_ref_testi',
      family: 'fam_ref_testi',
      category: 'money',
      tier: 'minor',
      weight: 10,
      cooldown: { self: 10, family: 5 },
      rootNode: 'n_kok',
      nodes: {
        n_kok: {
          id: 'n_kok', title: 'Masa', kind: 'branch',
          text: 'Krupiye jetonlari kaydiriyor ve sana bakiyor.',
          choices: [
            {
              id: 'c_oyna', text: 'Oyna.',
              effects: [{ flag: 'servet', op: 'add', value }],
            },
            { id: 'c_kalk', text: 'Masadan kalk.', effects: [{ flag: 'moral', op: 'add', value: -3 }] },
            { id: 'c_bekle', text: 'Bir el daha izle.', effects: [{ flag: 'moral', op: 'add', value: -1 }] },
          ],
        },
      },
    },
  };
  const loaded = await new ContentLoader(new MemoryContentSource([...base, doc])).load();
  if (!loaded.registry) return ['ICERIK YUKLENEMEDI'];
  const report = new Validator([ValueRefRule]).run(loaded.registry);
  return report.findings.map((f) => f.message);
}

describe('ValueRefRule', () => {
  it('gecerli referansi GECIRIYOR', async () => {
    expect(await findingsFor({ ref: 'borc', mul: -1 })).toEqual([]);
  });

  it('tanimsiz bayragi yakaliyor -- sessiz 0 en kotu sonuc', async () => {
    const f = await findingsFor({ ref: 'boyle_bir_bayrak_yok', mul: 2 });
    expect(f.join(' ')).toContain('boyle_bir_bayrak_yok');
  });

  it('sayisal olmayan bayragi yakaliyor', async () => {
    const f = await findingsFor({ ref: 'mem_sozlesme_bozdu', mul: 2 });
    expect(f.join(' ')).toContain('sayisal degil');
  });

  it('sacma carpani yakaliyor -- ekonomiyi tek sahnede patlatir', async () => {
    const f = await findingsFor({ ref: 'borc', mul: 5000 });
    expect(f.join(' ')).toContain('yazim hatasi');
  });

  it('sifir carpani yakaliyor -- olu efekt', async () => {
    const f = await findingsFor({ ref: 'borc', mul: 0 });
    expect(f.join(' ')).toContain('hicbir sey yapmaz');
  });

  it('severity `error` -- yeni ilkel, grandfather edilecek ihlal yok', () => {
    expect(ValueRefRule.defaultSeverity).toBe('error');
  });
});

describe('Uctan uca -- EffectApplier gercekten uyguluyor', () => {
  const applier = new EffectApplier(testRegistry());

  it('bahis kaybi: yatirilan tutar servetten dusuyor', () => {
    const s = testState();
    s.flags['servet'] = 100_000;
    s.flags['son_bahis_tutari'] = 25_000;

    applier.applyFlag(
      { flag: 'servet', op: 'add', value: { ref: 'son_bahis_tutari', mul: -1 } },
      s, SCALE, CONTENT_SOURCE,
    );
    expect(s.flags['servet']).toBe(75_000);
  });

  it('bahis kazanci: ayni tutar 35 kat geri geliyor', () => {
    const s = testState();
    s.flags['servet'] = 100_000;
    s.flags['son_bahis_tutari'] = 2_000;

    applier.applyFlag(
      { flag: 'servet', op: 'add', value: { ref: 'son_bahis_tutari', mul: 35 } },
      s, SCALE, CONTENT_SOURCE,
    );
    expect(s.flags['servet']).toBe(170_000);
  });

  it('MIKTARI OYUNCU BELIRLIYOR -- ayni efekt farkli bahislerde farkli sonuc', () => {
    const kucuk = testState();
    kucuk.flags['servet'] = 100_000;
    kucuk.flags['son_bahis_tutari'] = 1_000;

    const buyuk = testState();
    buyuk.flags['servet'] = 100_000;
    buyuk.flags['son_bahis_tutari'] = 50_000;

    const effect = { flag: 'servet', op: 'add' as const, value: { ref: 'son_bahis_tutari', mul: -1 } };
    applier.applyFlag(effect, kucuk, SCALE, CONTENT_SOURCE);
    applier.applyFlag(effect, buyuk, SCALE, CONTENT_SOURCE);

    // Tek bir yazilmis efekt, iki farkli sonuc. Eski sistemde bu
    // imkansizdi: deger sabit ya da kademeye baglıydı.
    expect(kucuk.flags['servet']).toBe(99_000);
    expect(buyuk.flags['servet']).toBe(50_000);
  });
});
