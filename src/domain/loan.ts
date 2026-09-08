/**
 * KREDI -- borcun mekanigi.
 *
 * NEDEN VAR: `borc` bayragi kuruluydu ama yalnizca "paran yetmedi"
 * durumunda dolduruluyordu; oyuncunun BILEREK borclanmasi mumkun
 * degildi. Oysa icerik borcu bol bol anlatiyor: on borc temali `mem_*`
 * bayragina 58 sahne yaziyor ve HICBIRI okunmuyordu.
 *
 * Kredi bu anlatinin mekanik karsiligi. Ve bedava bir yan etkisi var:
 * `evt_dark_betting_offer` zaten `borc >= 40000` ile tetikleniyor, yani
 * borclanmak sike teklifi zincirini kendiliginden aciyor. Yeni icerik
 * yazmadan olu bir kapi aciliyor.
 *
 * Saf matematik burada, durum yonetimi `GameEngine`de.
 */

/**
 * Kimden borc aliyorsun.
 *
 * Ayrim sadece faiz degil, BEDELIN TURU:
 *   banka  -- ucuz, ama gelir belgesi ister; odenmezse itibar ve basin
 *   tefeci -- pahali, hicbir sey sormaz; odenmezse insanlar gelir
 */
export type Lender = 'banka' | 'tefeci';

export interface LoanOffer {
  readonly lender: Lender;
  /** Eline gecen para. */
  readonly principal: number;
  /** Haftalik taksit. */
  readonly weekly: number;
  readonly weeks: number;
  /** Toplam geri odeme (anapara + faiz). */
  readonly total: number;
}

export interface LoanState {
  readonly lender: Lender;
  readonly weekly: number;
  weeksLeft: number;
  /** Ust uste kacirilan taksit -- temerrudun esigi. */
  missed: number;
}

/** Kacirilan taksitten sonra temerrut sayilan esik. */
export const DEFAULT_THRESHOLD = 3;

const TERMS: Readonly<Record<Lender, { maxMultiple: number; weeks: number; rate: number }>> = {
  // Haftalik maasin 40 kati, ~%15 toplam maliyet, bir yil vade.
  banka: { maxMultiple: 40, weeks: 52, rate: 0.15 },
  // Yarisi kadar para, iki kati maliyet, yarim vade. Aceleci icin.
  tefeci: { maxMultiple: 20, weeks: 26, rate: 0.45 },
};

/**
 * Bu gelirle ne kadar borc alinabilir.
 *
 * Mevcut borc kapasiteyi DUSURUR: ust uste kredi cekip sonsuz para
 * basmak mumkun olmamali. Kapasite bitince teklif uretilmez -- ve bu,
 * "artik banka sana vermiyor, geriye tefeci kaliyor" anini dogal olarak
 * kurar.
 */
export function loanOffers(weeklyIncome: number, existingDebt: number): readonly LoanOffer[] {
  if (weeklyIncome <= 0) return [];
  const out: LoanOffer[] = [];

  for (const lender of ['banka', 'tefeci'] as const) {
    const terms = TERMS[lender];
    const ceiling = weeklyIncome * terms.maxMultiple;
    const principal = Math.round(ceiling - existingDebt);
    // Cok kucuk krediler anlamsiz: hem masayi bogar hem karar degildir.
    if (principal < weeklyIncome * 2) continue;

    const total = Math.round(principal * (1 + terms.rate));
    out.push({
      lender,
      principal,
      weeks: terms.weeks,
      weekly: Math.ceil(total / terms.weeks),
      total,
    });
  }
  return out;
}

/**
 * Kacirilan taksitin cezasi.
 *
 * Tefeci daha sert: bir hafta gecikme haftalik taksitin yarisi kadar
 * eklenir, banka icin dortte biri. Ceza BORCA eklenir, yani kacirmak
 * borcu buyutur ve sarmali hizlandirir -- olmasi gereken de budur.
 */
export function latePenalty(loan: LoanState): number {
  return Math.round(loan.weekly * (loan.lender === 'tefeci' ? 0.5 : 0.25));
}
