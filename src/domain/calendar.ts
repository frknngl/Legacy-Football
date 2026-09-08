/**
 * TAKVIM SOZLESMESI -- iki asamali.
 *
 * KOK SORUN (eski surumde olculdu):
 *   Her turnuva kendi haftasini KENDI seciyordu. Hakem yoktu. Sonuc, 34
 *   kuluplu mock dunyada:
 *     - tr_1 (12 kulup) 22 turu 1-22. haftalara sikistiriyor, 23-40 bos
 *     - tr_amateur (10 kulup) 18 turu 1-35. haftalara yayiyor
 *     - 65 fikstur cakisiyor ve `forClub` bunlari SESSIZCE dusuruyor
 *     - kupa maclarinin ustune lig maci biniyor; ust lig kulubu kupa oynamiyor
 *
 * COZUM -- SORUMLULUK AYRIMI:
 *
 *     Takvim  ZAMANI rezerve eder.
 *     Turnuva KIMIN oynadigina karar verir.
 *
 *   Turnuva hafta BILMEZ; "N turum var, su pencerede, su tercihle" der
 *   (`RoundRequest`). Tek bir yerlestirici turlari slotlara dagitir ve global
 *   kisitlari uygular. Kupa/Avrupa'da eslesmeler sonradan dolar -- takvim
 *   zamani zaten ayirmistir.
 *
 * NEDEN SLOT:
 *   40 hafta sabit (icerigin butun cooldown ve `turnsSince` esikleri buna
 *   kalibre; degistirmek 142 olayin ritmini sessizce bozar). Ama 20 kuluplu
 *   bir lig + kupa + Avrupa 54 mac eder. Cozum haftayi cogaltmak degil, bir
 *   haftaya birden fazla mac SLOTU koymak -- gercek futbolda da hafta ici +
 *   hafta sonu boyle isler.
 */

import type { MatchImportance } from './match.js';

/** Bir hafta icindeki mac gunleri. Sira ONEMLI: yerlestirici bu sirayla dener. */
export const SLOT_KINDS = ['weekend', 'midweek', 'midweek2'] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

export interface MatchSlot {
  readonly week: number;
  readonly kind: SlotKind;
}

/** Bir eslesme. Kupa/Avrupa'da tur cozulene kadar BILINMEZ. */
export interface Tie {
  readonly home: string;
  readonly away: string;
}

/**
 * Turnuvanin takvimden ISTEDIGI sey.
 *
 * `ties` bos olabilir: kupanin 3. turunda kimin oynayacagi sezon basinda
 * belli degildir ama HAFTASI belli olmak zorundadir, yoksa lig fiksturu o
 * haftayi doldurur ve kupa bir daha sigmaz.
 */
export interface RoundRequest {
  readonly competitionId: string;
  readonly roundIndex: number;
  /**
   * Bu turnuvanin TOPLAM tur sayisi.
   *
   * Oransal yayilim icin sart: yerlestirici turun pencerenin neresine
   * dusecegini `roundIndex / (totalRounds - 1)` oranindan hesaplar. Bu sayi
   * olmadan 18 turluk lig ile 46 turluk lig ayni araliga yayilamaz.
   */
  readonly totalRounds: number;
  readonly roundLabel: string;
  readonly importance: MatchImportance;
  readonly window: { readonly start: number; readonly end: number };
  readonly prefer: SlotKind;
  /**
   * Bu turda sahaya cikacak kulupler. Bilinmiyorsa bos -- o zaman yerlestirici
   * yalnizca hafta uygunluguna bakar, kulup kapasitesine bakamaz.
   */
  readonly participants: readonly string[];
  readonly ties?: readonly Tie[];
  /** Ayni turnuvanin iki turu arasinda en az kac hafta olmali. */
  readonly minGapWeeks?: number;
}

export interface Fixture {
  readonly week: number;
  readonly slot: SlotKind;
  readonly homeId: string;
  readonly awayId: string;
  readonly importance: MatchImportance;
  readonly competitionId: string;
  /**
   * Puan durumunu ETKILEYEN turnuva. Yalnizca lig fiksturlerinde dolu;
   * `LeagueModel.record` bu alana bakar. Kupa/Avrupa tabloyu degistirmez.
   */
  readonly league?: string;
  readonly round?: string;
  readonly roundIndex?: number;
}

/**
 * Zamani ayrilmis ama eslesmesi henuz belli olmayan tur.
 * `CupCompetition.advance()` sonuclari aldikca bunlari doldurur.
 */
export interface ReservedRound {
  readonly competitionId: string;
  readonly roundIndex: number;
  readonly totalRounds: number;
  readonly roundLabel: string;
  readonly importance: MatchImportance;
  readonly slot: MatchSlot;
}

export interface CalendarConstraints {
  readonly weeks: number;
  /** Bir kulup bir haftada en fazla kac mac oynayabilir. */
  readonly maxFixturesPerClubPerWeek: number;
  /**
   * Milli mac haftalari -- kulup fiksturune KAPALI.
   * Bu, `national_duty` hayat durumunu ve `milli_mac_sayisi` sayacini gercek
   * bir seye baglayan sey; ikisi de bugun bosta duruyor.
   */
  readonly internationalWindows: readonly number[];
}

export const DEFAULT_CONSTRAINTS: CalendarConstraints = {
  weeks: 40,
  maxFixturesPerClubPerWeek: 2,
  // Gercek FIFA takviminin ritmi: sezon basi, sonbahar, kis oncesi, ilkbahar,
  // sezon sonu.
  internationalWindows: [5, 11, 17, 26, 33],
};

export interface SeasonSchedule {
  readonly weeks: number;
  readonly fixtures: readonly Fixture[];
  readonly reservedRounds: readonly ReservedRound[];
  readonly internationalWindows: readonly number[];
  byWeek(week: number): readonly Fixture[];
  /**
   * Bir kulubun o haftaki TUM maclari, slot sirasinda.
   *
   * Eski `forClub` tek fikstur donuyordu ve fazlasini sessizce yutuyordu --
   * olculen 65 kayip fiksturun sebebi buydu.
   */
  fixturesFor(clubId: string, week: number): readonly Fixture[];
  /** Geriye donuk uyum: o haftanin BIRINCIL maci. */
  forClub(clubId: string, week: number): Fixture | undefined;
  isInternationalWeek(week: number): boolean;
}

export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarError';
  }
}
