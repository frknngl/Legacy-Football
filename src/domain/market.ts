/**
 * BORSA VE KRIPTO -- tutulan pozisyon.
 *
 * KUMARDAN FARKI YAPISAL: kumar tek atistir, sonuc aninda belli olur ve
 * biter. Piyasa bir POZISYONDUR -- her hafta deger degistirir ve asil
 * karar "ne zaman cikacagin"dir. Ayni parayla ayni enstrumana giren iki
 * oyuncunun sonucu, ne zaman sattiklarina gore bambaska olur.
 *
 * Bu yuzden `resolveBet` gibi tek bir cozum fonksiyonu yok; bunun yerine
 * her hafta yurayen bir FIYAT var.
 *
 * ENFLASYONLA BAG: hisse fiyatlari nominal olarak enflasyonla birlikte
 * yukselir. Anadolu'da (%27,5) nakit tutmak yikici, hisseye gecmek bir
 * KORUNMA aracidir. Gallia'da (%1,8) fark neredeyse yok. Boylece ulke
 * secimi burada da anlam kazaniyor.
 *
 * Enstrumanlar KURGUSAL. Bu bir oyun; gercek sirket ya da coin adi
 * kullanilmaz.
 */

export type InstrumentKind = 'hisse' | 'endeks' | 'kripto';

export interface Instrument {
  readonly id: string;
  readonly label: string;
  readonly kind: InstrumentKind;
  /** Baslangic fiyati. */
  readonly basePrice: number;
  /**
   * Yillik REEL beklenen getiri (enflasyon HARIC), oran.
   * Endeks dusuk ve pozitif; kripto yuksek ama cok oynak.
   */
  readonly drift: number;
  /** Haftalik oynaklik, oran. Kriptoda endeksin bes kati. */
  readonly volatility: number;
  /**
   * Yillik temettu orani -- yalnizca hisse/endekste.
   * Kripto temettu odemez; "tutup beklemek" onun icin bedava degil.
   */
  readonly dividend?: number;
  /** Bu enstrumana girmek icin gereken en az servet. */
  readonly minWealth: number;
  readonly note?: string;
}

/** Portfoydeki bir pozisyon. */
export interface Holding {
  readonly id: string;
  /** Kac birim. Kesirli olabilir -- kripto boyle alinir. */
  units: number;
  /** Ortalama alis maliyeti (birim basina) -- kar/zarar bundan cikar. */
  avgCost: number;
}

/**
 * Piyasa durumu -- fiyatlar VE pozisyonlar.
 *
 * Fiyat turetilemez: pozisyonun anlami "girdiginden beri ne oldu"dur ve
 * bunu ancak kaydedilen, yuruyen bir fiyat tasiyabilir. Ayrica fiyat
 * herkes icin ayni olmali -- hic pozisyon almasan da piyasa yuruyor ve
 * girdiginde onu bulmus oluyorsun.
 */
export interface MarketState {
  /** Enstruman id -> bugunku fiyat. */
  prices: Record<string, number>;
  /** Acik pozisyonlar. */
  holdings: Holding[];
  /** Son cokusun turu -- host "gecen hafta piyasa cakildi" diyebilsin. */
  lastCrashTurn?: number;
}

/** Bir cokusun siddeti ve hangi turleri vurdugu. */
export interface Crash {
  readonly severity: number;
  readonly hits: readonly InstrumentKind[];
}

/**
 * Bir haftalik fiyat adimi.
 *
 * Uc bilesen:
 *   1. REEL surukleme  -- uzun vadeli beklenen getiri
 *   2. ENFLASYON       -- nominal fiyatlar parayla birlikte sisiyor
 *   3. GURULTU         -- haftalik oynaklik
 *
 * Enflasyon bileseni sart: aksi halde Anadolu'da hisse, nakitle birlikte
 * erirdi ve "enflasyondan hisseye kacmak" mumkun olmazdi.
 */
export function stepPrice(
  instrument: Instrument,
  price: number,
  inflationPercent: number,
  roll: number,
  crash?: Crash,
): number {
  const real = instrument.drift / 52;
  const inflation = Math.pow(1 + inflationPercent / 100, 1 / 52) - 1;
  // Iki cekimin toplami kaba bir normal verir; tek cekim dagilimin ucunu
  // duzlestirir ve "her hafta ya tavan ya taban" gibi bir ritim uretir.
  const noise = (roll + fract(roll * 11.31) - 1) * instrument.volatility;

  let next = price * (1 + real + inflation + noise);

  if (crash && crash.hits.includes(instrument.kind)) {
    next *= 1 - crash.severity;
  }

  // Fiyat sifira dusmez: kagit uzerinde deger biter ama pozisyon
  // "sifir birim" olarak degil "cok dusuk fiyat" olarak yasar.
  return Math.max(0.01, Math.round(next * 100) / 100);
}

/**
 * Bu hafta cokus var mi.
 *
 * Nadir ama gercek: kripto daha sik ve daha sert coker. Cokus olmadan
 * piyasa tek yonlu bir para makinesidir ve "ne zaman cikacagin" sorusu
 * anlamini yitirir.
 */
export function rollCrash(roll: number): Crash | undefined {
  // ~%0,4 haftalik: on bes sezonda ortalama iki-uc kez.
  if (roll < 0.004) {
    return { severity: 0.35, hits: ['hisse', 'endeks', 'kripto'] };
  }
  // ~%1,2 yalnizca kripto -- daha sik, daha sert.
  if (roll < 0.016) {
    return { severity: 0.45, hits: ['kripto'] };
  }
  return undefined;
}

/** Haftalik temettu -- yalnizca temettu odeyen enstrumanlarda. */
export function dividendFor(
  holdings: readonly Holding[],
  catalog: readonly Instrument[],
  priceOf: (id: string) => number,
): number {
  let sum = 0;
  for (const h of holdings) {
    const def = catalog.find((i) => i.id === h.id);
    if (def?.dividend === undefined) continue;
    sum += (h.units * priceOf(h.id) * def.dividend) / 52;
  }
  return Math.round(sum);
}

/** Portfoyun bugunku toplam degeri. */
export function portfolioValue(
  holdings: readonly Holding[],
  priceOf: (id: string) => number,
): number {
  let sum = 0;
  for (const h of holdings) sum += h.units * priceOf(h.id);
  return Math.round(sum);
}

/**
 * Host'a sunulan satir -- fiyat, pozisyon ve FARK.
 *
 * Ekranda gorulmesi gereken sey fiyat degil farktir: nereden girdin,
 * simdi neredesin. Karar "alayim mi" degil "cikayim mi"dir ve bu soru
 * ancak farkla sorulabilir.
 */
export interface MarketQuote {
  readonly instrument: Instrument;
  readonly price: number;
  /** Kariyer basina gore yuzde degisim -- girmesen de kacirdigini gorursun. */
  readonly sinceStart: number;
  /** Pozisyonun varsa: kac birim, ne kadar eder, kar/zarar. */
  readonly units?: number;
  readonly value?: number;
  readonly profit?: number;
}

/** Bir pozisyonun kar/zarari -- ortalama maliyete gore. */
export function unrealised(holding: Holding, price: number): number {
  return Math.round(holding.units * (price - holding.avgCost));
}

/** Alim reddi -- host'a gosterilecek sebeple. */
export function tradeRejection(
  instrument: Instrument | undefined,
  amount: number,
  wealth: number,
): string | undefined {
  if (instrument === undefined) return 'Boyle bir enstruman yok.';
  if (wealth < instrument.minWealth) {
    return `Bu piyasaya girmek icin en az ${instrument.minWealth} TL gerek.`;
  }
  if (!Number.isFinite(amount) || amount <= 0) return 'Gecerli bir tutar gir.';
  if (amount > wealth) return 'Bu kadar paran yok.';
  return undefined;
}

function fract(n: number): number {
  return n - Math.floor(n);
}
