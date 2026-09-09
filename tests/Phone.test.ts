/**
 * TELEFON MODELI.
 *
 * TASARIM KARARI (denetimden): telefon once VERI olarak insa edilir,
 * gorsel sonra. Motorun kurucu ilkesi UI-bagimsizlik; 3D bir telefon ise
 * bir render problemidir. Sira tersine cevrilirse (once 3D) motorun
 * icine gorsel varsayimlar sizar ve proje geri donulemez sekilde bir UI
 * projesine doner.
 *
 * Bu test modelin GORSELDEN BAGIMSIZ oldugunu ve kariyerin kendi
 * verisinden TURETILDIGINI korur. Model yeni bir durum alani
 * tasimiyor -- yani kayit gocu gerektirmiyor ve gunun birinde gercekle
 * celisemiyor.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { followerDrift, followerTarget } from '../src/domain/phone.js';
import { createMockWorld, type MockWorld } from '../src/testing/mockWorld.js';

let registry: ContentRegistry;
let mock: MockWorld;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
  mock = await createMockWorld('content', registry, 61);
});

function started(seed = 61): GameEngine {
  const engine = new GameEngine(registry, { seed, ...mock });
  engine.start('street');
  return engine;
}

describe('Takipci sayisi', () => {
  it('sohretin YANSIMASI -- kendiliginden buyuyen sayac degil', () => {
    expect(followerTarget(1, 60, 90)).toBeGreaterThan(followerTarget(0, 60, 90));
  });

  it('temiz medya itibari takipci getiriyor', () => {
    expect(followerTarget(0.5, 90, 50)).toBeGreaterThan(followerTarget(0.5, 10, 50));
  });

  it('cirak ile efsane arasinda buyuk mertebe farki var', () => {
    const rookie = followerTarget(0, 20, 40);
    const legend = followerTarget(1, 70, 95);
    expect(legend / rookie).toBeGreaterThan(50);
  });

  it('kayma ANI degil -- takipci ziplamaz', () => {
    const drift = followerDrift(10_000, 1_000_000);
    expect(drift).toBeGreaterThan(0);
    expect(drift).toBeLessThan(1_000_000 - 10_000);
  });

  it('hedefteyken kaymiyor', () => {
    expect(followerDrift(500_000, 500_000)).toBe(0);
  });
});

describe('Model kurulumu', () => {
  it('kariyer basinda bile GECERLI bir model doner', () => {
    const phone = started().phone();
    expect(Array.isArray(phone.feed)).toBe(true);
    expect(Array.isArray(phone.threads)).toBe(true);
    expect(Array.isArray(phone.notifications)).toBe(true);
    expect(phone.followers).toBeGreaterThanOrEqual(0);
  });

  it('mesaj basliklari SAHNEDEKI kisilerden geliyor', () => {
    const engine = started();
    const phone = engine.phone();
    const cast = Object.keys(engine.snapshot().casting);
    expect(phone.threads.length).toBeGreaterThan(0);
    for (const thread of phone.threads) {
      expect(cast).toContain(thread.slotId);
      // Isim prosedureldir; bos olmamali.
      expect(thread.name.length).toBeGreaterThan(1);
    }
  });

  it('AKIS mac reytinglerinden TURUYOR -- ayri bir gercek uretmiyor', () => {
    const engine = started();
    const state = engine.snapshot() as { ratingHistory: number[] };
    state.ratingHistory = [8.4, 8.1, 7.9];

    const phone = engine.phone();
    const positive = phone.feed.filter((f) => f.tone === 'olumlu');
    expect(positive.length).toBeGreaterThan(0);

    state.ratingHistory = [4.2, 4.8, 5.1];
    const bad = engine.phone().feed.filter((f) => f.tone === 'olumsuz');
    expect(bad.length).toBeGreaterThan(0);
  });

  it('yuksek medya baskisi AKISA dusuyor', () => {
    const engine = started();
    engine.snapshot().flags['medya_baskisi'] = 95;
    const items = engine.phone().feed.filter((f) => f.source === 'basin');
    expect(items.length).toBeGreaterThan(0);
  });

  it('acik kredi BILDIRIM olarak gorunuyor', () => {
    const engine = started();
    engine.advanceTurn();
    const offer = engine.loanOffers()[0];
    if (offer === undefined) return;
    engine.takeLoan(offer);

    const notices = engine.phone().notifications;
    expect(notices.some((n) => n.id === 'kredi')).toBe(true);
  });

  it('ceza BILDIRIM olarak gorunuyor ve ACIL', () => {
    const engine = started();
    (engine.snapshot() as { availability: { available: boolean; matchesRemaining: number } }).availability = { available: false, matchesRemaining: 3 };
    const notice = engine.phone().notifications.find((n) => n.id === 'ceza');
    expect(notice?.urgent).toBe(true);
  });

  it('akis SINIRLI -- telefon bir arsiv degil', () => {
    const engine = started();
    (engine.snapshot() as { ratingHistory: number[] }).ratingHistory = [6, 6, 6, 6, 6, 6, 6, 6, 6, 6];
    expect(engine.phone().feed.length).toBeLessThanOrEqual(12);
  });
});

describe('UI bagimsizligi', () => {
  it('model SADE veri -- fonksiyon, sinif ya da DOM tasimiyor', () => {
    const phone = started().phone();
    // JSON'a cevrilebiliyorsa hicbir gorsel varsayim tasimiyor demektir:
    // terminal, web ve 3D ayni ciktiyi okuyabilir.
    const round = JSON.parse(JSON.stringify(phone)) as typeof phone;
    expect(round.feed.length).toBe(phone.feed.length);
    expect(round.threads.length).toBe(phone.threads.length);
    expect(round.followers).toBe(phone.followers);
  });

  it('model TURETILMIS -- `GameState`e yeni alan girmemis', () => {
    const engine = started();
    const before = JSON.stringify(engine.snapshot());
    engine.phone();
    // Modeli kurmak durumu DEGISTIRMEMELI; depolanmis olsaydi degistirirdi.
    expect(JSON.stringify(engine.snapshot())).toBe(before);
  });
});
