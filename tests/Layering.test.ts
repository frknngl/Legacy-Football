/**
 * KATMAN KORKULUGU -- mimari kural artik gelenek degil, test.
 *
 * OLCULEN SORUN:
 *   Katman disiplini gercekti (`domain` hicbir ust katmandan import
 *   etmiyor, `simulation` yalnizca `domain` + `selection/Rng` goruyor)
 *   ama HICBIR SEY onu denetlemiyordu: projede eslint yapilandirmasi
 *   bile yok. Disiplin yalnizca dikkатle yuruyordu.
 *
 * NEDEN SIMDI:
 *   Ekonomi/bahis, isyan ve telefon modulleri eklenecek. Uc buyuk modul
 *   bu disiplini test eder. Korkuluk modullerden ONCE konmali -- sonra
 *   koymak, birikmis ihlalleri once temizlemek demektir ve o is her
 *   gecen commit'te buyur.
 *
 * KURAL:
 *   Her katmanin bir RUTBESI var. Bir katman yalnizca KENDINDEN DUSUK
 *   rutbeli katmanlari import edebilir. Ayni rutbe yalnizca asagida
 *   ADI GECEN istisnalarda serbest.
 *
 *   Ayrica iki sert kural:
 *     - `domain` hicbir src katmanina bagimli olamaz (en dip).
 *     - `src` hicbir zaman `tools`u goremez (arac hatti ayri dunya).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Katman rutbeleri. Dusuk sayi = daha dip.
 *
 * Belgelenen sira: cli -> runtime -> selection -> loading -> evaluation
 * -> domain. `simulation` yan bir daldir; `adapters`/`validation`/
 * `testing` runtime'in uzerinde ama cli'nin altinda durur.
 */
const RANK: Readonly<Record<string, number>> = {
  domain: 0,
  evaluation: 1,
  loading: 2,
  selection: 3,
  simulation: 4,
  runtime: 5,
  adapters: 6,
  validation: 6,
  testing: 6,
  cli: 7,
};

/**
 * Ayni rutbeli katmanlar arasinda IZIN VERILEN kenarlar.
 *
 * Her istisna GEREKCELIDIR. Gerekcesiz istisna, kuralin sessizce
 * asinmasidir; liste buyuyorsa mimari kayiyor demektir.
 */
const SAME_RANK_ALLOWED: readonly { from: string; to: string; reason: string }[] = [
  {
    from: 'adapters',
    to: 'testing',
    reason:
      'dbWorld.ts, MockWorldFeed`i paylasiyor: simulatedWorld ile birebir ayni ' +
      'sozlesmeyi uretiyor, ikinci bir kopya cikarmak yerine tek kaynak kullaniliyor.',
  },
];

/** `simulation` yalnizca bunlari gorebilir. Belgelenen en dar sozlesme. */
const SIMULATION_ALLOWED_LAYERS = new Set(['domain', 'selection']);
/** ...ve `selection`dan yalnizca bu modulu. */
const SIMULATION_ALLOWED_SELECTION_MODULES = new Set(['Rng']);

const SRC = fileURLToPath(new URL('../src', import.meta.url));

interface ImportEdge {
  readonly file: string;
  readonly fromLayer: string;
  readonly toLayer: string;
  /** `selection/Rng.js` -> `Rng` */
  readonly toModule: string;
  readonly specifier: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** `../../domain/flags.js` + kaynak yolu -> cozulmus src-goreli parcalar. */
function resolveSpecifier(fileRel: string, specifier: string): string[] | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const parts = fileRel.split('/').slice(0, -1);
  for (const seg of specifier.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts;
}

function collectEdges(): { edges: ImportEdge[]; toolsImports: string[] } {
  const edges: ImportEdge[] = [];
  const toolsImports: string[] = [];
  // `from '...'` ve `import '...'` -- tip-only import'lar da dahil,
  // cunku bir tip bagimliligi da mimari bir baglantidir.
  const pattern = /from\s+'([^']+)'|import\s+'([^']+)'/g;

  for (const abs of walk(SRC)) {
    const fileRel = abs.slice(SRC.length + 1);
    const fromLayer = fileRel.split('/')[0]!;
    const text = readFileSync(abs, 'utf-8');

    for (const match of text.matchAll(pattern)) {
      const specifier = match[1] ?? match[2]!;
      if (specifier.includes('/tools/') || specifier.startsWith('tools/')) {
        toolsImports.push(`${fileRel} -> ${specifier}`);
        continue;
      }
      const parts = resolveSpecifier(fileRel, specifier);
      if (!parts || parts.length === 0) continue;

      const toLayer = parts[0]!;
      if (toLayer === fromLayer) continue;
      if (RANK[toLayer] === undefined) continue;

      edges.push({
        file: fileRel,
        fromLayer,
        toLayer,
        toModule: (parts[1] ?? '').replace(/\.js$/, ''),
        specifier,
      });
    }
  }
  return { edges, toolsImports };
}

const { edges, toolsImports } = collectEdges();

function isSameRankAllowed(from: string, to: string): boolean {
  return SAME_RANK_ALLOWED.some((e) => e.from === from && e.to === to);
}

describe('Katman korkulugu', () => {
  it('her src katmani RANK tablosunda tanimli -- yeni katman sessizce eklenemez', () => {
    const layers = new Set(readdirSync(SRC, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name));
    const untracked = [...layers].filter((l) => RANK[l] === undefined);
    expect(untracked, `RANK tablosuna eklenmemis katman: ${untracked.join(', ')}`).toEqual([]);
  });

  it('`domain` hicbir src katmanina bagimli degil -- en dip katman', () => {
    const leaks = edges.filter((e) => e.fromLayer === 'domain');
    expect(
      leaks.map((e) => `${e.file} -> ${e.specifier}`),
      'domain saf kalmali: tum ust katmanlar onu okur, o hicbirini okumaz.',
    ).toEqual([]);
  });

  it('`src` hicbir zaman `tools`u import etmiyor', () => {
    expect(
      toolsImports,
      'Yazim hatti ayri bir dunya; oyun motoru ona bagimli olamaz.',
    ).toEqual([]);
  });

  it('`simulation` yalnizca `domain` ve `selection/Rng` goruyor', () => {
    const violations = edges
      .filter((e) => e.fromLayer === 'simulation')
      .filter(
        (e) =>
          !SIMULATION_ALLOWED_LAYERS.has(e.toLayer) ||
          (e.toLayer === 'selection' && !SIMULATION_ALLOWED_SELECTION_MODULES.has(e.toModule)),
      );
    expect(
      violations.map((e) => `${e.file} -> ${e.specifier}`),
      'simulation saf matematiktir: kariyer durumunu (runtime) bilmemeli, ' +
        'boylece hem oyun hem de dunya uretimi ayni modeli kullanabilir.',
    ).toEqual([]);
  });

  it('hicbir katman kendinden YUKARI rutbeye bagimli degil', () => {
    const upward = edges
      .filter((e) => RANK[e.toLayer]! > RANK[e.fromLayer]!)
      .map((e) => `${e.file} (${e.fromLayer}) -> ${e.toLayer}: ${e.specifier}`);
    expect(upward, 'Bagimlilik yonu her zaman asagi dogru olmali.').toEqual([]);
  });

  it('ayni rutbeli kenarlar yalnizca gerekcesi yazilmis istisnalar', () => {
    const sameRank = edges.filter((e) => RANK[e.toLayer] === RANK[e.fromLayer]);
    const undocumented = sameRank
      .filter((e) => !isSameRankAllowed(e.fromLayer, e.toLayer))
      .map((e) => `${e.file} (${e.fromLayer}) -> ${e.toLayer}: ${e.specifier}`);
    expect(
      undocumented,
      'Ayni rutbeli bagimlilik istiyorsan SAME_RANK_ALLOWED listesine GEREKCESIYLE ekle.',
    ).toEqual([]);
  });

  it('her istisnanin gerekcesi var ve hala kullaniliyor -- olu istisna birikmez', () => {
    for (const exception of SAME_RANK_ALLOWED) {
      expect(exception.reason.length, `${exception.from}->${exception.to} gerekcesiz`).toBeGreaterThan(30);
      const used = edges.some((e) => e.fromLayer === exception.from && e.toLayer === exception.to);
      expect(
        used,
        `Artik kullanilmayan istisna: ${exception.from} -> ${exception.to}. Listeden silin.`,
      ).toBe(true);
    }
  });

  it('grafik gercekten okunmus -- olcum bos donmedi', () => {
    // Regex bozulursa tum testler "ihlal yok" diye YESIL doner. Bu test
    // korkulugun kendisini korur.
    expect(edges.length).toBeGreaterThan(150);
  });
});
