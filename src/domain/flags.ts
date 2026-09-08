/**
 * Flag registry: TEK dogruluk kaynagi.
 *
 * Eski sistemin en buyuk yapisal hatasi, iki rakip `core.json’in birbirinin ust
 * kumesi bile olmamasi ve `tukenmislik` / `has_bribed_police` gibi flag'lerin
 * hicbir yerde beyan edilmemesiydi. Burada beyan edilmeyen flag'e yazmak hatadir.
 */

/**
 * Flag turu. Yalnizca etiket degil -- motorun davranisini belirler:
 *  - `stat`      : 0-100 arasi clamp'lenir
 *  - `resource`  : para/takipci gibi sinirsiz (ya da genis) sayisal deger
 *  - `pressure`  : 0-100 arasi baski gostergesi
 *  - `incident`  : `inc_*`, HER MACIN BASINDA otomatik silinir (roportaj penceresi)
 *  - `relation`  : `iliski_*`, 0-100 duygu
 *  - `persona`   : `persona_*`, BIRIKIMLI; icerik dogrudan `set` EDEMEZ
 *  - `memory`    : `mem_*`, kalici + otomatik zaman damgali (kelebek etkisi)
 *  - `match`     : host tarafindan disaridan yazilir, icerik yalnizca OKUR
 *  - `system`    : motorun yonettigi durum (turn, age, lifeState...)
 *  - `derived`   : motor hesaplar, icerik yalnizca OKUR, kimse yazamaz
 */
export const FLAG_KINDS = [
  'stat',
  'resource',
  'pressure',
  'incident',
  'relation',
  'persona',
  'memory',
  'match',
  'system',
  'derived',
] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

export type FlagType = 'number' | 'boolean' | 'string';

export type FlagValue = number | boolean | string;

export interface FlagDefinition {
  readonly key: string;
  readonly kind: FlagKind;
  readonly type: FlagType;
  readonly default: FlagValue;
  /** Yalnizca `number` icin. Verilmezse kind'a gore varsayilan uygulanir. */
  readonly min?: number;
  readonly max?: number;
  /** Insan okunur etiket -- CLI ve hata mesajlarinda gosterilir. */
  readonly label: string;
  /** Bu flag'i yalnizca su kaynak yazabilir. Ihlali validator yakalar. */
  readonly writableBy?: readonly ('content' | 'engine' | 'host')[];
  /**
   * YETERSIZLIK POLITIKASI.
   *
   * Bir cikarma bu flag'i `min’in altina itecekse, flag `min’e kirpilir ve
   * ACIK buraya yazilir. `servet` icin `borc` demektir: ikon seviyesinde
   * 730.000 TL'lik bir rusvet, 200.000 TL'si olan oyuncuyu eksi servete
   * dusurmez -- 530.000 TL borclandirir.
   *
   * Bu bir lint kurali degil, motorun davranisidir.
   */
  readonly shortfallTo?: string;
  /**
   * AZALAN GETIRI DIZI -- bu degerin uzerindeki ARTISLAR sonumlenir.
   *
   * NEDEN VAR:
   *   Olculdu: `liderlik` bayragina icerikte 237 etki dokunuyor ve
   *   233'u ARTI (+1113'e karsilik -23). 50'den baslayan bayrak dort
   *   sahnede 70'i asiyor, 900 turluk kariyerin ortasinda 100'e
   *   yapisiyor ve bir daha hic inmiyor. Icerikteki 219 kilitli secim
   *   kosulunun neredeyse tamami bu bayraga bagli oldugu icin, oyunun
   *   TEK gercek kapi sistemi kariyerin ortasinda tamamen kayboluyor.
   *
   * NASIL CALISIR:
   *   Dizin altinda artislar tam uygulanir. Ustunde kalan bosluga gore
   *   olceklenir: `delta * (max - current) / (max - knee)`. Dizin 70,
   *   tavan 100 icin -- 70'te tam, 85'te yarim, 95'te altida bir. Tavana
   *   ASIMPTOTIK yaklasilir, yapisilmaz.
   *
   *   AZALISLAR sonumlenmez. Kazanmak zorlasir, kaybetmek kolay kalir --
   *   yuksek bir degeri KORUMAK da bir secim olmali.
   *
   * Verilmezse sonum yok; bu alan opt-in.
   */
  readonly softCap?: number;
}

/** Icerigin dogrudan yazmasi YASAK olan turler. */
export const CONTENT_READONLY_KINDS: readonly FlagKind[] = ['derived', 'match'];

/** Icerigin `set` ile ezmesi yasak, yalnizca `add` ile itekleyebilecegi turler. */
export const NUDGE_ONLY_KINDS: readonly FlagKind[] = ['persona'];

/** Kind bazli varsayilan sayisal sinirlar. */
export function defaultBounds(kind: FlagKind): { min?: number; max?: number } {
  switch (kind) {
    case 'stat':
    case 'pressure':
    case 'relation':
    case 'persona':
      return { min: 0, max: 100 };
    case 'resource':
      return { min: 0 };
    default:
      return {};
  }
}

export type FlagRegistryMap = ReadonlyMap<string, FlagDefinition>;

/** Salt-okunur flag registry. `ContentLoader` tarafindan kurulur. */
export class FlagRegistry {
  private constructor(private readonly defs: FlagRegistryMap) {}

  static from(definitions: readonly FlagDefinition[]): FlagRegistry {
    const map = new Map<string, FlagDefinition>();
    for (const d of definitions) map.set(d.key, d);
    return new FlagRegistry(map);
  }

  has(key: string): boolean {
    return this.defs.has(key);
  }

  get(key: string): FlagDefinition | undefined {
    return this.defs.get(key);
  }

  keys(): IterableIterator<string> {
    return this.defs.keys();
  }

  all(): readonly FlagDefinition[] {
    return [...this.defs.values()];
  }

  byKind(kind: FlagKind): readonly FlagDefinition[] {
    return this.all().filter((d) => d.kind === kind);
  }

  /** Registry default'lariyla bos bir flag sozlugu uretir. */
  defaults(): Record<string, FlagValue> {
    const out: Record<string, FlagValue> = {};
    for (const d of this.defs.values()) out[d.key] = d.default;
    return out;
  }

  /**
   * Bir ARTISIN sonumlenmis hali.
   *
   * `softCap` tanimli degilse delta oldugu gibi doner. Azalislar ve
   * `set`/`mul` islemleri bu yoldan gecmez -- yalnizca `add` ile gelen
   * POZITIF degisim sonumlenir.
   */
  dampen(key: string, current: number, delta: number): number {
    const d = this.defs.get(key);
    if (!d || d.softCap === undefined || delta <= 0) return delta;
    const { max } = this.bounds(key);
    if (max === undefined || current <= d.softCap || max <= d.softCap) return delta;
    const headroom = Math.max(0, max - current) / (max - d.softCap);
    return delta * headroom;
  }

  /** Sayisal sinirlar: tanimda yoksa kind varsayilani. */
  bounds(key: string): { min?: number; max?: number } {
    const d = this.defs.get(key);
    if (!d) return {};
    const fallback = defaultBounds(d.kind);
    const min = d.min ?? fallback.min;
    const max = d.max ?? fallback.max;
    const out: { min?: number; max?: number } = {};
    if (min !== undefined) out.min = min;
    if (max !== undefined) out.max = max;
    return out;
  }
}
