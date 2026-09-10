/**
 * ISKELE -- `npm run scaffold -- --id=evt_life_wedding --category=life`
 *
 * Surdurulebilirlik vaadinin ("yeni olay = yalnizca yeni bir json") somut
 * hali. Uretilen dosya DOGRULAYICIDAN GECER: dogru klasor, dort secenek,
 * her secimde bir kazanc + bir bedel, kalici bir iz ve bir slot referansi.
 * Yazarin isi yalnizca metni degistirmek.
 *
 * Motor dosyasi ELLENMEZ: kategori klasoru ve `mem_*` izi otomatik tanimlanir.
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

function arg(name: string, fallback?: string): string | undefined {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? (found.split('=')[1] ?? fallback) : fallback;
}

const TIERS = ['minor', 'major', 'epic'] as const;
type Tier = (typeof TIERS)[number];

/** Tier basina govde metni; TierComplianceRule'un kelime araligini karsilar. */
function bodyFor(tier: Tier, actor: string): string {
  const opening =
    `BURAYI YAZ. Sahne tek bir anda acilmali: nerede oldugun, kimin karsinda ` +
    `durdugun ve neden simdi. Ilk paragraf okuyucuyu odaya sokar, aciklama yapmaz.\n\n` +
    `{actor.${actor}.name} bir sey soyluyor ve soyledigi sey secimi zorlastiriyor. ` +
    `Repliginin altinda bir tehdit ya da bir davet olmali; ikisi de olabilir.\n\n` +
    `Ikinci paragraf bedeli acikca koyar: ne kazanacaksin ve karsiliginda neyi ` +
    `birakacaksin. Oyuncu dogru cevabi bilmemeli, yalnizca neyi riske attigini bilmeli.`;

  if (tier === 'epic') {
    return (
      `${opening}\n\n` +
      `Ucuncu paragraf sahneyi genisletir: bu karar yalnizca bugunu degil, ` +
      `yillar sonra hatirlayacagin bir seyi belirliyor. Odada baska kim var, ` +
      `kim susuyor, kim bakislarini kaciriyor. Epik sahne uzun oldugu icin degil, ` +
      `geri donusu olmadigi icin epiktir.`
    );
  }
  if (tier === 'minor') {
    return (
      `BURAYI YAZ. Kucuk sahne tek bir goruntuyle acilir ve hemen secime gider.\n\n` +
      `{actor.${actor}.name} kisa bir sey soyler; cevabin da kisa olmali.`
    );
  }
  return opening;
}

interface ChoiceSpec {
  readonly id: string;
  readonly text: string;
  readonly outcome: string;
  readonly gain: readonly [string, number];
  readonly cost: readonly [string, number];
  readonly persona: Readonly<Record<string, number>>;
}

const CHOICES: readonly ChoiceSpec[] = [
  {
    id: 'c_take',
    text: 'BURAYI YAZ -- kabul et. Kazanci al, bedeli sonra ode.',
    outcome:
      'BURAYI YAZ. Sonuc paragrafi olayi ANLATMAZ, sonrasini gosterir: ne degisti, ' +
      'kim baska turlu bakiyor, hangi kapi kapandi. Tek bir somut ayrinti yeterli.',
    gain: ['servet', 50000],
    cost: ['medya_itibari', -10],
    persona: { dogruluk: -6, mizac: 4 },
  },
  {
    id: 'c_refuse',
    text: 'BURAYI YAZ -- reddet. Dogru olan ama pahali olan.',
    outcome:
      'BURAYI YAZ. Reddetmenin bedeli hemen gorunmeli; hakli cikmak rahatlatici ' +
      'olmamali. Odadan cikarken kimin yuzune bakamadigini ve o adamin ne ' +
      'yaptigini yaz. Tek bir somut ayrinti butun paragraftan daha guclu.',
    gain: ['sokak_itibari', 12],
    cost: ['yonetim_baskisi', 12],
    persona: { durus: 8, dogruluk: 7 },
  },
  {
    id: 'c_delay',
    text: 'BURAYI YAZ -- ertele. Karar vermemek de bir karardir.',
    outcome:
      'BURAYI YAZ. Erteleme sonucu, kararin BASKASI tarafindan verilmesidir. ' +
      'Kimin verdigini, ne zaman ogrendigini ve o anda nerede oldugunu yaz. ' +
      'Oyuncu kacirdigi seyi tam olarak gormeli.',
    gain: ['profesyonellik', 6],
    cost: ['moral', -8],
    persona: { mizac: -7 },
  },
  {
    id: 'c_turn',
    text: 'BURAYI YAZ -- masayi cevir. Kimsenin beklemedigi ucuncu yol.',
    outcome:
      'BURAYI YAZ. Ucuncu yol calisti ama temiz calismadi. Ne kirildigini, kimin ' +
      'bu isten zararli ciktigini ve bunun kac hafta sonra geri donecegini yaz. ' +
      'Bedelsiz zafer dolgudur.',
    gain: ['taraftar_destegi', 15],
    cost: ['medya_baskisi', 15],
    persona: { durus: 9, mizac: 6 },
  },
];

export interface ScaffoldSpec {
  readonly id: string;
  readonly category: string;
  readonly tier: Tier;
  readonly family: string;
  readonly actor: string;
  readonly authored?: 'hand' | 'generated' | undefined;
  readonly era?: string | undefined;
  readonly beat?: string | undefined;
  readonly once?: boolean | undefined;
}

const REPEAT_POLICIES: Record<Tier, Record<string, number>> = {
  epic: { arcGapTurns: 40, beatGapTurns: 120, signatureGapTurns: 80, maxBeatUses: 1 },
  major: { arcGapTurns: 16, beatGapTurns: 45, signatureGapTurns: 30, maxBeatUses: 6 },
  minor: { arcGapTurns: 10, beatGapTurns: 24, signatureGapTurns: 16 },
};

/** Iskele belgesi. Test bunu dogrulayiciya sokar; sablon asla curumez. */
export function buildEventDoc(spec: ScaffoldSpec): Record<string, unknown> {
  const memory = memoryFlagFor(spec.id);
  const choices = CHOICES.slice(0, spec.tier === 'minor' ? 3 : 4);
  const authored = spec.authored ?? 'hand';
  const beat = spec.beat ?? spec.id.replace(/^evt_[a-z0-9]+_/, '');
  const signature = `${spec.category}:${spec.actor}:${beat}`;

  const doc: Record<string, unknown> = {
    _yazar_notu: {
      neden_bu_cag: 'BURAYI YAZ: Neden bu cagda, hangi kariyer basamaginda?',
      hangi_soru: 'BURAYI YAZ: Bu sahnede oyuncuya asil sorulan soru nedir?',
      odeme_plani: 'BURAYI YAZ: Bu secimin faturasi/odulu hangi cagda nasil cikacak?',
    },
    id: spec.id,
    family: spec.family,
    category: spec.category,
    tier: spec.tier,
    authored,
    weight: 100,
    cooldown: { self: 30, family: 12 },
    story: {
      signature,
      slot: spec.actor,
      beat,
    },
    repeatPolicy: REPEAT_POLICIES[spec.tier],
  };

  if (spec.era) {
    doc['eras'] = [spec.era];
  }

  if (spec.once ?? (spec.tier === 'epic')) {
    doc['once'] = true;
  }

  doc['rootNode'] = 'n_root';
  doc['nodes'] = {
    n_root: {
      title: 'BURAYI YAZ',
      kind: 'branch',
      text: bodyFor(spec.tier, spec.actor),
      choices: choices.map((c, i) => ({
        id: c.id,
        text: c.text,
        target: `n_${c.id.replace(/^c_/, '')}`,
        effects: [
          { flag: c.gain[0], op: 'add', value: c.gain[1] },
          { flag: c.cost[0], op: 'add', value: c.cost[1] },
          // Kalici iz: bu secim yillar sonra okunabilsin diye.
          ...(i === 0 ? [{ flag: memory, op: 'set', value: true }] : []),
          ...(i === 1 ? [{ flag: `npc_${spec.actor}_arc`, op: 'add', value: 1 }] : []),
        ],
        persona: c.persona,
      })),
    },
    ...Object.fromEntries(
      choices.map((c) => [
        `n_${c.id.replace(/^c_/, '')}`,
        { title: 'BURAYI YAZ', kind: 'outcome', text: c.outcome },
      ]),
    ),
  };

  return doc;
}

export function memoryFlagFor(id: string): string {
  return `mem_${id.replace(/^evt_/, '')}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const id = arg('id');
  const category = arg('category');
  if (!id || !category) {
    console.error('Kullanim: npm run scaffold -- --id=evt_life_wedding --category=life');
    console.error('Secimlik: --tier=major --family=fam_x --slot=manager --era=rookie --beat=dugun --once=true');
    process.exitCode = 1;
    return;
  }
  if (!/^evt_[a-z0-9_]+$/.test(id)) {
    console.error(`Gecersiz id: "${id}". Kalip: evt_<kategori>_<konu>, yalnizca kucuk harf.`);
    process.exitCode = 1;
    return;
  }

  const tierArg = arg('tier', 'major')!;
  if (!(TIERS as readonly string[]).includes(tierArg)) {
    console.error(`Gecersiz tier: "${tierArg}". Secenekler: ${TIERS.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const tier = tierArg as Tier;
  const actor = arg('slot') ?? arg('actor', 'manager')!;
  const family = arg('family', `fam_${id.replace(/^evt_/, '')}`)!;
  const root = arg('root', 'content')!;
  const era = arg('era');
  const beat = arg('beat');
  const once = arg('once') === 'true' ? true : undefined;
  const authored = (arg('authored', 'hand') as 'hand' | 'generated');
  const memory = memoryFlagFor(id);

  const doc = buildEventDoc({ id, category, tier, family, actor, authored, era, beat, once });
  const choiceCount = tier === 'minor' ? 3 : 4;

  const file = join(root, 'events', category, `${id}.json`);
  if (await exists(file)) {
    console.error(`Zaten var: ${file}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

  console.log(`Olusturuldu: ${file}`);
  console.log(`  tier ${tier} | ${choiceCount} secenek | slot {actor.${actor}.*} | iz ${memory}`);
  console.log('');
  console.log('Siradaki adimlar:');
  console.log('  1. BURAYI YAZ gecen her yeri degistirin.');
  console.log('  2. Kapilari ekleyin: eras / stature / clubTiers / lifeStates / trigger.');
  console.log(`  3. "${memory}" izini okuyan bir olay yazin -- yoksa kelebek kopuk kalir.`);
  console.log('  4. npm run validate');
}

// Testler `buildEventDoc`u import eder; o durumda CLI calismamali.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
