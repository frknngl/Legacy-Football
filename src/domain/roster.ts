/**
 * DUNYA PORTLARI -- motorun disariya actigi tek kimlik/kadro sozlesmesi.
 *
 * SINIR (SRP):
 *   Disari (mock ya da DB) = kim var, adi ne, hangi kulupte, ne kadar iyi.
 *   Motor                  = onunla aranda ne gecti.
 *
 * Motor isim URETMEZ ve saklamaz. `ActorState` yalnizca ILISKIYI tasir;
 * ad/yas/kulup her render'da `lookup(sourceId)` ile CANLI okunur. Kaynak o
 * kisiyi artik tanimiyorsa (silinmis, emekli) motor kendi snapshot'ina duser --
 * `pendingMoments: []` ile ayni zarif bozulma prensibi.
 *
 * NEDEN SENKRON:
 *   `GameEngine.present()` senkrondur; portu async yapmak butun cagri zincirini
 *   kirardi. Bunun yerine port, host'un ONCEDEN yukledigi verinin uzerine bir
 *   GORUNTUdur. Transfer gibi yeni kadro gerektiren anlarda host `prefetch` ile
 *   onbellegi isitir. Bir kadro ~25 satirdir; bu gercekci bir sozlesmedir.
 *
 * DB ENTEGRASYONUNDA: bu dosya degismez. `DbRosterProvider` bu arayuzu
 * uygular, `src/cli/*.ts` icindeki mock enjeksiyonu degisir. Icerik dosyalarinin
 * hicbiri etkilenmez.
 */

import type { ClubTier } from './axes.js';
import type { AnyPerson, RosterPerson, StaffPerson, StaffRole } from './actors.js';
import type { AgentProfile } from './agent.js';

export interface ClubInfo {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  readonly stadium: string;
  readonly tier: ClubTier;
  readonly league: string;
  /** `{club.rival}` tokenini besler. */
  readonly rivalId?: string;
  /** 0-100. Casting kalitesini ve transfer cekiciligini olcekler. */
  readonly reputation: number;
  /**
   * MASKELI ulke adi -- enflasyon ve milli takim buradan cozulur.
   *
   * Enflasyon ULKEYE baglidir ve oyundaki ulkeler arasinda 15 KAT fark
   * var (Anadolu %27,5 / Gallia %1,8, 2015-2024 gercek verisi). Bu
   * yuzden kulubun ulkesi motora ULASMALI.
   */
  readonly countryName?: string;
  /** 0-1. Kadroda yabanci isim orani -- kulup seviyesi isimlerden hissedilir. */
  readonly foreignRatio: number;
}

/**
 * Lig piramidinin bir basamagi.
 *
 * `LeagueModel` fiksturu ve sezon sonu yukselme/dusme kontenjanini buradan
 * okur. Piramit VERIdir: yeni bir basamak eklemek kod degil satir gerektirir.
 */
export interface LeagueInfo {
  readonly id: string;
  readonly label: string;
  /** 1 = en ust. Yukselen bir alt seviyeye, dusen bir ust seviyeye tasinir. */
  readonly level: number;
  /** Sezon sonu kac kulup bir ust basamaga cikar. */
  readonly promoted: number;
  /** Sezon sonu kac kulup bir alt basamaga iner. */
  readonly relegated: number;
  /**
   * Bu ligin ULKESI -- terfi/dusme piramidini ulke icinde tutar.
   *
   * OLCULEN SORUN: bu alan yoktu ve `LeagueModel.finishSeason` bir ust/alt
   * basamagi `byLevel.find(l => l.level === ...)` ile ariyordu. `find`
   * o SEVIYEDEKI ILK ligi dondurur -- ulkeden bagimsiz. Sonuc: butun 2.
   * ligler ayni tek 1. lige terfi etti, butun 1. ligler ayni tek 2. lige
   * dustu. 100 sezonluk simulasyonda 21 ligin 19'u dokuz sezonda BOSALDI
   * (Dutch D1 30 -> 96 kulup, English D2 45 -> 156, digerleri 0).
   *
   * OPSIYONEL: mock dunyada her seviyede TEK lig var (tr_1 / tr_2 /
   * tr_amateur), yani orada ulke ayrimina gerek yok ve `undefined` kalir.
   * Tanimsizken eski davranis korunur -- zarif bozulma.
   */
  readonly country?: string;
}

export interface RosterProvider {
  club(clubId: string): ClubInfo | undefined;
  clubs(): readonly ClubInfo[];
  squad(clubId: string): readonly RosterPerson[];
  staff(clubId: string): readonly StaffPerson[];
  /** Arsivdeki aktorun GUNCEL halini cozer. Bilinmiyorsa undefined -> snapshot'a dusulur. */
  lookup(sourceId: string): AnyPerson | undefined;
  /**
   * MENAJER HAVUZU -- Hero'nun secebilecegi menajerler.
   *
   * Opsiyonel: mock dunyada menajer tablosu yok ve olmamali da. Motor
   * havuzu bulamazsa menajer sistemi sessizce kapali kalir; oyun calisir,
   * yalnizca teklif akisi menajersiz katsayiyla isler.
   */
  agents?(countryId?: string): readonly AgentProfile[];
  /**
   * BOSTA TEKNIK HEYET -- kulube atanmamis kisiler.
   *
   * NICIN VAR: teknik direktor kovuldugunda yerine gelecek GERCEK bir isim
   * lazim. Havuz yokken motor prosedurel bir ad uyduruyordu ve o adin
   * niteligi olmadigi icin takim gucu kovulan hocanin degerlerinde
   * takiliyordu (olculdu: 17 kovulmanin 17'sinde).
   *
   * `clubId` verilirse once O KULUBUN ULKESINDEN hocalar doner -- Ingiliz
   * kulubune once Ingiliz hoca. Havuz tukenirse yabanci isimlere dusulur.
   *
   * OPSIYONEL: mock dunyada boyle bir tablo yok; tanimsizken motor eski
   * davranisa doner ve oyun calismaya devam eder.
   */
  freeStaff?(role: StaffRole, clubId?: string): readonly StaffPerson[];
  /** Host'un onbellegi isitmasi icin opsiyonel kanca (DB adaptorunde anlamli). */
  prefetch?(clubIds: readonly string[]): Promise<void>;
}

export interface StandingRow {
  readonly clubId: string;
  readonly position: number;
  readonly played: number;
  readonly points: number;
}

export interface WorldProvider {
  standings(league: string): readonly StandingRow[];
  clubsByTier(tier: ClubTier): readonly ClubInfo[];
  /** Bu sohret seviyesindeki bir oyuncuyu hangi kulupler ister. */
  transferTargets(fromTier: ClubTier, stature: string): readonly ClubInfo[];
}

export interface Headline {
  readonly id: string;
  readonly text: string;
  readonly tags: readonly string[];
}

export interface WorldFeed {
  headlines(season: number, week: number): readonly Headline[];
  /** `{world.*}` yer tutucularini besleyen sozluk. */
  tokens(season: number, week: number): Readonly<Record<string, string>>;
}

/**
 * Her `WorldFeed` uygulamasinin saglamak ZORUNDA oldugu tokenler.
 * Icerik bunlari yazabilir; validator bu listeye gore denetler.
 */
export const WORLD_TOKENS = [
  'title_race_leader',
  'title_race_second',
  'relegation_bottom',
  'transfer_record_club',
  'transfer_record',
] as const;
