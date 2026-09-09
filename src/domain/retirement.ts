/**
 * EMEKLILIK -- "bir sezon daha" karari.
 *
 * NEDEN VAR: iskele zaten kuruluydu ama KABLOSU yoktu.
 * `TurnScheduler.retirementStage` uc asama donduruyordu --
 * `window` (33+), `choice` (38+), `forced` (41) -- ama motorda yalnizca
 * `forced` okunuyordu. Yani kariyeri hep motor bitiriyordu; oyuncunun
 * "bir sezon daha" deme hakki yoktu ve otuz sezonluk bir kariyerin en
 * insani karari hic sorulmuyordu.
 *
 * KARARI GERCEK KILAN ASIMETRI:
 *
 *   Zamaninda birakmak  -- nasil hatirlandigini KORUR
 *   Bir sezon daha      -- kazanabilirsin, ama hatirlanisini riske atarsin
 *
 * Ikisi de bedelli, ve bedeller ayni para biriminden degil. Devam etmek
 * fiziksel dususu hizlandirir (`extraDecline`) ve kotu oynanan her fazla
 * sezon itibardan yer (`legacyDamage`). Birakmak ise kapiyi kapatir:
 * yaklastigin kupa, yuzuncu milli mac, kirilmamis rekor orada kalir.
 *
 * "Bir yil fazla oynadi" cumlesi futbolun en yaygin cumlelerinden biri
 * ve bu modul onu mumkun kiliyor -- ama zorunlu kilmiyor: iyi oynayan
 * bir veteranin devam etmesi cezalandirilmaz.
 */

export type RetirementStage = 'none' | 'window' | 'choice' | 'forced';

/** Karara esas olan tablo -- host bunu gosterir. */
export interface RetirementPrompt {
  readonly stage: Exclude<RetirementStage, 'none' | 'forced'>;
  readonly age: number;
  /** Kacinci kez "bir sezon daha" dendi. */
  readonly playedOn: number;
  /** Zorunlu emekliye kac sezon kaldi. */
  readonly seasonsLeft: number;
  /** Devam etmenin bu sezonki fiziksel bedeli. */
  readonly decline: number;
  /** Formun bu yasta devam etmeye elverisli olup olmadigi. */
  readonly formWarning: boolean;
}

/**
 * "Bir sezon daha"nin EK fiziksel bedeli.
 *
 * `physicalDecline` zaten yasa bagli bir dusus uyguluyor; bu onun
 * USTUNE biner ve yalnizca SECEREK devam edenlere. Her tekrarda artar:
 * ilk fazladan sezon ucuz, dorduncusu degil.
 */
export function extraDecline(playedOn: number): number {
  if (playedOn <= 0) return 0;
  return -Math.round(playedOn * 1.5);
}

/**
 * Fazla oynamanin ITIBAR bedeli -- yalnizca KOTU oynanirsa.
 *
 * "Bir yil fazla oynadi" cumlesi kotu oynayan veteran icin kurulur;
 * iyi oynayan icin kurulmaz. Bu yuzden bedel forma bagli, yasa degil:
 * 39 yasinda 70 formla oynayan biri cezalandirilmamali.
 */
export function legacyDamage(form: number, playedOn: number): number {
  if (playedOn <= 0) return 0;
  if (form >= 55) return 0;
  return -Math.round((55 - form) * 0.12 * Math.min(3, playedOn));
}

/** Bu yasta ve bu formda devam etmek riskli mi -- host uyarir. */
export function formWarning(form: number, stage: RetirementStage): boolean {
  return stage === 'choice' && form < 55;
}

/**
 * Karar bu sezon soruluyor mu.
 *
 * `window` (33+) asamasinda sorulmaz: otuz uc yasindaki bir futbolcuya
 * her sezon "birakiyor musun" diye sormak karari degersizlestirir. O
 * asama yalnizca ICERIK icin bir kapidir (veda temali sahneler).
 * Gercek karar `choice` (38+) ile baslar.
 */
export function shouldAsk(stage: RetirementStage): boolean {
  return stage === 'choice';
}

/** Kararin sonucu -- host'a gosterilecek. */
export interface RetirementOutcome {
  readonly retired: boolean;
  readonly label: string;
}
