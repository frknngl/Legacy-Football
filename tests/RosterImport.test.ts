/**
 * Roster & Lisans Araci -- import hattinin kapisi.
 *
 * Uc sey korunuyor:
 *   1. CSV dogru ayristiriliyor  -- tirnakli/virgullu alan sessizce bozulmasin
 *   2. Format VERIDEN cikiyor     -- 2x(N-1) varsayimi gercek ligleri bozmasin
 *   3. Maske KILITLI              -- yeniden import isim ve ID degistirmesin
 *
 * Ucuncusu en kritigi: bir kariyerin 20 sezonluk hatirasi maskeli isme ve
 * stable_id'ye bagli. Bu test kirilirsa kaydedilmis oyunlar anlamini kaybeder.
 */

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterAll } from 'vitest';

import { readCsvAll, CsvError } from '../tools/roster/csv.js';
import { detectFormat, tierFor } from '../tools/roster/pipeline/competitions.js';
import { MaskBinder, phoneticShift, splitClubName, hashString } from '../tools/roster/masking.js';
import { openWorldDb } from '../tools/roster/db.js';
import { runImport } from '../tools/roster/import.js';
import { isYouthOrReserve, cleanClubName, type ImportScope } from '../tools/roster/scope.js';
import {
  deriveAttributes,
  potentialFor,
  softCeiling,
  targetOverall,
  toPosition,
} from '../tools/roster/pipeline/attributes.js';
import {
  cleanPlayerName,
  parseCitizenship,
  splitPlayerName,
} from '../tools/roster/pipeline/players.js';
import { overallFor, POSITIONS } from '../src/domain/actors.js';

const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'roster-'));
  temps.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ CSV

describe('CSV ayristirma', () => {
  it('tirnakli alandaki virgulu AYIRICI saymaz', async () => {
    const dir = tempDir();
    const file = join(dir, 'a.csv');
    writeFileSync(file, 'club_id,club_name,country_name\n1,Gyeongnam FC,"Korea, South"\n', 'utf-8');

    const rows = await readCsvAll(file, { requireColumns: ['club_id', 'country_name'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!['country_name']).toBe('Korea, South');
  });

  it('ikilenen tirnagi tek tirnaga cevirir', async () => {
    const dir = tempDir();
    const file = join(dir, 'b.csv');
    writeFileSync(file, 'a,b\n1,"J1 League - ""Second"" Stage (\'93,\'97)"\n', 'utf-8');

    const rows = await readCsvAll(file, { requireColumns: ['a', 'b'] });
    expect(rows[0]!['b']).toBe('J1 League - "Second" Stage (\'93,\'97)');
  });

  it('CRLF ve BOM ile bozulmaz', async () => {
    const dir = tempDir();
    const file = join(dir, 'c.csv');
    writeFileSync(file, '﻿club_id,name\r\n7,Test\r\n', 'utf-8');

    const rows = await readCsvAll(file, { requireColumns: ['club_id'] });
    expect(rows[0]!['club_id']).toBe('7');
  });

  it('beklenen kolon yoksa IMPORT BASLAMADAN durur', async () => {
    const dir = tempDir();
    const file = join(dir, 'd.csv');
    // Kaynak reposunun README'si guncel degil; kolon adlari degisebilir.
    // Sessizce bos deger uretmektense hemen durmak dogru.
    writeFileSync(file, 'club_id,club_name\n1,X\n', 'utf-8');

    await expect(
      readCsvAll(file, { requireColumns: ['club_id', 'country_name'] }),
    ).rejects.toThrow(CsvError);
  });
});

// ------------------------------------------------------------------ format

describe('format cikarimi', () => {
  it('gercek liglerin mac sayilarini dogru siniflar', () => {
    // Cift devre -- formul tutuyor
    expect(detectFormat(20, Array(20).fill(38)).format).toEqual({
      kind: 'round_robin',
      legs: 2,
      matchesPerClub: 38,
    });
    expect(detectFormat(24, Array(24).fill(46)).format).toEqual({
      kind: 'round_robin',
      legs: 2,
      matchesPerClub: 46,
    });

    // MLS: 30 kulup / 33 mac -- konferans, cift devre DEGIL
    expect(detectFormat(30, Array(30).fill(33)).format.kind).toBe('conference');

    // Torneo Apertura: 30 kulup / 16 mac -- herkes herkesle oynamiyor
    expect(detectFormat(30, Array(30).fill(16)).format.kind).toBe('group_phase');
  });

  it('ayni ligde farkli mac sayisi varsa explicit olur (USL)', () => {
    const counts = [...Array(24).fill(28), 29, 27];
    expect(detectFormat(26, counts).format).toEqual({ kind: 'explicit' });
  });

  it('EKSIK KULUBU formattan ayirir ve kacini eksik oldugunu soyler', () => {
    // Championship: kaynak 22 kulup veriyor ama 46 maclik fikstur 24 ister.
    // Bunu 'conference' diye kaydetmek takvimi yanlis format uzerine kurardi.
    const d = detectFormat(22, Array(22).fill(46));
    expect(d.format.kind).toBe('round_robin');
    expect(d.impliedClubCount).toBe(24);
  });

  it('mac sayisi yoksa explicit', () => {
    expect(detectFormat(18, [0, 0, 0]).format).toEqual({ kind: 'explicit' });
  });
});

describe('kulup basamagi', () => {
  it('2. lig kulubu itibari ne olursa olsun elit olamaz', () => {
    // clubTier icerik kapilama eksenidir; buradan sizan hata Sampiyonlar Ligi
    // sahnesini 2. lig oyuncusuna gosterir.
    expect(tierFor(99, 2)).toBe('mid');
    expect(tierFor(99, 1)).toBe('elite');
    expect(tierFor(99, 3)).toBe('amateur');
  });
});

// ------------------------------------------------------------------ maskeleme

describe('maskeleme', () => {
  it('soyadi fonetik olarak kaydirir ve girdiden FARKLI uretir', () => {
    expect(phoneticShift('Fernandes')).toBe('Fernandos');
    expect(phoneticShift('Sane')).toBe('Sano');
    for (const name of ['Modric', 'Kane', 'Silva', 'Yilmaz', 'Ozil', 'Mbappe', 'Xhaka']) {
      expect(phoneticShift(name)).not.toBe(name);
    }
  });

  it('kulup adini yer + kimlik olarak ayirir', () => {
    expect(splitClubName('Manchester City')).toEqual({ place: 'Manchester', identity: 'City' });
    expect(splitClubName('FC Barcelona')).toEqual({ place: 'Barcelona', identity: 'FC' });
    // Ayirt edilemiyorsa tum ad kimliktir.
    expect(splitClubName('Galatasaray').place).toBeUndefined();
  });

  it('hash deterministik -- ayni ad her calistirmada ayni maskeyi verir', () => {
    expect(hashString('Manchester City')).toBe(hashString('Manchester City'));
    expect(hashString('Manchester City', 1)).not.toBe(hashString('Manchester City', 0));
  });
});

describe('maske KILIDI', () => {
  it('bir kere baglanan ad ve ID bir daha DEGISMEZ', () => {
    const db = openWorldDb(':memory:');
    const binder = new MaskBinder(db);

    const first = binder.resolve('player', 'tm-12345', 'Bruno Fernandes', () => ({
      name: 'Bruno Fernandos',
      strategy: 'phonetic',
    }));
    expect(first.fresh).toBe(true);

    // Ikinci import: strateji TAMAMEN farkli bir ad uretse bile kilit kazanir.
    const second = binder.resolve('player', 'tm-12345', 'Bruno Fernandes', () => ({
      name: 'BAMBASKA BIR AD',
      strategy: 'pool',
    }));

    expect(second.fresh).toBe(false);
    expect(second.name).toBe('Bruno Fernandos');
    expect(second.stableId).toBe(first.stableId);
    db.close();
  });

  it('iki farkli varlik ayni maskeye dusemez', () => {
    // Kaynakta ayni ada sahip farkli kulupler var (Arsenal FC / Arsenal FC Argentina).
    const db = openWorldDb(':memory:');
    const binder = new MaskBinder(db);

    const a = binder.resolve('club', 'tm-11', 'Arsenal FC', () => ({
      name: 'Ayni Ad',
      strategy: 'pool',
    }));
    const b = binder.resolve('club', 'tm-4673', 'Arsenal FC', (salt) => ({
      name: salt === 0 ? 'Ayni Ad' : `Ayni Ad ${salt}`,
      strategy: 'pool',
    }));

    expect(a.name).toBe('Ayni Ad');
    expect(b.name).not.toBe('Ayni Ad');
    expect(b.stableId).not.toBe(a.stableId);
    db.close();
  });

  it('elle kuratorlu esleme algoritmayi ezer', () => {
    const db = openWorldDb(':memory:');
    const binder = new MaskBinder(db, {
      club: { 'Manchester City': 'Manchester Blue' },
      competition: {},
      country: {},
    });

    const r = binder.resolve('club', 'tm-281', 'Manchester City', () => ({
      name: 'Algoritma Adi',
      strategy: 'pool',
    }));
    expect(r.name).toBe('Manchester Blue');
    db.close();
  });
});

// ------------------------------------------------------------------ kapsam

describe('kapsam filtresi', () => {
  it('genc ve rezerv takimlari eler', () => {
    for (const n of ['Napoli Under 18', 'CD Mafra U23', 'Arsenal FC U21', 'Juventus Primavera']) {
      expect(isYouthOrReserve(n)).toBe(true);
    }
    for (const n of ['Manchester City', 'Galatasaray', 'AC Milan']) {
      expect(isYouthOrReserve(n)).toBe(false);
    }
  });

  it('kaynak ID ekini kulup adindan temizler', () => {
    expect(cleanClubName('Galatasaray (141)')).toBe('Galatasaray');
    expect(cleanClubName('Manchester City')).toBe('Manchester City');
  });
});

// ------------------------------------------------------------------ uctan uca

describe('uctan uca import', () => {
  function writeFixture(): { dataDir: string; dbPath: string } {
    const root = tempDir();
    const dataDir = join(root, 'transfermarkt');
    mkdirSync(join(dataDir, 'team_details'), { recursive: true });
    mkdirSync(join(dataDir, 'team_competitions_seasons'), { recursive: true });

    writeFileSync(
      join(dataDir, 'team_details', 'team_details.csv'),
      'club_id,club_name,country_name\n' +
        '1,Alpha FC (1),England\n' +
        '2,Beta United (2),England\n' +
        '3,Gamma Town (3),England\n' +
        '4,Delta City (4),England\n' +
        '9,Alpha FC U21 (9),England\n',
      'utf-8',
    );

    const head =
      'club_id,competition_id,competition_name,season_id,season_league_level_level_number,season_total_matches,season_points,team_name\n';
    const rows = [1, 2, 3, 4]
      .map((id) => `${id},GB1,Premier League,2024,1,6,${10 + id},Club ${id}`)
      .join('\n');
    // Genc takim ayni ligde gorunuyor -- isim filtresi elemeli.
    const youth = '\n9,GB1,Premier League,2024,1,6,11,Alpha U21';

    writeFileSync(
      join(dataDir, 'team_competitions_seasons', 'team_competitions_seasons.csv'),
      head + rows + youth + '\n',
      'utf-8',
    );

    return { dataDir, dbPath: join(root, 'world.db') };
  }

  const scope: ImportScope = {
    countries: ['England'],
    levels: [1],
    sourceSeason: 2024,
    historySeasons: 5,
    leagueWindow: { start: 1, end: 38, slot: 'weekend' },
  };

  it('CSV klasorunden world.db uretir ve genc takimi elemis olur', async () => {
    const { dataDir, dbPath } = writeFixture();
    const { emit } = await runImport({ dataDir, dbPath, scope });

    expect(emit.competitions).toBe(1);
    expect(emit.clubs).toBe(4); // U21 elenmis
    expect(emit.freshMasks).toBeGreaterThan(0);

    const db = openWorldDb(dbPath);
    const comp = db.prepare('SELECT * FROM competition').get() as Record<string, unknown>;
    // 4 kulup, 6 mac -> 2x(4-1) = 6 -> cift devre
    expect(comp['format_kind']).toBe('round_robin');
    expect(comp['legs']).toBe(2);
    expect(comp['matches_per_club']).toBe(6);
    db.close();
  });

  it('YENIDEN import maskeleri korur -- 0 yeni kilit', async () => {
    const { dataDir, dbPath } = writeFixture();

    const first = await runImport({ dataDir, dbPath, scope });
    expect(first.emit.reusedMasks).toBe(0);

    const before = snapshotMasks(dbPath);
    const second = await runImport({ dataDir, dbPath, scope });

    expect(second.emit.freshMasks).toBe(0);
    expect(second.emit.reusedMasks).toBe(first.emit.freshMasks);
    expect(snapshotMasks(dbPath)).toEqual(before);
  });

  it('eksik kulubu HATA olarak raporlar', async () => {
    const root = tempDir();
    const dataDir = join(root, 'transfermarkt');
    mkdirSync(join(dataDir, 'team_details'), { recursive: true });
    mkdirSync(join(dataDir, 'team_competitions_seasons'), { recursive: true });

    writeFileSync(
      join(dataDir, 'team_details', 'team_details.csv'),
      'club_id,club_name,country_name\n1,A (1),England\n2,B (2),England\n3,C (3),England\n',
      'utf-8',
    );
    // 3 kulup okundu ama 6 maclik fikstur 4 kulup ister -> 1 eksik.
    writeFileSync(
      join(dataDir, 'team_competitions_seasons', 'team_competitions_seasons.csv'),
      'club_id,competition_id,competition_name,season_id,season_league_level_level_number,season_total_matches,season_points,team_name\n' +
        '1,GB1,Premier League,2024,1,6,11,A\n' +
        '2,GB1,Premier League,2024,1,6,12,B\n' +
        '3,GB1,Premier League,2024,1,6,13,C\n',
      'utf-8',
    );

    const { log } = await runImport({ dataDir, dbPath: join(root, 'w.db'), scope });
    const errors = log.all().filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('1 kulup EKSIK');
  });
});

function snapshotMasks(dbPath: string): { key: string; id: number; name: string }[] {
  const db = openWorldDb(dbPath);
  const rows = db
    .prepare(
      'SELECT external_key, stable_id, masked_name FROM mask_binding ORDER BY entity_kind, external_key',
    )
    .all() as { external_key: string; stable_id: number; masked_name: string }[];
  db.close();
  return rows.map((r) => ({ key: r.external_key, id: r.stable_id, name: r.masked_name }));
}

// ------------------------------------------------------------------ nitelikler

describe('nitelik turetme', () => {
  it('gerceklesen overall motorun overallFor sonucuyla BIREBIR ayni', () => {
    // Motorun sozlesmesi: quality niteliklerden turer. DB'de baska bir sayi
    // tutmak ikisini sessizce ayristirir ve kadro simulatorun okudugundan
    // farkli bir sey anlatir.
    for (const position of POSITIONS) {
      for (const target of [42, 55, 68, 80, 91, 97]) {
        const { attributes, overall } = deriveAttributes(position, '', target);
        expect(overall).toBe(overallFor(position, attributes));
      }
    }
  });

  it('ust seviyede niteliklerin HEPSI birden tavana yapismaz', () => {
    // Sert kirpma + duzeltme dongusu bunu uretiyordu: Mbappe pac98 sho99 phy99.
    // Boyle bir kadroda simulator mevki farkini okuyamaz.
    const { attributes } = deriveAttributes('FW', 'Attack - Centre-Forward', 96);
    const maxed = Object.values(attributes).filter((v) => v >= 99).length;
    expect(maxed).toBeLessThanOrEqual(1);
    // Santrforun savunmasi yuksek olmamali, gucu ne olursa olsun.
    expect(attributes.defending).toBeLessThan(50);
  });

  it('sikistirma monoton ve 99 tavanini asmaz', () => {
    expect(softCeiling(40)).toBe(40);
    expect(softCeiling(85)).toBe(85);
    let previous = 0;
    for (let v = 0; v <= 400; v += 7) {
      const out = softCeiling(v);
      expect(out).toBeGreaterThanOrEqual(previous);
      expect(out).toBeLessThan(99.001);
      previous = out;
    }
  });

  it('mevki profili niteliklerin NEREYE dagildigini belirler', () => {
    const gk = deriveAttributes('GK', 'Goalkeeper', 85).attributes;
    expect(gk.goalkeeping).toBeGreaterThan(gk.shooting);

    const cb = deriveAttributes('DF', 'Defender - Centre-Back', 80).attributes;
    expect(cb.defending).toBeGreaterThan(cb.shooting);

    const winger = deriveAttributes('FW', 'Attack - Right Winger', 80).attributes;
    expect(winger.pace).toBeGreaterThan(winger.defending);
  });

  it('yas duzeltmesi: genc oyuncunun degeri POTANSIYELI fiyatlar', () => {
    // Ayni piyasa degeri, farkli yas -> 18'lik bugun daha zayif olmali.
    const young = targetOverall(30_000_000, 18);
    const prime = targetOverall(30_000_000, 26);
    const old = targetOverall(30_000_000, 34);
    expect(young).toBeLessThan(prime);
    expect(old).toBeGreaterThan(prime);
    // Ama potansiyeli yuksek.
    expect(potentialFor(young, 18)).toBeGreaterThan(young);
    expect(potentialFor(prime, 26)).toBe(prime);
  });

  it('piyasa degeri logaritmik esleniyor -- 4.000 kat aralik yayiliyor', () => {
    const low = targetOverall(50_000, 26);
    const mid = targetOverall(1_000_000, 26);
    const high = targetOverall(200_000_000, 26);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    // Dogrusal esleme medyani tabana yapistirirdi; log ile ortada durmali.
    expect(mid).toBeGreaterThan(low + 10);
    expect(high).toBeGreaterThan(mid + 20);
  });

  it('boy ayni mevki+degerdeki iki oyuncuyu AYRISTIRIR', () => {
    const short = deriveAttributes('FW', 'Attack - Centre-Forward', 90, 170).attributes;
    const tall = deriveAttributes('FW', 'Attack - Centre-Forward', 90, 195).attributes;
    expect(short.pace).toBeGreaterThan(tall.pace);
    expect(tall.physical).toBeGreaterThan(short.physical);
  });

  it('main_position motorun dort mevkisine eslenir', () => {
    expect(toPosition('Goalkeeper')).toBe('GK');
    expect(toPosition('Defender')).toBe('DF');
    expect(toPosition('Midfield')).toBe('MF');
    expect(toPosition('Attack')).toBe('FW');
    expect(toPosition('')).toBeUndefined();
  });
});

describe('oyuncu adi', () => {
  it('kaynak ID ekini atar', () => {
    expect(cleanPlayerName('Miroslav Klose (10)')).toBe('Miroslav Klose');
  });

  it('soyad eklerini soyadin PARCASI sayar', () => {
    expect(splitPlayerName('Virgil van Dijk')).toEqual({ first: 'Virgil', last: 'van Dijk' });
    expect(splitPlayerName('Bruno Fernandes')).toEqual({ first: 'Bruno', last: 'Fernandes' });
  });

  it('tek kelimelik adi soyad sayar -- maskeleme yine soyada uygulanir', () => {
    expect(splitPlayerName('Rodrygo')).toEqual({ first: '', last: 'Rodrygo' });
  });

  it('cifte vatandasligi ayirir -- milli takim uygunlugunun girdisi', () => {
    expect(parseCitizenship('France  Nigeria')).toEqual(['France', 'Nigeria']);
    expect(parseCitizenship('Germany')).toEqual(['Germany']);
    expect(parseCitizenship('')).toEqual([]);
  });
});
