/**
 * YAPISAL KURALLAR -- grafin ve semanin tutarliligi.
 *
 * Eski sistemde tespit edilen hatalardan #7 (tanimsiz flag), #8 (her olayda
 * tam 2 secenek), #12 (cooldown 0 + weight 100) ve #14 (her target hardcoded
 * hub_calendar) bu dosyadaki kurallarla YAPISAL olarak imkansiz hale gelir.
 */

import { referencedFlags } from '../../domain/conditions.js';
import { isFlagEffect, isScheduleEffect, isValueRef } from '../../domain/effects.js';
import { allNodes, type StoryEvent, type StoryNode } from '../../domain/story.js';
import { CONTENT_READONLY_KINDS } from '../../domain/flags.js';
import { finding, isWaived, type Finding, type ValidationRule } from '../Rule.js';

/** Bir olayin (varyantli ya da varyantsiz) tum node kumelerini gezer. */
function nodeSets(event: StoryEvent): { label: string; root: string; nodes: Record<string, StoryNode> }[] {
  if (event.nodes && event.rootNode) {
    return [{ label: '', root: event.rootNode, nodes: { ...event.nodes } }];
  }
  return (event.variants ?? []).map((v) => ({
    label: `variants.${v.id}.`,
    root: v.rootNode,
    nodes: { ...v.nodes },
  }));
}

export const DanglingTargetRule: ValidationRule = {
  name: 'DanglingTargetRule',
  defaultSeverity: 'error',
  description: 'Her secim ve sonuc hedefi ayni olay icinde var olan bir node hedefine isaret etmeli.',
  check({ events }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (isWaived(event, 'DanglingTargetRule')) continue;
      for (const set of nodeSets(event)) {
        if (!(set.root in set.nodes)) {
          out.push(
            finding(DanglingTargetRule, event, `rootNode "${set.root}" tanimli degil.`, {
              path: `${set.label}rootNode`,
              fix: `nodes altina "${set.root}" ekleyin ya da rootNode’u mevcut bir node hedefine cevirin.`,
            }),
          );
        }
        for (const [id, node] of Object.entries(set.nodes)) {
          const targets: { path: string; target: string }[] = [];
          for (const [i, c] of (node.choices ?? []).entries()) {
            if (c.target !== undefined) targets.push({ path: `${set.label}${id}.choices[${i}].target`, target: c.target });
          }
          for (const [i, o] of (node.outcomes ?? []).entries()) {
            targets.push({ path: `${set.label}${id}.outcomes[${i}].target`, target: o.target });
          }
          if (node.next !== undefined) targets.push({ path: `${set.label}${id}.next`, target: node.next });

          for (const t of targets) {
            if (!(t.target in set.nodes)) {
              out.push(
                finding(DanglingTargetRule, event, `Hedef node bulunamadi: "${t.target}"`, {
                  path: t.path,
                  fix: 'Hedefi kaldirin (olay biter) ya da o node tanimlayin.',
                }),
              );
            }
          }
        }
      }
    }
    return out;
  },
};

export const UnreachableNodeRule: ValidationRule = {
  name: 'UnreachableNodeRule',
  defaultSeverity: 'error',
  description: 'Yazilmis ama hicbir yoldan ulasilamayan node olmamali.',
  check({ events }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (isWaived(event, 'UnreachableNodeRule')) continue;
      for (const set of nodeSets(event)) {
        const reachable = new Set<string>();
        const stack = [set.root];
        while (stack.length > 0) {
          const id = stack.pop()!;
          if (reachable.has(id)) continue;
          reachable.add(id);
          const node = set.nodes[id];
          if (!node) continue;
          for (const c of node.choices ?? []) if (c.target) stack.push(c.target);
          for (const o of node.outcomes ?? []) stack.push(o.target);
          if (node.next) stack.push(node.next);
        }
        for (const id of Object.keys(set.nodes)) {
          if (!reachable.has(id)) {
            out.push(
              finding(UnreachableNodeRule, event, `Ulasilamayan node: "${id}"`, {
                path: `${set.label}${id}`,
                fix: 'Bir secimden hedef gosterin ya da node silin.',
              }),
            );
          }
        }
      }
    }
    return out;
  },
};

export const MinChoiceCountRule: ValidationRule = {
  name: 'MinChoiceCountRule',
  defaultSeverity: 'error',
  description: 'Her branch node en az 3 secenek tasimali -- ikili secim dolgudur.',
  check({ events }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (isWaived(event, 'MinChoiceCountRule')) continue;
      for (const [id, node] of allNodes(event)) {
        if (node.kind !== 'branch') continue;
        const n = (node.choices ?? []).length;
        if (n < 3) {
          out.push(
            finding(MinChoiceCountRule, event, `"${id}" node icinde ${n} secenek var, en az 3 gerekli.`, {
              path: `nodes.${id}.choices`,
              fix: 'Bir guvenli, bir riskli, bir stat-kilitli ve bir gri secenek deseni kullanin.',
            }),
          );
        }
      }
    }
    return out;
  },
};

export const EscapeHatchRule: ValidationRule = {
  name: 'EscapeHatchRule',
  defaultSeverity: 'error',
  description: 'Her branch node icinde en az 1 KOSULSUZ secenek olmali; oyuncu takilamaz.',
  check({ events }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (isWaived(event, 'EscapeHatchRule')) continue;
      for (const [id, node] of allNodes(event)) {
        if (node.kind !== 'branch') continue;
        const hasOpen = (node.choices ?? []).some((c) => c.requires === undefined);
        if (!hasOpen) {
          out.push(
            finding(EscapeHatchRule, event, `"${id}" node icindeki her secenek kosullu -- oyuncu kilitlenebilir.`, {
              path: `nodes.${id}.choices`,
              fix: 'En az bir secenegin requires alanini kaldirin.',
            }),
          );
        }
      }
    }
    return out;
  },
};

export const UndeclaredFlagRule: ValidationRule = {
  name: 'UndeclaredFlagRule',
  defaultSeverity: 'error',
  description: 'Okunan ya da yazilan her flag core.json’da beyan edilmis olmali.',
  check({ events, registry }): Finding[] {
    const out: Finding[] = [];
    const report = (event: StoryEvent, flag: string, path: string, mode: 'okuma' | 'yazma'): void => {
      if (registry.flags.has(flag)) return;
      out.push(
        finding(UndeclaredFlagRule, event, `Tanimsiz flag ${mode}: "${flag}"`, {
          path,
          fix: `content/orchestrator/core.json icine "${flag}" tanimini ekleyin.`,
        }),
      );
    };

    for (const event of events) {
      if (isWaived(event, 'UndeclaredFlagRule')) continue;

      if (event.trigger) {
        for (const f of referencedFlags(event.trigger)) report(event, f, 'trigger', 'okuma');
      }

      for (const [id, node] of allNodes(event)) {
        for (const [i, e] of (node.onEnter ?? []).entries()) {
          if (isFlagEffect(e)) report(event, e.flag, `nodes.${id}.onEnter[${i}]`, 'yazma');
        }
        for (const [ci, c] of (node.choices ?? []).entries()) {
          if (c.requires) {
            for (const f of referencedFlags(c.requires)) {
              report(event, f, `nodes.${id}.choices[${ci}].requires`, 'okuma');
            }
          }
          for (const [ei, e] of c.effects.entries()) {
            if (isFlagEffect(e)) report(event, e.flag, `nodes.${id}.choices[${ci}].effects[${ei}]`, 'yazma');
          }
        }
        for (const [oi, o] of (node.outcomes ?? []).entries()) {
          for (const m of o.weight.modifiers ?? []) {
            report(event, m.flag, `nodes.${id}.outcomes[${oi}].weight`, 'okuma');
          }
          for (const [ei, e] of (o.effects ?? []).entries()) {
            if (isFlagEffect(e)) report(event, e.flag, `nodes.${id}.outcomes[${oi}].effects[${ei}]`, 'yazma');
          }
        }
      }
    }
    return out;
  },
};

export const ReadOnlyFlagRule: ValidationRule = {
  name: 'ReadOnlyFlagRule',
  defaultSeverity: 'error',
  description: 'Icerik derived ve match flag turlerine yazamaz; onlari motor ve host uretir.',
  check({ events, registry }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (isWaived(event, 'ReadOnlyFlagRule')) continue;
      for (const [id, node] of allNodes(event)) {
        const effects = [
          ...(node.onEnter ?? []).map((e, i) => ({ e, p: `nodes.${id}.onEnter[${i}]` })),
          ...(node.choices ?? []).flatMap((c, ci) =>
            c.effects.map((e, ei) => ({ e, p: `nodes.${id}.choices[${ci}].effects[${ei}]` })),
          ),
        ];
        for (const { e, p } of effects) {
          if (!isFlagEffect(e)) continue;
          const def = registry.flags.get(e.flag);
          if (!def) continue;
          if (CONTENT_READONLY_KINDS.includes(def.kind)) {
            out.push(
              finding(ReadOnlyFlagRule, event, `"${e.flag}" (${def.kind}) icerikten yazilamaz.`, {
                path: p,
                fix: 'Bu deger motor tarafindan turetilir; icerik yalnizca OKUR.',
              }),
            );
          }
          if (def.kind === 'persona' && e.op === 'set') {
            out.push(
              finding(ReadOnlyFlagRule, event, `Kimlik ekseni "${e.flag}" dogrudan set edilemez.`, {
                path: p,
                fix: 'Secimin persona alanini kullanin; kimlik BIRIKIR, atanmaz.',
              }),
            );
          }
        }
      }
    }
    return out;
  },
};

export const CooldownSanityRule: ValidationRule = {
  name: 'CooldownSanityRule',
  defaultSeverity: 'error',
  description: 'Yuksek agirlikli olay sifir cooldown ile tekrar tekrar cikamaz.',
  check({ events }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (isWaived(event, 'CooldownSanityRule')) continue;
      if (event.weight <= 0) {
        out.push(
          finding(CooldownSanityRule, event, `weight ${event.weight} -- olay hicbir zaman secilmez.`, {
            path: 'weight',
            fix: 'Pozitif bir agirlik verin.',
          }),
        );
      }
      if (event.cooldown.family <= 0 && event.once !== true) {
        out.push(
          finding(CooldownSanityRule, event, 'Aile cooldown’u 0 -- ayni tema ust uste cikabilir.', {
            path: 'cooldown.family',
            fix: 'En az 2-3 tur verin. Bu kural "ust uste 100 gece kulubu" hatasini onler.',
          }),
        );
      }
      if (event.cooldown.self < event.cooldown.family) {
        out.push(
          finding(
            CooldownSanityRule,
            event,
            `self (${event.cooldown.self}) aile cooldown degerinden (${event.cooldown.family}) kucuk.`,
            {
              path: 'cooldown',
              fix: 'Olayin kendisi, ailesinden daha sik cikamamali: self >= family.',
            },
          ),
        );
      }
    }
    return out;
  },
};

export const RollWeightRule: ValidationRule = {
  name: 'RollWeightRule',
  defaultSeverity: 'error',
  description: 'roll node icinde en az 2 sonuc olmali ve hicbiri erisilemez kalmamali.',
  check({ events }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (isWaived(event, 'RollWeightRule')) continue;
      for (const [id, node] of allNodes(event)) {
        if (node.kind !== 'roll') continue;
        const outcomes = node.outcomes ?? [];
        if (outcomes.length < 2) {
          out.push(
            finding(RollWeightRule, event, `"${id}" roll node icinde ${outcomes.length} sonuc var.`, {
              path: `nodes.${id}.outcomes`,
              fix: 'Bir zar atisinin en az iki olasi sonucu olmali; yoksa outcome kullanin.',
            }),
          );
        }
        const totalBase = outcomes.reduce((s, o) => s + o.weight.base, 0);
        if (totalBase <= 0) {
          out.push(
            finding(RollWeightRule, event, `"${id}" roll node icinde toplam taban agirlik 0.`, {
              path: `nodes.${id}.outcomes`,
              fix: 'En az bir sonuca pozitif base verin; aksi halde ilk dala dusulur.',
            }),
          );
        }
        for (const [i, o] of outcomes.entries()) {
          if (o.weight.base <= 0 && (o.weight.modifiers ?? []).every((m) => m.scale <= 0)) {
            out.push(
              finding(RollWeightRule, event, `"${id}" sonuc ${i} hicbir kosulda secilemez.`, {
                path: `nodes.${id}.outcomes[${i}].weight`,
                fix: 'Pozitif bir base ya da pozitif olcekli bir modifier ekleyin.',
              }),
            );
          }
        }
      }
    }
    return out;
  },
};

export const ScheduledEventRule: ValidationRule = {
  name: 'ScheduledEventRule',
  defaultSeverity: 'error',
  description: 'schedule efektinin isaret ettigi olay var olmali; cancel politikasi yedek gerektirir.',
  check({ events, registry }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (isWaived(event, 'ScheduledEventRule')) continue;
      for (const [id, node] of allNodes(event)) {
        const all = [
          ...(node.onEnter ?? []).map((e, i) => ({ e, p: `nodes.${id}.onEnter[${i}]` })),
          ...(node.choices ?? []).flatMap((c, ci) =>
            c.effects.map((e, ei) => ({ e, p: `nodes.${id}.choices[${ci}].effects[${ei}]` })),
          ),
          ...(node.outcomes ?? []).flatMap((o, oi) =>
            (o.effects ?? []).map((e, ei) => ({ e, p: `nodes.${id}.outcomes[${oi}].effects[${ei}]` })),
          ),
        ];
        for (const { e, p } of all) {
          if (!isScheduleEffect(e)) continue;
          if (!registry.get(e.event)) {
            out.push(
              finding(ScheduledEventRule, event, `Zamanlanan olay bulunamadi: "${e.event}"`, {
                path: p,
                fix: 'Olay kimligini duzeltin ya da hedef olayi yazin. Kirik kuyruk = sessizce kopan hikaye ipi.',
              }),
            );
          }
          if (e.inTurns <= 0) {
            out.push(
              finding(ScheduledEventRule, event, `inTurns ${e.inTurns} -- gelecege zamanlanmali.`, {
                path: p,
                fix: 'En az 1 verin.',
              }),
            );
          }
          if (e.onIneligible === 'cancel' && e.replaceWith === undefined) {
            out.push(
              finding(ScheduledEventRule, event, 'cancel politikasi replaceWith olmadan kullanilamaz.', {
                path: p,
                fix: 'Yedek bir olay verin; aksi halde hikaye ipi sessizce kopar.',
              }),
            );
          }
          if (e.replaceWith !== undefined && !registry.get(e.replaceWith)) {
            out.push(
              finding(ScheduledEventRule, event, `Yedek olay bulunamadi: "${e.replaceWith}"`, { path: p }),
            );
          }
        }
      }
    }
    return out;
  },
};

export const RootNodeKindRule: ValidationRule = {
  name: 'RootNodeKindRule',
  defaultSeverity: 'warn',
  description: 'Olayin kok node oyuncuya bir karar sunmali.',
  check({ events }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (isWaived(event, 'RootNodeKindRule')) continue;
      for (const set of nodeSets(event)) {
        const root = set.nodes[set.root];
        if (root && root.kind === 'outcome') {
          out.push(
            finding(RootNodeKindRule, event, `Kok node "${set.root}" bir outcome -- karar sunmuyor.`, {
              path: `${set.label}rootNode`,
              fix: 'Koku branch ya da roll yapin. Karar sunmayan olay dolgudur.',
            }),
          );
        }
      }
    }
    return out;
  },
};

/**
 * VARYANT AYRIKLIGI -- ayni olayin iki anlatimi birbirinin kopyasi olamaz.
 *
 * OLCULEN SORUN:
 *   271 varyant ciftinin %97'si ayni sayida secenege, %93'u ayni kilit
 *   desenine, %66'si ayni bayrak setine sahip. 51/90 olayda TUM
 *   varyantlarin secenek->efekt imzasi birebir ayni. Kelimeler farkli,
 *   iskelet ayni -- oyuncu bunu tekrar olarak hisseder.
 *
 * NEDEN MEVCUT KURALLAR YAKALAMIYOR:
 *   `VariantConsistencyRule` yalnizca yapisal gecerlilik denetliyor
 *   (benzersiz id, bos degil, >=2 varyant). `TextQualityRule` md5 ile
 *   BIREBIR klon ariyor -- tek kelime degisse tutmuyor.
 *
 * KURAL:
 *   Iki varyant su uc eksenden EN AZ IKISINDE ayrismali:
 *     1. secenek sayisi
 *     2. kilit deseni (kac tane, hangi bayrak)
 *     3. bayrak seti (hangi flag'lere dokunuyor)
 *
 *   Uc eksende de ayni olmak = ayni sahnenin sifat degistirilmis hali.
 *
 * SEVERITY:
 *   Ilk asamada `warn`. Mevcut 55 cift 4/4 ayni; hepsi aninda `error`
 *   olsaydi dogrulayici kilitlenir ve hicbir is yapilamazdi. Temizlik
 *   bitince `error`a cevrilecek.
 */
/**
 * VARYANT INCIDENT KORUMASI.
 *
 * Mac anlari incident'lerin KAYNAGIDIR: `inc_var_against`,
 * `inc_scored_penalty`, `inc_injured_in_match`... Tepki sahneleri ve
 * uzun zincirler bunlarla tetiklenir.
 *
 * OLCULEN SORUN:
 *   Uretilen 30 mac varyanti incident'leri hic tasimadi. Motor o
 *   varyanti sectiginde mac SONUCSUZ kaliyor: tepki sahnesi cikmiyor,
 *   VAR -> roportaj -> PFDK -> ceza zinciri sessizce oluyor. Hicbir
 *   kural bakmadigi icin 0 hatayla korpusa girdiler; yalnizca bir
 *   zincir testi patladigi icin fark edildi.
 *
 * KURAL:
 *   Ayni olayin varyantlari AYNI incident kumesini acmali. Bir varyant
 *   kardesinin actigi bir incident'i acmiyorsa, o dal oyunun sonuc
 *   sistemini deler.
 */
export const VariantIncidentRule: ValidationRule = {
  name: 'VariantIncidentRule',
  defaultSeverity: 'error',
  description: 'Ayni olayin varyantlari AYNI incident kumesini acmali.',
  check({ events }): Finding[] {
    const out: Finding[] = [];

    for (const event of events) {
      if (event.variants === undefined || event.variants.length < 2) continue;
      if (isWaived(event, 'VariantIncidentRule')) continue;

      const per = event.variants.map((v) => ({
        id: v.id,
        incidents: incidentsOf(v.nodes),
      }));
      const union = new Set(per.flatMap((p) => [...p.incidents]));
      if (union.size === 0) continue;

      for (const { id, incidents } of per) {
        const missing = [...union].filter((i) => !incidents.has(i)).sort();
        if (missing.length === 0) continue;
        out.push(
          finding(
            VariantIncidentRule,
            event,
            `"${id}" kardeslerinin actigi olayi acmiyor: ${missing.join(', ')}`,
            {
              path: `variants.${id}`,
              fix:
                'Bir outcome node\'unun `onEnter` alanina ' +
                '{ "op": "match", "incident": "..." } ekleyin. Incident acmayan ' +
                'bir varyant maci SONUCSUZ birakir ve tepki zincirini sessizce oldurur.',
            },
          ),
        );
      }
    }
    return out;
  },
};

/** Bir node kumesinin actigi incident'ler. */
function incidentsOf(nodes: Record<string, StoryNode>): Set<string> {
  const out = new Set<string>();
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    const rec = value as Record<string, unknown>;
    const inc = rec['incident'];
    if (typeof inc === 'string') out.add(inc);
    const flag = rec['flag'];
    if (typeof flag === 'string' && flag.startsWith('inc_')) out.add(flag);
    for (const child of Object.values(rec)) {
      if (Array.isArray(child)) child.forEach(walk);
      else walk(child);
    }
  };
  walk(nodes);
  return out;
}

export const VariantDistinctnessRule: ValidationRule = {
  name: 'VariantDistinctnessRule',
  // `warn` -> `error` (9 Eylul 2026).
  //
  // Kural yazildiginda 55 cift 4/4 ayni iskeletteydi; hepsi aninda hata
  // olsaydi dogrulayici kilitlenir ve hicbir is yapilamazdi. Temizlik
  // bitti: bulgu 55 -> 0. Kapi artik kapali, cunku bu kural GELECEGI
  // koruyor -- korpus buyudukce ayni iskeletin tekrar uretilmesi en
  // olasi bozulma bicimi.
  defaultSeverity: 'error',
  description:
    'Ayni olayin iki varyanti secenek sayisi / kilit deseni / bayrak setinden en az IKISINDE ayrismali.',
  check({ events }): Finding[] {
    const out: Finding[] = [];

    for (const event of events) {
      if (event.variants === undefined || event.variants.length < 2) continue;
      if (isWaived(event, 'VariantDistinctnessRule')) continue;

      const shapes = event.variants.map((v) => {
        const root = v.nodes[v.rootNode];
        const choices = root?.choices ?? [];
        return {
          id: v.id,
          count: choices.length,
          locks: choices
            .map((c) => (c.requires === undefined ? '-' : lockKey(c.requires)))
            .join('|'),
          flags: [
            ...new Set(choices.flatMap((c) => c.effects.filter(isFlagEffect).map((e) => e.flag))),
          ]
            .sort()
            .join(','),
        };
      });

      for (let i = 0; i < shapes.length; i += 1) {
        for (let j = i + 1; j < shapes.length; j += 1) {
          const a = shapes[i]!;
          const b = shapes[j]!;
          const same = [a.count === b.count, a.locks === b.locks, a.flags === b.flags];
          const sameCount = same.filter(Boolean).length;
          if (sameCount < 2) continue;

          const axes: string[] = [];
          if (same[0]) axes.push(`secenek sayisi (${a.count})`);
          if (same[1]) axes.push('kilit deseni');
          if (same[2]) axes.push('bayrak seti');

          out.push(
            finding(
              VariantDistinctnessRule,
              event,
              `"${a.id}" ve "${b.id}" ayni iskelet: ${axes.join(' + ')}`,
              {
                path: `variants.${b.id}`,
                fix: 'Varyant ayni sahnenin sifat degistirilmis hali olamaz. Mekani, nesneyi, ucuncu kisiyi ve SECENEKLERIN SEKLINI degistirin -- kelimeleri degil.',
              },
            ),
          );
        }
      }
    }
    return out;
  },
};

/** Kilit kosulunun kimlik anahtari -- ic ice kosullarda ilk yaprak yeter. */
function lockKey(condition: unknown): string {
  const flags = [...referencedFlags(condition as never)].sort();
  return flags.length === 0 ? '?' : flags.join('+');
}

/**
 * SEKIL CESITLILIGI -- tum kulliyat tek sablon olamaz.
 *
 * OLCULEN SORUN:
 *   345 sahnenin %77'si 4 secenekli, %67'si tam 5 dugumlu (1 branch +
 *   4 outcome), %69'unda tam 1 kilitli secenek. `roll` dugumu tum
 *   kulliyatta 31 tane.
 *
 *   Bu sablonla 1364 metin yazilsa bile tekrar hissi gecmez: oyuncu
 *   metni degil RITMI taniyor. "Yine dort secenek, yine biri kilitli."
 *
 * KURAL:
 *   Bir kategorideki sahnelerin %70'inden fazlasi ayni iskelete
 *   (secenek sayisi + dugum sayisi) sahipse uyari. Kategori basina TEK
 *   bulgu uretilir -- her sahneye ayri uyari basmak raporu bogar ve
 *   sorunun kategori capinda oldugunu gizler.
 *
 *   Esik 3'ten az sahnesi olan kategorilere bakilmaz: iki sahnenin
 *   ayni sekilde olmasi istatistik degil tesaduftur.
 */
export const ShapeVarietyRule: ValidationRule = {
  name: 'ShapeVarietyRule',
  defaultSeverity: 'warn',
  description: 'Bir kategorideki sahnelerin %70+"i ayni iskelete sahip olamaz.',
  check({ events }): Finding[] {
    const out: Finding[] = [];
    const byCategory = new Map<string, { shapes: Map<string, number>; total: number; sample: StoryEvent }>();

    for (const event of events) {
      if (isWaived(event, 'ShapeVarietyRule')) continue;
      for (const set of nodeSets(event)) {
        const root = set.nodes[set.root];
        if (!root || root.kind !== 'branch') continue;
        const shape = `${(root.choices ?? []).length}s/${Object.keys(set.nodes).length}d`;
        const cell = byCategory.get(event.category) ?? {
          shapes: new Map<string, number>(),
          total: 0,
          sample: event,
        };
        cell.shapes.set(shape, (cell.shapes.get(shape) ?? 0) + 1);
        cell.total += 1;
        byCategory.set(event.category, cell);
      }
    }

    for (const [category, cell] of byCategory) {
      if (cell.total < 3) continue;
      const [topShape, topCount] = [...cell.shapes].sort((a, b) => b[1] - a[1])[0]!;
      const share = topCount / cell.total;
      if (share <= 0.7) continue;
      out.push(
        finding(
          ShapeVarietyRule,
          cell.sample,
          `"${category}" kategorisinin %${Math.round(share * 100)}'i ayni iskelette: ${topShape} (${topCount}/${cell.total})`,
          {
            fix: 'Sekil katalogunu kullanin (docs/senaryo-matrisi.md): sert ikilem (2 secenek), genis (5-6), zar (roll), cok asamali, taniklik (karar yok). Oyuncu metni degil RITMI taniyor.',
          },
        ),
      );
    }
    return out;
  },
};

export const VariantConsistencyRule: ValidationRule = {
  name: 'VariantConsistencyRule',
  defaultSeverity: 'error',
  description: 'Varyantli olayda her varyantin kendi koku ve node kumesi olmali.',
  check({ events }): Finding[] {
    const out: Finding[] = [];
    for (const event of events) {
      if (event.variants === undefined) continue;
      if (isWaived(event, 'VariantConsistencyRule')) continue;
      const ids = new Set<string>();
      for (const v of event.variants) {
        if (ids.has(v.id)) {
          out.push(finding(VariantConsistencyRule, event, `Ayni varyant id iki kez: "${v.id}"`, { path: 'variants' }));
        }
        ids.add(v.id);
        if (Object.keys(v.nodes).length === 0) {
          out.push(
            finding(VariantConsistencyRule, event, `Varyant "${v.id}" bos.`, { path: `variants.${v.id}.nodes` }),
          );
        }
      }
      if (event.variants.length < 2) {
        out.push(
          finding(
            VariantConsistencyRule,
            event,
            'Tek varyantli olay -- variants yerine dogrudan nodes kullanin.',
            { path: 'variants', fix: 'Varyantlarin amaci ayni metnin ikinci kez cikmasini onlemektir.' },
          ),
        );
      }
    }
    return out;
  },
};

/**
 * BAYRAK REFERANSI DENETIMI.
 *
 * `ValueRef` bir efektin buyuklugunu CALISMA ZAMANINDA bir bayraktan
 * okur. Bu guclu bir ilkel ama sessiz bir hata kaynagi: tanimsiz ya da
 * sayisal olmayan bir referans `0` verir ve efekt hicbir sey yapmaz.
 * Bahis kaybi 0 TL olur, kredi taksiti hic kesilmez -- ve hicbir yerde
 * hata gorunmez.
 *
 * Bu yuzden referans BUILD ZAMANINDA denetlenir:
 *   1. Bayrak tanimli mi
 *   2. Sayisal mi (boolean 0/1 verir, string her zaman 0)
 *   3. Carpan makul mu -- 1000 kat bir carpan neredeyse her zaman
 *      yazim hatasidir ve ekonomiyi tek sahnede patlatir
 *
 * SEVERITY `error`: bu ilkel yeni, yani grandfather edilecek mevcut
 * ihlal yok. Kapiyi bastan sikilastirmak, sonra temizlemekten ucuzdur.
 */
export const ValueRefRule: ValidationRule = {
  name: 'ValueRefRule',
  defaultSeverity: 'error',
  description: 'ValueRef tanimli ve SAYISAL bir bayraga isaret etmeli; carpan makul olmali.',
  check({ events, registry }): Finding[] {
    const out: Finding[] = [];
    const MAX_MUL = 100;

    for (const event of events) {
      if (isWaived(event, 'ValueRefRule')) continue;
      for (const [nodeId, node] of allNodes(event)) {
        const effects = [
          ...(node.onEnter ?? []).map((e) => ({ e, path: `nodes.${nodeId}.onEnter` })),
          ...(node.choices ?? []).flatMap((c) =>
            c.effects.map((e) => ({ e, path: `nodes.${nodeId}.choices.${c.id}.effects` })),
          ),
        ];

        for (const { e, path } of effects) {
          if (!isFlagEffect(e) || !isValueRef(e.value)) continue;
          const ref = e.value.ref;
          const def = registry.flags.get(ref);

          if (!def) {
            out.push(
              finding(ValueRefRule, event, `"${ref}" diye bir bayrak yok (ValueRef).`, {
                path,
                fix: 'Referansi core.json`daki bir bayraga cevirin. Tanimsiz referans sessizce 0 verir.',
              }),
            );
            continue;
          }

          if (def.type !== 'number') {
            out.push(
              finding(
                ValueRefRule,
                event,
                `"${ref}" sayisal degil (${def.type}); ValueRef her zaman 0 uretir.`,
                { path, fix: 'Sayisal bir bayraga referans verin.' },
              ),
            );
          }

          const mul = e.value.mul;
          if (mul !== undefined && Math.abs(mul) > MAX_MUL) {
            out.push(
              finding(
                ValueRefRule,
                event,
                `"${ref}" carpani ${mul} -- ${MAX_MUL} kattan buyuk carpan neredeyse her zaman yazim hatasidir.`,
                { path, fix: 'Carpani kucultun ya da sabit bir deger kullanin.' },
              ),
            );
          }

          if (mul === 0) {
            out.push(
              finding(ValueRefRule, event, `"${ref}" carpani 0 -- efekt hicbir sey yapmaz.`, {
                path,
                fix: 'Carpan 0 ise efekti silin; olu efekt okuyucuyu yaniltir.',
              }),
            );
          }
        }
      }
    }
    return out;
  },
};


/**
 * MAC ANLARINDA HER YOL BIR OLAY ACMALI.
 *
 * OLCULEN SORUN: `VariantIncidentRule` varyant DUZEYINDE bakiyor --
 * "bu varyant su incident'i bir yerde aciyor mu". Dort sonuctan
 * yalnizca biri aciyorsa kural GECIYOR.
 *
 * Bedeli olculdu: `evt_match_var_against` varyantlarindan `v_kirilma`nin
 * HICBIR yolu `inc_var_against` acmiyordu ve iki sonucu hicbir sey
 * acmiyordu. Motor o varyanti sectiginde VAR karari hic olmamis gibi
 * davraniyor; roportaj penceresi sessizce kapaniyor ve
 * VAR -> PFDK -> ceza zinciri kopuyor. Orijinal govde (`v_asil`) bunu
 * dogru yapiyordu: BES sonucunun besi de aciyordu.
 *
 * KURAL: bir mac olayinin (momentType tasiyan) her `outcome` dugumu EN
 * AZ BIR incident acmali. Mac ani sonucsuz kalamaz -- oyuncu bir karar
 * verdi, sahada bir sey oldu; hicbir sey acilmamasi o kararin dunyada
 * karsiligi olmamasi demektir.
 */
export const MomentOutcomeIncidentRule: ValidationRule = {
  name: 'MomentOutcomeIncidentRule',
  defaultSeverity: 'error',
  description: 'Mac aninin HER sonucu en az bir incident acmali.',
  check({ events }): Finding[] {
    const out: Finding[] = [];

    for (const event of events) {
      if (event.momentType === undefined) continue;
      if (isWaived(event, 'MomentOutcomeIncidentRule')) continue;

      for (const set of nodeSets(event)) {
        for (const [nodeId, node] of Object.entries(set.nodes)) {
          if (node.kind !== 'outcome') continue;
          const opens = (node.onEnter ?? []).some(
            (e) => 'incident' in e && typeof (e as { incident?: unknown }).incident === 'string',
          );
          if (opens) continue;

          out.push(
            finding(
              MomentOutcomeIncidentRule,
              event,
              `"${nodeId}" hicbir olay acmiyor -- mac ani sonucsuz kaliyor.`,
              {
                path: `${set.label}nodes.${nodeId}.onEnter`,
                fix:
                  'Bu sonuca { "op": "match", "incident": "inc_..." } ekleyin. ' +
                  'Sahada bir sey oldu; tepki sahnesi onu okumali.',
              },
            ),
          );
        }
      }
    }
    return out;
  },
};


/**
 * ULASILAMAZ TETIKLI OLAYA SEVK "fire" OLMALI.
 *
 * OLCULEN SORUN: bazi olaylar YALNIZCA kuyruktan gelir ve kendiliginden
 * cikmasin diye tetikleri BILEREK saglanamaz yapilir
 * (`evt_legal_pfdk_hearing`: `turnsSince 999999`). Boyle bir olayi
 * `onIneligible: "defer"` ile sevk etmek onu SONSUZA DEK erteler:
 * uygunluk kapisi hicbir zaman acilmaz.
 *
 * Bedeli olculdu: uretilen bir varyant `onIneligible` alanini atladi
 * (varsayilan `defer`). PFDK kuyruga girdi, `forced` onceligi tasidi,
 * vadesi geldi -- ve SEKIZ TUR boyunca hic calismadi. VAR -> PFDK ->
 * ceza zinciri sessizce oldu. Orijinal govde `"onIneligible": "fire"`
 * yaziyordu; fark yalnizca bu tek alandi.
 *
 * Hicbir mevcut kural bunu yakalamiyordu: sevk vardi, onceligi dogruydu,
 * hedef olay vardi. Eksik olan tek sey davranisti.
 */
export const ScheduleReachabilityRule: ValidationRule = {
  name: 'ScheduleReachabilityRule',
  defaultSeverity: 'error',
  description: 'Tetigi saglanamayan olaya sevk `onIneligible: fire` istemeli.',
  check({ events }): Finding[] {
    const out: Finding[] = [];

    /** Tetigi pratikte saglanamayan olaylar -- yalnizca kuyruktan gelirler. */
    const unreachable = new Set(
      events
        .filter((e) => {
          if (e.scheduledOnly === true) return true;
          const trigger = e.trigger as { op?: string; value?: unknown } | undefined;
          return trigger?.op === 'turnsSince' && Number(trigger.value) > 10_000;
        })
        .map((e) => e.id),
    );
    if (unreachable.size === 0) return out;

    for (const event of events) {
      if (isWaived(event, 'ScheduleReachabilityRule')) continue;
      for (const set of nodeSets(event)) {
        for (const [nodeId, node] of Object.entries(set.nodes)) {
          const effects = [
            ...(node.onEnter ?? []),
            ...(node.choices ?? []).flatMap((c) => c.effects),
          ];
          for (const effect of effects) {
            if (!isScheduleEffect(effect)) continue;
            if (!unreachable.has(effect.event)) continue;
            if (effect.onIneligible === 'fire') continue;
            if (effect.onIneligible === 'cancel' && effect.replaceWith !== undefined) continue;

            out.push(
              finding(
                ScheduleReachabilityRule,
                event,
                `"${effect.event}" yalnizca kuyruktan gelir; ` +
                  `"${effect.onIneligible ?? 'defer'}" ile sevk edilirse SONSUZA DEK ertelenir.`,
                {
                  path: `${set.label}nodes.${nodeId}`,
                  fix: 'Sevke `"onIneligible": "fire"` ekleyin -- olay uygunluk kapisini asarak calisir.',
                },
              ),
            );
          }
        }
      }
    }
    return out;
  },
};
