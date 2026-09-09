/**
 * Ham JSON -> tipli domain nesnesi.
 *
 * Elle yazilmis ayristirici, ajv'nin uretebileceginden cok daha KESIN Turkce
 * hata mesaji verir ("evt_x -> node_y -> secim 2: `target` bilinmeyen node'a
 * isaret ediyor"). ajv semalari editorde otomatik tamamlama icin ayrica durur.
 *
 * Ayristirici ILK HATADA DURMAZ; tum sorunlari toplar.
 */

import {
  ARCHETYPES,
  CLUB_TIERS,
  ERAS,
  LIFE_STATES,
  MEDIA_ERAS,
  PERSONA_AXES,
  STATURES,
  TIERS,
  type Archetype,
  type ClubTier,
  type Era,
  type LifeState,
  type MediaEra,
  type PersonaAxis,
  type Stature,
  type Tier,
} from '../domain/axes.js';
import { CONDITION_OPS, type Condition } from '../domain/conditions.js';
import { FLAG_EFFECT_OPS, type Effect, type EffectValue } from '../domain/effects.js';
import { FLAG_KINDS, type FlagDefinition, type FlagKind, type FlagType } from '../domain/flags.js';
import type {
  Choice,
  CooldownSpec,
  EventVariant,
  NodeKind,
  RepeatPolicy,
  RollOutcome,
  StoryMeta,
  StoryEvent,
  StoryNode,
  WeightExpression,
} from '../domain/story.js';

export interface ParseIssue {
  readonly path: string;
  readonly message: string;
  readonly hint?: string;
}

export class ParseContext {
  readonly issues: ParseIssue[] = [];

  constructor(readonly file: string) {}

  error(path: string, message: string, hint?: string): void {
    this.issues.push(hint === undefined ? { path, message } : { path, message, hint });
  }

  get ok(): boolean {
    return this.issues.length === 0;
  }
}

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

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

function arrOf<T extends string>(
  v: unknown,
  allowed: readonly T[],
  ctx: ParseContext,
  path: string,
): T[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    ctx.error(path, 'Dizi bekleniyordu.');
    return undefined;
  }
  const out: T[] = [];
  for (const [i, item] of v.entries()) {
    const parsed = oneOf(item, allowed);
    if (parsed === undefined) {
      ctx.error(`${path}[${i}]`, `Gecersiz deger: ${JSON.stringify(item)}`, `Izin verilenler: ${allowed.join(', ')}`);
    } else {
      out.push(parsed);
    }
  }
  return out;
}

// ---------------------------------------------------------------- kosullar

export function parseCondition(v: unknown, ctx: ParseContext, path: string): Condition | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) {
    ctx.error(path, 'Kosul bir nesne olmali.');
    return undefined;
  }

  for (const key of ['allOf', 'anyOf', 'noneOf'] as const) {
    if (key in v) {
      const raw = v[key];
      if (!Array.isArray(raw)) {
        ctx.error(`${path}.${key}`, 'Dizi bekleniyordu.');
        return undefined;
      }
      const children: Condition[] = [];
      for (const [i, child] of raw.entries()) {
        const parsed = parseCondition(child, ctx, `${path}.${key}[${i}]`);
        if (parsed) children.push(parsed);
      }
      if (key === 'allOf') return { allOf: children };
      if (key === 'anyOf') return { anyOf: children };
      return { noneOf: children };
    }
  }

  if ('not' in v) {
    const inner = parseCondition(v['not'], ctx, `${path}.not`);
    return inner ? { not: inner } : undefined;
  }

  const flag = str(v['flag']);
  if (flag === undefined) {
    ctx.error(path, '`flag` alani eksik veya string degil.', 'Yaprak kosul: { flag, op, value }');
    return undefined;
  }
  const op = oneOf(v['op'], CONDITION_OPS);
  if (op === undefined) {
    ctx.error(`${path}.op`, `Bilinmeyen operator: ${JSON.stringify(v['op'])}`, `Izin verilenler: ${CONDITION_OPS.join(', ')}`);
    return undefined;
  }
  return 'value' in v ? { flag, op, value: v['value'] } : { flag, op };
}

// ---------------------------------------------------------------- efektler

function parseEffectValue(v: unknown, ctx: ParseContext, path: string): EffectValue | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (isObj(v) && 'scaleBy' in v) {
    const scaleBy = oneOf(v['scaleBy'], ['stature', 'clubTier', 'season'] as const);
    const base = num(v['base']);
    const perTier = num(v['perTier']);
    if (scaleBy === undefined || base === undefined || perTier === undefined) {
      ctx.error(path, 'Olceklenen deger `scaleBy`, `base` ve `perTier` gerektirir.');
      return undefined;
    }
    const out: Record<string, unknown> = { scaleBy, base, perTier };
    const cmin = num(v['clampMin']);
    const cmax = num(v['clampMax']);
    if (cmin !== undefined) out['clampMin'] = cmin;
    if (cmax !== undefined) out['clampMax'] = cmax;
    return out as unknown as EffectValue;
  }
  if (isObj(v) && 'ref' in v) {
    const ref = str(v['ref']);
    if (ref === undefined) {
      ctx.error(path, 'Bayrak referansi `ref` bir metin olmali.');
      return undefined;
    }
    const out: Record<string, unknown> = { ref };
    for (const key of ['mul', 'add', 'clampMin', 'clampMax'] as const) {
      const n = num(v[key]);
      if (n !== undefined) out[key] = n;
    }
    return out as unknown as EffectValue;
  }
  ctx.error(path, `Gecersiz efekt degeri: ${JSON.stringify(v)}`);
  return undefined;
}

export function parseEffect(v: unknown, ctx: ParseContext, path: string): Effect | undefined {
  if (!isObj(v)) {
    ctx.error(path, 'Efekt bir nesne olmali.');
    return undefined;
  }

  const op = str(v['op']);

  if (op === 'schedule') {
    const event = str(v['event']);
    const inTurns = num(v['inTurns']);
    const priority = oneOf(v['priority'], ['forced', 'weighted'] as const);
    if (event === undefined || inTurns === undefined || priority === undefined) {
      ctx.error(path, '`schedule` efekti `event`, `inTurns` ve `priority` gerektirir.');
      return undefined;
    }
    const onIneligible = oneOf(v['onIneligible'], ['defer', 'fire', 'cancel'] as const);
    const out: Record<string, unknown> = { op: 'schedule', event, inTurns, priority };
    if (onIneligible !== undefined) out['onIneligible'] = onIneligible;
    const maxDefer = num(v['maxDeferTurns']);
    if (maxDefer !== undefined) out['maxDeferTurns'] = maxDefer;
    const replaceWith = str(v['replaceWith']);
    if (replaceWith !== undefined) out['replaceWith'] = replaceWith;
    return out as unknown as Effect;
  }

  if (op === 'lifeState') {
    const to = str(v['to']);
    if (to === undefined) {
      ctx.error(path, '`lifeState` efekti `to` gerektirir.');
      return undefined;
    }
    const forTurns = num(v['forTurns']);
    return (forTurns === undefined
      ? { op: 'lifeState', to }
      : { op: 'lifeState', to, forTurns }) as Effect;
  }

  if (op === 'clubTier') {
    const to = str(v['to']);
    if (to === undefined) {
      ctx.error(path, 'clubTier efekti `to` gerektirir.');
      return undefined;
    }
    return { op: 'clubTier', to } as Effect;
  }

  if (op === 'match') {
    const out: Record<string, unknown> = { op: 'match' };
    for (const key of ['goals', 'assists', 'yellowCards', 'injuryWeeks', 'rating'] as const) {
      const n = num(v[key]);
      if (n !== undefined) out[key] = n;
    }
    if (v['redCard'] === true) out['redCard'] = true;
    const incident = str(v['incident']);
    if (incident !== undefined) out['incident'] = incident;
    return out as unknown as Effect;
  }

  if (op === 'suspend') {
    const matches = num(v['matches']);
    const reason = str(v['reason']);
    if (matches === undefined || reason === undefined) {
      ctx.error(path, '`suspend` efekti `matches` ve `reason` gerektirir.');
      return undefined;
    }
    return { op: 'suspend', matches, reason };
  }

  const flag = str(v['flag']);
  const flagOp = oneOf(v['op'], FLAG_EFFECT_OPS);
  if (flag === undefined || flagOp === undefined) {
    ctx.error(
      path,
      `Gecersiz efekt: ${JSON.stringify(v)}`,
      'Flag efekti { flag, op, value }; ozel efektler op: schedule | lifeState | suspend',
    );
    return undefined;
  }
  const value = parseEffectValue(v['value'], ctx, `${path}.value`);
  return value === undefined ? { flag, op: flagOp } : { flag, op: flagOp, value };
}

function parseEffects(v: unknown, ctx: ParseContext, path: string): Effect[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    ctx.error(path, 'Dizi bekleniyordu.');
    return [];
  }
  const out: Effect[] = [];
  for (const [i, item] of v.entries()) {
    const parsed = parseEffect(item, ctx, `${path}[${i}]`);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parsePersona(
  v: unknown,
  ctx: ParseContext,
  path: string,
): Partial<Record<PersonaAxis, number>> | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) {
    ctx.error(path, 'Persona katkisi bir nesne olmali.');
    return undefined;
  }
  const out: Partial<Record<PersonaAxis, number>> = {};
  for (const [key, raw] of Object.entries(v)) {
    const axis = oneOf(key, PERSONA_AXES);
    if (axis === undefined) {
      ctx.error(`${path}.${key}`, `Bilinmeyen kimlik ekseni.`, `Eksenler: ${PERSONA_AXES.join(', ')}`);
      continue;
    }
    const n = num(raw);
    if (n === undefined) ctx.error(`${path}.${key}`, 'Sayi bekleniyordu.');
    else out[axis] = n;
  }
  return out;
}

function parseStoryMeta(v: unknown, ctx: ParseContext, path: string): StoryMeta | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) {
    ctx.error(path, 'story bir nesne olmali.');
    return undefined;
  }

  const out: Record<string, unknown> = {};

  for (const key of ['arc', 'beat', 'slot', 'signature'] as const) {
    const raw = v[key];
    if (raw === undefined) continue;
    const value = str(raw);
    if (value === undefined || value.trim().length === 0) {
      ctx.error(`${path}.${key}`, 'Bos olmayan bir metin bekleniyordu.');
      continue;
    }
    out[key] = value;
  }

  return Object.keys(out).length > 0 ? (out as StoryMeta) : undefined;
}

function parseRepeatPolicy(v: unknown, ctx: ParseContext, path: string): RepeatPolicy | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) {
    ctx.error(path, 'repeatPolicy bir nesne olmali.');
    return undefined;
  }

  const out: Record<string, number> = {};

  const gap = (key: 'arcGapTurns' | 'beatGapTurns' | 'signatureGapTurns'): void => {
    const raw = v[key];
    if (raw === undefined) return;
    const value = num(raw);
    if (value === undefined || value < 0) {
      ctx.error(`${path}.${key}`, 'Sifir veya pozitif sayi bekleniyordu.');
      return;
    }
    out[key] = value;
  };

  gap('arcGapTurns');
  gap('beatGapTurns');
  gap('signatureGapTurns');

  const maxBeatUsesRaw = v['maxBeatUses'];
  if (maxBeatUsesRaw !== undefined) {
    const maxBeatUses = num(maxBeatUsesRaw);
    if (maxBeatUses === undefined || maxBeatUses < 1 || !Number.isInteger(maxBeatUses)) {
      ctx.error(`${path}.maxBeatUses`, '1 veya daha buyuk bir tamsayi bekleniyordu.');
    } else {
      out['maxBeatUses'] = maxBeatUses;
    }
  }

  return Object.keys(out).length > 0 ? (out as RepeatPolicy) : undefined;
}

// ---------------------------------------------------------------- node/secim

function parseWeightExpression(
  v: unknown,
  ctx: ParseContext,
  path: string,
): WeightExpression | undefined {
  if (typeof v === 'number') return { base: v };
  if (!isObj(v)) {
    ctx.error(path, 'Agirlik bir sayi ya da { base, modifiers } nesnesi olmali.');
    return undefined;
  }
  const base = num(v['base']);
  if (base === undefined) {
    ctx.error(`${path}.base`, 'Sayi bekleniyordu.');
    return undefined;
  }
  const rawMods = v['modifiers'];
  if (rawMods === undefined) return { base };
  if (!Array.isArray(rawMods)) {
    ctx.error(`${path}.modifiers`, 'Dizi bekleniyordu.');
    return { base };
  }
  const modifiers: { flag: string; scale: number }[] = [];
  for (const [i, m] of rawMods.entries()) {
    if (!isObj(m)) {
      ctx.error(`${path}.modifiers[${i}]`, 'Nesne bekleniyordu.');
      continue;
    }
    const flag = str(m['flag']);
    const scale = num(m['scale']);
    if (flag === undefined || scale === undefined) {
      ctx.error(`${path}.modifiers[${i}]`, '`flag` ve `scale` gerekli.');
      continue;
    }
    modifiers.push({ flag, scale });
  }
  return { base, modifiers };
}

function parseChoice(v: unknown, ctx: ParseContext, path: string): Choice | undefined {
  if (!isObj(v)) {
    ctx.error(path, 'Secim bir nesne olmali.');
    return undefined;
  }
  const id = str(v['id']);
  const text = str(v['text']);
  if (id === undefined || text === undefined) {
    ctx.error(path, 'Secim `id` ve `text` gerektirir.');
    return undefined;
  }
  const out: Record<string, unknown> = { id, text, effects: parseEffects(v['effects'], ctx, `${path}.effects`) };

  const requires = parseCondition(v['requires'], ctx, `${path}.requires`);
  if (requires) {
    out['requires'] = requires;
    const lockLabel = str(v['lockLabel']);
    if (lockLabel === undefined) {
      ctx.error(
        `${path}.lockLabel`,
        'Kosullu secim `lockLabel` ZORUNLU.',
        'Oyuncu neyi kacirdigini gormeli. Ornek: "[Liderlik 70]"',
      );
    } else {
      out['lockLabel'] = lockLabel;
    }
  }
  if (v['hideWhenLocked'] === true) out['hideWhenLocked'] = true;

  const target = str(v['target']);
  if (target !== undefined) out['target'] = target;

  const persona = parsePersona(v['persona'], ctx, `${path}.persona`);
  if (persona !== undefined) out['persona'] = persona;

  return out as unknown as Choice;
}

function parseNode(v: unknown, ctx: ParseContext, path: string, id: string): StoryNode | undefined {
  if (!isObj(v)) {
    ctx.error(path, 'Node bir nesne olmali.');
    return undefined;
  }
  const title = str(v['title']);
  const text = str(v['text']);
  const kind = oneOf(v['kind'], ['branch', 'outcome', 'roll'] as const) as NodeKind | undefined;
  if (title === undefined || text === undefined || kind === undefined) {
    ctx.error(path, 'Node `title`, `text` ve `kind` gerektirir.', 'kind: branch | outcome | roll');
    return undefined;
  }

  const out: Record<string, unknown> = { id, title, text, kind };
  const onEnter = parseEffects(v['onEnter'], ctx, `${path}.onEnter`);
  if (onEnter.length > 0) out['onEnter'] = onEnter;

  if (kind === 'branch') {
    const raw = v['choices'];
    if (!Array.isArray(raw)) {
      ctx.error(`${path}.choices`, '`branch` node’u secim dizisi gerektirir.');
      return undefined;
    }
    const choices: Choice[] = [];
    for (const [i, c] of raw.entries()) {
      const parsed = parseChoice(c, ctx, `${path}.choices[${i}]`);
      if (parsed) choices.push(parsed);
    }
    out['choices'] = choices;
  }

  if (kind === 'roll') {
    const raw = v['outcomes'];
    if (!Array.isArray(raw)) {
      ctx.error(`${path}.outcomes`, '`roll` node’u sonuc dizisi gerektirir.');
      return undefined;
    }
    const outcomes: RollOutcome[] = [];
    for (const [i, o] of raw.entries()) {
      if (!isObj(o)) {
        ctx.error(`${path}.outcomes[${i}]`, 'Nesne bekleniyordu.');
        continue;
      }
      const target = str(o['target']);
      const weight = parseWeightExpression(o['weight'], ctx, `${path}.outcomes[${i}].weight`);
      if (target === undefined || weight === undefined) {
        ctx.error(`${path}.outcomes[${i}]`, '`target` ve `weight` gerekli.');
        continue;
      }
      const effects = parseEffects(o['effects'], ctx, `${path}.outcomes[${i}].effects`);
      outcomes.push(effects.length > 0 ? { target, weight, effects } : { target, weight });
    }
    out['outcomes'] = outcomes;
  }

  const next = str(v['next']);
  if (next !== undefined) out['next'] = next;

  return out as unknown as StoryNode;
}

function parseNodes(
  v: unknown,
  ctx: ParseContext,
  path: string,
): Record<string, StoryNode> | undefined {
  if (!isObj(v)) {
    ctx.error(path, '`nodes` bir nesne olmali (id -> node).');
    return undefined;
  }
  const out: Record<string, StoryNode> = {};
  for (const [id, raw] of Object.entries(v)) {
    const node = parseNode(raw, ctx, `${path}.${id}`, id);
    if (node) out[id] = node;
  }
  return out;
}

// ---------------------------------------------------------------- olay

function parseCooldown(v: unknown, ctx: ParseContext, path: string): CooldownSpec {
  if (typeof v === 'number') {
    ctx.error(
      path,
      'Cooldown artik iki seviyelidir.',
      'Yaz: { "self": <tur>, "family": <tur> } -- aile cooldown’u "ust uste 100 gece kulubu" hatasini onler.',
    );
    return { self: v, family: v };
  }
  if (!isObj(v)) {
    ctx.error(path, 'Cooldown { self, family } nesnesi olmali.');
    return { self: 0, family: 0 };
  }
  const self = num(v['self']);
  const family = num(v['family']);
  if (self === undefined || family === undefined) {
    ctx.error(path, '`self` ve `family` sayilari gerekli.');
  }
  return { self: self ?? 0, family: family ?? 0 };
}

export function parseEvent(v: unknown, ctx: ParseContext, sourceFile: string): StoryEvent | undefined {
  if (!isObj(v)) {
    ctx.error('', 'Olay dosyasi bir nesne olmali.');
    return undefined;
  }
  const id = str(v['id']);
  const family = str(v['family']);
  const category = str(v['category']);
  const tier = oneOf(v['tier'], TIERS) as Tier | undefined;

  if (id === undefined || family === undefined || category === undefined || tier === undefined) {
    ctx.error(
      '',
      'Olay `id`, `family`, `category` ve `tier` gerektirir.',
      `tier: ${TIERS.join(' | ')} -- "filler" tier YOKTUR.`,
    );
    return undefined;
  }

  const weight = num(v['weight']) ?? 10;
  const cooldown = parseCooldown(v['cooldown'], ctx, 'cooldown');

  const out: Record<string, unknown> = { id, family, category, tier, weight, cooldown, sourceFile };

  const eras = arrOf<Era>(v['eras'], ERAS, ctx, 'eras');
  if (eras) out['eras'] = eras;
  const stature = arrOf<Stature>(v['stature'], STATURES, ctx, 'stature');
  if (stature) out['stature'] = stature;
  const clubTiers = arrOf<ClubTier>(v['clubTiers'], CLUB_TIERS, ctx, 'clubTiers');
  if (clubTiers) out['clubTiers'] = clubTiers;
  const lifeStates = arrOf<LifeState>(v['lifeStates'], LIFE_STATES, ctx, 'lifeStates');
  if (lifeStates) out['lifeStates'] = lifeStates;
  const mediaEras = arrOf<MediaEra>(v['mediaEras'], MEDIA_ERAS, ctx, 'mediaEras');
  if (mediaEras) out['mediaEras'] = mediaEras;
  const archetypes = arrOf<Archetype>(v['archetypes'], ARCHETYPES, ctx, 'archetypes');
  if (archetypes) out['archetypes'] = archetypes;

  const affinity = parsePersona(v['personaAffinity'], ctx, 'personaAffinity');
  if (affinity !== undefined) out['personaAffinity'] = affinity;

  if (v['once'] === true) out['once'] = true;
  if (v['scheduledOnly'] === true) out['scheduledOnly'] = true;

  const trigger = parseCondition(v['trigger'], ctx, 'trigger');
  if (trigger) out['trigger'] = trigger;

  const momentType = str(v['momentType']);
  if (momentType !== undefined) out['momentType'] = momentType;

  const story = parseStoryMeta(v['story'], ctx, 'story');
  if (story !== undefined) out['story'] = story;

  const repeatPolicy = parseRepeatPolicy(v['repeatPolicy'], ctx, 'repeatPolicy');
  if (repeatPolicy !== undefined) out['repeatPolicy'] = repeatPolicy;

  // Tek varyant mi, cok varyant mi?
  const hasVariants = Array.isArray(v['variants']);
  const hasNodes = isObj(v['nodes']);

  if (hasVariants) {
    const variants: EventVariant[] = [];
    for (const [i, raw] of (v['variants'] as unknown[]).entries()) {
      if (!isObj(raw)) {
        ctx.error(`variants[${i}]`, 'Nesne bekleniyordu.');
        continue;
      }
      const vid = str(raw['id']);
      const rootNode = str(raw['rootNode']);
      const nodes = parseNodes(raw['nodes'], ctx, `variants[${i}].nodes`);
      if (vid === undefined || rootNode === undefined || nodes === undefined) {
        ctx.error(`variants[${i}]`, 'Varyant `id`, `rootNode` ve `nodes` gerektirir.');
        continue;
      }
      const vArch = arrOf<Archetype>(raw['archetypes'], ARCHETYPES, ctx, `variants[${i}].archetypes`);
      variants.push(
        vArch ? { id: vid, rootNode, nodes, archetypes: vArch } : { id: vid, rootNode, nodes },
      );
    }
    out['variants'] = variants;
  } else if (hasNodes) {
    const rootNode = str(v['rootNode']);
    const nodes = parseNodes(v['nodes'], ctx, 'nodes');
    if (rootNode === undefined) {
      ctx.error('rootNode', '`rootNode` eksik.');
    } else {
      out['rootNode'] = rootNode;
    }
    if (nodes) out['nodes'] = nodes;
  } else {
    ctx.error('', 'Olay ya `nodes` ya da `variants` icermeli.');
    return undefined;
  }

  const lint = v['lint'];
  if (isObj(lint)) {
    const ignore = Array.isArray(lint['ignore'])
      ? lint['ignore'].filter((x): x is string => typeof x === 'string')
      : [];
    const reason = str(lint['reason']);
    if (reason === undefined || reason.trim().length === 0) {
      ctx.error(
        'lint.reason',
        'Validator muafiyeti GEREKCESIZ olamaz.',
        'Neden bu kuralin bu olayda gecerli olmadigini yaz.',
      );
    } else {
      out['lint'] = { ignore, reason };
    }
  }

  return out as unknown as StoryEvent;
}

// ---------------------------------------------------------------- flag registry

export function parseFlagDefinition(
  v: unknown,
  ctx: ParseContext,
  path: string,
): FlagDefinition | undefined {
  if (!isObj(v)) {
    ctx.error(path, 'Flag tanimi bir nesne olmali.');
    return undefined;
  }
  const key = str(v['key']);
  const kind = oneOf(v['kind'], FLAG_KINDS) as FlagKind | undefined;
  const type = oneOf(v['type'], ['number', 'boolean', 'string'] as const) as FlagType | undefined;
  const label = str(v['label']);
  if (key === undefined || kind === undefined || type === undefined || label === undefined) {
    ctx.error(
      path,
      'Flag `key`, `kind`, `type` ve `label` gerektirir.',
      `kind: ${FLAG_KINDS.join(' | ')}`,
    );
    return undefined;
  }
  const dflt = v['default'];
  if (dflt === undefined) {
    ctx.error(`${path}.default`, '`default` zorunlu.');
    return undefined;
  }
  const out: Record<string, unknown> = { key, kind, type, label, default: dflt };
  const min = num(v['min']);
  const max = num(v['max']);
  if (min !== undefined) out['min'] = min;
  if (max !== undefined) out['max'] = max;
  const shortfallTo = str(v['shortfallTo']);
  if (shortfallTo !== undefined) out['shortfallTo'] = shortfallTo;
  const softCap = num(v['softCap']);
  if (softCap !== undefined) out['softCap'] = softCap;
  const softFloor = num(v['softFloor']);
  if (softFloor !== undefined) out['softFloor'] = softFloor;
  return out as unknown as FlagDefinition;
}
