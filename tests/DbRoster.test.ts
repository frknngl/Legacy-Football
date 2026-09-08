/**
 * world.db adaptoru -- motor gercek veriyi okuyor mu.
 *
 * En kritik iki sey:
 *   1. Motora YALNIZCA maskeli ad ulasir. Gercek ad DB'de duruyor ama
 *      `RosterProvider` yuzeyinden asla gecmez; aksi halde bir metin sablonu
 *      yanlislikla gercek ismi basabilir ve lisans maskesi anlamsizlasir.
 *   2. `quality` NITELIKLERDEN turer (`overallFor`) -- DB'deki sayiya
 *      guvenilmez, motorun kendi formulu kullanilir.
 */

import { describe, expect, it, afterAll } from 'vitest';
import { DatabaseSync } from '../src/adapters/sqlite.js';
import { DbRosterProvider } from '../src/adapters/DbRosterProvider.js';
import { overallFor, type SlotDefinition } from '../src/domain/actors.js';
import type { NameConfig } from '../src/evaluation/NameForge.js';

const NAMES: NameConfig = {
  pools: {
    tr: { male: ['Ahmet', 'Mehmet', 'Kerem'], female: ['Elif', 'Zeynep'], last: ['Yilmaz', 'Kaya'] },
    br: { male: ['Joao', 'Pedro'], female: ['Ana'], last: ['Silva', 'Souza'] },
  },
  foreignOrigins: ['br'],
  foreignRatioByClubTier: { amateur: 0, lower: 0, mid: 0.2, contender: 0.3, elite: 0.5 },
  nicknames: ['Aga'],
};

const SLOTS: readonly SlotDefinition[] = [];

const SCHEMA = `
CREATE TABLE country(id INTEGER PRIMARY KEY, name_real TEXT, name_masked TEXT);
CREATE TABLE competition(id INTEGER PRIMARY KEY, name_masked TEXT, level INTEGER,
  promoted INTEGER DEFAULT 0, relegated INTEGER DEFAULT 0, matches_per_club INTEGER);
CREATE TABLE club(id INTEGER PRIMARY KEY, name_real TEXT, name_masked TEXT, short_masked TEXT,
  city TEXT DEFAULT '', stadium TEXT DEFAULT '', tier TEXT, competition_id INTEGER,
  country_id INTEGER, reputation INTEGER);
CREATE TABLE player(id INTEGER PRIMARY KEY, first_real TEXT, last_real TEXT,
  first_masked TEXT, last_masked TEXT, birth_year INTEGER, nationality TEXT,
  position TEXT, height_cm INTEGER, club_id INTEGER);
CREATE TABLE player_attributes(player_id INTEGER PRIMARY KEY, pace INTEGER, shooting INTEGER,
  passing INTEGER, defending INTEGER, physical INTEGER, goalkeeping INTEGER,
  overall INTEGER, potential INTEGER);
`;

const open = (): any => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.exec(`
    INSERT INTO country VALUES (1,'England','Albion');
    INSERT INTO competition VALUES (1,'Premier Division',1,0,3,38);
    INSERT INTO club VALUES (1,'Manchester City','Manchester Blue','MAN BLU','','','elite',1,1,96);
    INSERT INTO club VALUES (2,'Tiny FC','Tiny Crown','TIN CRO','','','lower',1,1,30);
  `);

  // Manchester Blue: 20 gercek oyuncu. Tiny Crown: yalnizca 5 -> tamamlanmali.
  const p = db.prepare(
    'INSERT INTO player VALUES (?,?,?,?,?,?,?,?,?,?)',
  );
  const a = db.prepare('INSERT INTO player_attributes VALUES (?,?,?,?,?,?,?,?,?)');
  const positions = ['GK', 'GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF',
    'FW', 'FW', 'FW', 'DF', 'MF', 'FW', 'DF', 'MF', 'FW', 'GK'];

  positions.forEach((position, i) => {
    const id = i + 1;
    p.run(id, 'Bruno', 'Fernandes', 'Bruno', `Fernandos${id}`, 1996, 'England', position, 180, 1);
    a.run(id, 70, 70, 70, 70, 70, position === 'GK' ? 80 : 10, 70, 72);
  });
  for (let i = 0; i < 5; i += 1) {
    const id = 100 + i;
    p.run(id, 'Real', 'Name', 'Masked', `Last${i}`, 2000, 'Brazil', 'MF', 175, 2);
    a.run(id, 50, 50, 50, 50, 50, 5, 50, 55);
  }
  return db;
};

const dbs: any[] = [];
function provider(seed = 1): DbRosterProvider {
  const db = open();
  dbs.push(db);
  return new DbRosterProvider({ db, names: NAMES, slots: SLOTS, seed });
}

afterAll(() => {
  for (const db of dbs) db.close();
});

describe('DbRosterProvider', () => {
  it('kulupleri MASKELI adla doner -- gercek ad motora ULASMAZ', () => {
    const roster = provider();
    const names = roster.clubs().map((c) => c.name);
    expect(names).toContain('Manchester Blue');
    expect(names).not.toContain('Manchester City');
  });

  it('oyuncu adlari da maskeli', () => {
    const roster = provider();
    const squad = roster.squad('1');
    expect(squad.length).toBeGreaterThan(0);
    for (const p of squad) {
      expect(p.last).not.toBe('Fernandes');
      expect(p.displayName).not.toContain('Fernandes');
    }
  });

  it('quality DB kolonundan degil NITELIKLERDEN turer', () => {
    // DB'de overall 70 yaziyor ama kaleciler icin agirlikli hesap farkli sonuc
    // verir. Motorun sozlesmesi `overallFor`dur; DB'ye korlemesine guvenmeyiz.
    const roster = provider();
    for (const p of roster.squad('1')) {
      expect(p.quality).toBe(overallFor(p.position, p.attributes));
    }
  });

  it('nitelikler DB satirindan BIREBIR gelir', () => {
    const roster = provider();
    const keeper = roster.squad('1').find((p) => p.position === 'GK')!;
    expect(keeper.attributes.goalkeeping).toBe(80);
    expect(keeper.attributes.pace).toBe(70);
  });

  it('en iyi kaleci 1 numarayi alir', () => {
    const roster = provider();
    const squad = roster.squad('1');
    expect(squad[0]!.shirtNumber).toBe(1);
    expect(squad[0]!.position).toBe('GK');
  });

  it('INCE kadro tohumdan tamamlanir -- 11v11 sahaya 11 kisi cikarmali', () => {
    // Kaynak anliginda bazi kuluplerin kadrosu 6 kisiye kadar dusuyor.
    const roster = provider();
    const squad = roster.squad('2');
    expect(squad.length).toBeGreaterThanOrEqual(18);

    // Tamamlananlar isaretli -- gercek oyuncudan ayirt edilebilir.
    const generated = squad.filter((p) => p.sourceId.includes(':gen'));
    expect(generated.length).toBe(squad.length - 5);

    // Ve her mevkiden en az bir kisi var, yoksa ilk 11 kurulamaz.
    for (const position of ['GK', 'DF', 'MF', 'FW'] as const) {
      expect(squad.some((p) => p.position === position), position).toBe(true);
    }
  });

  it('teknik heyet TOHUMDAN uretilir -- kaynakta yok', () => {
    const roster = provider();
    const staff = roster.staff('1');
    expect(staff.map((s) => s.role)).toContain('manager');
    expect(staff.map((s) => s.role)).toContain('president');
    for (const s of staff) expect(s.displayName.length).toBeGreaterThan(0);
  });

  it('lookup onbellek sogukken de calisir', () => {
    const roster = provider();
    const id = roster.squad('1')[3]!.sourceId;

    const fresh = provider();
    const found = fresh.lookup(id);
    expect(found).toBeDefined();
    expect(found!.sourceId).toBe(id);
  });

  it('ayni tohum ayni dunyayi uretir', () => {
    const a = provider(99).squad('2').map((p) => p.displayName);
    const b = provider(99).squad('2').map((p) => p.displayName);
    expect(a).toEqual(b);
  });

  it('ligleri competition tablosundan okur', () => {
    const leagues = provider().leagues();
    expect(leagues).toHaveLength(1);
    expect(leagues[0]!.label).toBe('Premier Division');
    expect(leagues[0]!.relegated).toBe(3);
  });
});
