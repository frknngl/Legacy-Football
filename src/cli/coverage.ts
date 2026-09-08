/**
 * KAPSAMA MATRISI -- `npm run coverage`
 *
 * Yapisal garanti #4'un ("seviyeye uygunluk") statik denetimi.
 *
 * Simulate bir kariyerin BASINA geleni olcer; burasi kariyerin gelebilecegi
 * HER duruma bakar. Bir hucre bossa o durumdaki oyuncuya gosterilecek hicbir
 * sey yok demektir ve bunu ancak o duruma dusen oyuncu fark eder.
 *
 * Yalnizca eksen kapilarina bakar (era/stature/clubTier/lifeState/mediaEra/
 * arketip); `trigger` ve soguma dinamiktir, orasi simulate'in isi.
 */

import {
  ARCHETYPES,
  CLUB_TIERS,
  ERAS,
  MEDIA_ERAS,
  STATURES,
  type Archetype,
  type ClubTier,
  type Era,
  type LifeState,
  type MediaEra,
  type Stature,
} from '../domain/axes.js';
import type { StoryEvent } from '../domain/story.js';
import { ContentLoader } from '../loading/ContentLoader.js';
import { FileSystemContentSource } from '../loading/FileSystemContentSource.js';

/** Bir hucrede en az bu kadar olay olmali; altindaysa oyuncu tekrari hisseder. */
const THIN = 6;

function arg(name: string, fallback: string): string {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? (found.split('=')[1] ?? fallback) : fallback;
}

function allows<T>(allowed: readonly T[] | undefined, actual: T): boolean {
  return allowed === undefined || allowed.includes(actual);
}

interface Cell {
  readonly era: Era;
  readonly stature: Stature;
  readonly clubTier: ClubTier;
  readonly lifeState: LifeState;
  readonly count: number;
  readonly variants: number;
}

async function main(): Promise<void> {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  if (!loaded.registry) {
    console.error('Icerik yuklenemedi.');
    process.exitCode = 1;
    return;
  }
  const registry = loaded.registry;
  const lifeStates = registry.config.lifeStates;
  const impossible = registry.config.progression.impossibleCells;
  const isImpossible = (era: Era, stature: Stature, clubTier: ClubTier): boolean =>
    impossible.some(
      (c) =>
        (c.era === undefined || c.era === era) &&
        (c.stature === undefined || c.stature === stature) &&
        (c.clubTier === undefined || c.clubTier === clubTier),
    );

  const archetypeArg = arg('archetype', 'street');
  const archetype = ((ARCHETYPES as readonly string[]).includes(archetypeArg)
    ? archetypeArg
    : 'street') as Archetype;
  const mediaEraArg = arg('mediaEra', 'any');
  const showAll = process.argv.includes('--all');

  // Takvimin uretebilecegi olaylar; mac ani ve kuyruga ozel olanlar haric.
  const pool = registry.events.filter(
    (e: StoryEvent) => e.momentType === undefined && e.scheduledOnly !== true,
  );

  const fits = (e: StoryEvent, c: Omit<Cell, 'count' | 'variants'>, media: MediaEra): boolean =>
    allows(e.eras, c.era) &&
    allows(e.stature, c.stature) &&
    allows(e.clubTiers, c.clubTier) &&
    allows(e.lifeStates, c.lifeState) &&
    allows(e.mediaEras, media) &&
    allows(e.archetypes, archetype);

  const mediaAxis: readonly MediaEra[] =
    mediaEraArg === 'any' ? MEDIA_ERAS : [mediaEraArg as MediaEra];

  const cells: Cell[] = [];
  for (const era of ERAS) {
    for (const stature of STATURES) {
      for (const clubTier of CLUB_TIERS) {
        if (isImpossible(era, stature, clubTier)) continue;
        for (const ls of lifeStates) {
          const key = { era, stature, clubTier, lifeState: ls.id as LifeState };
          // Bir olay HERHANGI bir medya caginda uyuyorsa hucre dolu sayilir.
          const matched = pool.filter((e) => mediaAxis.some((m) => fits(e, key, m)));
          const variants = matched.reduce((n, e) => n + Math.max(1, e.variants?.length ?? 1), 0);
          cells.push({ ...key, count: matched.length, variants });
        }
      }
    }
  }

  const empty = cells.filter((c) => c.count === 0);
  const thin = cells.filter((c) => c.count > 0 && c.count < THIN);

  console.log(`=== KAPSAMA | ${archetype} | medya: ${mediaEraArg} ===\n`);
  console.log(`Havuz      : ${pool.length} olay (takvimden cikabilen)`);
  console.log(`Hucre      : ${cells.length}  (era x sohret x kulup x hayat, imkansizlar haric)`);
  console.log(`Bos        : ${empty.length}`);
  console.log(`Ince (<${THIN})  : ${thin.length}`);

  if (empty.length > 0) {
    console.log('\nBOS HUCRELER -- bu durumdaki oyuncuya gosterilecek hicbir sey yok');
    const grouped = new Map<string, string[]>();
    for (const c of empty) {
      const k = `${c.lifeState}`;
      (grouped.get(k) ?? grouped.set(k, []).get(k)!).push(`${c.era}/${c.stature}/${c.clubTier}`);
    }
    for (const [ls, list] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${ls.padEnd(16)} ${list.length} hucre`);
      if (showAll) for (const x of list) console.log(`      ${x}`);
    }
    if (!showAll) console.log('  (tam liste icin --all)');
  }

  // Hayat durumu bazinda ozet: en dar kapi hangisi?
  console.log('\nHAYAT DURUMU BAZINDA (min / ortalama / max olay)');
  for (const ls of lifeStates) {
    const mine = cells.filter((c) => c.lifeState === (ls.id as LifeState));
    if (mine.length === 0) continue;
    const counts = mine.map((c) => c.count);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const mean = Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);
    const mark = min === 0 ? '  <- BOS HUCRE VAR' : min < THIN ? '  <- ince' : '';
    console.log(
      `  ${ls.id.padEnd(16)} ${String(min).padStart(3)} / ${String(mean).padStart(3)} / ${String(max).padStart(3)}${mark}`,
    );
  }

  console.log('\nSOHRET BAZINDA (min / ortalama / max olay)');
  for (const s of STATURES) {
    const mine = cells.filter((c) => c.stature === s);
    if (mine.length === 0) continue;
    const counts = mine.map((c) => c.count);
    const min = Math.min(...counts);
    const mean = Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);
    console.log(
      `  ${s.padEnd(16)} ${String(min).padStart(3)} / ${String(mean).padStart(3)} / ${String(Math.max(...counts)).padStart(3)}`,
    );
  }

  console.log('');
  if (empty.length > 0) {
    console.log(`${empty.length} bos hucre var.`);
    if (process.argv.includes('--strict')) process.exitCode = 1;
  } else {
    console.log('Her hucrede en az bir olay var.');
  }
}

await main();
