/**
 * TRANSFER PIYASASI -- degerleme, ortu ve NPC hareketi.
 *
 * En kritik iki degismez:
 *   1. `world.db` DEGISMEZ -- transfer bir ORTU. Ayni veritabaniyla yirmi
 *      farkli kariyer oynanabilmeli.
 *   2. Piyasa "en zengin herkesi alir"a donmemeli -- `keepDesire` bunu
 *      engelleyen tek mekanizma.
 */

import { describe, expect, it } from 'vitest';
import {
  askingPrice,
  valuePlayer,
  windowAt,
  DEFAULT_WINDOWS,
  TransferOverlay,
} from '../src/domain/transfer.js';
import { TransferMarket, type MarketPlayer } from '../src/simulation/TransferMarket.js';
import { transferRatio, WAGE_RATIO } from '../tools/roster/pipeline/budgets.js';
import { Rng } from '../src/selection/Rng.js';
import type { Position } from '../src/domain/actors.js';

const base = {
  baseValue: 10_000_000,
  age: 25,
  overall: 80,
  potential: 82,
  form: 50,
  seasonsLeft: 3,
};

describe('degerleme', () => {
  it('SOZLESME en sert etki -- son yil yarim fiyat, biten bedava', () => {
    const long = valuePlayer({ ...base, seasonsLeft: 4 });
    const lastYear = valuePlayer({ ...base, seasonsLeft: 1 });
    const expired = valuePlayer({ ...base, seasonsLeft: 0 });

    expect(lastYear).toBeLessThan(long * 0.7);
    expect(expired).toBeLessThan(lastYear * 0.5);
  });

  it('yas: 24-27 zirve, sonrasi sert dusus', () => {
    const prime = valuePlayer({ ...base, age: 26 });
    const veteran = valuePlayer({ ...base, age: 34 });
    expect(veteran).toBeLessThan(prime * 0.4);
  });

  it('gencte POTANSIYEL primi var', () => {
    const talent = valuePlayer({ ...base, age: 19, overall: 70, potential: 90 });
    const limited = valuePlayer({ ...base, age: 19, overall: 70, potential: 72 });
    expect(talent).toBeGreaterThan(limited);
  });

  it('form +/-%25 bandinda kalir -- tek basina belirleyici degil', () => {
    const hot = valuePlayer({ ...base, form: 100 });
    const cold = valuePlayer({ ...base, form: 0 });
    expect(hot / cold).toBeLessThan(2);
  });

  it('taban deger sifir olsa bile deger sifir olmaz', () => {
    expect(valuePlayer({ ...base, baseValue: 0 })).toBeGreaterThan(0);
  });
});

describe('satis fiyati', () => {
  it('tutmak isteyen kulup FAHIS ister', () => {
    const wanted = askingPrice(10_000_000, 95);
    const surplus = askingPrice(10_000_000, 5);
    expect(wanted).toBeGreaterThan(surplus * 2);
  });

  it('yedek oyuncu piyasa degerinin ALTINA bile gidebilir', () => {
    expect(askingPrice(10_000_000, 0)).toBeLessThan(10_000_000);
  });
});

describe('pencereler', () => {
  it('yalnizca iki pencere acik', () => {
    const open = Array.from({ length: 40 }, (_, i) => i + 1).filter(
      (w) => windowAt(w) !== undefined,
    );
    expect(open).toEqual([1, 2, 3, 20, 21, 22]);
  });

  it('pencere disinda transfer YOK', () => {
    expect(windowAt(10)).toBeUndefined();
    expect(windowAt(40)).toBeUndefined();
    expect(DEFAULT_WINDOWS).toHaveLength(2);
  });
});

describe('butce', () => {
  it('oran kadro degeriyle TERS olceklenir', () => {
    // Duz yuzde kullansaydik elit kulupler her sezon kadrosunun besde birini
    // yenileyebilirdi.
    expect(transferRatio(1_000_000)).toBeGreaterThan(transferRatio(1_000_000_000));
    expect(transferRatio(1_000_000_000)).toBeGreaterThan(0.1);
    expect(WAGE_RATIO).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ piyasa

function player(
  id: number,
  clubId: string,
  position: Position,
  overall: number,
  value = 5_000_000,
): MarketPlayer {
  return { id, clubId, position, overall, potential: overall, age: 25, baseValue: value, seasonsLeft: 3 };
}

/** Iki kulup, dolu kadrolar; A zengin ve zayif, B fakir ve guclu. */
function world() {
  const players: MarketPlayer[] = [];
  let id = 1;
  for (const [club, level] of [['A', 60], ['B', 82]] as const) {
    for (const pos of ['GK', 'GK', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW'] as Position[]) {
      players.push(player(id++, club, pos, level + (id % 5)));
    }
  }
  return {
    players,
    clubs: [
      { id: 'A', reputation: 80, budget: 200_000_000 },
      { id: 'B', reputation: 50, budget: 1_000_000 },
    ],
  };
}

describe('NPC piyasasi', () => {
  it('world.db DEGISMEZ -- transfer bir ORTU', () => {
    const { players, clubs } = world();
    const overlay = new TransferOverlay();
    const market = new TransferMarket({ clubs, players, overlay });

    const before = players.map((p) => p.clubId);
    for (let w = 1; w <= 3; w += 1) market.runWeek(w, new Rng(w));

    // Kaynak dizi hic degismedi; degisen yalnizca ortu.
    expect(players.map((p) => p.clubId)).toEqual(before);
    expect(overlay.size).toBeGreaterThan(0);
  });

  it('pencere kapaliyken hicbir sey olmaz', () => {
    const { players, clubs } = world();
    const market = new TransferMarket({ clubs, players, overlay: new TransferOverlay() });
    expect(market.runWeek(10, new Rng(1))).toHaveLength(0);
    expect(market.isOpen(10)).toBe(false);
  });

  it('butce ODENIR ve satana GECER', () => {
    const { players, clubs } = world();
    const market = new TransferMarket({ clubs, players, overlay: new TransferOverlay() });

    const buyerBefore = market.budgetOf('A');
    const sellerBefore = market.budgetOf('B');
    const done = [1, 2, 3].flatMap((w) => market.runWeek(w, new Rng(w * 7)));
    if (done.length === 0) return;

    const spent = done.filter((t) => t.toClubId === 'A').reduce((s, t) => s + t.fee, 0);
    const earned = done.filter((t) => t.fromClubId === 'B').reduce((s, t) => s + t.fee, 0);
    expect(market.budgetOf('A')).toBe(buyerBefore - spent + earned * 0);
    expect(market.budgetOf('B')).toBeGreaterThanOrEqual(sellerBefore);
  });

  it('ayni oyuncu bir sezonda BIR kez transfer olur', () => {
    const { players, clubs } = world();
    const market = new TransferMarket({ clubs, players, overlay: new TransferOverlay() });
    const done = [1, 2, 3, 20, 21, 22].flatMap((w) => market.runWeek(w, new Rng(w)));
    expect(new Set(done.map((t) => t.playerId)).size).toBe(done.length);
  });

  it('korumali oyuncu ASLA transfer olmaz -- Hero menajerin isi', () => {
    const { players, clubs } = world();
    const protectedIds = players.filter((p) => p.clubId === 'B').map((p) => p.id);
    const market = new TransferMarket({
      clubs,
      players,
      overlay: new TransferOverlay(),
      protectedPlayerIds: protectedIds,
    });
    const done = [1, 2, 3].flatMap((w) => market.runWeek(w, new Rng(w)));
    for (const t of done) expect(protectedIds).not.toContain(t.playerId);
  });

  it('ortu gecmisi kulup bazinda okunabilir', () => {
    const overlay = new TransferOverlay();
    overlay.apply({
      week: 1, playerId: 7, fromClubId: 'B', toClubId: 'A',
      fee: 1_000_000, position: 'MF', overall: 80,
    });
    expect(overlay.clubOf(7, 'B')).toBe('A');
    expect(overlay.clubOf(99, 'B')).toBe('B'); // hareketsiz oyuncu
    expect(overlay.movesFor('A').in).toHaveLength(1);
    expect(overlay.movesFor('B').out).toHaveLength(1);
  });
});
