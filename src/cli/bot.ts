/**
 * OLCUM BOTUNUN KARARLARI.
 *
 * OLCULEN SORUN: `simulate` ve `playtest` oyuncunun yaptigi bazi seyleri
 * HIC yapmiyordu, dolayisiyla o yollara bagli icerik "olu" olarak
 * raporlaniyordu -- ama olu degildi, yalnizca OLCULMEMISTI:
 *
 *   - `simulate` menajer imzalamiyor, teklif gormuyordu
 *   - IKISI DE hicbir zaman gercekten kulup degistirmiyordu
 *     (`reportWorldEvent({kind:'transfer'})` hicbir host'ta cagrilmiyordu
 *     `play.ts` disinda), yani `mem_rakibe_transfer` HIC yazilmiyor ve
 *     `evt_transfer_rakibe_gecis_hesaplasma` hep olu gorunuyordu
 *   - IKISI DE kredi cekmiyordu, yani borc kolu (`evt_dark_betting_offer`,
 *     `evt_legal_mafia_collects`) olculemiyordu
 *
 * Bot GERCEK bir oyuncuyu taklit etmeli, kusursuz bir oyuncuyu degil:
 * bazen kabul eder, bazen reddeder, bazen borclanir. Hep en iyisini
 * secen bir bot kariyerin yalnizca bir kolunu olcer.
 *
 * Burasi OYUN KURALI DEGIL, olcum davranisidir. `src/runtime` bunu
 * bilmez; motorun kendi olasiliklari (`rollAgentOffer`) sorulur ve
 * karar burada verilir.
 */

import type { GameEngine } from '../runtime/GameEngine.js';
import type { RosterProvider } from '../domain/roster.js';
import type { Rng } from '../selection/Rng.js';

export interface BotOutcome {
  agentSigned: boolean;
  agentQuit: boolean;
  transferred: boolean;
  /** Ezeli rakibe gecildi mi -- `mem_rakibe_transfer` bunu yaziyor. */
  toRival: boolean;
  /** Secilen agir sakatlik tedavisi -- yoksa undefined. */
  treatment?: string;
  loanTaken: boolean;
}

/** Bot davranis sozlesmesi -- olcum manifestinde kayda gecer. */
export const BOT_POLICY_VERSION = 'bot-v2-shared-turn-policy';

const NOTHING: BotOutcome = {
  agentSigned: false,
  agentQuit: false,
  transferred: false,
  toRival: false,
  loanTaken: false,
};

/** Transfer penceresi -- `play.ts` ile ayni haftalar. */
function windowOpen(week: number): boolean {
  return week <= 3 || (week >= 20 && week <= 22);
}

/**
 * Bu tura ilgi duyan kulup.
 *
 * `play.ts`teki `pickInterestedClub` ile ayni mantik: mevcut kulubun
 * itibarindan cok asagi olmayan bir kulup, turdan turetilen deterministik
 * bir secimle. Deterministik olmasi sart -- olcum tekrarlanabilir kalmali.
 */
function interestedClub(
  roster: RosterProvider,
  currentClubId: string,
  turn: number,
  rng: Rng,
): { id: string; name: string; reputation: number } | undefined {
  const club = roster.club(currentClubId);
  const current = club?.reputation ?? 50;

  // EZELI RAKIBE bilerek nisan alinir -- ama nadiren (~%12).
  //
  // Neden ozel bir kol: rakibe transfer anlatinin en agir tetigi
  // (`mem_rakibe_transfer`, taraftar destegi -35) ama rastgele secimde
  // 300 kulup arasindan neredeyse hic secilmez. Olcum araci nadir ama
  // ONEMLI yollari kasten dolasmali, yoksa o icerik hep "olu" gorunur.
  if (club?.rivalId !== undefined && rng.next() < 0.12) {
    const rival = roster.club(club.rivalId);
    if (rival !== undefined) {
      return { id: rival.id, name: rival.name, reputation: rival.reputation };
    }
  }

  const options = roster
    .clubs()
    .filter((c) => c.id !== currentClubId && (c.reputation ?? 0) >= current - 12);
  if (options.length === 0) return undefined;
  const picked = options[(turn * 2654435761) % options.length];
  return picked === undefined
    ? undefined
    : { id: picked.id, name: picked.name, reputation: picked.reputation };
}

/**
 * Bir turluk bot karari: menajer, transfer, kredi.
 *
 * Cagiran host bunu `advanceTurn` SONRASI ve sahne bosaltmadan ONCE
 * cagirmalidir; motor acik bir karar varken durum degistirmeye izin
 * verir ama sira karisirsa olcum yanilir.
 */
export function botTurn(
  engine: GameEngine,
  roster: RosterProvider,
  rng: Rng,
  week: number,
): BotOutcome {
  const out: BotOutcome = { ...NOTHING };
  const state = engine.snapshot();

  // --- MENAJER
  //
  // Bot her pencerede menajer arar ve gelen teklifin yarisini kabul eder.
  // Hep kabul eden bir bot memnuniyet dususunu, hep reddeden de transferi
  // hic olcemezdi.
  if (engine.currentAgent() === undefined) {
    const options = engine.agentOptions(4);
    const pick = options[Math.floor(rng.next() * options.length)];
    if (pick && engine.signAgent(pick.id)) out.agentSigned = true;
  } else {
    const club = roster.club(state.clubId);
    const offered = engine.rollAgentOffer({
      clubReputation: (club?.reputation ?? 50) + 8,
      currentClubReputation: club?.reputation ?? 50,
      playingChance: 55,
      form: numberOf(state.flags['form']),
      seasonGoals: numberOf(state.flags['sezon_gol_sayisi']),
      windowOpen: windowOpen(week),
    });

    if (offered) {
      const accept = rng.next() < 0.5;
      engine.reportAgentOutcome(accept ? 'transfer_done' : 'offer_rejected');
      if (engine.currentAgent() === undefined) out.agentQuit = true;

      // --- GERCEKTEN TASIN
      //
      // Eski davranista bot menajere "transfer oldu" diyor ama kulubu
      // DEGISTIRMIYORDU. Bu yuzden `mem_rakibe_transfer` hic yazilmiyor
      // ve rakibe transfer sahnesi hep olu goruluyordu.
      if (accept) {
        const target = interestedClub(roster, state.clubId, state.turn, rng);
        if (target !== undefined) {
          const rival = club?.rivalId !== undefined && club.rivalId === target.id;
          engine.reportWorldEvent({
            kind: 'transfer',
            toClubId: target.id,
            toClubName: target.name,
            toRival: rival,
          });
          out.transferred = true;
          out.toRival = rival;
        }
      }
    }
  }

  // --- AGIR SAKATLIK TEDAVISI
  //
  // Bot uc yolu da kullanmali, yoksa mekanik olculmez ve "kulup doktoru
  // karar verdi" dalindan baska bir sey hic sinanmaz. Dagilim kasitli:
  // cogunlukla konservatif (gercekci), ara sira ameliyat, nadiren gizle.
  if (engine.pendingTreatment() !== undefined) {
    const roll = rng.next();
    const id = roll < 0.25 ? 'ameliyat' : roll < 0.85 ? 'konservatif' : 'gizle';
    try {
      engine.chooseTreatment(id);
      out.treatment = id;
    } catch {
      // Parasi yetmediyse kulup doktoru karar versin.
    }
  }

  // --- KREDI
  //
  // Gercek oyuncu her firsatta borclanmaz; bot da oyle. Yalnizca parasi
  // haftalik maasinin ucuna dustugunde ve dusuk bir olasilikla bakar.
  // Amac borc KOLUNU olcmek, kariyeri borca bogmak degil.
  //
  // DIKKAT: ilk yazimda kosul "parasi haftalik maasin ucune dusunce"
  // idi ve HIC tetiklenmedi (6 kariyerde 0 kredi). Sebebi olculdu:
  // hero zaten hicbir zaman parasiz kalmiyor -- `servet` medyani 5,4M,
  // maas medyani 3.479. Yani "darda kalinca borclanan" bir bot borc
  // kolunu asla olcemez.
  //
  // Gercek oyuncu zaten ihtiyactan degil FIRSAT icin de borclanir.
  // Esik bu yuzden servete degil, duz bir olasiliga bagli.
  if (engine.currentLoan() === undefined) {
    const wage = numberOf(state.flags['haftalik_gelir']);
    if (wage > 0 && rng.next() < 0.02) {
      const offers = engine.loanOffers();
      const pick = offers[Math.floor(rng.next() * offers.length)];
      if (pick) {
        engine.takeLoan(pick);
        out.loanTaken = true;
      }
    }
  }

  return out;
}

function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
