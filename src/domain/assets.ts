/**
 * VARLIKLAR -- ev, araba, arsa, otel.
 *
 * NEDEN VAR: cuzdanda `varlik` diye bir kategori vardi ama hicbir sey
 * ona yazmiyordu. Oyuncu para biriktiriyor ve onunla YAPACAK BIR SEY
 * bulamiyordu: servet medyani 5,4 milyon, harcama yeri yok.
 *
 * TASARIM -- varlik bir sayi degil bir SECIM olmali. Uc eksende ayrisir:
 *
 *   getiri  Arsa ve otel deger kazanir; araba kaybeder. Ev arada.
 *   gider   Her varligin haftalik masrafi var; otel calisan tutar.
 *   goze    Bazi varliklar GORUNUR: medya yazar, taraftar bakis acisini
 *           degistirir. Sessiz bir arsa ile lambo ayni sey degildir.
 *
 * Boylece "ne alayim" sorusu gercek bir karar olur: hizli haz mi
 * (araba: pahali, deger kaybeder, ama sokak itibari getirir), sessiz
 * birikim mi (arsa: gorunmez, yavas kazandirir), yoksa isletme mi
 * (otel: en pahali, en cok getirir, ama vergi ve dikkat ceker).
 *
 * Katalog ICERIKTE (`content/economy/assets.json`) -- fiyat dengesi kod
 * degisikligi gerektirmemeli.
 */

export type AssetKind = 'araba' | 'ev' | 'arsa' | 'isletme';

export interface AssetDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: AssetKind;
  readonly price: number;
  /** Haftalik gider (bakim, vergi, personel). */
  readonly upkeep: number;
  /**
   * Yillik deger degisimi, ORAN. Araba negatif, arsa pozitif.
   * Haftalik uygulanir: `1 + drift/52`.
   */
  readonly yearlyDrift: number;
  /** 0-100. Ne kadar GORUNUR: medya ve taraftar bunu fark eder. */
  readonly visibility: number;
  /**
   * Kiraya verilirse YILLIK getiri orani (degerin yuzdesi).
   *
   * Arabanin kirasi olmaz; arsanin dusuk, isletmenin yuksek. Kira
   * gideri KAPATMAZ, sadece hafifletir -- yoksa her varlik kendi
   * kendini odeyen bir makineye donerdi ve alim karari kaybolurdu.
   */
  readonly rentYield?: number;
  readonly note?: string;
}

/** Sahip olunan varlik -- alis anindaki degeri ve bugunku degeri. */
export interface OwnedAsset {
  readonly id: string;
  /** Kacinci turda alindi -- "uc yildir o evde" cumlesi icin. */
  readonly boughtTurn: number;
  /** Bugunku degeri; her hafta `yearlyDrift` VE enflasyonla guncellenir. */
  value: number;
  /** Kiraya verildi mi. */
  rented?: boolean;
}

/** Haftalik toplam gider. */
export function totalUpkeep(
  owned: readonly OwnedAsset[],
  catalog: readonly AssetDefinition[],
): number {
  let sum = 0;
  for (const item of owned) {
    const def = catalog.find((d) => d.id === item.id);
    if (def) sum += def.upkeep;
  }
  return Math.round(sum);
}

/**
 * Varliklarin haftalik deger degisimi.
 *
 * Araba her hafta biraz daha az eder; arsa biraz daha cok. Fark
 * kariyerin sonunda gorunur: ayni parayla alinan iki varlik on yil sonra
 * bambaska rakamlardir -- ve bu, harcama kararini gercek kilar.
 */
export function driftValues(
  owned: readonly OwnedAsset[],
  catalog: readonly AssetDefinition[],
): void {
  for (const item of owned) {
    const def = catalog.find((d) => d.id === item.id);
    if (!def) continue;
    item.value = Math.max(0, Math.round(item.value * (1 + def.yearlyDrift / 52)));
  }
}

/**
 * GORUNURLUK -- varliklarin toplam gosteris agirligi (0-100).
 *
 * Medya itibarini ve taraftar destegini besler: gosterisli bir hayat
 * markalari cezbeder, taraftari sogutur. Sessiz bir arsa hicbirini
 * yapmaz.
 */
export function displayWeight(
  owned: readonly OwnedAsset[],
  catalog: readonly AssetDefinition[],
): number {
  let sum = 0;
  for (const item of owned) {
    const def = catalog.find((d) => d.id === item.id);
    if (def) sum += def.visibility;
  }
  return Math.min(100, sum);
}

/** Alim reddi -- host'a gosterilecek sebeple. */
export function purchaseRejection(
  def: AssetDefinition | undefined,
  wealth: number,
  owned: readonly OwnedAsset[],
): string | undefined {
  if (def === undefined) return 'Boyle bir varlik yok.';
  if (owned.some((o) => o.id === def.id)) return 'Bu zaten senin.';
  if (wealth < def.price) return 'Paran yetmiyor.';
  return undefined;
}

/**
 * Satista elde edilen tutar.
 *
 * Acele satista kaybedersin: varligi elden cikarmak zaman ister, hemen
 * satmak alicinin isine gelir. %12 kesinti bunu temsil eder.
 */
export function saleValue(asset: OwnedAsset): number {
  return Math.round(asset.value * 0.88);
}


/** Haftalik kira geliri -- yalnizca kiraya verilmis varliklardan. */
export function rentIncome(
  owned: readonly OwnedAsset[],
  catalog: readonly AssetDefinition[],
): number {
  let sum = 0;
  for (const item of owned) {
    if (item.rented !== true) continue;
    const def = catalog.find((d) => d.id === item.id);
    if (def?.rentYield === undefined) continue;
    sum += (item.value * def.rentYield) / 52;
  }
  return Math.round(sum);
}

/** Kiraya verilebilir mi -- arabanin kirasi olmaz. */
export function canRent(def: AssetDefinition | undefined): boolean {
  return def?.rentYield !== undefined && def.rentYield > 0;
}

/**
 * ENFLASYON varlik degerine islenir.
 *
 * `driftValues` REEL degisimi uygular (araba yipranir, arsa kiymetlenir);
 * bu ise NOMINAL artisi. Ikisi ayri tutulmali: Anadolu'da bir araba
 * nominal olarak deger KAZANABILIR ama reel olarak yine kaybeder -- ve
 * oyuncunun gordugu sayi nominal olandir.
 */
export function inflateValues(owned: readonly OwnedAsset[], weeklyFactor: number): void {
  if (weeklyFactor === 1) return;
  for (const item of owned) {
    item.value = Math.max(0, Math.round(item.value * weeklyFactor));
  }
}
