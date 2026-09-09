/**
 * ENFLASYON -- oynadigin ulkenin parasi.
 *
 * VERI GERCEK: 2015-2024 yillik TUFE ortalamalari. Oyundaki sekiz ulke
 * arasinda **on bes kat** fark var:
 *
 *   Anadolu (Turkiye)   %27,5   (7,7 - 72,3 bandi)
 *   Albion (Ingiltere)   %3,2
 *   Rheinland (Almanya)  %2,5
 *   Gallia (Fransa)      %1,8   en istikrarlisi
 *
 * NEDEN OYUNA GIRIYOR: enflasyon yalnizca buyuk sayilar uretirse
 * gorunmez olur -- her sey ayni oranda artarsa hicbir sey degismez.
 * Karar uretmesi icin ASIMETRIK olmali:
 *
 *   nakit ERIR      15 sezonda 1M TL -> Anadolu'da 26 bin, Gallia'da 765 bin
 *   varlik KORUR    ev/arsa nominal olarak enflasyonla birlikte yukselir
 *   MAAS GERIDE     sozlesme NOMINAL ve sabit; bes yillik sozlesme
 *                   Anadolu'da felaket, Gallia'da onemsiz
 *   BORC ERIR       yuksek enflasyonda borclanmak KAZANDIRIR
 *
 * Boylece "Anadolu'da kredi cekip arsa al, nakit tutma" gercek bir
 * strateji; Gallia'da ayni hamle anlamsiz. Ulke secimi para kazanmanin
 * bicimini degistiriyor.
 */

export interface CountryInflation {
  readonly name: string;
  /** Yillik ortalama, yuzde. */
  readonly mean: number;
  /** Yillik standart sapma -- Anadolu'da 23, Gallia'da 1,7. */
  readonly volatility: number;
  readonly note?: string;
}

export interface InflationConfig {
  readonly countries: readonly CountryInflation[];
  readonly fallback: CountryInflation;
}

/**
 * Bir sezonun enflasyon orani.
 *
 * ORTALAMAYA DONUS: gecen yilki oran bu yili etkiler (%45 agirlik).
 * Saf rastgele cekim gercekci degil -- enflasyon yapiskan bir buyukluktur,
 * bir yil %70'ken ertesi yil %3 olmaz. Ama ortalamaya da doner; kalici
 * olarak zirvede kalmaz.
 *
 * @param roll [0,1) tohumlu rastgele sayi
 * @param previous gecen sezonun orani (ilk sezonda ortalama verilir)
 */
export function seasonRate(
  country: CountryInflation,
  previous: number,
  roll: number,
): number {
  // Kaba normal yaklasimi: iki tekduze cekimin toplami. Tek cekim
  // dagilimin ucunu duz yapar ve "her yil ya cok dusuk ya cok yuksek"
  // gibi gercek disi bir ritim uretir.
  const noise = (roll + fract(roll * 7.13) - 1) * country.volatility * 1.4;
  const raw = country.mean + noise;
  const sticky = previous * 0.45 + raw * 0.55;
  // Deflasyon mumkun ama dar: Iberia ve Peninsula gercekten negatif
  // yillar gordu. Alt sinir ortalamanin cok altina inmesin.
  return Math.max(-2, Math.round(sticky * 10) / 10);
}

/** Bir sezonun sonunda fiyat endeksinin yeni degeri. */
export function nextIndex(index: number, seasonRatePercent: number): number {
  return Math.max(1, Math.round(index * (1 + seasonRatePercent / 100) * 100) / 100);
}

/**
 * Enflasyonun HAFTALIK carpani -- varlik degerleri bunu kullanir.
 *
 * Yillik oran 52'ye bolunmez, bilesik koke gore alinir: %72'lik bir
 * yilda haftalik %1,38 degil %1,05'tir ve fark on yilda katlanir.
 */
export function weeklyFactor(seasonRatePercent: number): number {
  return Math.pow(1 + seasonRatePercent / 100, 1 / 52);
}

/** Ulke adindan yapilandirmayi bulur; bilinmiyorsa varsayilan. */
export function forCountry(
  config: InflationConfig,
  countryName: string | undefined,
): CountryInflation {
  if (countryName === undefined) return config.fallback;
  return config.countries.find((c) => c.name === countryName) ?? config.fallback;
}

/**
 * Nominal bir tutarin BUGUNKU alim gucu.
 *
 * `:cuzdan` masasi bunu gosterir: "10 milyon TL (kariyer basi parasiyla
 * 380 bin)". Enflasyonun gorunur oldugu tek yer burasi -- gorunmezse
 * oyuncu neden fakirlestigini anlamaz.
 */
export function realValue(nominal: number, index: number): number {
  return Math.round((nominal / Math.max(1, index)) * 100);
}

function fract(n: number): number {
  return n - Math.floor(n);
}
