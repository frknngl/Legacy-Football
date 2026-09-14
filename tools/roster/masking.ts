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
import { readMaskRules } from './pipeline/reference.js';

export type EntityKind =
  | 'club'
  | 'player'
  | 'competition'
  | 'country'
  // v5: teknik heyet ve menajerlik sirketi kendi maske uzaylarini alir.
  //
  // Hakem ve menajer (agent) tarihsel olarak 'player' uzayini PAYLASIYOR
  // (bkz. referees.ts / agents.ts) ve ID cakismasi ofsetle onleniyor.
  // Yeni iki varlik icin ayni yol SECILMEDI: ayri uzay, cakisma denetimini
  // kendi icinde net tutar ve ID ofsetlerini okunur birakir.
  | 'staff'
  | 'agency';
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

/**
 * Yer adi havuzu -- gercek adinda YER GECMEYEN kulupler icin.
 *
 * OLCULEN SORUN: eski surum, yer bulamadiginda gercek adin ILK KELIMESINI
 * aynen kullaniyordu. Sonuc:
 *   Arsenal            -> "Arsenal Eastfield"
 *   Liverpool          -> "Liverpool Old Mill"
 * Yani kulubun tescilli adi maskenin ICINDE hayatta kaliyordu ve maske
 * islevini yitiriyordu. "Manchester City -> Manchester Northgate" sorun
 * degil (Manchester bir SEHIR, tescilli degil); "Arsenal -> Arsenal ..."
 * sorunun ta kendisi.
 *
 * Ayrim `CLUB_AFFIXES` ile yapilir: adinda FC/United/City gibi jenerik bir
 * ek varsa geri kalan TOKEN yer sayilir ve korunur. Yoksa ad tumuyle
 * tescilli kabul edilir ve yer havuzdan cekilir.
 */
const PLACE_POOL: readonly string[] = [
  'Ashford', 'Barrow', 'Camden', 'Denbury', 'Eastmoor', 'Fairhaven',
  'Greenock', 'Hallam', 'Irongate', 'Kelmore', 'Lyndale', 'Marlow',
  'Northwick', 'Oakley', 'Pendle', 'Quarrow', 'Redmoor', 'Stanbridge',
  'Thornby', 'Upton', 'Vale End', 'Westmere', 'Yarrow', 'Ashcombe',
  'Brackley', 'Cranfield', 'Dunmore', 'Elmwood', 'Foxhall', 'Glenmore',
];

/**
 * Havuzdan deterministik kulup maskesi.
 *
 * Iki yol:
 *   adinda yer VAR  -> "Manchester City"  -> "Manchester Northgate"
 *   adinda yer YOK  -> "Arsenal"          -> "Pendle Eastfield"
 *
 * Ikinci yolda taninabilirlik kaybolur -- bu bilincli bir takas. Kuratorlu
 * esleme (`ref_mask_rule`) istenen kulup icin bunu EZER; editorun ilk isi
 * odur.
 */
export function poolClubMask(realName: string, salt = 0): string {
  const { place } = splitClubName(realName);
  const pick = CLUB_DISTINCTIVES[hashString(realName, salt) % CLUB_DISTINCTIVES.length]!;
  if (place !== undefined && place.length > 0) return `${place} ${pick}`;
  const generated = PLACE_POOL[hashString(realName, salt + 7) % PLACE_POOL.length]!;
  return `${generated} ${pick}`;
}

/**
 * ULKE SIFATI -- "English", "Spanish", "Turkish".
 *
 * Lig adini ulkeden turetmek PES/eFootball deseni: "Premier League" yerine
 * "English League 1". Tescilli lig markasi tamamen dusurulur, buna karsilik
 * oyuncu hangi ulkenin kacinci ligi oldugunu ILK BAKISTA anlar -- ki lig
 * adinin oyundaki tek islevi budur.
 */
const COUNTRY_ADJECTIVE: Readonly<Record<string, string>> = {
  England: 'English',
  Spain: 'Spanish',
  Italy: 'Italian',
  Germany: 'German',
  France: 'French',
  Portugal: 'Portuguese',
  Netherlands: 'Dutch',
  'Türkiye': 'Turkish',
  Belgium: 'Belgian',
  Scotland: 'Scottish',
  Denmark: 'Danish',
  Norway: 'Norwegian',
  Sweden: 'Swedish',
  Poland: 'Polish',
  Austria: 'Austrian',
  Switzerland: 'Swiss',
  Greece: 'Greek',
  Croatia: 'Croatian',
  Czechia: 'Czech',
  Romania: 'Romanian',
  Ukraine: 'Ukrainian',
  Brazil: 'Brazilian',
  Argentina: 'Argentine',
  Uruguay: 'Uruguayan',
  Colombia: 'Colombian',
  Chile: 'Chilean',
  Peru: 'Peruvian',
  Mexico: 'Mexican',
  'United States': 'American',
  Japan: 'Japanese',
  'Korea Republic': 'Korean',
  'China PR': 'Chinese',
  Australia: 'Australian',
  'Saudi Arabia': 'Saudi',
  India: 'Indian',
  Hungary: 'Hungarian',
  Finland: 'Finnish',
  Cyprus: 'Cypriot',
  Azerbaijan: 'Azerbaijani',
  'Republic of Ireland': 'Irish',
  'United Arab Emirates': 'Emirati',
  Bolivia: 'Bolivian',
  Ecuador: 'Ecuadorian',
  Venezuela: 'Venezuelan',
  Paraguay: 'Paraguayan',
};

export function countryAdjective(country: string): string {
  return COUNTRY_ADJECTIVE[country] ?? country;
}

/** Turnuvanin maskeleme baglami -- ulke ve basamak. */
export interface CompetitionMaskContext {
  readonly country: string;
  readonly level?: number | undefined;
  readonly kind?: string | undefined;
}

/**
 * Turnuva adi maskesi -- PES mantigi.
 *
 * OLCULEN SORUN: eski surum sabit bir esleme tablosuydu ve tabloda olmayan
 * her lig `Lig 7` gibi anlamsiz bir ada dusuyordu. Olculdu: "England Cup"
 * -> "Lig 9". Ustelik tablodaki esleme de zayifti: "Premier League" ->
 * "Premier Division", yani tescilli "Premier" sozcugu hayatta kaliyordu.
 *
 * Yeni kural ulke + basamaktan TURETIR:
 *   England  lvl1 lig   -> "English Division 1"
 *   Germany  lvl2 lig   -> "German Division 2"
 *   England  kupa       -> "English Cup"
 * Baglam verilmezse eski davranisa duser (geriye uyumluluk).
 */
export function poolCompetitionMask(
  realName: string,
  salt = 0,
  context?: CompetitionMaskContext,
): string {
  if (context !== undefined && context.country !== '') {
    const adjective = countryAdjective(context.country);
    if (context.kind === 'domestic_cup') {
      return salt === 0 ? `${adjective} Cup` : `${adjective} Cup ${salt + 1}`;
    }
    const level = context.level ?? 1;
    return salt === 0
      ? `${adjective} Division ${level}`
      : `${adjective} Division ${level}-${salt}`;
  }

  // Baglamsiz cagri -- eski hat (Transfermarkt) hala buradan geciyor.
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

  /**
   * Kuratorlu esleme -- `ref_mask_rule` TABLOSUNDAN okunur.
   *
   * Once `mask-rules.json` dosyasindan geliyordu. Gercek veri veritabaninda
   * yasar: editorden duzenlenebilmesi ve import hattiyla ayni kaynagi
   * gormesi icin tabloya tasindi.
   */
  private readonly dbRules: ReadonlyMap<string, ReadonlyMap<string, string>>;

  constructor(
    private readonly db: DatabaseSyncType,
    private readonly rules: ManualRules = EMPTY_RULES,
  ) {
    this.dbRules = readMaskRules(db);
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
    // Once VERITABANI kurallari, sonra (geriye uyumluluk icin) dosya.
    const fromDb = this.dbRules.get(kind)?.get(realName);
    if (fromDb !== undefined) return { name: fromDb, strategy: 'manual' };

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
