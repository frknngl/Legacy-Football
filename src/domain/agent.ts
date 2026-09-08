/**
 * MENAJER -- arketip egilimleri, memnuniyet ve komisyon pazarligi.
 *
 * NEDEN DOMAIN:
 *   Menajer matematigi hem `runtime` (Hero'nun menajeri, memnuniyet dongusu)
 *   hem ileride `simulation` (NPC'lerin menajerleri, piyasa hareketi)
 *   tarafindan okunacak. Ortak matematik taban katmanda.
 *
 * NEDEN world.db DEGIL GameState:
 *   Menajer KADROSU dunyanin parcasi (`world.db.agent`) -- ayni dunyada
 *   yirmi kariyer oynanir, hepsi ayni menajerleri gorur. Ama Hero'nun O
 *   menajerle iliskisi kariyerin parcasi: memnuniyet, pazarlikla kirilmis
 *   komisyon, kac sezondur birlikte. Bu yuzden `AgentState` burada.
 *
 * DENGE ILKESI:
 *   Hicbir arketip baskin degil. `super_agent` seni Sampiyonlar Ligi'ne
 *   tasir ama kazancinin altida birini alir ve her sezon satmak ister;
 *   `family` seni ust lige cikaramaz ama 34 yasinda formdan dustugunde de
 *   yanindadir. Asagidaki her carpan bu dengeyi korumak icin var --
 *   birini yukseltirken karsiligini dusurmeden degistirmeyin.
 */

export type AgentArchetype =
  | 'super_agent'
  | 'family'
  | 'developer'
  | 'opportunist'
  | 'journeyman';

/** `world.db.agent` satirinin okunmus hali. Kariyer boyunca DEGISMEZ. */
export interface AgentProfile {
  readonly id: number;
  readonly name: string;
  readonly archetype: AgentArchetype;
  /** 0-100. Hangi seviyedeki kulup kapisini acabilir. */
  readonly reach: number;
  /** 0-100. Maas/bonservis pazarlik gucu. */
  readonly negotiation: number;
  /** 0-100. Oyuncuyu satmaya direnci. */
  readonly loyalty: number;
  /** 0-100. Reddedilen tekliflere tahammulu. */
  readonly patience: number;
  /** Taban komisyon orani (0.03 - 0.18). Pazarlik bunu EZEBILIR. */
  readonly commission: number;
  readonly reputation: number;
}

/** Hero'nun bu menajerle iliskisi. Kariyer durumu -- kayda yazilir. */
export interface AgentState {
  readonly agentId: number;
  /** 0-100. Dusrse ilgisini keser, dibe vurursa BIRAKIR. */
  satisfaction: number;
  /** Pazarlikla degistirilebilir; profildeki tabani ezer. */
  commission: number;
  /** Reddedilen teklif sayisi -- sabrin tuketilme sayaci. */
  rejectedOffers: number;
  /** Bu menajerle kac sezon calisildi. Sadakat primi. */
  seasonsTogether: number;
  /** Menajer degistirme sogumasi -- tur numarasi. */
  switchableFromTurn: number;
  /** Bir sonraki komisyon pazarligina en erken hangi turda girilebilir. */
  negotiableFromTurn: number;
}

export const AGENT_START_SATISFACTION = 60;
/** Bu esigin altinda uyari sahnesi tetiklenir. */
export const AGENT_WARNING_THRESHOLD = 30;
/** Bu esigin altinda menajer BIRAKIR. */
export const AGENT_QUIT_THRESHOLD = 10;
/** Menajer degistirme sogumasi -- tur. */
export const AGENT_SWITCH_COOLDOWN = 20;
/** Reddedilen pazarliktan sonra tekrar denemek icin beklenecek tur. */
export const NEGOTIATION_COOLDOWN = 10;

export function newAgentState(profile: AgentProfile, turn: number): AgentState {
  return {
    agentId: profile.id,
    satisfaction: AGENT_START_SATISFACTION,
    commission: profile.commission,
    rejectedOffers: 0,
    seasonsTogether: 0,
    switchableFromTurn: turn + AGENT_SWITCH_COOLDOWN,
    negotiableFromTurn: turn,
  };
}

// ------------------------------------------------------------ teklif olasiligi

export interface OfferContext {
  /** Teklifi getiren kulubun itibari (0-100). */
  readonly clubReputation: number;
  /** Hero'nun mevcut kulubunun itibari. */
  readonly currentClubReputation: number;
  /** Hedefte ilk 11'e girme sansi (0-100). */
  readonly playingChance: number;
  /** Hero'nun formu (0-100). */
  readonly form: number;
  /** Bu sezon atilan gol. */
  readonly seasonGoals: number;
  /** Transfer penceresi acik mi. */
  readonly windowOpen: boolean;
}

/** Haftalik taban teklif olasiligi. Pencerede ucе katlanir. */
const BASE_OFFER_CHANCE = 0.06;

/**
 * ERISIM UYUMU -- menajerin acabilecegi kapinin tavani.
 *
 * Asagi dogru sinir YOK: reach 90 olan menajer 60 itibarli kulupten de
 * teklif getirebilir (getirmek istemeyebilir, o ayri -- `archetypeBias`
 * halleder). Yukari dogru sert: reach 50 olan menajer 90 itibarli kulubun
 * kapisini calamaz. `family` arketipinin tavaninin alcak olmasinin
 * mekanigi budur.
 */
export function reachFit(reach: number, clubReputation: number): number {
  return clamp01(1 - Math.max(0, clubReputation - reach) / 40);
}

export function formFactor(form: number, seasonGoals: number): number {
  return 0.5 + clamp01(form / 100) + seasonGoals * 0.03;
}

/**
 * Memnun olmayan menajer TELEFONA BAKMAZ.
 *
 * 25'in altinda sert kirilma var (0.2): bu, "menajerin seni birakmadan
 * once gorunmez oldugu" evre. Oyuncu bunu teklif akisinin kurumasindan
 * anlar -- once bir uyari sahnesi, sonra sessizlik.
 */
export function satisfactionFactor(satisfaction: number): number {
  return satisfaction < 25 ? 0.2 : 0.6 + satisfaction / 250;
}

/**
 * ARKETIP EGILIMI -- menajerin NE aradigi.
 *
 * Ayni erisim gucundeki iki menajer ayni teklifleri getirmez: `developer`
 * forma sansina bakar, `opportunist` komisyon tutarina, `super_agent`
 * kulubun buyuklugune. Arketip secimini anlamli kilan tek carpan bu.
 */
export function archetypeBias(archetype: AgentArchetype, ctx: OfferContext): number {
  switch (archetype) {
    case 'super_agent':
      // Buyuk kulup disinda hicbir sey ilgisini cekmiyor.
      return ctx.clubReputation > 80 ? 1.6 : ctx.clubReputation < 60 ? 0.3 : 1;
    case 'developer':
      // Forma sansi olmayan transferi savunmaz -- parasi ne olursa olsun.
      return ctx.playingChance > 55 ? 1.8 : 0.4;
    case 'family':
      // Yalnizca acik bir YUKSELIS icin masaya oturur.
      return ctx.clubReputation > ctx.currentClubReputation ? 1 : 0.2;
    case 'opportunist':
      // Kulubun kalitesi umurunda degil; buyuk kulup = buyuk komisyon.
      return ctx.clubReputation > 70 ? 1.5 : 1.1;
    case 'journeyman':
      return 1;
  }
}

export function offerChance(
  profile: AgentProfile,
  state: AgentState,
  ctx: OfferContext,
): number {
  const base = BASE_OFFER_CHANCE * (ctx.windowOpen ? 3 : 1);
  return clamp01(
    base *
      reachFit(profile.reach, ctx.clubReputation) *
      formFactor(ctx.form, ctx.seasonGoals) *
      satisfactionFactor(state.satisfaction) *
      archetypeBias(profile.archetype, ctx),
  );
}

/** Menajersiz Hero'nun ham teklif olasiligi -- kapi neredeyse kapali. */
export const AGENTLESS_OFFER_FACTOR = 0.25;

// ------------------------------------------------------------------ memnuniyet

export type SatisfactionEvent =
  | 'offer_rejected'
  | 'transfer_done'
  | 'season_in_form'
  | 'season_out_of_form'
  | 'trophy';

/**
 * Memnuniyet hareketi.
 *
 * `offer_rejected` tek DEGISKEN ceza: sabirsiz menajer sert duser
 * (patience 20 -> -26), sabirli menajer omuz silker (patience 95 -> -11).
 * `super_agent`la calismanin bedeli burada somutlasiyor -- her "hayir"
 * seni birakmasina yaklastirir.
 */
export function satisfactionDelta(
  event: SatisfactionEvent,
  profile: AgentProfile,
): number {
  switch (event) {
    case 'offer_rejected':
      return -(30 - profile.patience / 5);
    case 'transfer_done':
      return 25;
    case 'season_in_form':
      return 8;
    case 'season_out_of_form':
      return -12;
    case 'trophy':
      return 10;
  }
}

export function applySatisfaction(
  state: AgentState,
  event: SatisfactionEvent,
  profile: AgentProfile,
): AgentState {
  const satisfaction = clamp(state.satisfaction + satisfactionDelta(event, profile), 0, 100);
  return {
    ...state,
    satisfaction,
    rejectedOffers: state.rejectedOffers + (event === 'offer_rejected' ? 1 : 0),
  };
}

export function agentQuits(state: AgentState): boolean {
  return state.satisfaction < AGENT_QUIT_THRESHOLD;
}

// -------------------------------------------------------------- komisyon pazarligi

/**
 * Komisyon pazarligi -- kabul olasiligi.
 *
 * Dort eksen: ne kadar kirptigin (baskin), guven (memnuniyet), birlikte
 * gecen sezonlar ve menajerin pazarlik gucu. Kirpma katsayisi -8 kasitli
 * olarak SERT: %14'ten %10'a inmek istemek (0.04 fark) olasiligi 0.32
 * dusurur. Yumusak olsaydi her oyuncu ilk sezonda komisyonu tabana ceker
 * ve arketip secimi anlamsizlasirdi.
 *
 * Alt sinir 0.02: imkansiz degil. Ust sinir 0.95: garanti degil.
 */
export function negotiationChance(
  profile: AgentProfile,
  state: AgentState,
  proposed: number,
): number {
  return clamp(
    0.5 +
      (state.commission - proposed) * -8 +
      state.satisfaction / 200 +
      state.seasonsTogether * 0.04 -
      (profile.negotiation - 50) / 300,
    0.02,
    0.95,
  );
}

/** Reddedilen pazarligin bedeli: memnuniyet -8 ve on tur bekleme. */
export const NEGOTIATION_REJECT_PENALTY = 8;

/**
 * Menajer FESIH BEDELI.
 *
 * Kalan sezon x haftalik gelir x komisyon x 4. Dortlu carpan, menajer
 * degistirmeyi bedava yapmamak icin: bedelsiz olsaydi oyuncu her sezon
 * en yuksek reach'li menajere atlar, sadakatin hicbir anlami kalmazdi.
 */
export function terminationFee(
  state: AgentState,
  weeklyIncome: number,
  seasonsLeft: number,
): number {
  return Math.round(Math.max(0, seasonsLeft) * weeklyIncome * state.commission * 4);
}

/**
 * Yeni menajerin baslangic memnuniyeti.
 *
 * Sik menajer degistiren oyuncuya piyasa SOGUK bakar: her onceki menajer
 * baslangici uc puan dusurur. Bu olmadan menajer degistirmek risksiz bir
 * optimizasyon olurdu.
 */
export function newAgentSatisfaction(previousAgents: number): number {
  return clamp(AGENT_START_SATISFACTION - previousAgents * 3, 20, AGENT_START_SATISFACTION);
}

// ------------------------------------------------------------------ yardimci

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
