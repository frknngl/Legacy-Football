/**
 * LISANS MASKELEME -- ve KALICI KIMLIK KILIDI.
 *
 * Iki ayri sorumluluk, bilincli olarak ayni dosyada:
 *
 *   1. STRATEJI  : gercek ad -> maskeli ad. Degistirilebilir, kurallanabilir.
 *   2. BAGLAMA   : bir kere uretilen ad DONAR. Degistirilemez.
 *
 * KILIT NEDEN KRITIK:
 *   Kullanici ileride guncel bir CSV yukleyecek. O zaman oyuncunun yasi, gucu
 *   ve kulubu GUNCELLENMELI ama "Bruno Fernandos" adi ve sistemdeki ID'si
 *   AYNEN KALMALI -- yoksa 20 sezonluk bir kariyerdeki butun hatiralar
 *   (mem_* izleri, iliski slotlari, transfer gecmisi) kime ait oldugunu
 *   kaybeder.
 *
 *   Bu yuzden `mask_binding` tablosu yalnizca INSERT alir. Var olan bir
 *   (entity_kind, external_key) icin strateji BIR DAHA CALISMAZ.
 *
 * CAPA:
 *   `external_key` = kaynagin kendi ID'si (Transfermarkt player_id / club_id).
 *   Kalici ve benzersiz oldugu icin kendi ID'mizi uretmeye gerek yok; oyuncu
 *   kulup degistirse, adi duzeltilse bile bu ID sabit kalir.
 *
 * HUKUKI NOT (tek cumle, abartisiz):
 *   Isim maskelemesi riski azaltir, sifirlamaz -- gercek stat + gercek kulup
 *   + gercek uyruk birlikte kimligi taninir kilar. Bu yuzden import dogum
 *   TARIHINI degil YILINI tutar ve fotograf/sosyal medya/menajer alanlarini
 *   maskelemez, ATAR.
 */

import type { DatabaseSyncType } from './sqlite.js';

export type EntityKind = 'club' | 'player' | 'competition' | 'country';
export type MaskStrategyName = 'manual' | 'rule' | 'phonetic' | 'pool';

export interface MaskResult {
  readonly name: string;
  readonly strategy: MaskStrategyName;
}

/** Elle kuratorlu esleme. GUI bu dosyayi duzenletecek. */
export interface ManualRules {
  readonly club: Readonly<Record<string, string>>;
  readonly competition: Readonly<Record<string, string>>;
  readonly country: Readonly<Record<string, string>>;
}

export const EMPTY_RULES: ManualRules = { club: {}, competition: {}, country: {} };

/**
 * Deterministik hash (FNV-1a).
 *
 * Ayni ad + ayni tuz -> ayni maske, her calistirmada. Rastgelelik kullanmak
 * yeniden import'u ongorulemez yapardi.
 */
export function hashString(value: string, salt = 0): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// --------------------------------------------------------------- oyuncu adi

/**
 * Sonek donusum tablosu -- soyadin son hecesini kaydirir.
 *
 * Ornekler: Fernandes -> Fernandos, Sane -> Sano, Modric -> Modrac.
 * Sira ONEMLI: uzun sonek once denenir ('es' 's'den once).
 */
const SUFFIX_SHIFTS: readonly (readonly [string, string])[] = [
  ['ndes', 'ndos'],
  ['des', 'dos'],
  ['tes', 'tos'],
  ['res', 'ros'],
  ['nes', 'nos'],
  ['les', 'los'],
  ['ez', 'oz'],
  ['az', 'oz'],
  ['ic', 'ac'],
  ['ić', 'ać'],
  ['ov', 'ev'],
  ['ev', 'ov'],
  ['sen', 'son'],
  ['son', 'sen'],
  ['ini', 'ino'],
  ['eri', 'ero'],
  ['ane', 'ano'],
  ['ine', 'ino'],
  ['ard', 'ord'],
  ['aud', 'oud'],
];

const VOWELS = 'aeiouáéíóúàèìòùâêîôûäëïöüãõıİ';
/** Sesli kaydirma dongusu -- okunabilirligi korur. */
const VOWEL_ROTATION: Readonly<Record<string, string>> = {
  a: 'o',
  e: 'o',
  i: 'e',
  o: 'a',
  u: 'o',
};

/**
 * Soyadi fonetik olarak kaydirir.
 *
 * Once sonek tablosu denenir; tutmazsa SON sesli harf dondurulur. Ikisi de
 * uretemezse (sesli yok) sonuna bir harf eklenir -- cikti her zaman
 * girdiden FARKLI olmak zorundadir, yoksa maskeleme yapilmamis olur.
 */
export function phoneticShift(surname: string): string {
  const lower = surname.toLowerCase();

  for (const [from, to] of SUFFIX_SHIFTS) {
    if (lower.endsWith(from)) {
      const head = surname.slice(0, surname.length - from.length);
      return head + matchCase(to, surname.slice(surname.length - from.length));
    }
  }

  for (let i = surname.length - 1; i >= 1; i -= 1) {
    const ch = surname[i]!;
    const low = ch.toLowerCase();
    if (VOWELS.includes(low)) {
      const next = VOWEL_ROTATION[low];
      if (next === undefined) continue;
      const replaced = ch === low ? next : next.toUpperCase();
      const out = surname.slice(0, i) + replaced + surname.slice(i + 1);
      if (out !== surname) return out;
    }
  }

  return `${surname}o`;
}

/** 'os' + orijinal 'ES' -> 'OS'. Buyuk/kucuk harf desenini korur. */
function matchCase(replacement: string, original: string): string {
  if (original === original.toUpperCase() && original !== original.toLowerCase()) {
    return replacement.toUpperCase();
  }
  return replacement;
}

// --------------------------------------------------------------- kulup adi

/** Kulup adinin sonunda/basinda gecen jenerik kimlik sozcukleri. */
const CLUB_AFFIXES = new Set([
  'fc',
  'cf',
  'sc',
  'sk',
  'ac',
  'as',
  'ss',
  'us',
  'afc',
  'cd',
  'ud',
  'rc',
  'sv',
  'tsv',
  'vfb',
  'vfl',
  'bsc',
  'city',
  'united',
  'town',
  'rovers',
  'wanderers',
  'albion',
  'athletic',
  'atletico',
  'atlético',
  'real',
  'sporting',
  'club',
  'calcio',
  'spor',
  'kulubu',
  'kulübü',
  'sk.',
  '1899',
  '1900',
]);

/**
 * Kulup adini yer + kimlik olarak ayirir.
 *
 * "Manchester City"  -> yer: Manchester, kimlik: City
 * "Galatasaray SK"   -> yer: yok,        kimlik: Galatasaray
 * "FC Barcelona"     -> yer: Barcelona,  kimlik: FC
 *
 * Yer bulunursa maske "Yer + Ayirt Edici" olur; bulunamazsa tum ad havuzdan
 * uretilir. Bu ayrim "Manchester Blue / Manchester Red" desenini mumkun kilan
 * seydir.
 */
export function splitClubName(name: string): { place?: string; identity: string } {
  const tokens = name.split(/\s+/).filter((t) => t.length > 0);
  const place = tokens.filter((t) => !CLUB_AFFIXES.has(t.toLowerCase().replace(/\./g, '')));
  const identity = tokens.filter((t) => CLUB_AFFIXES.has(t.toLowerCase().replace(/\./g, '')));

  if (place.length > 0 && identity.length > 0) {
    return { place: place.join(' '), identity: identity.join(' ') };
  }
  return { identity: name };
}

/** Yer adina eklenecek ayirt ediciler -- gercek bir kulup adiyla cakismayacak sozcukler. */
const CLUB_DISTINCTIVES: readonly string[] = [
  'Blue',
  'Red',
  'White',
  'Black',
  'Green',
  'Gold',
  'Silver',
  'Crown',
  'Harbour',
  'Ironside',
  'Northgate',
  'Southgate',
  'Riverside',
  'Old Mill',
  'Cathedral',
  'Foundry',
  'Kingsway',
  'Eastfield',
  'Westbank',
  'Highbridge',
];

/** Havuzdan deterministik kulup maskesi. */
export function poolClubMask(realName: string, salt = 0): string {
  const { place } = splitClubName(realName);
  const pick = CLUB_DISTINCTIVES[hashString(realName, salt) % CLUB_DISTINCTIVES.length]!;
  if (place !== undefined && place.length > 0) return `${place} ${pick}`;
  return `${realName.split(/\s+/)[0]} ${pick}`;
}

/** Turnuva adi icin jenerik donusum. */
export function poolCompetitionMask(realName: string, salt = 0): string {
  const replacements: readonly (readonly [RegExp, string])[] = [
    [/Premier League/i, 'Premier Division'],
    [/Championship/i, 'Second Division'],
    [/Bundesliga/i, 'Bundesklasse'],
    [/LaLiga2/i, 'Liga Segunda'],
    [/LaLiga/i, 'Liga Primera'],
    [/Serie A/i, 'Serie Prima'],
    [/Serie B/i, 'Serie Seconda'],
    [/Ligue 1/i, 'Ligue Premiere'],
    [/Ligue 2/i, 'Ligue Deuxieme'],
    [/Eredivisie/i, 'Eerste Klasse'],
    [/Süper Lig/i, 'Birinci Lig'],
    [/Liga Portugal 2/i, 'Liga Lusa 2'],
    [/Liga Portugal/i, 'Liga Lusa'],
  ];
  for (const [pattern, out] of replacements) {
    if (pattern.test(realName)) return out;
  }
  const n = (hashString(realName, salt) % 9) + 1;
  return `Lig ${n}`;
}

// --------------------------------------------------------------- baglama

/**
 * Maske baglayici -- KILIDIN sahibi.
 *
 * `resolve` cagrildiginda once tabloya bakar. Baglama varsa strateji HIC
 * calismaz; kilitli ad doner. Yoksa strateji calisir, cakisma cozulur ve
 * sonuc KILITLENIR.
 */
export class MaskBinder {
  private readonly selectByKey;
  private readonly selectByName;
  private readonly insert;
  private readonly nextId;

  constructor(
    private readonly db: DatabaseSyncType,
    private readonly rules: ManualRules = EMPTY_RULES,
  ) {
    this.selectByKey = db.prepare(
      `SELECT stable_id, masked_name, strategy FROM mask_binding
       WHERE entity_kind = ? AND external_key = ?`,
    );
    this.selectByName = db.prepare(
      `SELECT 1 FROM mask_binding WHERE entity_kind = ? AND masked_name = ?`,
    );
    this.insert = db.prepare(
      `INSERT INTO mask_binding(entity_kind, external_key, stable_id, masked_name, strategy, locked_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.nextId = db.prepare(
      `SELECT COALESCE(MAX(stable_id), 0) + 1 AS n FROM mask_binding WHERE entity_kind = ?`,
    );
  }

  /** Bu varlik daha once baglanmis mi. */
  existing(kind: EntityKind, externalKey: string): { stableId: number; name: string } | undefined {
    const row = this.selectByKey.get(kind, externalKey) as
      | { stable_id: number; masked_name: string }
      | undefined;
    return row ? { stableId: row.stable_id, name: row.masked_name } : undefined;
  }

  /**
   * Maskeyi cozer ve kilitler.
   *
   * `compute` yalnizca YENI varliklar icin cagrilir. Var olanlarda strateji
   * degisse bile ad degismez -- kilit budur.
   */
  resolve(
    kind: EntityKind,
    externalKey: string,
    realName: string,
    compute: (salt: number) => MaskResult,
  ): { stableId: number; name: string; fresh: boolean } {
    const bound = this.existing(kind, externalKey);
    if (bound) return { ...bound, fresh: false };

    const manual = this.manualFor(kind, realName);
    let result: MaskResult = manual ?? compute(0);

    // Cakisma: ayni maske baska bir varliga verilmisse tuzu artirip tekrar dene.
    // Elle girilen esleme cakisirsa da kaydirilir -- benzersizlik pazarlik disi.
    for (let salt = 1; salt <= 64 && this.taken(kind, result.name); salt += 1) {
      result = compute(salt);
    }
    if (this.taken(kind, result.name)) {
      // 64 denemede cozulmediyse deterministik sonek: veri kaybindansa cirkin ad.
      result = { name: `${result.name} ${hashString(externalKey) % 9973}`, strategy: result.strategy };
    }

    const id = (this.nextId.get(kind) as { n: number }).n;
    this.insert.run(kind, externalKey, id, result.name, result.strategy, new Date().toISOString());
    return { stableId: id, name: result.name, fresh: true };
  }

  private taken(kind: EntityKind, name: string): boolean {
    return this.selectByName.get(kind, name) !== undefined;
  }

  private manualFor(kind: EntityKind, realName: string): MaskResult | undefined {
    const table =
      kind === 'club'
        ? this.rules.club
        : kind === 'competition'
          ? this.rules.competition
          : kind === 'country'
            ? this.rules.country
            : undefined;
    const hit = table?.[realName];
    return hit === undefined ? undefined : { name: hit, strategy: 'manual' };
  }

  /** Kac varlik kilitli -- rapor icin. */
  countBound(kind: EntityKind): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM mask_binding WHERE entity_kind = ?`)
      .get(kind) as { n: number };
    return row.n;
  }
}
