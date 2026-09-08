/**
 * Turkce ek cekimi.
 *
 * Isimler PROSEDUREL uretildigi icin metne "Baris'in" yazilamaz: bir sonraki
 * tohumda o isim "Oktay" olur ve ek bozulur. Icerik yalnizca hali belirtir:
 *
 *   {actor.captain.first:gen}  -> Baris'in | Oktay'in | Vinicius'un
 *   {club.name:loc}            -> Karadeniz FK'da
 *   {actor.manager.name:abl}   -> Orhan Kaya'dan
 *
 * Ozel isim oldugu icin ek her zaman KESME ISARETIYLE baglanir; bu ayni zamanda
 * unsuz yumusamasini da devre disi birakir (Mehmet'i, "Mehmedi" degil).
 */

export const SUFFIX_CASES = ['gen', 'acc', 'dat', 'loc', 'abl', 'ins', 'plu'] as const;
export type SuffixCase = (typeof SUFFIX_CASES)[number];

const BACK_VOWELS = 'aıou';
const FRONT_VOWELS = 'eiöü';
const VOWELS = BACK_VOWELS + FRONT_VOWELS;

/** "fistikci sahap" -- sert unsuzler locative/ablative ekini sertlestirir. */
const VOICELESS = 'fstkçşhp';

type Harmony2 = 'a' | 'e';
type Harmony4 = 'ı' | 'i' | 'u' | 'ü';

export function isSuffixCase(v: string): v is SuffixCase {
  return (SUFFIX_CASES as readonly string[]).includes(v);
}

/** Turkce harf adlari -- kisaltmalar okundugu gibi cekilir: FK -> "ka" -> FK'da. */
const LETTER_NAMES: Readonly<Record<string, string>> = {
  A: 'a', B: 'be', C: 'ce', 'Ç': 'çe', D: 'de', E: 'e', F: 'fe', G: 'ge', 'Ğ': 'ge',
  H: 'he', I: 'ı', 'İ': 'i', J: 'je', K: 'ka', L: 'le', M: 'me', N: 'ne', O: 'o',
  'Ö': 'ö', P: 'pe', R: 're', S: 'se', 'Ş': 'şe', T: 'te', U: 'u', 'Ü': 'ü',
  V: 've', Y: 'ye', Z: 'ze',
};

const ABBREVIATION = /^[A-ZÇĞİÖŞÜ]{2,}$/;

/**
 * Uyum hesabinin bakacagi bicim.
 *
 * "Karadeniz FK" yazilir ama "karadeniz fe-KA" okunur; ek okunusa gore gelir.
 * Kisaltmayla biten adlarda son harfin ADI kullanilir, aksi halde kelimenin
 * kendisi.
 */
function phoneticForm(word: string): string {
  const tokens = word.trim().split(/\s+/);
  const last = tokens[tokens.length - 1];
  if (last !== undefined && ABBREVIATION.test(last)) {
    const name = LETTER_NAMES[last.slice(-1)];
    if (name !== undefined) return name;
  }
  return word;
}

/** Sondan basa ilk unluyu bulur. Yoksa undefined. */
function lastVowel(word: string): string | undefined {
  const lower = word.toLocaleLowerCase('tr-TR');
  for (let i = lower.length - 1; i >= 0; i -= 1) {
    const ch = lower[i]!;
    if (VOWELS.includes(ch)) return ch;
  }
  return undefined;
}

/** Buyuk unlu uyumu: kalin -> a, ince -> e. */
function harmony2(word: string): Harmony2 {
  const v = lastVowel(word);
  if (v === undefined) return 'e';
  return BACK_VOWELS.includes(v) ? 'a' : 'e';
}

/** Kucuk unlu uyumu: a,ı -> ı | e,i -> i | o,u -> u | ö,ü -> ü */
function harmony4(word: string): Harmony4 {
  const v = lastVowel(word);
  switch (v) {
    case 'a':
    case 'ı':
      return 'ı';
    case 'o':
    case 'u':
      return 'u';
    case 'ö':
    case 'ü':
      return 'ü';
    default:
      return 'i';
  }
}

function lastChar(word: string): string {
  return word.slice(-1).toLocaleLowerCase('tr-TR');
}

function endsWithVowel(word: string): boolean {
  return VOWELS.includes(lastChar(word));
}

/** Sert unsuzle bitiyorsa d -> t. */
function hardConsonant(word: string): boolean {
  return VOICELESS.includes(lastChar(word));
}

function suffixFor(word: string, kase: SuffixCase): string {
  const sound = phoneticForm(word);
  const v4 = harmony4(sound);
  const v2 = harmony2(sound);
  const vowelEnd = endsWithVowel(sound);

  switch (kase) {
    // -(n)ın / -(n)in / -(n)un / -(n)ün
    case 'gen':
      return `${vowelEnd ? 'n' : ''}${v4}n`;
    // -(y)ı / -(y)i / -(y)u / -(y)ü
    case 'acc':
      return `${vowelEnd ? 'y' : ''}${v4}`;
    // -(y)a / -(y)e
    case 'dat':
      return `${vowelEnd ? 'y' : ''}${v2}`;
    // -da / -de / -ta / -te
    case 'loc':
      return `${hardConsonant(sound) ? 't' : 'd'}${v2}`;
    // -dan / -den / -tan / -ten
    case 'abl':
      return `${hardConsonant(sound) ? 't' : 'd'}${v2}n`;
    // -(y)la / -(y)le
    case 'ins':
      return `${vowelEnd ? 'y' : ''}l${v2}`;
    // -lar / -ler
    case 'plu':
      return `l${v2}r`;
  }
}

/**
 * Ozel isme ek ekler: `Baris` + `gen` -> `Baris'in`
 *
 * Bos ya da cozulememis bir isim geldiginde ek EKLENMEZ; "'ın" gibi sahipsiz
 * bir ek metinde durmaktansa hicbir sey durmasi iyidir.
 */
export function applySuffix(word: string, kase: SuffixCase): string {
  const trimmed = word.trim();
  if (trimmed.length === 0) return word;
  return `${trimmed}'${suffixFor(trimmed, kase)}`;
}
