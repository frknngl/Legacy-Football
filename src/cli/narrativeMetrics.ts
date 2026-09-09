/**
 * Ortak olcum araclari: occurrence toplama + calisma manifesti.
 *
 * Simulate ve playtest ayni sayac sozlesmesini kullanirsa ciktilar
 * karsilastirilabilir olur.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Archetype } from '../domain/axes.js';
import type { ContentRegistry } from '../loading/ContentRegistry.js';
import type { PresentedNode } from '../runtime/GameEngine.js';

const DEFAULT_AMBIENT = new Set<string>(['match', 'reaction']);
const SKIP_CHOICE_TEXT = new Set<string>(['Devam et']);

export interface OccurrenceObservation {
  readonly category: string;
  readonly occurrenceId: string;
  readonly eventKey: string;
  readonly canonicalText: string;
  readonly ambient: boolean;
  readonly countedNode: boolean;
  readonly countedOccurrence: boolean;
}

export class OccurrenceCollector {
  readonly shownStory = new Map<string, number>();
  readonly shownAmbient = new Map<string, number>();
  readonly shownStoryText = new Map<string, number>();
  readonly shownAmbientText = new Map<string, number>();
  readonly byCategory = new Map<string, number>();

  firstRepeatTurn: number | undefined;
  storyOccurrences = 0;
  ambientOccurrences = 0;

  private readonly seenNodes = new Set<string>();
  private readonly seenOccurrences = new Set<string>();

  constructor(private readonly ambientCategories: ReadonlySet<string> = DEFAULT_AMBIENT) {}

  observe(node: PresentedNode, turn: number): OccurrenceObservation {
    const category = node.category || 'bilinmiyor';
    const eventKey = node.variantId ? `${node.eventId}#${node.variantId}` : node.eventId;
    const canonicalText = canonicalPresentedText(node);
    const ambient = this.ambientCategories.has(category);
    const nodeKey = `${node.occurrenceId}/${node.nodeId}`;

    if (this.seenNodes.has(nodeKey)) {
      return {
        category,
        occurrenceId: node.occurrenceId,
        eventKey,
        canonicalText,
        ambient,
        countedNode: false,
        countedOccurrence: false,
      };
    }
    this.seenNodes.add(nodeKey);

    const countedOccurrence = !this.seenOccurrences.has(node.occurrenceId);
    if (countedOccurrence) {
      this.seenOccurrences.add(node.occurrenceId);

      const byKey = ambient ? this.shownAmbient : this.shownStory;
      const beforeByKey = byKey.get(eventKey) ?? 0;
      byKey.set(eventKey, beforeByKey + 1);
      if (beforeByKey === 1 && this.firstRepeatTurn === undefined) {
        this.firstRepeatTurn = turn;
      }

      const byText = ambient ? this.shownAmbientText : this.shownStoryText;
      byText.set(canonicalText, (byText.get(canonicalText) ?? 0) + 1);

      this.byCategory.set(category, (this.byCategory.get(category) ?? 0) + 1);
      if (ambient) this.ambientOccurrences += 1;
      else this.storyOccurrences += 1;
    }

    return {
      category,
      occurrenceId: node.occurrenceId,
      eventKey,
      canonicalText,
      ambient,
      countedNode: true,
      countedOccurrence,
    };
  }

  allSeenEventKeys(): Set<string> {
    return new Set<string>([...this.shownStory.keys(), ...this.shownAmbient.keys()]);
  }

  totalOccurrences(): number {
    return this.storyOccurrences + this.ambientOccurrences;
  }
}

export interface CountStats {
  readonly shows: number;
  readonly unique: number;
  readonly ratio: number;
}

export function countMapStats(counts: ReadonlyMap<string, number>): CountStats {
  let shows = 0;
  for (const value of counts.values()) shows += value;
  const unique = counts.size;
  return {
    shows,
    unique,
    ratio: unique === 0 ? 0 : shows / unique,
  };
}

export function mergeCountMaps(
  maps: readonly ReadonlyMap<string, number>[],
): Map<string, number> {
  const merged = new Map<string, number>();
  for (const counts of maps) {
    for (const [key, value] of counts) {
      merged.set(key, (merged.get(key) ?? 0) + value);
    }
  }
  return merged;
}

/** Kariyer bazli tekrar oranlarini ortalama alir; tek ortak havuzu baz almaz. */
export function averageCountStats(maps: readonly ReadonlyMap<string, number>[]): CountStats {
  if (maps.length === 0) return { shows: 0, unique: 0, ratio: 0 };
  let shows = 0;
  let unique = 0;
  let ratio = 0;
  for (const counts of maps) {
    const stats = countMapStats(counts);
    shows += stats.shows;
    unique += stats.unique;
    ratio += stats.ratio;
  }
  return {
    shows: Math.round(shows / maps.length),
    unique: Math.round(unique / maps.length),
    ratio: ratio / maps.length,
  };
}

export function canonicalPresentedText(node: PresentedNode): string {
  const parts = [node.title, node.text, ...node.choices.map((c) => c.text).filter((t) => !SKIP_CHOICE_TEXT.has(t))];
  return normalizeWhitespace(parts.join('\n'));
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export interface MetricsManifest {
  readonly tool: 'simulate' | 'playtest';
  readonly generatedAt: string;
  readonly engineVersion: string;
  readonly botVersion: string;
  readonly world: string;
  readonly archetype: Archetype;
  readonly requestedSeeds: number;
  readonly requestedTurns: number;
  readonly seeds: readonly number[];
  readonly playedTurns: readonly number[];
  readonly contentHash: string;
  /**
   * KAYNAK KIMLIGI -- olcumun kod tarafi.
   *
   * NEDEN VAR: manifest icerigi sabitliyordu ama KODU sabitlemiyordu.
   * Olculdu -- `phase-b-rhythm3` ve `phase-b-rhythm5` manifestleri zaman
   * damgasi disinda BIREBIR aynidir (ayni icerik hash'i, ayni tohumlar,
   * ayni dunya, ayni surum etiketi) ama ambiyans tekrarlari 12,5x ve
   * 8,8x cikmistir. Kosular belirlenimcidir (iki kez dogrulandi), yani
   * fark yalnizca kodda olabilir -- ve manifest onu yakalamadigi icin
   * hangi ayarin kazandigi GERI GETIRILEMEZ oldu.
   *
   * `engineVersion` yetmiyor: o `package.json` surumu ve kod
   * degistiginde degismiyor.
   */
  readonly sourceHash: string;
  /** Varsa git commit'i ve calisma agacinin temiz olup olmadigi. */
  readonly commit?: string;
  readonly dirty?: boolean;
}

export interface BuildManifestInput {
  readonly tool: MetricsManifest['tool'];
  readonly registry: ContentRegistry;
  readonly world: string;
  readonly archetype: Archetype;
  readonly requestedSeeds: number;
  readonly requestedTurns: number;
  readonly seeds: readonly number[];
  readonly playedTurns: readonly number[];
  readonly botVersion: string;
  readonly engineVersion?: string;
}

export function buildMetricsManifest(input: BuildManifestInput): MetricsManifest {
  return {
    tool: input.tool,
    generatedAt: new Date().toISOString(),
    engineVersion: input.engineVersion ?? process.env['npm_package_version'] ?? 'dev',
    botVersion: input.botVersion,
    world: input.world,
    archetype: input.archetype,
    requestedSeeds: input.requestedSeeds,
    requestedTurns: input.requestedTurns,
    seeds: [...input.seeds],
    playedTurns: [...input.playedTurns],
    contentHash: contentHash(input.registry),
    sourceHash: sourceHash(),
    ...gitIdentity(),
  };
}

/**
 * `src/` agacinin icerik hash'i.
 *
 * Bir olcumu tekrar uretmek icin gereken ikinci yari. Dosya adlari ve
 * icerikleri sirali olarak hash'lenir; okunamayan dosya sessizce
 * atlanmaz, adi hash'e girer -- aksi halde silinen bir dosya farki
 * gizlerdi.
 */
export function sourceHash(root = 'src'): string {
  const hash = createHash('sha256');
  for (const file of walkFiles(root)) {
    hash.update(file);
    hash.update('\0');
    try {
      hash.update(readFileSync(file));
    } catch {
      hash.update('<okunamadi>');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Git commit'i ve calisma agacinin temizligi.
 *
 * `dirty: true` ise commit tek basina olcumu geri getirmez -- rapor
 * bunu SOYLEMELI, yoksa yanlis bir guven verir.
 */
function gitIdentity(): { commit?: string; dirty?: boolean } {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return { commit, dirty: status.length > 0 };
  } catch {
    return {};
  }
}

export function seedSeries(count: number, base: number, step: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => base + i * step);
}

export async function writeManifest(manifest: MetricsManifest, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2), 'utf-8');
}

export function contentHash(registry: ContentRegistry): string {
  const payload = stableJson({ config: registry.config, events: registry.events });
  return createHash('sha256').update(payload).digest('hex');
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortKeysDeep(item));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
