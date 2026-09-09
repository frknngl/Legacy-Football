/**
 * AGIR SAKATLIK -- tedavi karari.
 *
 * NEDEN VAR: sakatlik zaten vardi ama KARAR yoktu. Motor bir sayi
 * uretiyordu ("6 hafta yoksun"), oyuncu bekliyordu, bitiyordu. Oysa
 * gercek futbolcu kariyerlerinin donum noktalari tam burada: ameliyat
 * olup sezonu vermek mi, idare edip oynamak mi, yoksa hic soylememek mi.
 *
 * Ayrica `end_broken_body` sonlanmasi `mem_hid_injury` izini OKUYORDU ama
 * o izi YAZAN hicbir sey yoktu -- yani bir kariyer sonu erisilemezdi.
 * Bu modul o kapiyi aciyor.
 *
 * UC YOL, UC AYRI PARA BIRIMI:
 *
 *   ameliyat    ZAMAN oder    -- en uzun yokluk, ama yarayi gercekten kapatir
 *   konservatif ORTA yol      -- daha kisa, iz birakir
 *   gizle       RISK oder     -- hic durmazsin, ve bir gun bacagin durur
 *
 * KIRILGANLIK bu kararlarin kariyere yayilan izidir: her tedavi bir
 * miktar birakir, ameliyat ise mevcut kirilganligi DUSURUR. Saglikli
 * gecen haftalarda yavasca iyilesir -- tek yonlu bir mandal olsaydi her
 * kariyer ayni yerde biterdi ve bu projede ayni deseni dort kez
 * duzeltmistik (moral, sponsor, medya, ozel hayat gerginligi).
 *
 * Denge ICERIKTE (`content/health/treatments.json`).
 */

export type TreatmentId = string;

export interface Treatment {
  readonly id: TreatmentId;
  readonly label: string;
  /** Yokluk suresi carpani. Gizlemede 0 -- oynamaya devam edersin. */
  readonly weekMultiplier: number;
  /** Tedavinin biraktigi kirilganlik. */
  readonly fragility: number;
  /** Mevcut kirilganligi DUSURUR (ameliyat). */
  readonly fragilityHeal?: number;
  /** Ozel klinik parasi. */
  readonly cost?: number;
  /** Gizlemede: her hafta cokme olasiligi. */
  readonly collapseChance?: number;
  /** Oynamaya devam edilirse haftalik form/kondisyon bedeli. */
  readonly weeklyToll?: number;
  /** Birakilan `mem_*` izi. */
  readonly trace?: string;
  readonly note?: string;
}

export interface TreatmentConfig {
  /** Bu kadar hafta ve uzeri sakatlik KARAR gerektirir. */
  readonly seriousWeeks: number;
  /** Kirilganligin haftalik dogal iyilesmesi. */
  readonly fragilityDecay: number;
  readonly treatments: readonly Treatment[];
}

/** Bekleyen tedavi karari. */
export interface PendingTreatment {
  /** Karar verilmezse ne kadar surecekti. */
  readonly baseWeeks: number;
  /** Karar hangi turda soruldu -- cevapsiz kalirsa varsayilana duser. */
  readonly askedTurn: number;
}

/** Sakatlik durumu -- kirilganlik ve gizlenmis sakatlik. */
export interface InjuryState {
  /** 0-100. Gecmis sakatliklarin biraktigi iz; risk hesabina girer. */
  fragility: number;
  /** Gizlenmis bir sakatlikla mi oynuyorsun. */
  hidden?: boolean;
  /** Gizlenen sakatligin gercek suresi -- coktugunde bu kullanilir. */
  hiddenWeeks?: number;
  pending?: PendingTreatment | undefined;
}

/** Karar gerektirecek kadar agir mi. */
export function isSerious(weeks: number, config: TreatmentConfig): boolean {
  return weeks >= config.seriousWeeks;
}

/**
 * Tedavinin gercek yokluk suresi.
 *
 * Ameliyat en uzun yoklugu getirir ve bu kasitli: bedeli ZAMAN. Ama
 * karsiliginda kirilganligi dusurur, yani kariyerin geri kalanini
 * korur. "Simdi mi odeyeyim sonra mi" sorusu buradan cikar.
 */
export function recoveryWeeks(treatment: Treatment, baseWeeks: number): number {
  return Math.max(0, Math.round(baseWeeks * treatment.weekMultiplier));
}

/** Tedaviden sonraki kirilganlik. */
export function fragilityAfter(current: number, treatment: Treatment): number {
  const healed = Math.max(0, current - (treatment.fragilityHeal ?? 0));
  return Math.max(0, Math.min(100, Math.round(healed + treatment.fragility)));
}

/**
 * Kirilganligin sakatlik riskine katkisi.
 *
 * `injuryRisk`in uzerine EKLENIR, carpmaz: carpim yuksek yorgunlukla
 * birlesince riski aninda tavana yapistirirdi ve yorgunluk yonetimi
 * anlamsizlasirdi.
 */
export function fragilityRisk(fragility: number): number {
  return Math.round(fragility * 0.35);
}

/**
 * Saglikli gecen haftada kirilganlik biraz iyilesir.
 *
 * SART: yalnizca tirmanan bir kirilganlik tek yonlu mandaldir ve her
 * kariyer ayni kirilgan yerde biter. Iyilesme YAVAS olmali ki karar
 * agirligini korusun.
 */
export function healFragility(current: number, config: TreatmentConfig): number {
  if (current <= 0) return 0;
  return Math.max(0, Math.round((current - config.fragilityDecay) * 10) / 10);
}

/**
 * Gizlenmis sakatligin bu hafta cokup cokmedigi.
 *
 * Cokerse gercek sure IKI KATIYLA gelir: erteledigin fatura faiziyle
 * odenir. Oynamaya devam etmenin cazibesi de tam olarak bu -- fatura
 * BUGUN gelmiyor.
 */
export function collapses(treatment: Treatment, roll: number): boolean {
  return roll < (treatment.collapseChance ?? 0);
}

/** Cokusun getirdigi yokluk. */
export function collapseWeeks(hiddenWeeks: number): number {
  return Math.max(2, Math.round(hiddenWeeks * 2.2));
}

/** Tedavi secimi reddi -- host'a gosterilecek sebeple. */
export function treatmentRejection(
  treatment: Treatment | undefined,
  pending: PendingTreatment | undefined,
  wealth: number,
): string | undefined {
  if (pending === undefined) return 'Karar bekleyen bir sakatligin yok.';
  if (treatment === undefined) return 'Boyle bir tedavi yok.';
  if ((treatment.cost ?? 0) > wealth) return 'Ozel klinigin parasi yok.';
  return undefined;
}

/** Karar verilmezse hangi tedavi uygulanir -- kulup doktoru karar verir. */
export function defaultTreatment(config: TreatmentConfig): Treatment | undefined {
  return config.treatments.find((t) => t.weekMultiplier === 1) ?? config.treatments[0];
}
