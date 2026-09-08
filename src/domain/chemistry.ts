/**
 * KIMYA -- saf matematik.
 *
 * KATMAN NOTU:
 *   Bu fonksiyonlari hem `simulation` (asist tercihi, sans carpani) hem
 *   `runtime` (birikim, erime) okuyor. Kural `simulation -> runtime` importunu
 *   YASAKLIYOR, dolayisiyla ortak matematik taban katmanda durmak zorunda.
 *   `runtime/ChemistryTracker.ts` bunlari sarar ve durum yonetir.
 */

/** Tam mac (90 dk) bu kadar kimya kazandirir. */
export const CHEMISTRY_PER_FULL_MATCH = 1.8;

/** Birlikte oynanmayan her hafta bu kadar erir. */
export const CHEMISTRY_WEEKLY_DECAY = 0.6;

/** Antrenmanla ve zamanla ulasilabilecek tavan. */
export const CHEMISTRY_CEILING = 95;

/**
 * Bir macin kimya katkisi.
 *
 * KALIBRASYON:
 *   38 maclik bir sezonda birlikte oynayan ikili ~68 ham kazanir; haftalik
 *   sonumlenme dusuldugunde net ~45. Yani BIR sezon "iyi anlasiyorlar"a
 *   (~70) cikarir, IKI sezon tavana yaklastirir. Sakatlik donemi gozle
 *   gorulur sekilde eritir -- istenen davranis.
 */
export function chemistryGain(minutesTogether: number): number {
  return round1((Math.max(0, Math.min(90, minutesTogether)) / 90) * CHEMISTRY_PER_FULL_MATCH);
}

/** Birlikte oynanmayan haftanin erimesi. `weeks` birden buyuk olabilir. */
export function chemistryDecay(current: number, weeks: number): number {
  if (current <= 0) return 0;
  return -round1(Math.min(current, CHEMISTRY_WEEKLY_DECAY * Math.max(0, weeks)));
}

/** Kazanc ve erimeyi uygulayip tavana kirpar. */
export function applyChemistry(current: number, delta: number): number {
  return round1(Math.max(0, Math.min(CHEMISTRY_CEILING, current + delta)));
}

/**
 * Kimyanin asist tercihine carpani.
 *
 * NEDEN DAR BANT (0.70 - 1.38):
 *   Kimya bir TERCIH sinyali olmali, bir GUC carpani degil. Genis bant
 *   verilirse "iyi anlasan zayif ikili, anlasamayan guclu ikiliyi gecer"
 *   olur; bu futbol degil. Kimya kimin pas verecegini etkiler, pasin ne
 *   kadar iyi olacagini degil.
 */
export function assistWeightFactor(chemistry: number): number {
  return 0.7 + Math.max(0, Math.min(CHEMISTRY_CEILING, chemistry)) / 140;
}

/**
 * Kimyanin sansa (xG) carpani -- +/-%10 bandi.
 *
 * Asist tercihinden AYRI ve daha kucuk: iyi anlasan ikili daha COK pozisyon
 * uretir (tercih), pozisyonun kendisi ise yalnizca biraz daha iyi olur.
 */
export function chanceFactor(chemistry: number | undefined): number {
  if (chemistry === undefined) return 1;
  return 1 + (Math.max(0, Math.min(100, chemistry)) - 50) / 500;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
