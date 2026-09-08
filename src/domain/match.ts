/**
 * MAC SOZLESMESI -- CIFT YONLU.
 *
 * Sinir (SRP):
 *   Host  = fizik, simulasyon, skor, lig tablosu, fikstur.
 *   Motor = oyuncunun KARARI ve anlati.
 *
 * Motor yoktan gol icat ETMEZ. Yalnizca host'un sundugu bir "an"in sonucunu
 * belirler ve host'a bir delta dondurur. Host bu deltayi skora uygular.
 *
 * Akis:
 *   1. Host maci simule eder, oyuncunun dahil oldugu kritik anlari KARARA BAGLAMAZ
 *   2. Host  -> Motor : playMatch({ context, pendingMoments })
 *   3. Motor -> Host  : DecisionQueue (UI oyuncuya sorar) -> roll node ile sonuc
 *   4. Motor -> Host  : MatchOutcomeDelta
 *   5. Host skora uygular -> final sonuc -> finalizeMatch(result)
 *   6. Motor incident flag'lerini yazar -> roportaj / soyunma odasi olaylari tetiklenir
 *
 * Host'un mac simulasyonu yoksa pendingMoments bos gonderilir; motor moment
 * fazini atlar ve yalnizca final sonucu okur (ZARIF BOZULMA).
 */

import type { Position } from './actors.js';

export type MatchResult = 'win' | 'draw' | 'loss' | 'none';

export type MatchImportance = 'league' | 'derby' | 'cup' | 'cup_final' | 'european' | 'national';

/** Host'un mac oncesi/sonrasi sundugu baglam. Motor bunlari yalnizca OKUR. */
export interface MatchContext {
  readonly opponentName: string;
  readonly importance: MatchImportance;
  readonly isStarter: boolean;
  readonly teamLeaguePosition?: number;
  readonly unbeatenStreak?: number;
  readonly scorelessStreak?: number;
  readonly seasonGoals?: number;
  readonly seasonAssists?: number;
  readonly seasonApps?: number;
}

/**
 * Motorun host'a gecirdigi Hero OZETI.
 *
 * Host, motorun flag sozlugunu GORMEZ. `skandal_seviyesi` ya da `mem_*` izleri
 * simulatoru ilgilendirmez; simulatorun bilmesi gereken tek sey sahadaki
 * oyuncunun ne kadar iyi oldugu ve hangi mevkide oynadigidir.
 *
 * Bu daralma bilincli: host bu ozetin disina cikamadigi surece "simulator
 * hikayeyi okuyor" sizintisi olusamaz.
 */
export interface HeroProfile {
  readonly position: Position;
  /** teknik + pas ekseni (0-100). */
  readonly technical: number;
  /** fizik + kondisyon ekseni (0-100). */
  readonly physical: number;
  /** Son bes macin reyting ortalamasindan turer (0-100). */
  readonly form: number;
  /** Bu maca ne kadar taze basliyor (0-100). */
  readonly stamina: number;
  readonly stature: string;
  readonly morale: number;
  /** Kaptan mi -- ilk 11 secimini ve pazuband momentini etkiler. */
  readonly isCaptain: boolean;
}

/**
 * Host'un sundugu karar ani. Motor karsiliginda bir hikaye olayi bulur.
 * Karsiligi olmayan moment sessizce DUSURULUR (host bosa moment sunmus olur).
 */
export const MOMENT_TYPES = [
  // Pozisyon
  'penalty_for',
  'penalty_against',
  'one_on_one',
  'free_kick',
  'last_minute_chance',
  'handball_on_line',
  // VAR / hakem
  'var_review_against',
  'var_review_for',
  'var_controversial',
  'offside_marginal',
  'ghost_goal',
  'ref_dispute',
  // Disiplin
  'red_card_provocation',
  'dive_opportunity',
  'celebration_choice',
  'teammate_feud',
  // Fiziksel
  'injury_in_match',
  'substituted_off',
  // Sosyal
  'racist_abuse',
  'object_thrown',
  'captain_armband',
] as const;
export type MomentType = (typeof MOMENT_TYPES)[number];

export interface PendingMoment {
  readonly type: MomentType;
  readonly minute: number;
  /** Ornek: "1-1". Metin enterpolasyonunda kullanilir. */
  readonly scoreline: string;
  readonly opponent: string;
  readonly importance: MatchImportance;
}

/** Motorun bir momenti cozdukten sonra urettigi kayit. */
export interface MomentResolution {
  readonly moment: PendingMoment;
  readonly eventId: string;
  readonly choiceId: string;
  readonly outcomeNodeId: string;
}

/** Motorun host'a dondurdugu, skoru gercekten degistiren delta. */
export interface MatchOutcomeDelta {
  readonly goalsDelta: number;
  readonly assistsDelta: number;
  readonly yellowCards: number;
  readonly redCard: boolean;
  readonly injuryWeeks: number;
  /** Host'un mac reytingine ekleyecegi duzeltme. */
  readonly ratingModifier: number;
  readonly incidents: readonly MatchIncident[];
}

export function emptyDelta(): MatchOutcomeDelta {
  return {
    goalsDelta: 0,
    assistsDelta: 0,
    yellowCards: 0,
    redCard: false,
    injuryWeeks: 0,
    ratingModifier: 0,
    incidents: [],
  };
}

/**
 * Mac icinde olan, sonrasinda roportaj/soyunma odasi olaylarini acan olay.
 * `flag` bir inc_* flag'idir ve SONRAKI MACIN BASINDA otomatik silinir.
 */
export interface MatchIncident {
  readonly flag: string;
  readonly minute: number;
  readonly scoreline: string;
  readonly opponent: string;
  /**
   * Bu incident'i hangi karar dogurdu.
   *
   * KELEBEK GUNLUGU icin sart: `inc_*` flag'leri EffectApplier'dan degil
   * IncidentLedger'dan yazilir, dolayisiyla attribution'i kendileri tasimak
   * zorundadir. Bu olmadan "roportaj neden cikti" sorusu maça kadar
   * izlenemez.
   */
  readonly causedByEventId?: string;
  readonly causedByChoiceId?: string;
  readonly causedByChoiceText?: string;
}

/** Host'un macin gercek sonucunu motora bildirmesi. */
export interface MatchResultReport {
  readonly result: MatchResult;
  readonly rating: number;
  readonly goals: number;
  readonly assists: number;
  readonly minutes: number;
  readonly cards: number;
}

/**
 * Ceza sistemi cikti sozlesmesi.
 * Motor disiplin cezasi verdiginde host'a bildirir; host oyuncuyu kadroya yazmaz.
 */
export interface PlayerAvailability {
  readonly available: boolean;
  readonly reason?: string;
  readonly matchesRemaining: number;
}

/**
 * TEK BIR MOMENTIN skora katkisi.
 *
 * `MatchOutcomeDelta` bunlarin TOPLAMIdir. Ayrim duraklamali akis icin sart:
 * simulator her momentten sonra skoru guncelleyip devam etmek zorundadir,
 * mac bitene kadar bekleyemez -- yoksa 30. dakikadaki gol 90. dakikada
 * sayilir ve sonraki momentlerin skor baglami yanlis olur.
 */
export interface MomentDelta {
  readonly goals: number;
  readonly assists: number;
  readonly yellowCards: number;
  readonly redCard: boolean;
  readonly injuryWeeks: number;
  readonly ratingModifier: number;
  readonly incidents: readonly MatchIncident[];
}

export function emptyMomentDelta(): MomentDelta {
  return {
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCard: false,
    injuryWeeks: 0,
    ratingModifier: 0,
    incidents: [],
  };
}

/** Host'un bir mac uretmesi icin motordan aldigi baglam. */
export interface MatchBuildInput {
  readonly availability: PlayerAvailability;
  readonly season: number;
  readonly week: number;
  readonly heroClubId: string;
  readonly hero: HeroProfile;
  /**
   * O haftanin kacinci maci. Takvim artik bir haftaya birden fazla mac
   * koyabiliyor (hafta sonu + hafta ici); bu alan olmadan ikinci mac
   * oynanamaz ve yogun hafta yorgunluga hic yansimaz.
   */
  readonly slot?: number;
}

/** Host'un urettigi mac: baglam + oyuncunun dahil oldugu karar anlari. */
export interface HostMatch {
  readonly context: MatchContext;
  readonly pendingMoments: readonly PendingMoment[];
}

/**
 * MAC HOST PORTU.
 *
 * Motor bu arayuzun ARKASINDA ne oldugunu bilmez: sabit tablolu bir taklit de
 * olabilir (`FakeMatchHost`), dakika dakika 11v11 simulatoru de
 * (`MatchSimulator`). Ikisi de ayni sozlesmeyi doldurur.
 *
 * `buildMatch` bos hafta icin `undefined` doner -- fikstur takviminde mac yoksa
 * ya da oyuncu cezali/sakatsa. Motor bunu zaten bekliyor.
 */
export interface MatchHost {
  buildMatch(input: MatchBuildInput): HostMatch | undefined;
  /**
   * O hafta oyuncunun kac maci var. Uygulamayan host icin 1 varsayilir --
   * zarif bozulma, duraklayamayan host'lardaki desenin aynisi.
   */
  matchCount?(input: MatchBuildInput): number;
  applyDelta(match: HostMatch, delta: MatchOutcomeDelta): MatchResultReport;
  resetSeason(): void;
}

/** Motorun host'a sundugu, oyuncuya sorulacak karar. */
export interface PendingDecision {
  readonly moment: PendingMoment;
  readonly eventId: string;
  readonly nodeId: string;
}
