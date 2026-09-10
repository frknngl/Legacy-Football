/**
 * KALITE KURALLARI -- yazim sozlesmesinin makineyle zorlanmasi.
 *
 * Eski sistemin en pahali hatasi 400 dosyanin 4 senaryodan ibaret olmasiydi
 * (#3) ve her olayin tam iki secenek tasimasiydi (#8). Bu dosyadaki kurallar
 * o kalite duzeyine geri dusmeyi BUILD HATASI haline getirir.
 *
 * Muafiyet mekanizmasi: olay dosyasinda
 *   "lint": { "ignore": ["TextQualityRule"], "reason": "<zorunlu gerekce>" }
 * Gerekcesiz muafiyet ayristirma asamasinda reddedilir.
 */

import { createHash } from 'node:crypto';
import { referencedFlags } from '../../domain/conditions.js';
import {
  isFlagEffect,
  isLifeStateEffect,
  isMatchDeltaEffect,
  isScheduleEffect,
  isSuspendEffect,
} from '../../domain/effects.js';
import { allNodes, type StoryEvent } from '../../domain/story.js';
import type { Tier } from '../../domain/axes.js';
import { MOMENT_TYPES } from '../../domain/match.js';
import { WORLD_TOKENS } from '../../domain/roster.js';
import {
  ACTOR_FIELDS,
  CLUB_FIELDS,
  MATCH_LOCALS,
  MEMORY_FIELDS,
  OPPONENT_FIELDS,
  PLAYER_FIELDS,
  TextInterpolator,
} from '../../evaluation/TextInterpolator.js';
import { isSuffixCase, SUFFIX_CASES } from '../../evaluation/TurkishSuffix.js';
import {
  finding,
  isWaived,
  type Finding,
  type RuleContext,
  type ValidationRule,
} from '../Rule.js';

/**
 * Tier basina yazim standardi.
 *
 * Kelime araligi NODE TIPINE gore degisir; tek bir aralik dayatmak yanlis olur:
 *   branch  : sahnedir -- mekan, ses, bir NPC bakisi, ic ses. Uzun olmali.
 *   outcome : odemedir -- kisa ve sert olabilir.
 *   roll    : karar ile sonuc arasindaki gerilim ani. Tek cumle DOGRUDUR;
 *             buraya 60 kelime dayatmak tam da bu kuralin onlemek istedigi
 *             dolguyu uretir.
 */
const TIER_SPEC: Record<
  Tier,
  {
    nodes: [number, number];
    choices: [number, number];
    branch: [number, number];
    outcome: [number, number];
  }
> = {
  epic: { nodes: [4, 28], choices: [4, 6], branch: [70, 280], outcome: [20, 280] },
  major: { nodes: [2, 16], choices: [3, 6], branch: [45, 220], outcome: [18, 220] },
  minor: { nodes: [1, 8], choices: [3, 5], branch: [40, 180], outcome: [15, 180] },
  beat: { nodes: [1, 4], choices: [3, 4], branch: [30, 150], outcome: [12, 150] },
};

/** roll node'lari her tier'da kisadir; ayri ve dar bir aralik. */
const ROLL_WORDS: [number, number] = [4, 45];

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
}

export const TierComplianceRule: ValidationRule = {
  name: 'TierComplianceRule',
  defaultSeverity: 'warn',
  description: 'Olay, tier icin tanimli node/secenek/kelime araliklarina uymali.',
  check({ events }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (isWaived(event, 'TierComplianceRule')) continue;
      const spec = TIER_SPEC[event.tier];
      const nodes = [...allNodes(event)];
      const nodeCount = event.variants
        ? Math.round(nodes.length / event.variants.length)
        : nodes.length;

      if (nodeCount < spec.nodes[0] || nodeCount > spec.nodes[1]) {
        out.push(
          finding(TierComplianceRule, event, `tier "${event.tier}" icin node sayisi ${nodeCount}, beklenen ${spec.nodes[0]}-${spec.nodes[1]}.`, {
            path: 'nodes',
            fix: 'Tier degerini icerige uydurun ya da sahneyi genisletin/kisaltin.',
          }),
        );
      }

      for (const [id, node] of nodes) {
        if (node.kind === 'branch') {
          const n = (node.choices ?? []).length;
          if (n < spec.choices[0] || n > spec.choices[1]) {
            out.push(
              finding(TierComplianceRule, event, `"${id}": ${n} secenek, tier "${event.tier}" icin ${spec.choices[0]}-${spec.choices[1]} bekleniyor.`, {
                path: `nodes.${id}.choices`,
              }),
            );
          }
        }
        const range: [number, number] =
          node.kind === 'roll' ? ROLL_WORDS : node.kind === 'outcome' ? spec.outcome : spec.branch;
        const w = wordCount(node.text);
        if (w < range[0] || w > range[1]) {
          const fix =
            node.kind === 'roll'
              ? 'roll node bir gerilim anidir; bir-iki cumle yeter. Uzunsa sahneyi branch node icine tasiyin.'
              : 'Sahneyi zenginlestirin (mekan, ses, bir NPC bakisi) ya da tier dusurun.';
          out.push(
            finding(TierComplianceRule, event, `"${id}": ${w} kelime, tier "${event.tier}" ${node.kind} node icin ${range[0]}-${range[1]} bekleniyor.`, {
              path: `nodes.${id}.text`,
              fix,
            }),
          );
        }
      }
    }
    return out;
  },
};

export const TradeoffRule: ValidationRule = {
  name: 'TradeoffRule',
  defaultSeverity: 'warn',
  description: 'Her secenek en az 1 sey kazandirmali ve en az 1 sey kaybettirmeli -- kolay dogru cevap yok.',
  check({ events, registry }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (isWaived(event, 'TradeoffRule')) continue;
      for (const [id, node] of allNodes(event)) {
        for (const [ci, choice] of (node.choices ?? []).entries()) {
          let positive = false;
          let negative = false;
          for (const e of choice.effects) {
            if (!isFlagEffect(e)) {
              // schedule / suspend / lifeState bir BEDELDIR.
              if (isScheduleEffect(e) || isSuspendEffect(e) || isLifeStateEffect(e)) negative = true;
              continue;
            }
            const def = registry.flags.get(e.flag);
            const raw = e.value;
            const n =
              typeof raw === 'number'
                ? raw
                : typeof raw === 'object' && raw !== null && 'base' in raw
                  ? (raw as { base: number }).base
                  : undefined;
            if (n === undefined) {
              // Bool memory flag: kalici bir iz, hem kazanc hem risk sayilir.
              if (def?.kind === 'memory') positive = true;
              continue;
            }
            // `pressure` turunde ARTIS kotudur, azalis iyidir.
            const inverted = def?.kind === 'pressure';
            if (n > 0) (inverted ? (negative = true) : (positive = true));
            if (n < 0) (inverted ? (positive = true) : (negative = true));
          }
          for (const axis of Object.values(choice.persona ?? {})) {
            if (typeof axis === 'number' && axis !== 0) positive = true;
          }

          if (!positive || !negative) {
            const missing = !positive ? 'olumlu' : 'olumsuz';
            out.push(
              finding(TradeoffRule, event, `"${choice.id}" seceneginde ${missing} bir sonuc yok.`, {
                path: `nodes.${id}.choices[${ci}].effects`,
                fix: 'Her secim bir sey kazandirmali ve bir sey kaybettirmeli. Bedelsiz secim dolgudur.',
              }),
            );
          }
        }
      }
    }
    return out;
  },
};

export const ConsequenceHookRule: ValidationRule = {
  name: 'ConsequenceHookRule',
  defaultSeverity: 'error',
  description: 'SONUCSUZ OLAY YASAK: her olay kalici bir iz birakmali.',
  check({ events, registry }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (isWaived(event, 'ConsequenceHookRule')) continue;
      let hasHook = false;
      for (const [, node] of allNodes(event)) {
        const effects = [
          ...(node.onEnter ?? []),
          ...(node.choices ?? []).flatMap((c) => c.effects),
          ...(node.outcomes ?? []).flatMap((o) => o.effects ?? []),
        ];
        for (const e of effects) {
          if (isScheduleEffect(e) || isLifeStateEffect(e) || isSuspendEffect(e)) hasHook = true;
          if (isMatchDeltaEffect(e) && e.incident !== undefined) hasHook = true;
          if (isFlagEffect(e)) {
            const def = registry.flags.get(e.flag);
            if (def?.kind === 'memory') hasHook = true;
            // npc_<isim>_arc ilerlemesi de kalici bir izdir.
            if (/^npc_.+_arc$/.test(e.flag)) hasHook = true;
          }
        }
        if (hasHook) break;
      }
      if (!hasHook) {
        out.push(
          finding(ConsequenceHookRule, event, 'Olay hicbir kalici iz birakmiyor.', {
            fix: 'En az biri gerekli: mem_* yaz | schedule et | npc_*_arc ilerlet | lifeState degistir | incident ac.',
          }),
        );
      }
    }
    return out;
  },
};

export const TextQualityRule: ValidationRule = {
  name: 'TextQualityRule',
  defaultSeverity: 'error',
  description: 'Klon metin yasak -- ayni sahne iki dosyada olamaz.',
  check({ events }): Finding[] {
    const out: Finding[] = [];
    const seen = new Map<string, { event: string; node: string }>();

    for (const event of events) {
      if (isWaived(event, 'TextQualityRule')) continue;
      for (const [id, node] of allNodes(event)) {
        const norm = normalize(node.text);
        if (norm.length < 20) continue;
        const hash = createHash('md5').update(norm).digest('hex');
        const prev = seen.get(hash);
        if (prev) {
          out.push(
            finding(TextQualityRule, event, `"${id}" metni "${prev.event}" -> "${prev.node}" ile birebir ayni.`, {
              path: `nodes.${id}.text`,
              fix: 'Sahneyi yeniden yazin. Isim/takim degistirmek yeni senaryo yapmaz.',
            }),
          );
        } else {
          seen.set(hash, { event: event.id, node: id });
        }
      }
    }
    return out;
  },
};

const TEMPLATE_CLOSURES = [
  normalize('Koridordan ayrilirken bu secimin etkisinin beklediginden uzun sure kalacagini fark ettin'),
  normalize('Kisa bir duraksamadan sonra bu adimin yarina tasinacak bir iz biraktigi netlesti'),
  normalize('Sahne kapanirken verdigin karar gunun ritmini degistiren sessiz bir kirilmaya donustu'),
];

const BROKEN_TAIL_FRAGMENTS = new Set<string>([
  normalize('bu secimin'),
  normalize('bu secimin izi'),
  normalize('bu anin'),
  normalize('bu anin yankisi'),
  normalize('icindeki gerilim'),
  normalize('kararin agirligi omzuna'),
  normalize('kimse acikca konusmaz'),
  normalize('tribunun ugultusu'),
  normalize('tribunun ugultusu uzaktan'),
  normalize('koridorda sessizlik'),
  normalize('koridorda sessizlik derinlesir'),
  normalize('ince bir tereddut'),
]);

function sentenceParts(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function repeatedTailSentence(sentences: readonly string[]): string | undefined {
  if (sentences.length < 2) return undefined;
  const last = sentences[sentences.length - 1]!;
  const prev = sentences[sentences.length - 2]!;
  const nLast = normalize(last);
  const nPrev = normalize(prev);

  if (nLast === '' || nPrev === '') return undefined;
  if (nLast === nPrev && Math.max(wordCount(last), wordCount(prev)) <= 8) return last;

  const closeStem = nLast.startsWith(nPrev) || nPrev.startsWith(nLast);
  if (closeStem && Math.min(wordCount(last), wordCount(prev)) <= 4) {
    return wordCount(last) <= wordCount(prev) ? last : prev;
  }
  return undefined;
}

function brokenTailFragment(sentences: readonly string[]): string | undefined {
  for (const s of sentences.slice(-2)) {
    if (wordCount(s) > 5) continue;
    const n = normalize(s);
    if (BROKEN_TAIL_FRAGMENTS.has(n)) return s;
  }
  return undefined;
}

export const TailTemplateRule: ValidationRule = {
  name: 'TailTemplateRule',
  defaultSeverity: 'warn',
  description: 'Kirik kuyruk ve sablon kapanis metni otomatik tespit edilir.',
  check({ events }): Finding[] {
    const out: Finding[] = [];

    for (const event of events) {
      if (isWaived(event, 'TailTemplateRule')) continue;
      for (const [id, node] of allNodes(event)) {
        const norm = normalize(node.text);

        if (TEMPLATE_CLOSURES.some((tail) => norm.endsWith(tail))) {
          out.push(
            finding(TailTemplateRule, event, `"${id}" metni sablon kapanisla bitiyor.`, {
              path: `nodes.${id}.text`,
              fix: 'Kapanisi sahneye ozel odeme cumlesiyle yeniden yazin; stok kapanis kullanmayin.',
            }),
          );
          continue;
        }

        const sentences = sentenceParts(node.text);
        const repeat = repeatedTailSentence(sentences);
        if (repeat !== undefined) {
          out.push(
            finding(TailTemplateRule, event, `"${id}" metninin kuyrugunda tekrar eden parcacik var: "${repeat}".`, {
              path: `nodes.${id}.text`,
              fix: 'Kuyruktaki tekrari silin ve metni tek bir net kapanisla bitirin.',
            }),
          );
          continue;
        }

        const broken = brokenTailFragment(sentences);
        if (broken !== undefined) {
          out.push(
            finding(TailTemplateRule, event, `"${id}" metninin kuyrugunda kirik parcacik var: "${broken}".`, {
              path: `nodes.${id}.text`,
              fix: 'Kuyruktaki kirik parcayi sahneye bagli tam bir cumleye cevirin ya da kaldirin.',
            }),
          );
        }
      }
    }

    return out;
  },
};

/**
 * Teknik tanimlayici oyuncuya GORUNMEZ.
 *
 * `mem_used_own_healer` bir motor anahtaridir, bir cumle degil. Uretilen
 * sahnelerde bu anahtarlarin dogrudan metne sizdigi goruldu ("o odada
 * yasadigin mem_mind_kirilma_psychologist sureci"). Klon metinden farkli
 * olarak bu goze carpmaz: sahne akici okunur, yalnizca bir kelime yanlistir.
 *
 * `{...}` icindeki her sey yer tutucudur ve taramanin disinda kalir --
 * `{mem_x}` mesru bir interpolasyondur, `mem_x` degildir.
 */
const RAW_IDENTIFIER = /\b(?:mem|inc|iliski|npc|persona|evt|fam)_[a-z0-9_]+/i;

export const RawIdentifierRule: ValidationRule = {
  name: 'RawIdentifierRule',
  defaultSeverity: 'error',
  description: 'Motor anahtari oyuncuya gosterilen metne sizamaz.',
  check({ events }): Finding[] {
    const out: Finding[] = [];

    const scan = (event: StoryEvent, path: string, text: string): void => {
      if (isWaived(event, 'RawIdentifierRule')) return;
      const hit = RAW_IDENTIFIER.exec(text.replace(/\{[^}]*\}/g, ' '));
      if (!hit) return;
      out.push(
        finding(RawIdentifierRule, event, `Metne teknik tanimlayici sizmis: "${hit[0]}".`, {
          path,
          fix: 'Anahtari cumleden cikarin. Izi metinde degil `onEnter`/`requires` icinde tasiyin.',
        }),
      );
    };

    for (const event of events) {
      for (const [id, node] of allNodes(event)) {
        scan(event, `nodes.${id}.text`, node.text);
        scan(event, `nodes.${id}.title`, node.title);
        for (const choice of node.kind === 'branch' ? (node.choices ?? []) : []) {
          scan(event, `nodes.${id}.choices.${choice.id}.text`, choice.text);
          if (choice.lockLabel !== undefined) {
            scan(event, `nodes.${id}.choices.${choice.id}.lockLabel`, choice.lockLabel);
          }
        }
      }
    }
    return out;
  },
};

export const InterpolationRule: ValidationRule = {
  name: 'InterpolationRule',
  defaultSeverity: 'error',
  description: 'Metindeki her {yer_tutucu} ve :filtre tanimli olmali.',
  check({ events, registry }): Finding[] {
    const out: Finding[] = [];
    const locals = new Set<string>(MATCH_LOCALS);
    const scopes: Readonly<Record<string, ReadonlySet<string>>> = {
      player: new Set(PLAYER_FIELDS),
      club: new Set(CLUB_FIELDS),
      opponent: new Set(OPPONENT_FIELDS),
      world: new Set(WORLD_TOKENS),
    };

    for (const event of events) {
      if (isWaived(event, 'InterpolationRule')) continue;
      for (const [id, node] of allNodes(event)) {
        const texts = [
          { t: node.title, p: `nodes.${id}.title` },
          { t: node.text, p: `nodes.${id}.text` },
          ...(node.choices ?? []).map((c, i) => ({ t: c.text, p: `nodes.${id}.choices[${i}].text` })),
        ];
        for (const { t, p } of texts) {
          for (const { key, filter } of TextInterpolator.tokens(t)) {
            if (filter !== undefined && !isSuffixCase(filter)) {
              out.push(
                finding(InterpolationRule, event, `Bilinmeyen ek filtresi: ":${filter}"`, {
                  path: p,
                  fix: `Gecerli filtreler: ${SUFFIX_CASES.join(', ')}.`,
                }),
              );
            }
            const problem = describeUnknownToken(key, registry, locals, scopes);
            if (problem) out.push(finding(InterpolationRule, event, problem.message, { path: p, fix: problem.fix }));
          }
        }
      }
    }
    return out;
  },
};

/**
 * Epiloglar da yer tutucu tasir ve olay metinleriyle ayni denetimi hak eder.
 * Kariyerin son ekraninda cozulmemis bir {actor.xxx} en gorunur hatadir.
 */
export const EndingInterpolationRule: ValidationRule = {
  name: 'EndingInterpolationRule',
  defaultSeverity: 'error',
  description: 'endings.json epiloglarindaki her yer tutucu ve filtre tanimli olmali.',
  check({ registry }): Finding[] {
    const out: Finding[] = [];
    const locals = new Set<string>(MATCH_LOCALS);
    const scopes: Readonly<Record<string, ReadonlySet<string>>> = {
      player: new Set(PLAYER_FIELDS),
      club: new Set(CLUB_FIELDS),
      opponent: new Set(OPPONENT_FIELDS),
      world: new Set(WORLD_TOKENS),
    };

    for (const ending of registry.config.endings) {
      for (const { key, filter } of TextInterpolator.tokens(ending.epilogue)) {
        if (filter !== undefined && !isSuffixCase(filter)) {
          out.push({
            rule: EndingInterpolationRule.name,
            severity: 'error',
            file: 'orchestrator/endings.json',
            path: `endings.${ending.id}.epilogue`,
            message: `Bilinmeyen ek filtresi: ":${filter}"`,
            fix: `Gecerli filtreler: ${SUFFIX_CASES.join(', ')}.`,
          });
        }
        const problem = describeUnknownToken(key, registry, locals, scopes);
        if (!problem) continue;
        out.push({
          rule: EndingInterpolationRule.name,
          severity: 'error',
          file: 'orchestrator/endings.json',
          path: `endings.${ending.id}.epilogue`,
          message: problem.message,
          fix: problem.fix,
        });
      }
    }
    return out;
  },
};

/** Cozulemeyecek bir token mu? Cozulebiliyorsa undefined. */
function describeUnknownToken(
  key: string,
  registry: RuleContext['registry'],
  locals: ReadonlySet<string>,
  scopes: Readonly<Record<string, ReadonlySet<string>>>,
): { message: string; fix: string } | undefined {
  const dot = key.indexOf('.');
  // Noktasiz anahtar hicbir zaman kapsam degildir: bare `{opponent}` mac
  // baglami yerel degiskenidir, `{opponent.name}` ise kulup kaydidir.
  const head = dot > 0 ? key.slice(0, dot) : '';
  const tail = dot > 0 ? key.slice(dot + 1) : '';

  if (head === 'actor') {
    const slotId = tail.split('.')[0] ?? '';
    const field = tail.includes('.') ? tail.slice(tail.indexOf('.') + 1) : 'name';
    if (!registry.slots.has(slotId)) {
      return {
        message: `Bilinmeyen slot: {actor.${slotId}}`,
        fix: `roles.json icindeki bir slot kullanin (ornek: ${[...registry.slots.keys()].slice(0, 3).join(', ')}).`,
      };
    }
    if (!(ACTOR_FIELDS as readonly string[]).includes(field)) {
      return {
        message: `Bilinmeyen aktor alani: {actor.${slotId}.${field}}`,
        fix: `Gecerli alanlar: ${ACTOR_FIELDS.join(', ')}.`,
      };
    }
    return undefined;
  }

  if (head === 'memory') {
    const lastDot = tail.lastIndexOf('.');
    if (lastDot <= 0) {
      return { message: `Eksik hafiza alani: {${key}}`, fix: 'Bicim: {memory.<mem_flag>.<alan>}' };
    }
    const flag = tail.slice(0, lastDot);
    const field = tail.slice(lastDot + 1);
    if (!registry.flags.has(flag)) {
      return { message: `Tanimsiz hafiza flag'i: {${key}}`, fix: `"${flag}" hicbir yerde yazilmiyor.` };
    }
    if (!(MEMORY_FIELDS as readonly string[]).includes(field)) {
      return {
        message: `Bilinmeyen hafiza alani: {${key}}`,
        fix: `Gecerli alanlar: ${MEMORY_FIELDS.join(', ')}.`,
      };
    }
    return undefined;
  }

  const scope = scopes[head];
  if (scope) {
    return scope.has(tail)
      ? undefined
      : {
          message: `Bilinmeyen ${head} alani: {${key}}`,
          fix: `Gecerli alanlar: ${[...scope].join(', ')}.`,
        };
  }

  if (locals.has(key) || registry.flags.has(key)) return undefined;

  return {
    message: `Tanimsiz yer tutucu: {${key}}`,
    fix: `core.json'a "${key}" flag'ini ekleyin ya da yer tutucuyu duzeltin.`,
  };
}

export const OrphanMemoryFlagRule: ValidationRule = {
  name: 'OrphanMemoryFlagRule',
  scope: 'corpus',
  defaultSeverity: 'warn',
  description: 'Yazilan her mem_* bir gun OKUNMALI; okunan her mem_* bir yerde YAZILMALI.',
  check({ events, registry }): Finding[] {
    const out: Finding[] = [];
    const written = new Map<string, string>();
    const read = new Map<string, string>();

    for (const event of events) {
      if (event.trigger) {
        for (const f of referencedFlags(event.trigger)) {
          if (!read.has(f)) read.set(f, event.id);
        }
      }
      for (const [, node] of allNodes(event)) {
        for (const c of node.choices ?? []) {
          if (c.requires) for (const f of referencedFlags(c.requires)) if (!read.has(f)) read.set(f, event.id);
        }
        for (const o of node.outcomes ?? []) {
          for (const m of o.weight.modifiers ?? []) if (!read.has(m.flag)) read.set(m.flag, event.id);
        }
        const effects = [
          ...(node.onEnter ?? []),
          ...(node.choices ?? []).flatMap((c) => c.effects),
          ...(node.outcomes ?? []).flatMap((o) => o.effects ?? []),
        ];
        for (const e of effects) {
          if (isFlagEffect(e) && !written.has(e.flag)) written.set(e.flag, event.id);
        }
      }
    }

    // Sonlar ve rakip arki da OKUMA yeridir: "gecmisin finali belirler"
    // vaadi tam olarak buradan gecer. Bunlari saymazsak kural, kariyerin
    // sonunda okunan her izi olu kelebek sanir.
    for (const ending of registry.config.endings) {
      for (const f of referencedFlags(ending.requires)) {
        if (!read.has(f)) read.set(f, `(son: ${ending.id})`);
      }
    }
    // EPILOG KODALARI da okuma yeridir -- hatta en dogru yer: kariyerin
    // biraktigi izin karsiligini sonda vermek, kelebek vaadinin ta
    // kendisi.
    for (const coda of registry.config.epilogueCodas) {
      for (const f of referencedFlags(coda.requires)) {
        if (!read.has(f)) read.set(f, `(koda: ${coda.id})`);
      }
    }
    for (const arc of registry.config.nemeses) {
      for (const r of arc.resolutions) {
        if (!r.condition) continue;
        for (const f of referencedFlags(r.condition)) {
          if (!read.has(f)) read.set(f, `(rakip finali: ${r.id})`);
        }
      }
    }

    for (const def of registry.flags.byKind('memory')) {
      // MOTOR DA BIR YAZARDIR.
      //
      // Kural yalnizca icerigi tariyordu ve motorun yazdigi izleri
      // "okunuyor ama hicbir yerde yazilmiyor" diye bildiriyordu.
      // Olculdu: uc yanlis alarm (`mem_gambling_debt`, `mem_hoca_kovuldu`,
      // `mem_rakibe_transfer`) -- ucu de `GameEngine` icinde yaziliyor.
      //
      // Yanlis alarm veren bir kural, dogru alarmlarini da supheli kilar:
      // 182 uyarinin icinde hangisinin gercek oldugunu bilemezsin.
      const engineWrites = def.writableBy?.includes('engine') ?? false;
      const w = written.get(def.key) ?? (engineWrites ? '(motor)' : undefined);
      const r = read.get(def.key);
      if (w !== undefined && r === undefined) {
        // CIRCIR (ratchet): eski borc hos gorulur, YENI borc hatadir.
        //
        // Olculdu: 204 memory bayragindan 180'i hic okunmuyordu. Kurali
        // aninda `error` yapmak dogrulayiciyi kilitler; `warn` birakmak
        // ise her partide yeni yetim uretilmesine izin verir (bu oturumda
        // uc kez oldu). Taban listesi ikisini de cozer.
        const grandfathered = registry.config.orphanBaseline?.includes(def.key) ?? false;
        out.push({
          rule: OrphanMemoryFlagRule.name,
          severity: grandfathered ? 'warn' : 'error',
          file: events.find((e) => e.id === w)?.sourceFile ?? '(motor)',
          message: grandfathered
            ? `"${def.key}" yaziliyor ama hicbir yerde okunmuyor -- olu kelebek (taban listesinde).`
            : `"${def.key}" yaziliyor ama hicbir yerde okunmuyor -- YENI olu kelebek.`,
          fix: grandfathered
            ? 'Bu izi okuyan bir olay yazin; yazinca satirini orphan-baseline.json icinden SILIN.'
            : 'Bu izi okuyan bir olay yazin ya da flag tanimini kaldirin. Yeni yetim kabul edilmez -- eski borc buyutulmemeli.',
        });
      }
      if (r !== undefined && w === undefined) {
        out.push({
          rule: OrphanMemoryFlagRule.name,
          severity: 'warn',
          file: events.find((e) => e.id === r)?.sourceFile ?? '(bilinmiyor)',
          message: `"${def.key}" okunuyor ama hicbir yerde yazilmiyor -- olu olay.`,
          fix: 'Bu izi yazan bir karar ekleyin; aksi halde bu olay hic tetiklenmez.',
        });
      }
    }
    return out;
  },
};

export const IncidentLifetimeRule: ValidationRule = {
  name: 'IncidentLifetimeRule',
  scope: 'corpus',
  defaultSeverity: 'warn',
  description: 'Acilan her inc_* flag icin onu okuyan en az 1 tepki olayi olmali.',
  check({ events, registry }): Finding[] {
    const out: Finding[] = [];
    const opened = new Map<string, StoryEvent>();
    const consumed = new Set<string>();

    for (const event of events) {
      for (const [, node] of allNodes(event)) {
        const effects = [
          ...(node.onEnter ?? []),
          ...(node.choices ?? []).flatMap((c) => c.effects),
          ...(node.outcomes ?? []).flatMap((o) => o.effects ?? []),
        ];
        for (const e of effects) {
          if (isMatchDeltaEffect(e) && e.incident) opened.set(e.incident, event);
          if (isFlagEffect(e) && registry.flags.get(e.flag)?.kind === 'incident') {
            opened.set(e.flag, event);
          }
        }
      }
      if (event.trigger) {
        for (const f of referencedFlags(event.trigger)) {
          if (registry.flags.get(f)?.kind === 'incident') consumed.add(f);
        }
      }
    }

    for (const [flag, event] of opened) {
      if (!consumed.has(flag)) {
        out.push(
          finding(IncidentLifetimeRule, event, `"${flag}" aciliyor ama hicbir tepki olayi onu okumuyor.`, {
            fix: 'Bu incident icin bir reaction olayi yazin; yoksa roportaj penceresi bos kalir.',
          }),
        );
      }
    }
    return out;
  },
};

export const MomentCoverageRule: ValidationRule = {
  name: 'MomentCoverageRule',
  scope: 'corpus',
  defaultSeverity: 'error',
  description: 'Host tarafindan sunulabilecek her moment tipini karsilayan en az 1 olay olmali.',
  check({ events }): Finding[] {
    const covered = new Set(events.map((e) => e.momentType).filter(Boolean) as string[]);
    // Beklenen liste DOMAIN'den okunur. Eskiden burada 10 tiplik bir kopya
    // vardi ve host'a yeni bir tip eklendiginde bu kural sessizce yalan
    // soyluyordu: kapsanmayan tipi hic bildirmiyordu.
    return MOMENT_TYPES.filter((t) => !covered.has(t)).map((t) => ({
      rule: MomentCoverageRule.name,
      severity: 'error' as const,
      file: '(icerik kapsami)',
      message: `"${t}" moment tipini karsilayan olay yok -- host bu ani bosa sunar.`,
      fix: `content/events/match/ altina momentType: "${t}" tasiyan bir olay ekleyin.`,
    }));
  },
};

export const UnusedWaiverRule: ValidationRule = {
  name: 'UnusedWaiverRule',
  defaultSeverity: 'warn',
  description: 'Artik gerekmeyen validator muafiyeti temizlenmeli.',
  check(): Finding[] {
    // Gercek kontrol ValidationReport icinde yapilir (hangi muafiyet is gordu
    // bilgisi ancak tum kurallar kostuktan sonra bilinir).
    return [];
  },
};
