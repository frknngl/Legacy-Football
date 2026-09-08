/**
 * RITIM ve TON -- oyun testinde bulunan uc kusurun kapisi.
 *
 * Kullanici 16 yasindaki bir sokak cocugunu oynadi ve sunlari gordu:
 *   1. 7 haftada 4 soyunma odasi sahnesi -- ayni TON ust uste
 *   2. "takimin en kidemli oyuncusu" diye tarif edildigi bir sahne
 *   3. "senin eski kaptanlik bandin" denen bir sahne
 *   4. Kaptanla esit konusup ona prim teklif ettigi secenekler
 *
 * Uygunluk filtresi DOGRU calisiyordu; hata icerigin kapilamasinda ve
 * soguma modelinde eksik olan ucuncu seviyedeydi.
 */

import { describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { CooldownTracker } from '../src/selection/CooldownTracker.js';
import { SeniorVoiceRule } from '../src/validation/rules/voice.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import type { StoryEvent } from '../src/domain/story.js';

let cached: ContentRegistry | undefined;
async function registry(): Promise<ContentRegistry> {
  if (!cached) {
    const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
    cached = loaded.registry!;
  }
  return cached;
}

function event(id: string, reg: ContentRegistry): StoryEvent {
  const found = reg.events.find((e) => e.id === id);
  if (!found) throw new Error(`Olay yok: ${id}`);
  return found;
}

// ------------------------------------------------------------------ ritim

describe('kategori ritmi', () => {
  it('cadence.json yuklenir ve locker sogur', async () => {
    const reg = await registry();
    expect(reg.config.cadence.categories['locker']).toBeGreaterThan(0);
    // Mac ve tepki BILEREK sogumaz: ikisi de macin kendisine bagli.
    expect(reg.config.cadence.categories['match']).toBe(0);
    expect(reg.config.cadence.categories['reaction']).toBe(0);
  });

  it('ayni kategoriden ikinci olay soguma bitene kadar BLOKLU', async () => {
    const reg = await registry();
    const tracker = new CooldownTracker(reg.config.cadence);
    const window = tracker.categoryCooldown('locker');

    // Ayni kategoriden AMA farkli aileden iki olay: eski modelde ikisi de
    // ust uste cikabiliyordu, aile sogumasi birbirini gormedigi icin.
    const first = event('evt_locker_captain_yuzlesme', reg);
    const second = event('evt_locker_manager_reddedilis', reg);
    expect(first.family).not.toBe(second.family);

    const state = { cooldowns: {}, familyCooldowns: {}, categoryCooldowns: {} };
    tracker.mark(first, 10, state);

    expect(tracker.blockedBy(second, 10 + window - 1, state, {})).toBe('category');
    expect(tracker.blockedBy(second, 10 + window, state, {})).toBeUndefined();
  });

  it('soguma tablosu bos ise kategori kapisi KAPALI -- zarif bozulma', async () => {
    const reg = await registry();
    const tracker = new CooldownTracker(); // varsayilan: soguma yok
    const e = event('evt_locker_captain_yuzlesme', reg);
    const state = { cooldowns: {}, familyCooldowns: {}, categoryCooldowns: {} };
    tracker.mark(e, 10, state);

    const other = event('evt_locker_manager_reddedilis', reg);
    expect(tracker.blockedBy(other, 11, state, {})).toBeUndefined();
  });

  it('ESKI kayitlarda categoryCooldowns yoksa cokmez', async () => {
    const reg = await registry();
    const tracker = new CooldownTracker(reg.config.cadence);
    const e = event('evt_locker_captain_yuzlesme', reg);
    // Alan hic yok -- eski bir save.
    expect(tracker.blockedBy(e, 5, { cooldowns: {}, familyCooldowns: {} }, {})).toBeUndefined();
  });
});

// ------------------------------------------------------------------ ton

describe('sahne tonu', () => {
  it('KIDEMLI agizli sahneler caylaga kapali', async () => {
    const reg = await registry();

    // "takimin en kidemli oyuncusu" ve "senin eski kaptanlik bandin":
    // bunlar STATURE degil ERA sorunu -- 16 yasinda ilk 11'e girsen de
    // kadronun en kidemlisi ya da ESKI KAPTAN olamazsin.
    for (const id of ['evt_locker_keeper_taninma', 'evt_locker_youngster_reddedilis']) {
      const e = event(id, reg);
      expect(e.eras, id).toBeDefined();
      expect(e.eras, id).not.toContain('rookie');
      expect(e.stature, id).toBeDefined();
      expect(e.stature, id).not.toContain('nobody');
    }

    // Kaptanla esit konusma / yildizin sirdasi olma: sohret kapisi yeterli.
    for (const id of ['evt_locker_captain_yuzlesme', 'evt_locker_star_teammate_golge']) {
      const e = event(id, reg);
      expect(e.stature, id).toBeDefined();
      expect(e.stature, id).not.toContain('nobody');
      expect(e.stature, id).not.toContain('local_talent');
    }
  });

  it('SeniorVoiceRule mevcut icerikte temiz', async () => {
    const reg = await registry();
    const findings = SeniorVoiceRule.check({ registry: reg, events: reg.events });
    expect(findings.map((f) => f.file)).toEqual([]);
  });

  it('SeniorVoiceRule yeni bir ihlali YAKALAR', async () => {
    // Kural nobetci: 0 bulgu "kural calismiyor" demek olmasin diye sentetik
    // bir ihlalle dogruluyoruz.
    const reg = await registry();
    const bad = {
      ...event('evt_locker_captain_yuzlesme', reg),
      id: 'evt_test_bad',
      stature: undefined,
      eras: ['rookie'],
      nodes: {
        n_root: {
          id: 'n_root',
          title: 'Test',
          kind: 'branch',
          text: 'Sen takimin en kidemli oyuncususun.',
          choices: [],
        },
      },
      variants: undefined,
      rootNode: 'n_root',
    } as unknown as StoryEvent;

    const findings = SeniorVoiceRule.check({ registry: reg, events: [bad] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('kidemli');
  });
});

// ------------------------------------------------------------------ baslangic

describe('kariyer basi secimleri', () => {
  it('mevki SECILEBILIR -- arketip yalnizca varsayilani verir', async () => {
    const reg = await registry();

    const def = new GameEngine(reg, { seed: 1 });
    def.start('street');
    expect(def.snapshot().flags['position']).toBe('FW'); // arketipin dogali

    const chosen = new GameEngine(reg, { seed: 1 });
    chosen.start('street', { position: 'FW' });
    expect(chosen.snapshot().flags['position']).toBe('FW');

    // KILITLI MEVKI SESSIZCE DUSER, patlamaz.
    //
    // Ilk surumde GK/DF kapali (release.json). Secim yine de gelebilir --
    // eski kayittan, testten, ileride UI'dan. Motor onu en yakin acik
    // mevkiye cevirir; hata firlatmak kayit yuklemeyi kirardi.
    const locked = new GameEngine(reg, { seed: 5 });
    locked.start('street', { position: 'GK' });
    expect(locked.snapshot().flags['position']).toBe('MF');
  });

  it('secim verilmezse eski davranis korunur', async () => {
    const reg = await registry();
    const a = new GameEngine(reg, { seed: 7 });
    const b = new GameEngine(reg, { seed: 7 });
    a.start('academy');
    b.start('academy', {});
    expect(a.snapshot().flags['position']).toBe(b.snapshot().flags['position']);
  });

  it('gecersiz kulup secimi tohumlu secime DUSER -- cokmez', async () => {
    const reg = await registry();
    const e = new GameEngine(reg, { seed: 3 });
    e.start('street', { clubId: 'olmayan_kulup' });
    // Roster yoksa clubId zaten bos kalir; onemli olan cokmemesi.
    expect(e.snapshot().archetype).toBe('street');
  });
});
