/**
 * TRANSFER PIYASASI -- NPC kulupleri kendi aralarinda transfer yapar.
 *
 * AMAC:
 *   Dunya Hero'nun etrafinda donmesin. Oyuncu hicbir sey yapmasa da kadrolar
 *   degissin, kulupler guclensin/zayiflasin, "gecen sezon rakip takimda olan
 *   adam simdi senin yaninda" gibi anlar dogsun.
 *
 * ALGORITMA (her transfer penceresi haftasi):
 *   1. Kulupler butceye gore SIRALANIR ve karistirilir (zengin once davranir
 *      ama sira sabit degil)
 *   2. Her kulup EN ZAYIF mevkisini bulur
 *   3. O mevkide daha iyi, satin alinabilir ve satilik oyunculari arar
 *   4. Fiyat: piyasa degeri x satici kulubun TUTMA istegi
 *   5. Butce yeterse transfer olur; iki kulubun de kadrosu degisir
 *
 * NEDEN "SATILIK" KAVRAMI:
 *   Kulup kendi en iyi oyuncusunu kolay satmaz. `keepDesire` bunu sayiya
 *   doker: kadrodaki siralamasi yukseldikce fiyat fahislesir. Bu olmadan
 *   piyasa "en zengin herkesi alir"a doner ve iki sezonda tek bir super
 *   takim kalir.
 *
 * KATMAN: `domain` + `selection/Rng`. Motoru bilmez, world.db'yi DEGISTIRMEZ.
 */

import {
  askingPrice,
  valuePlayer,
  windowAt,
  DEFAULT_WINDOWS,
  type Transfer,
  type TransferOverlay,
  type TransferWindow,
} from '../domain/transfer.js';
import type { Position } from '../domain/actors.js';
import type { Rng } from '../selection/Rng.js';

/** Piyasanin gordugu oyuncu. Motor sozlugunden BAGIMSIZ. */
export interface MarketPlayer {
  readonly id: number;
  readonly clubId: string;
  readonly position: Position;
  readonly overall: number;
  readonly potential: number;
  readonly age: number;
  readonly baseValue: number;
  readonly seasonsLeft: number;
}

export interface MarketClub {
  readonly id: string;
  readonly reputation: number;
  budget: number;
  /** Ezeli rakip. Karsiliklidir; `world.db.club.rival_club_id`den gelir. */
  readonly rivalId?: string;
}

export interface TransferMarketDeps {
  readonly clubs: readonly MarketClub[];
  readonly players: readonly MarketPlayer[];
  readonly overlay: TransferOverlay;
  readonly windows?: readonly TransferWindow[];
  /** Hero'nun kulubu -- NPC piyasasi Hero'yu satmaz (o menajerin isi). */
  readonly protectedPlayerIds?: readonly number[];
}

/** Bir haftada en fazla bu kadar transfer -- piyasa cilginlasmasin. */
const MAX_PER_WEEK = 14;

/** Kulup basina hafta basi en fazla transfer. */
const MAX_PER_CLUB = 1;

export class TransferMarket {
  private readonly budget = new Map<string, number>();
  private readonly protectedIds: ReadonlySet<number>;
  private readonly windows: readonly TransferWindow[];
  /**
   * MEVKI OLCUTU -- her mevkinin dunya capindaki en iyi seviyesi.
   *
   * NEDEN GEREKLI (olculdu):
   *   Ham overall karsilastirmasi her kulubun "en zayif mevkisi"ni HEP KALECI
   *   yapiyordu. Sebep motorun kendi agirliklarinda: `POSITION_WEIGHTS`
   *   kaleciye 0.65 goalkeeping veriyor ve overall tavani 87'de kaliyor;
   *   saha oyuncusu 94'e cikiyor. Yani her kulubun kalecisi, en iyi saha
   *   oyuncusundan sayisal olarak DAIMA daha zayif gorunuyordu ve piyasa
   *   yalnizca kaleci aliyordu (olculen 150 transferin tamami).
   *
   *   Cozum: mevkiler kendi olcutlerine gore karsilastirilir. "Kalecim
   *   kalecilerin %70'i seviyesinde, stoperim stoperlerin %85'i" -- bu
   *   karsilastirilabilir bir sey.
   */
  private readonly benchmark = new Map<Position, number>();
  /** Bu sezon zaten transfer olmus oyuncular -- ayni oyuncu dort kez donmesin. */
  private readonly movedThisSeason = new Set<number>();
  /** Kulup -> ezeli rakip. Satis fiyatini ve anlatiyi belirler. */
  private readonly rivalOf = new Map<string, string>();

  constructor(private readonly deps: TransferMarketDeps) {
    for (const club of deps.clubs) this.budget.set(club.id, club.budget);
    this.protectedIds = new Set(deps.protectedPlayerIds ?? []);
    this.windows = deps.windows ?? DEFAULT_WINDOWS;
    for (const club of deps.clubs) {
      if (club.rivalId !== undefined) this.rivalOf.set(club.id, club.rivalId);
    }

    // OLCUT: kuluplerin O MEVKIDEKI EN IYISININ ortalamasi.
    //
    // Ilk denemede mevkinin en iyi %5'i olcut alinmisti ve kaleci hala
    // transferlerin %61'ini olusturuyordu. Sebep ORNEKLEME: kadroda 2-3
    // kaleci, 6-8 defans var. Ayni dagilimdan daha cok cekilis, daha yuksek
    // "en iyi" demek -- yani kulubun en iyi defansi, en iyi kalecisinden
    // sistematik olarak daha yuksek cikiyor. Bu bir KALITE farki degil,
    // KADRO DERINLIGI farki.
    //
    // Dogru karsilastirma: "benim en iyi kalecim, TIPIK bir kulubun en iyi
    // kalecisine gore nerede?" Bu, derinlik etkisini kendiliginden notrler.
    const bestPerClub = new Map<Position, number[]>();
    const clubBest = new Map<string, Map<Position, number>>();
    for (const p of deps.players) {
      const club = clubBest.get(p.clubId) ?? new Map<Position, number>();
      if ((club.get(p.position) ?? 0) < p.overall) club.set(p.position, p.overall);
      clubBest.set(p.clubId, club);
    }
    for (const positions of clubBest.values()) {
      for (const [position, best] of positions) {
        const list = bestPerClub.get(position);
        if (list) list.push(best);
        else bestPerClub.set(position, [best]);
      }
    }
    for (const [position, values] of bestPerClub) {
      this.benchmark.set(position, values.reduce((a, b) => a + b, 0) / values.length);
    }
  }

  /** Sezon donusunde cagrilir: transfer kilidi ve butceler tazelenir. */
  resetSeason(): void {
    this.movedThisSeason.clear();
    for (const club of this.deps.clubs) this.budget.set(club.id, club.budget);
  }

  isOpen(week: number): boolean {
    return windowAt(week, this.windows) !== undefined;
  }

  budgetOf(clubId: string): number {
    return this.budget.get(clubId) ?? 0;
  }

  /**
   * Bir haftayi isler. Pencere kapaliysa hicbir sey yapmaz.
   *
   * Donen liste o hafta gerceklesen transferler -- anlati ve rapor icin.
   */
  runWeek(week: number, rng: Rng): readonly Transfer[] {
    if (!this.isOpen(week)) return [];

    const squads = this.buildSquads();
    const done: Transfer[] = [];
    const perClub = new Map<string, number>();

    // Zengin kulup once davranir ama sira sabit degil: butceye gore
    // agirliklandirilmis bir karistirma.
    const actors = rng
      .shuffle([...this.deps.clubs])
      .sort((a, b) => this.budgetOf(b.id) - this.budgetOf(a.id));

    for (const club of actors) {
      if (done.length >= MAX_PER_WEEK) break;
      if ((perClub.get(club.id) ?? 0) >= MAX_PER_CLUB) continue;
      // Her kulup her hafta hamle yapmaz -- piyasa dalgali olmali.
      if (rng.next() > 0.35) continue;

      const transfer = this.attemptSigning(club, squads, week, rng);
      if (!transfer) continue;

      this.commit(transfer, squads);
      done.push(transfer);
      perClub.set(club.id, (perClub.get(club.id) ?? 0) + 1);
    }

    return done;
  }

  // ------------------------------------------------------------- ic isleyis

  /** Guncel kadrolar -- ortu uygulanmis halde. */
  private buildSquads(): Map<string, MarketPlayer[]> {
    const byClub = new Map<string, MarketPlayer[]>();
    for (const player of this.deps.players) {
      const clubId = this.deps.overlay.clubOf(player.id, player.clubId);
      if (clubId === undefined) continue;
      const list = byClub.get(clubId);
      if (list) list.push(player);
      else byClub.set(clubId, [player]);
    }
    return byClub;
  }

  private attemptSigning(
    club: MarketClub,
    squads: ReadonlyMap<string, MarketPlayer[]>,
    week: number,
    rng: Rng,
  ): Transfer | undefined {
    const squad = squads.get(club.id) ?? [];
    if (squad.length === 0) return undefined;

    const weakest = this.weakestPosition(squad);
    if (!weakest) return undefined;

    const budget = this.budgetOf(club.id);
    if (budget < 100_000) return undefined;

    // Adaylar: ayni mevkide, DAHA IYI, baska kulupte, korumasiz.
    const candidates: { player: MarketPlayer; price: number; toRival: boolean }[] = [];
    for (const [otherId, otherSquad] of squads) {
      if (otherId === club.id) continue;

      for (const player of otherSquad) {
        if (player.position !== weakest.position) continue;
        if (player.overall <= weakest.best + 2) continue; // kayda deger gelisme sart
        if (this.protectedIds.has(player.id)) continue;
        // Ayni oyuncu bir sezonda bir kez transfer olur. Bu kilit olmadan
        // ayni kaleci sezon boyunca dort kulup dolasiyordu (olculdu).
        if (this.movedThisSeason.has(player.id)) continue;

        const value = valuePlayer({
          baseValue: player.baseValue,
          age: player.age,
          overall: player.overall,
          potential: player.potential,
          form: 50,
          seasonsLeft: player.seasonsLeft,
        });
        const toRival = this.rivalOf.get(otherId) === club.id;
        const price = askingPrice(value, this.keepDesire(player, otherSquad), toRival);
        if (price > budget) continue;

        candidates.push({ player, price, toRival });
      }
    }
    if (candidates.length === 0) return undefined;

    // En iyi degil, iyi olanlardan biri: piyasa deterministik olmamali.
    candidates.sort((a, b) => b.player.overall - a.player.overall);
    const shortlist = candidates.slice(0, 6);
    const chosen = rng.weighted(shortlist, (c) => c.player.overall - weakest.best);
    if (!chosen) return undefined;

    return {
      week,
      playerId: chosen.player.id,
      fromClubId: this.deps.overlay.clubOf(chosen.player.id, chosen.player.clubId)!,
      toClubId: club.id,
      fee: chosen.price,
      position: chosen.player.position,
      overall: chosen.player.overall,
      ...(chosen.toRival ? { toRival: true } : {}),
    };
  }

  /**
   * Kulubun EN ZAYIF mevkisi -- o mevkideki en iyi oyuncusuna bakilir.
   *
   * Ortalamaya degil EN IYIYE bakiyoruz: ilk 11'e cikan odur. Ortalamaya
   * bakan bir kulup "dokuz kotu stoperim var, bir tane daha alayim" derdi.
   */
  private weakestPosition(
    squad: readonly MarketPlayer[],
  ): { position: Position; best: number } | undefined {
    const bestByPosition = new Map<Position, number>();
    for (const p of squad) {
      const current = bestByPosition.get(p.position) ?? 0;
      if (p.overall > current) bestByPosition.set(p.position, p.overall);
    }

    // Eksik mevki en zayif sayilir -- kalecisiz kadro her seyden once kaleci arar.
    for (const position of ['GK', 'DF', 'MF', 'FW'] as const) {
      if (!bestByPosition.has(position)) return { position, best: 0 };
    }

    // MEVKIYE GORE NORMALIZE: ham overall degil, o mevkinin olcutune ORAN.
    let worst: { position: Position; best: number; ratio: number } | undefined;
    for (const [position, best] of bestByPosition) {
      const mark = this.benchmark.get(position) ?? 100;
      const ratio = best / mark;
      if (!worst || ratio < worst.ratio) worst = { position, best, ratio };
    }
    return worst === undefined ? undefined : { position: worst.position, best: worst.best };
  }

  /**
   * Satici kulubun TUTMA istegi (0-100).
   *
   * Kadrodaki siralamasi ne kadar yukseksek o kadar tutmak ister. Kadronun
   * en iyisi ~95, yedegi ~20 doner. Bu, "para verirsen herkesi alirsin"
   * durumunu engelleyen tek mekanizma.
   */
  private keepDesire(player: MarketPlayer, squad: readonly MarketPlayer[]): number {
    const samePosition = squad
      .filter((p) => p.position === player.position)
      .sort((a, b) => b.overall - a.overall);
    const rank = samePosition.findIndex((p) => p.id === player.id);

    // Mevkisinde birinciyse cok isteniyor; ucuncu ve sonrasi fazlalik.
    const positional = rank === 0 ? 70 : rank === 1 ? 40 : 15;

    // Kadronun genel siralamasi da etkiler: takimin yildizi satilmaz.
    const overallRank = [...squad].sort((a, b) => b.overall - a.overall).findIndex((p) => p.id === player.id);
    const star = overallRank < 3 ? 25 : overallRank < 8 ? 10 : 0;

    return Math.min(100, positional + star);
  }

  private commit(transfer: Transfer, squads: Map<string, MarketPlayer[]>): void {
    this.deps.overlay.apply(transfer);
    this.movedThisSeason.add(transfer.playerId);

    // Butceler: alan oder, satan kazanir. Satan kulup parayi HEMEN kullanabilir
    // -- gercek piyasada da satis geliri ayni pencerede harcanir.
    this.budget.set(transfer.toClubId, this.budgetOf(transfer.toClubId) - transfer.fee);
    this.budget.set(transfer.fromClubId, this.budgetOf(transfer.fromClubId) + transfer.fee);

    // Kadro haritasini guncelle ki ayni pencerede tutarli kalsin.
    const from = squads.get(transfer.fromClubId);
    const player = from?.find((p) => p.id === transfer.playerId);
    if (from && player) {
      squads.set(
        transfer.fromClubId,
        from.filter((p) => p.id !== transfer.playerId),
      );
      const to = squads.get(transfer.toClubId) ?? [];
      squads.set(transfer.toClubId, [...to, player]);
    }
  }
}
