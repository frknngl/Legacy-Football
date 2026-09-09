/**
 * Icerik yukleyici: kaynak -> ayristirma -> registry.
 *
 * Yol sozlesmesi (manifest YOK, klasor yapisi yeterlidir):
 *   content/orchestrator/*.json  -> motor yapilandirmasi
 *   content/events/<kategori>/*.json -> senaryo agaclari
 *
 * Bir olayin `category` alani ile bulundugu klasor uyusmuyorsa uyarilir --
 * dosyanin nereye ait oldugu tek bakista anlasilmali.
 */

import {
  ARCHETYPES,
  CLUB_TIERS,
  ERAS,
  LIFE_STATES,
  MEDIA_ERAS,
  STATURES,
} from '../domain/axes.js';
import { slotFlagDefinitions } from '../domain/actors.js';
import { referencedFlags } from '../domain/conditions.js';
import { isFlagEffect } from '../domain/effects.js';
import type { FlagDefinition } from '../domain/flags.js';
import type { OrchestratorConfig } from '../domain/orchestrator.js';
import { allNodes, type StoryEvent } from '../domain/story.js';
import { ContentRegistry } from './ContentRegistry.js';
import type { ContentSource, LoadedDocument } from './ContentSource.js';
import { ParseContext, parseEvent, type ParseIssue } from './parse.js';
import {
  parseArchetypes,
  parseAxes,
  parseEndings,
  parseEras,
  parseFlags,
  parseMediaEras,
  parseNames,
  parseNemeses,
  parseCadence,
  parseProgression,
  parseRelease,
  parseRoles,
} from './parseOrchestrator.js';
import { parseGames } from './parseGames.js';
import { parseAssets } from './parseAssets.js';
import { parseInflation } from './parseInflation.js';

export interface LoadIssue extends ParseIssue {
  readonly file: string;
}

export interface LoadResult {
  readonly registry: ContentRegistry | undefined;
  readonly issues: readonly LoadIssue[];
  readonly eventCount: number;
  readonly fileCount: number;
}

const ORCHESTRATOR_FILES = {
  core: 'orchestrator/core.json',
  eras: 'orchestrator/eras.json',
  axes: 'orchestrator/axes.json',
  progression: 'orchestrator/progression.json',
  mediaEras: 'orchestrator/media_eras.json',
  archetypes: 'orchestrator/archetypes.json',
  roles: 'orchestrator/roles.json',
  names: 'orchestrator/names.json',
  nemesis: 'orchestrator/nemesis.json',
  endings: 'orchestrator/endings.json',
  cadence: 'orchestrator/cadence.json',
  release: 'orchestrator/release.json',
  orphanBaseline: 'orchestrator/orphan-baseline.json',
  games: 'economy/games.json',
  assets: 'economy/assets.json',
  inflation: 'economy/inflation.json',
} as const;

export class ContentLoader {
  constructor(private readonly source: ContentSource) {}

  async load(): Promise<LoadResult> {
    const docs = await this.source.load();
    const byPath = new Map(docs.map((d) => [d.path, d]));
    const issues: LoadIssue[] = [];

    const collect = (file: string, ctx: ParseContext): void => {
      for (const issue of ctx.issues) issues.push({ ...issue, file });
    };

    const need = (key: keyof typeof ORCHESTRATOR_FILES): LoadedDocument | undefined => {
      const path = ORCHESTRATOR_FILES[key];
      const doc = byPath.get(path);
      if (!doc) {
        issues.push({ file: path, path: '', message: 'Zorunlu orkestratör dosyasi eksik.' });
      }
      return doc;
    };

    const coreDoc = need('core');
    const erasDoc = need('eras');
    const axesDoc = need('axes');
    const progressionDoc = need('progression');
    const mediaDoc = need('mediaEras');
    const archetypeDoc = need('archetypes');
    const rolesDoc = need('roles');
    const namesDoc = need('names');
    // nemesis ve endings opsiyoneldir; henuz yazilmamis olabilir.
    const nemesisDoc = byPath.get(ORCHESTRATOR_FILES.nemesis);
    const endingsDoc = byPath.get(ORCHESTRATOR_FILES.endings);

    const coreCtx = new ParseContext(ORCHESTRATOR_FILES.core);
    const flags = coreDoc ? parseFlags(coreDoc.data, coreCtx) : [];
    collect(ORCHESTRATOR_FILES.core, coreCtx);

    const erasCtx = new ParseContext(ORCHESTRATOR_FILES.eras);
    const { eras, turn } = erasDoc
      ? parseEras(erasDoc.data, erasCtx)
      : { eras: [], turn: { turnsPerSeason: 40, retirementWindowAge: 33, retirementChoiceMinAge: 38, forcedRetirementAge: 41, retirementEpilogueTurns: 12 } };
    collect(ORCHESTRATOR_FILES.eras, erasCtx);

    const axesCtx = new ParseContext(ORCHESTRATOR_FILES.axes);
    const lifeStates = axesDoc ? parseAxes(axesDoc.data, axesCtx) : [];
    collect(ORCHESTRATOR_FILES.axes, axesCtx);

    const progCtx = new ParseContext(ORCHESTRATOR_FILES.progression);
    const progression = progressionDoc
      ? parseProgression(progressionDoc.data, progCtx)
      : { statureThresholds: [], clubTiers: [], statureWeights: {}, hysteresis: 0, impossibleCells: [] };
    collect(ORCHESTRATOR_FILES.progression, progCtx);

    // Ritim OPSIYONEL: dosya yoksa hicbir kategori sogumaz (zarif bozulma).
    const cadenceDoc = byPath.get(ORCHESTRATOR_FILES.cadence);
    const cadenceCtx = new ParseContext(ORCHESTRATOR_FILES.cadence);
    const cadence = cadenceDoc
      ? parseCadence(cadenceDoc.data, cadenceCtx)
      : { defaultCooldown: 0, categories: {} };
    collect(ORCHESTRATOR_FILES.cadence, cadenceCtx);

    // Surum kapilari OPSIYONEL: dosya yoksa tum mevkiler acik.
    const releaseDoc = byPath.get(ORCHESTRATOR_FILES.release);
    const releaseCtx = new ParseContext(ORCHESTRATOR_FILES.release);
    const release = releaseDoc
      ? parseRelease(releaseDoc.data, releaseCtx)
      : { playablePositions: ['GK', 'DF', 'MF', 'FW'], lockedPositions: {}, positionFallback: {} };
    collect(ORCHESTRATOR_FILES.release, releaseCtx);

    // Yetim tabani OPSIYONEL: dosya yoksa hicbir yetim hos gorulmez
    // (yani kural saf `error` gibi davranir). Liste bosaldiginda dosya
    // silinir ve durum kendiliginden siki hale gelir.
    const orphanDoc = byPath.get(ORCHESTRATOR_FILES.orphanBaseline);
    const orphanBaseline: string[] = Array.isArray(
      (orphanDoc?.data as { grandfathered?: unknown })?.grandfathered,
    )
      ? ((orphanDoc!.data as { grandfathered: unknown[] }).grandfathered.filter(
          (v): v is string => typeof v === 'string',
        ))
      : [];

    const mediaCtx = new ParseContext(ORCHESTRATOR_FILES.mediaEras);
    const mediaEras = mediaDoc ? parseMediaEras(mediaDoc.data, mediaCtx) : [];
    collect(ORCHESTRATOR_FILES.mediaEras, mediaCtx);

    const archCtx = new ParseContext(ORCHESTRATOR_FILES.archetypes);
    const archetypes = archetypeDoc ? parseArchetypes(archetypeDoc.data, archCtx) : [];
    collect(ORCHESTRATOR_FILES.archetypes, archCtx);

    const rolesCtx = new ParseContext(ORCHESTRATOR_FILES.roles);
    const slots = rolesDoc ? parseRoles(rolesDoc.data, rolesCtx) : [];
    collect(ORCHESTRATOR_FILES.roles, rolesCtx);

    const namesCtx = new ParseContext(ORCHESTRATOR_FILES.names);
    const names = namesDoc
      ? parseNames(namesDoc.data, namesCtx)
      : { pools: {}, foreignOrigins: [], foreignRatioByClubTier: {}, nicknames: [] };
    collect(ORCHESTRATOR_FILES.names, namesCtx);

    // Her slot dort flag SENTEZLER; boylece yeni bir NPC eklemek core.json'a
    // dokunmaz. Cakisma olursa core.json kazanir ve durum bildirilir.
    const declared = new Set(flags.map((f) => f.key));
    const synthesized: FlagDefinition[] = [];
    for (const slot of slots) {
      for (const def of slotFlagDefinitions(slot)) {
        if (declared.has(def.key)) {
          issues.push({
            file: ORCHESTRATOR_FILES.roles,
            path: `slots.${slot.id}`,
            message: `"${def.key}" hem core.json'da tanimli hem slottan turetiliyor.`,
            hint: 'core.json satirini silin; slot flag\u0027leri otomatik uretilir.',
          });
          continue;
        }
        declared.add(def.key);
        synthesized.push(def);
      }
    }
    flags.push(...synthesized);

    const nemCtx = new ParseContext(ORCHESTRATOR_FILES.nemesis);
    const nemeses = nemesisDoc ? parseNemeses(nemesisDoc.data, nemCtx) : [];
    collect(ORCHESTRATOR_FILES.nemesis, nemCtx);

    const endCtx = new ParseContext(ORCHESTRATOR_FILES.endings);
    const endings = endingsDoc ? parseEndings(endingsDoc.data, endCtx) : [];
    collect(ORCHESTRATOR_FILES.endings, endCtx);

    // ---- olaylar ----
    const events: StoryEvent[] = [];
    const seenIds = new Map<string, string>();

    for (const doc of docs) {
      if (!doc.path.startsWith('events/')) continue;
      const ctx = new ParseContext(doc.path);
      const event = parseEvent(doc.data, ctx, doc.path);
      collect(doc.path, ctx);
      if (!event) continue;

      const previous = seenIds.get(event.id);
      if (previous !== undefined) {
        issues.push({
          file: doc.path,
          path: 'id',
          message: `Ayni olay kimligi iki dosyada birden: "${event.id}"`,
          hint: `Digeri: ${previous}`,
        });
        continue;
      }
      seenIds.set(event.id, doc.path);

      const folder = doc.path.split('/')[1];
      if (folder !== undefined && folder !== event.category) {
        issues.push({
          file: doc.path,
          path: 'category',
          message: `Kategori klasorle uyusmuyor: category="${event.category}" ama dosya events/${folder}/ altinda.`,
        });
      }

      events.push(event);
    }

    // "YENI OLAY = SADECE YENI JSON" garantisi.
    //
    // `mem_*` ve `inc_*` icerigin OZ SOZLUGUDUR; semantikleri sabittir
    // (boolean + zaman damgasi). Her yeni iz icin core.json'a satir yazmak
    // zorunlulugu, tek dosyayla olay eklemeyi imkansiz kilardi. Typo riski
    // bosta kalmaz: `OrphanMemoryFlagRule` yazilip okunmayani yakalar.
    for (const def of autoDeclaredFlags(events, declared)) {
      declared.add(def.key);
      flags.push(def);
    }

    // KUMAR KATALOGU -- oyun matematigi ICERIKTE durur, kodda degil.
    // Kasanin avantajini ayarlamak kod degisikligi gerektirmemeli.
    // OPSIYONEL: katalog yoksa kumar masasi acilmaz, oyun yine calisir.
    // `need()` kullanilamaz -- eksik dosyayi ZORUNLU sayip yuklemeyi
    // dusururdu ve mevcut testler (sentetik korpus) bu dosyayi tasimiyor.
    const games = parseGames(byPath.get(ORCHESTRATOR_FILES.games)?.data);
    const assets = parseAssets(byPath.get(ORCHESTRATOR_FILES.assets)?.data);
    const inflation = parseInflation(byPath.get(ORCHESTRATOR_FILES.inflation)?.data);

    const config: OrchestratorConfig = {
      schemaVersion: 1,
      flags,
      eras,
      lifeStates,
      progression,
      mediaEras,
      archetypes,
      slots,
      names,
      nemeses,
      endings,
      turn,
      cadence,
      release,
      orphanBaseline,
      games,
      assets,
      inflation,
    };

    const fatal =
      flags.length === 0 ||
      eras.length === 0 ||
      archetypes.length === 0 ||
      slots.length === 0 ||
      lifeStates.length === 0;
    const registry = fatal
      ? undefined
      : new ContentRegistry(config, events, {
          eras: ERAS,
          statures: STATURES,
          clubTiers: CLUB_TIERS,
          lifeStates: LIFE_STATES,
          mediaEras: MEDIA_ERAS,
          archetypes: ARCHETYPES,
        });

    return { registry, issues, eventCount: events.length, fileCount: docs.length };
  }
}

/** Icerigin okudugu ve yazdigi tum flag adlari. */
function referencedByContent(events: readonly StoryEvent[]): Set<string> {
  const keys = new Set<string>();
  for (const event of events) {
    if (event.trigger) for (const f of referencedFlags(event.trigger)) keys.add(f);
    for (const [, node] of allNodes(event)) {
      for (const e of node.onEnter ?? []) if (isFlagEffect(e)) keys.add(e.flag);
      for (const c of node.choices ?? []) {
        if (c.requires) for (const f of referencedFlags(c.requires)) keys.add(f);
        for (const e of c.effects) if (isFlagEffect(e)) keys.add(e.flag);
      }
      for (const o of node.outcomes ?? []) {
        for (const m of o.weight.modifiers ?? []) keys.add(m.flag);
        for (const e of o.effects ?? []) if (isFlagEffect(e)) keys.add(e.flag);
      }
    }
  }
  return keys;
}

/**
 * Beyan edilmemis `mem_*` / `inc_*` flag'lerini uretir.
 *
 * Yalnizca bu iki onek: stat, resource, pressure ve relation KATI kalir --
 * onlarin varsayilanlari ve sinirlari motorun dengesine aittir, icerigin
 * kendi basina uydurabilecegi seyler degildir.
 */
function autoDeclaredFlags(
  events: readonly StoryEvent[],
  declared: ReadonlySet<string>,
): FlagDefinition[] {
  const out: FlagDefinition[] = [];
  for (const key of [...referencedByContent(events)].sort()) {
    if (declared.has(key)) continue;
    if (key.startsWith('mem_')) {
      out.push({ key, kind: 'memory', type: 'boolean', default: false, label: key });
    } else if (key.startsWith('inc_')) {
      out.push({ key, kind: 'incident', type: 'boolean', default: false, label: key });
    }
  }
  return out;
}
