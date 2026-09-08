/**
 * Orkestratör dosyalarinin ayristirilmasi.
 *
 * `content/orchestrator/` altindaki her dosya motorun bir davranis eksenini
 * besler. Bunlar KOD DEGIL VERIDIR -- esikleri degistirmek icin TypeScript
 * dosyasina dokunmak gerekmez.
 */

import {
  ARCHETYPES,
  CLUB_TIERS,
  ERAS,
  LIFE_STATES,
  MEDIA_ERAS,
  STATURES,
  type Archetype,
  type ClubTier,
  type Era,
  type LifeState,
  type MediaEra,
  type Stature,
} from '../domain/axes.js';
import {
  ACTOR_SOURCES,
  NEMESIS_RESOLUTIONS,
  POSITIONS,
  REUNION_TRIGGERS,
  SLOT_SCOPES,
  STAFF_ROLES,
  type NameConfig,
  type NamePool,
  type NemesisDefinition,
  type NemesisResolutionDefinition,
  type NemesisStage,
  type Position,
  type RelationDecay,
  type ReunionTrigger,
  type SlotDefinition,
} from '../domain/actors.js';
import type { Ending } from '../domain/endings.js';
import type { FlagDefinition, FlagValue } from '../domain/flags.js';
import type {
  ArchetypeDefinition,
  ClubTierDefinition,
  EraDefinition,
  ImpossibleCell,
  LifeStateDefinition,
  MediaEraDefinition,
  ProgressionConfig,
  StatureThreshold,
  TurnConfig,
  CadenceConfig,
  ReleaseConfig,
} from '../domain/orchestrator.js';
import { parseCondition, parseFlagDefinition, type ParseContext } from './parse.js';

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function parseFlags(doc: unknown, ctx: ParseContext): FlagDefinition[] {
  if (!isObj(doc)) {
    ctx.error('', 'core.json bir nesne olmali.');
    return [];
  }
  const out: FlagDefinition[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of arr(doc['flags']).entries()) {
    const def = parseFlagDefinition(raw, ctx, `flags[${i}]`);
    if (!def) continue;
    if (seen.has(def.key)) {
      ctx.error(`flags[${i}]`, `Ayni flag iki kez tanimli: "${def.key}"`);
      continue;
    }
    seen.add(def.key);
    out.push(def);
  }
  if (out.length === 0) ctx.error('flags', 'Hicbir flag tanimlanmamis.');
  return out;
}

export function parseEras(doc: unknown, ctx: ParseContext): { eras: EraDefinition[]; turn: TurnConfig } {
  const fallbackTurn: TurnConfig = {
    turnsPerSeason: 40,
    retirementWindowAge: 33,
    retirementChoiceMinAge: 38,
    forcedRetirementAge: 41,
    retirementEpilogueTurns: 12,
  };
  if (!isObj(doc)) {
    ctx.error('', 'eras.json bir nesne olmali.');
    return { eras: [], turn: fallbackTurn };
  }

  const eras: EraDefinition[] = [];
  for (const [i, raw] of arr(doc['eras']).entries()) {
    if (!isObj(raw)) continue;
    const id = oneOf(raw['id'], ERAS) as Era | undefined;
    const minAge = num(raw['minAge']);
    const maxAge = num(raw['maxAge']);
    const label = str(raw['label']);
    if (id === undefined || minAge === undefined || maxAge === undefined || label === undefined) {
      ctx.error(`eras[${i}]`, 'Era `id`, `minAge`, `maxAge`, `label` gerektirir.');
      continue;
    }
    eras.push({ id, minAge, maxAge, label });
  }

  // Era araliklarinda BOSLUK ya da CAKISMA olmamali; yoksa bir yasta hicbir
  // icerik acilmaz ya da iki era birden acilir.
  const sorted = [...eras].sort((a, b) => a.minAge - b.minAge);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.minAge !== prev.maxAge + 1) {
      ctx.error(
        'eras',
        `Era araliklarinda boskluk/cakisma: "${prev.id}" ${prev.maxAge} yasinda bitiyor, "${cur.id}" ${cur.minAge} yasinda basliyor.`,
        'Araliklar bitisik olmali.',
      );
    }
  }

  const t = doc['turn'];
  const turn: TurnConfig = isObj(t)
    ? {
        turnsPerSeason: num(t['turnsPerSeason']) ?? fallbackTurn.turnsPerSeason,
        retirementWindowAge: num(t['retirementWindowAge']) ?? fallbackTurn.retirementWindowAge,
        retirementChoiceMinAge:
          num(t['retirementChoiceMinAge']) ?? fallbackTurn.retirementChoiceMinAge,
        forcedRetirementAge: num(t['forcedRetirementAge']) ?? fallbackTurn.forcedRetirementAge,
        retirementEpilogueTurns:
          num(t['retirementEpilogueTurns']) ?? fallbackTurn.retirementEpilogueTurns,
      }
    : fallbackTurn;

  return { eras, turn };
}

export function parseProgression(doc: unknown, ctx: ParseContext): ProgressionConfig {
  const empty: ProgressionConfig = {
    statureThresholds: [],
    clubTiers: [],
    statureWeights: {},
    hysteresis: 0,
    impossibleCells: [],
  };
  if (!isObj(doc)) {
    ctx.error('', 'progression.json bir nesne olmali.');
    return empty;
  }

  const statureThresholds: StatureThreshold[] = [];
  for (const [i, raw] of arr(doc['statureThresholds']).entries()) {
    if (!isObj(raw)) continue;
    const id = oneOf(raw['id'], STATURES) as Stature | undefined;
    const threshold = num(raw['threshold']);
    const label = str(raw['label']);
    if (id === undefined || threshold === undefined || label === undefined) {
      ctx.error(`statureThresholds[${i}]`, '`id`, `threshold`, `label` gerekli.');
      continue;
    }
    statureThresholds.push({ id, threshold, label });
  }
  if (statureThresholds.length !== STATURES.length) {
    ctx.error(
      'statureThresholds',
      `7 sohret seviyesinin hepsi tanimlanmali (su an ${statureThresholds.length}).`,
    );
  }

  const clubTiers: ClubTierDefinition[] = [];
  for (const [i, raw] of arr(doc['clubTiers']).entries()) {
    if (!isObj(raw)) continue;
    const id = oneOf(raw['id'], CLUB_TIERS) as ClubTier | undefined;
    const label = str(raw['label']);
    if (id === undefined || label === undefined) {
      ctx.error(`clubTiers[${i}]`, '`id` ve `label` gerekli.');
      continue;
    }
    clubTiers.push({ id, label });
  }

  const statureWeights: Record<string, number> = {};
  const rawWeights = doc['statureWeights'];
  if (isObj(rawWeights)) {
    for (const [flag, w] of Object.entries(rawWeights)) {
      const n = num(w);
      if (n === undefined) ctx.error(`statureWeights.${flag}`, 'Sayi bekleniyordu.');
      else statureWeights[flag] = n;
    }
  } else {
    ctx.error('statureWeights', 'Sohret agirliklari tanimlanmamis.');
  }

  const impossibleCells: ImpossibleCell[] = [];
  for (const [i, raw] of arr(doc['impossibleCells']).entries()) {
    if (!isObj(raw)) continue;
    const reason = str(raw['reason']);
    if (reason === undefined) {
      ctx.error(`impossibleCells[${i}].reason`, 'Anlamsiz hucre GEREKCESIZ birakilamaz.');
      continue;
    }
    const cell: Record<string, unknown> = { reason };
    const era = oneOf(raw['era'], ERAS);
    const stature = oneOf(raw['stature'], STATURES);
    const clubTier = oneOf(raw['clubTier'], CLUB_TIERS);
    if (era) cell['era'] = era;
    if (stature) cell['stature'] = stature;
    if (clubTier) cell['clubTier'] = clubTier;
    impossibleCells.push(cell as unknown as ImpossibleCell);
  }

  const out: Record<string, unknown> = {
    statureThresholds,
    clubTiers,
    statureWeights,
    hysteresis: num(doc['hysteresis']) ?? 0,
    impossibleCells,
  };
  const promo = str(doc['promotionEvent']);
  const demo = str(doc['demotionEvent']);
  if (promo) out['promotionEvent'] = promo;
  if (demo) out['demotionEvent'] = demo;
  return out as unknown as ProgressionConfig;
}

export function parseMediaEras(doc: unknown, ctx: ParseContext): MediaEraDefinition[] {
  if (!isObj(doc)) {
    ctx.error('', 'media_eras.json bir nesne olmali.');
    return [];
  }
  const out: MediaEraDefinition[] = [];
  for (const [i, raw] of arr(doc['mediaEras']).entries()) {
    if (!isObj(raw)) continue;
    const id = oneOf(raw['id'], MEDIA_ERAS) as MediaEra | undefined;
    const minSeason = num(raw['minSeason']);
    const maxSeason = num(raw['maxSeason']);
    const label = str(raw['label']);
    if (id === undefined || minSeason === undefined || maxSeason === undefined || label === undefined) {
      ctx.error(`mediaEras[${i}]`, '`id`, `minSeason`, `maxSeason`, `label` gerekli.');
      continue;
    }
    const def: Record<string, unknown> = { id, minSeason, maxSeason, label };
    const transitionEvent = str(raw['transitionEvent']);
    if (transitionEvent) def['transitionEvent'] = transitionEvent;
    out.push(def as unknown as MediaEraDefinition);
  }
  return out;
}

export function parseArchetypes(doc: unknown, ctx: ParseContext): ArchetypeDefinition[] {
  if (!isObj(doc)) {
    ctx.error('', 'archetypes.json bir nesne olmali.');
    return [];
  }
  const out: ArchetypeDefinition[] = [];
  for (const [i, raw] of arr(doc['archetypes']).entries()) {
    if (!isObj(raw)) continue;
    const id = oneOf(raw['id'], ARCHETYPES) as Archetype | undefined;
    const label = str(raw['label']);
    const startAge = num(raw['startAge']);
    const note = str(raw['note']);
    const startClubTier = oneOf(raw['startClubTier'], CLUB_TIERS) as ClubTier | undefined;
    const startPosition = oneOf(raw['startPosition'], POSITIONS) as Position | undefined;
    if (
      id === undefined ||
      label === undefined ||
      startAge === undefined ||
      note === undefined ||
      startClubTier === undefined ||
      startPosition === undefined
    ) {
      ctx.error(
        `archetypes[${i}]`,
        '`id`, `label`, `startAge`, `note`, `startClubTier`, `startPosition` gerekli.',
        `startPosition: ${POSITIONS.join(' | ')}`,
      );
      continue;
    }
    const startFlags: Record<string, FlagValue> = {};
    const rawFlags = raw['startFlags'];
    if (isObj(rawFlags)) {
      for (const [k, v] of Object.entries(rawFlags)) {
        if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
          startFlags[k] = v;
        } else {
          ctx.error(`archetypes[${i}].startFlags.${k}`, 'Sayi, bool ya da string bekleniyordu.');
        }
      }
    }
    const def: Record<string, unknown> = {
      id, label, startAge, note, startFlags, startClubTier, startPosition,
    };
    const nemesis = str(raw['nemesis']);
    if (nemesis) def['nemesis'] = nemesis;
    out.push(def as unknown as ArchetypeDefinition);
  }
  return out;
}

export function parseNemeses(doc: unknown, ctx: ParseContext): NemesisDefinition[] {
  if (!isObj(doc)) {
    ctx.error('', 'nemesis.json bir nesne olmali.');
    return [];
  }
  const defaultGap = num(isObj(doc['defaults']) ? doc['defaults']['gapTurns'] : undefined) ?? 12;
  const out: NemesisDefinition[] = [];
  for (const [i, raw] of arr(doc['nemeses']).entries()) {
    if (!isObj(raw)) continue;
    const id = str(raw['id']);
    const slotRef = str(raw['slotRef']);
    const label = str(raw['label']);
    if (id === undefined || slotRef === undefined || label === undefined) {
      ctx.error(`nemeses[${i}]`, '`id`, `slotRef` ve `label` gerekli.');
      continue;
    }
    const stages: NemesisStage[] = [];
    for (const [j, s] of arr(raw['stages']).entries()) {
      if (!isObj(s)) continue;
      const stage = num(s['stage']);
      const stageLabel = str(s['label']);
      const eventId = str(s['eventId']);
      if (stage === undefined || stageLabel === undefined || eventId === undefined) {
        ctx.error(`nemeses[${i}].stages[${j}]`, '`stage`, `label`, `eventId` gerekli.');
        continue;
      }
      const entry: Record<string, unknown> = { stage, label: stageLabel, eventId };
      const minSeason = num(s['minSeason']);
      if (minSeason !== undefined) entry['minSeason'] = minSeason;
      stages.push(entry as unknown as NemesisStage);
    }
    const resolutions: NemesisResolutionDefinition[] = [];
    for (const [j, r] of arr(raw['resolutions']).entries()) {
      if (!isObj(r)) continue;
      const resId = oneOf(r['id'], NEMESIS_RESOLUTIONS);
      const eventId = str(r['eventId']);
      if (resId === undefined || eventId === undefined) {
        ctx.error(`nemeses[${i}].resolutions[${j}]`, '`id` (yikim|saygi|dostluk) ve `eventId` gerekli.');
        continue;
      }
      const entry: Record<string, unknown> = { id: resId, eventId };
      if (r['condition'] !== undefined) {
        const cond = parseCondition(r['condition'], ctx, `nemeses[${i}].resolutions[${j}].condition`);
        if (cond) entry['condition'] = cond;
      }
      resolutions.push(entry as unknown as NemesisResolutionDefinition);
    }
    const def: Record<string, unknown> = {
      id,
      slotRef,
      label,
      gapTurns: num(raw['gapTurns']) ?? defaultGap,
      stages,
      resolutions,
    };
    if (Array.isArray(raw['archetypes'])) {
      def['archetypes'] = raw['archetypes'].filter((x): x is string => typeof x === 'string');
    }
    out.push(def as unknown as NemesisDefinition);
  }
  return out;
}

export function parseEndings(doc: unknown, ctx: ParseContext): Ending[] {
  if (!isObj(doc)) {
    ctx.error('', 'endings.json bir nesne olmali.');
    return [];
  }
  const out: Ending[] = [];
  for (const [i, raw] of arr(doc['endings']).entries()) {
    if (!isObj(raw)) continue;
    const id = str(raw['id']);
    const title = str(raw['title']);
    const epilogue = str(raw['epilogue']);
    const priority = num(raw['priority']);
    const requires = parseCondition(raw['requires'], ctx, `endings[${i}].requires`);
    if (
      id === undefined ||
      title === undefined ||
      epilogue === undefined ||
      priority === undefined ||
      requires === undefined
    ) {
      ctx.error(`endings[${i}]`, '`id`, `title`, `epilogue`, `priority`, `requires` gerekli.');
      continue;
    }
    out.push({ id, title, epilogue, priority, requires });
  }
  return out;
}

const DEFAULT_DECAY: RelationDecay = { positivePerSeason: 0, negativeLocked: true, towards: 50 };

export function parseAxes(doc: unknown, ctx: ParseContext): LifeStateDefinition[] {
  if (!isObj(doc)) {
    ctx.error('', 'axes.json bir nesne olmali.');
    return [];
  }

  const out: LifeStateDefinition[] = [];
  const seen = new Set<LifeState>();

  for (const [i, raw] of arr(doc['lifeStates']).entries()) {
    if (!isObj(raw)) continue;
    const id = oneOf(raw['id'], LIFE_STATES);
    const label = str(raw['label']);
    if (id === undefined || label === undefined) {
      ctx.error(`lifeStates[${i}]`, '`id` (tanimli bir hayat durumu) ve `label` gerekli.');
      continue;
    }
    if (seen.has(id)) {
      ctx.error(`lifeStates[${i}]`, `Ayni hayat durumu iki kez: "${id}"`);
      continue;
    }
    seen.add(id);

    const transitionsTo: LifeState[] = [];
    for (const t of arr(raw['transitionsTo'])) {
      const target = oneOf(t, LIFE_STATES);
      if (target === undefined) {
        ctx.error(`lifeStates[${i}].transitionsTo`, `Bilinmeyen hedef durum: "${String(t)}"`);
        continue;
      }
      transitionsTo.push(target);
    }

    out.push({
      id,
      label,
      canPlay: raw['canPlay'] === true,
      transitionsTo,
      closedCategories: strings(raw['closedCategories']),
    });
  }

  // Eksik durum sessizce "gecissiz" kalmasin: oyuncu o duruma dusunce kilitlenir.
  for (const id of LIFE_STATES) {
    if (!seen.has(id)) ctx.error('lifeStates', `Hayat durumu tanimlanmamis: "${id}"`);
  }
  return out;
}

export function parseRoles(doc: unknown, ctx: ParseContext): SlotDefinition[] {
  if (!isObj(doc)) {
    ctx.error('', 'roles.json bir nesne olmali.');
    return [];
  }

  const defaults = isObj(doc['defaults']) ? doc['defaults'] : {};
  const baseRelations = isObj(defaults['relationByStature'])
    ? numberMap(defaults['relationByStature'])
    : undefined;
  const d = defaults['decay'];
  const baseDecay: RelationDecay = isObj(d)
    ? {
        positivePerSeason: num(d['positivePerSeason']) ?? DEFAULT_DECAY.positivePerSeason,
        negativeLocked: d['negativeLocked'] !== false,
        towards: num(d['towards']) ?? DEFAULT_DECAY.towards,
      }
    : DEFAULT_DECAY;

  const out: SlotDefinition[] = [];
  const seen = new Set<string>();

  for (const [i, raw] of arr(doc['slots']).entries()) {
    if (!isObj(raw)) continue;
    const id = str(raw['id']);
    const scope = oneOf(raw['scope'], SLOT_SCOPES);
    const label = str(raw['label']);
    if (id === undefined || scope === undefined || label === undefined) {
      ctx.error(`slots[${i}]`, '`id`, `scope`, `label` gerekli.');
      continue;
    }
    if (seen.has(id)) {
      ctx.error(`slots[${i}]`, `Ayni slot iki kez tanimli: "${id}"`);
      continue;
    }
    seen.add(id);

    // former-scope slot bir arsivden beslenir; kendi kaynagi yoktur.
    const source = oneOf(raw['source'], ACTOR_SOURCES) ?? 'external';
    const relationByStature = isObj(raw['relationByStature'])
      ? numberMap(raw['relationByStature'])
      : baseRelations;

    const slot: Record<string, unknown> = {
      id,
      scope,
      label,
      source,
      defaultRelation: num(raw['defaultRelation']) ?? relationByStature?.['starter'] ?? 50,
      arcStages: num(raw['arcStages']) ?? 1,
      mortal: raw['mortal'] === true,
      decay: baseDecay,
    };
    if (relationByStature) slot['relationByStature'] = relationByStature;

    const note = str(raw['note']);
    if (note !== undefined) slot['note'] = note;
    const staffRole = oneOf(raw['staffRole'], STAFF_ROLES);
    if (staffRole !== undefined) slot['staffRole'] = staffRole;
    const castingRule = str(raw['castingRule']);
    if (castingRule !== undefined) slot['castingRule'] = castingRule;
    const gender = oneOf(raw['gender'], ['male', 'female', 'any'] as const);
    if (gender !== undefined) slot['gender'] = gender;
    if (raw['nicknamed'] === true) slot['nicknamed'] = true;
    const titled = str(raw['titled']);
    if (titled !== undefined) slot['titled'] = titled;
    const archiveOf = str(raw['archiveOf']);
    if (archiveOf !== undefined) slot['archiveOf'] = archiveOf;
    if (Array.isArray(raw['lifeStates'])) {
      slot['lifeStates'] = raw['lifeStates'].filter((x): x is string => typeof x === 'string');
    }
    if (Array.isArray(raw['reunionTriggers'])) {
      const triggers: ReunionTrigger[] = [];
      for (const t of raw['reunionTriggers']) {
        const trigger = oneOf(t, REUNION_TRIGGERS);
        if (trigger === undefined) {
          ctx.error(`slots[${i}].reunionTriggers`, `Bilinmeyen tetikleyici: "${String(t)}"`);
          continue;
        }
        triggers.push(trigger);
      }
      slot['reunionTriggers'] = triggers;
    }

    if (scope === 'former' && slot['archiveOf'] === undefined) {
      ctx.error(`slots[${i}].archiveOf`, 'former slot hangi arsivden beslendigini bildirmeli.');
    }

    out.push(slot as unknown as SlotDefinition);
  }

  if (out.length === 0) ctx.error('slots', 'Hicbir slot tanimlanmamis.');
  return out;
}

export function parseNames(doc: unknown, ctx: ParseContext): NameConfig {
  const empty: NameConfig = {
    pools: {},
    foreignOrigins: [],
    foreignRatioByClubTier: {},
    nicknames: [],
  };
  if (!isObj(doc)) {
    ctx.error('', 'names.json bir nesne olmali.');
    return empty;
  }

  const pools: Record<string, NamePool> = {};
  const rawPools = doc['pools'];
  if (isObj(rawPools)) {
    for (const [origin, value] of Object.entries(rawPools)) {
      if (!isObj(value)) continue;
      pools[origin] = {
        male: strings(value['male']),
        female: strings(value['female']),
        last: strings(value['last']),
      };
    }
  }

  if (pools['tr'] === undefined) {
    ctx.error('pools.tr', 'Varsayilan "tr" isim havuzu zorunludur.');
    return empty;
  }
  for (const [origin, pool] of Object.entries(pools)) {
    if (pool.male.length === 0 || pool.last.length === 0) {
      ctx.error(`pools.${origin}`, 'Havuzda en az bir ad ve bir soyad olmali.');
    }
  }

  return {
    pools,
    foreignOrigins: strings(doc['foreignOrigins']).filter((o) => o in pools),
    foreignRatioByClubTier: isObj(doc['foreignRatioByClubTier'])
      ? numberMap(doc['foreignRatioByClubTier'])
      : {},
    nicknames: strings(doc['nicknames']),
  };
}

function strings(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === 'string');
}

function numberMap(o: Obj): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) {
    const n = num(v);
    if (n !== undefined) out[k] = n;
  }
  return out;
}

/**
 * `cadence.json` -- kategori sogumalari.
 *
 * Dosya yoksa varsayilana duser: hicbir kategori sogumaz. Boylece eski bir
 * icerik agaci motoru dusurmez (zarif bozulma), ama ritim de kazanmaz.
 */
export function parseCadence(data: unknown, ctx: ParseContext): CadenceConfig {
  const root = data as { defaultCooldown?: unknown; categories?: unknown };
  const fallback: CadenceConfig = { defaultCooldown: 0, categories: {} };
  if (typeof root !== 'object' || root === null) return fallback;

  const defaultCooldown =
    typeof root.defaultCooldown === 'number' && root.defaultCooldown >= 0
      ? root.defaultCooldown
      : 0;

  const categories: Record<string, number> = {};
  const raw = root.categories;
  if (typeof raw === 'object' && raw !== null) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'number' && value >= 0) categories[key] = value;
      else ctx.error(`categories.${key}`, 'negatif olmayan sayi bekleniyordu');
    }
  }

  return { defaultCooldown, categories };
}

/**
 * `release.json` -- surum kapilari.
 *
 * Dosya yoksa TUM mevkiler acik sayilir: eski bir icerik agaci motoru
 * kisitlamaz (zarif bozulma).
 */
export function parseRelease(data: unknown, ctx: ParseContext): ReleaseConfig {
  const fallback: ReleaseConfig = {
    playablePositions: ['GK', 'DF', 'MF', 'FW'],
    lockedPositions: {},
    positionFallback: {},
  };
  const root = data as Partial<ReleaseConfig> | null;
  if (typeof root !== 'object' || root === null) return fallback;

  const playable = Array.isArray(root.playablePositions)
    ? root.playablePositions.filter((p): p is string => typeof p === 'string')
    : fallback.playablePositions;
  if (playable.length === 0) {
    ctx.error('playablePositions', 'en az bir mevki acik olmali');
    return fallback;
  }

  return {
    playablePositions: playable,
    lockedPositions: (root.lockedPositions ?? {}) as ReleaseConfig['lockedPositions'],
    positionFallback: (root.positionFallback ?? {}) as ReleaseConfig['positionFallback'],
  };
}
