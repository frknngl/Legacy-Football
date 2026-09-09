/**
 * SOSYAL FINANSMAN -- arkadastan borc.
 *
 * NEDEN AYRI BIR KOL: banka ve tefeci zaten var, ama ikisi de PARAYLA
 * odetiyor -- biri faizle, oteki daha yuksek faizle. Ucuncu bir kol
 * ancak PARA BIRIMI farkliysa gercek bir secim uretir:
 *
 *   banka   ucuz  -- gelir belgesi ister; odenmezse itibar ve basin
 *   tefeci  pahali -- hicbir sey sormaz; odenmezse insanlar gelir
 *   arkadas FAIZSIZ -- hicbir sey istemez; odenmezse ARKADASINI kaybedersin
 *
 * Uc kolun bedeli uc ayri kaynaktan cikiyor: para, guvenlik, iliski.
 * Boylece "kimden alayim" sorusu bir hesap degil bir KARAKTER sorusu
 * olur -- ve kariyerin sonunda geriye kimin kaldigini bu belirler.
 *
 * FAIZ YOK, VADE DE YOK. Arkadas taksit istemez; ne zaman verirsen o
 * zaman. Ama beklemek bedava degil: her hafta biraz daha utanirsin
 * (`trust` sessizce erir) ve bir noktada o kisi artik senin arkadasin
 * degildir. Borcun tek yaptirimi budur ve yeterlidir.
 *
 * Saf matematik burada, durum yonetimi `GameEngine`de.
 */

/** Bir arkadastan alinan borc. */
export interface Favor {
  /** Kimden -- aktor id'si. Slot degil: o kisi transfer olsa da borc kalir. */
  readonly actorId: string;
  /** Hangi slottan tanidin -- host "kaptan" diyebilsin. */
  readonly slotId: string;
  readonly amount: number;
  readonly takenTurn: number;
  /** Ne kadari odendi. */
  paid: number;
}

/** Borc teklifi -- kim, ne kadar verebilir. */
export interface FavorOffer {
  readonly actorId: string;
  readonly slotId: string;
  readonly name: string;
  /** Verebilecegi en yuksek tutar. */
  readonly ceiling: number;
  /** Neden bu kadar -- host'a gosterilir. */
  readonly reason: string;
}

/** Bu esigin altinda kimse sana borc vermez. */
export const TRUST_FLOOR = 55;

/** Bu kadar hafta odenmezse arkadaslik biter. */
export const PATIENCE_WEEKS = 60;

/**
 * Kim ne kadar verebilir.
 *
 * Iki carpan: GUVEN ve KAZANC. Sana guvenen ama kendisi de yeni
 * baslayan bir genc, cok az verebilir; seni orta derecede seven bir
 * yildiz, cok. Ikisi de gerekli -- yalnizca guvene bakmak kadroyu
 * bankaya cevirirdi.
 *
 * Tavan haftalik maasindan turetiliyor: bir arkadas sana "birkac
 * haftalik" verir, kredi acmaz.
 */
export function favorCeiling(
  trust: number,
  lenderWeeklyWage: number,
  yourWeeklyWage: number,
): number {
  if (trust < TRUST_FLOOR) return 0;
  // Esikten 100'e kadar 0 -> 1 arasi.
  const willingness = (trust - TRUST_FLOOR) / (100 - TRUST_FLOOR);
  // Kendi kazancinin en fazla sekiz haftaligi kadar verir.
  const capacity = lenderWeeklyWage * 8;
  const ceiling = capacity * willingness;
  // Senin maasindan cok kucuk bir tutar karar degil, gurultudur.
  return ceiling < yourWeeklyWage ? 0 : Math.round(ceiling);
}

/** Borcun ne kadari duruyor. */
export function outstanding(favor: Favor): number {
  return Math.max(0, favor.amount - favor.paid);
}

/**
 * Odenmemis borcun GUVEN asindirmasi -- haftalik.
 *
 * Ilk haftalar neredeyse bedelsiz: kimse ertesi hafta parasini istemez.
 * Bekledikce hizlanir. `PATIENCE_WEEKS` doldugunda toplam asinma
 * guveni esigin altina indirmeye yeter -- yani o kisi bir daha sana
 * borc vermez, ve bu YETERLI bir yaptirimdir.
 */
export function trustErosion(favor: Favor, currentTurn: number): number {
  if (outstanding(favor) <= 0) return 0;
  const waited = currentTurn - favor.takenTurn;
  if (waited < 8) return 0;
  // 8. haftadan sonra dogrusal hizlanma.
  return Math.min(1.2, (waited - 8) * 0.02);
}

/** Arkadaslik bitti mi -- borc unutulmadi, kisi vazgecti. */
export function friendshipBroken(favor: Favor, currentTurn: number): boolean {
  return outstanding(favor) > 0 && currentTurn - favor.takenTurn >= PATIENCE_WEEKS;
}

/** Borc alma reddi -- host'a gosterilecek sebeple. */
export function favorRejection(
  offer: FavorOffer | undefined,
  amount: number,
  alreadyOwes: boolean,
): string | undefined {
  if (offer === undefined) return 'Bu kisiden borc isteyemezsin.';
  if (alreadyOwes) return 'Ona zaten borcun var. Once onu kapat.';
  if (!Number.isFinite(amount) || amount <= 0) return 'Gecerli bir tutar gir.';
  if (amount > offer.ceiling) {
    return `${offer.name} en fazla ${offer.ceiling.toLocaleString('tr-TR')} TL verebilir.`;
  }
  return undefined;
}

/**
 * Geri odeme reddi.
 *
 * Bakiye, girilen tutarla degil ODENEBILIR tutarla karsilastirilir.
 * "Hepsini kapatayim" diye buyuk bir sayi yazmak normal bir jesttir ve
 * 30 bin borcu olan birinin 999.999 yazmasi "paran yok" ile
 * karsilanmamali -- borc zaten 30 bin.
 */
export function repayRejection(
  favor: Favor | undefined,
  amount: number,
  wealth: number,
): string | undefined {
  if (favor === undefined) return 'Ona borcun yok.';
  if (!Number.isFinite(amount) || amount <= 0) return 'Gecerli bir tutar gir.';
  if (Math.min(amount, outstanding(favor)) > wealth) return 'Bu kadar paran yok.';
  return undefined;
}
