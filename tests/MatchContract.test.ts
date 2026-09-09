/**
 * DURAKLAMALI MAC SOZLESMESI.
 *
 * `playMatch` bir sarmalayicidir; asil sozlesme `beginMatch` + `presentMoment`
 * ikilisidir. Simulator maci dakika dakika yururken her kritik anda motoru
 * durdurur, karari alir, SKORU GUNCELLER ve devam eder.
 *
 * Kritik olan: `momentDelta()` yalnizca O ANIN katkisini vermeli. Toplami
 * verirse 30. dakikadaki gol her momentte tekrar sayilir.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { createMockWorld } from '../src/testing/mockWorld.js';
import { FakeMatchHost } from '../src/testing/FakeMatchHost.js';
import type { MatchContext, PendingMoment } from '../src/domain/match.js';

const CONTENT_DIR = fileURLToPath(new URL('../content', import.meta.url));

let registry: ContentRegistry;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource(CONTENT_DIR)).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
});

async function engineFor(seed: number, archetype = 'street'): Promise<GameEngine> {
  const world = await createMockWorld(CONTENT_DIR, registry, seed);
  const engine = new GameEngine(registry, {
    seed,
    roster: world.roster,
    world: world.world,
    worldFeed: world.worldFeed,
  });
  engine.start(archetype as never);
  return engine;
}

const CONTEXT: MatchContext = {
  opponentName: 'Goztepe',
  importance: 'derby',
  isStarter: true,
};

function moment(type: PendingMoment['type'], minute: number, scoreline: string): PendingMoment {
  return { type, minute, scoreline, opponent: 'Goztepe', importance: 'derby' };
}

function momentWithScoreSnapshot(
  type: PendingMoment['type'],
  minute: number,
  scoreline: string,
  snapshots: {
    scorelineBefore: string;
    scorelineProvisional: string;
    scorelineAfter: string;
  },
): PendingMoment {
  return {
    type,
    minute,
    scoreline,
    scorelineBefore: snapshots.scorelineBefore,
    scorelineProvisional: snapshots.scorelineProvisional,
    scorelineAfter: snapshots.scorelineAfter,
    opponent: 'Goztepe',
    importance: 'derby',
  };
}

describe('Duraklamali sozlesme', () => {
  it('beginMatch baglami yazar ve roportaj penceresini kapatir', async () => {
    const engine = await engineFor(4);
    engine.snapshot().flags['inc_missed_penalty'] = true;

    engine.beginMatch(CONTEXT);

    expect(engine.snapshot().flags['opponent_name']).toBe('Goztepe');
    expect(engine.snapshot().flags['match_importance']).toBe('derby');
    // Onceki macin incident'i yeni macta TASINMAZ.
    expect(engine.snapshot().flags['inc_missed_penalty']).toBe(false);
    expect(engine.currentNode()).toBeUndefined();
  });

  it('opsiyonel baglam verilmezse onceki mac degeri tasinmaz', async () => {
    const engine = await engineFor(4);
    engine.beginMatch({
      ...CONTEXT,
      teamLeaguePosition: 2,
      unbeatenStreak: 7,
      scorelessStreak: 3,
      seasonGoals: 11,
      seasonAssists: 5,
      seasonApps: 17,
    });

    engine.beginMatch({ ...CONTEXT, isStarter: false });

    expect(engine.snapshot().flags['team_league_position']).toBe(10);
    expect(engine.snapshot().flags['unbeaten_streak']).toBe(0);
    expect(engine.snapshot().flags['scoreless_streak']).toBe(0);
    expect(engine.snapshot().flags['season_goals']).toBe(0);
    expect(engine.snapshot().flags['season_assists']).toBe(0);
    expect(engine.snapshot().flags['season_apps']).toBe(0);
    expect(engine.snapshot().flags['is_starter']).toBe(false);
  });

  it('presentMoment tek ani sunar ve motoru orada durdurur', async () => {
    const engine = await engineFor(4);
    engine.beginMatch(CONTEXT);

    const decision = engine.presentMoment(moment('penalty_for', 63, '0-1'));
    expect(decision).toBeDefined();
    expect(decision!.moment.minute).toBe(63);

    const node = engine.currentNode();
    expect(node?.isMoment).toBe(true);
    // Yer tutucular O ANIN baglamiyla dolar.
    expect(node!.text).toContain('63');
    expect(node!.text).toContain('Goztepe');
    expect(node!.text).not.toContain('{');
  });

  it('moment score snapshot baglamini flaglere yazar', async () => {
    const engine = await engineFor(4);
    engine.beginMatch(CONTEXT);

    engine.presentMoment(
      momentWithScoreSnapshot('var_review_against', 63, '1-1', {
        scorelineBefore: '1-1',
        scorelineProvisional: '2-1',
        scorelineAfter: '1-1',
      }),
    );

    const flags = engine.snapshot().flags;
    expect(flags['inc_scoreline']).toBe('1-1');
    expect(flags['inc_scoreline_before']).toBe('1-1');
    expect(flags['inc_scoreline_provisional']).toBe('2-1');
    expect(flags['inc_scoreline_after']).toBe('1-1');
  });

  it('VAR iptal metni provisional skoru kullanir', async () => {
    const engine = await engineFor(4);
    engine.beginMatch(CONTEXT);

    const decision = engine.presentMoment(
      momentWithScoreSnapshot('var_review_against', 71, '1-1', {
        scorelineBefore: '1-1',
        scorelineProvisional: '2-1',
        scorelineAfter: '1-1',
      }),
    );
    expect(decision).toBeDefined();

    const node = engine.currentNode();
    expect(node?.eventId).toBe('evt_match_var_against');
    expect(node?.text).toContain('Skor 2-1 olacaktı.');
  });

  it('karsiligi olmayan moment undefined doner, motor durmaz', async () => {
    const engine = await engineFor(4);
    engine.beginMatch(CONTEXT);

    // Ayni tipteki ikinci an: olay kendi cooldown'unda oldugu icin uygun degil.
    // Artik 21 moment tipinin hepsinin icerigi var, bu yuzden "karsiliksiz an"
    // durumu ancak UYGUNLUK kapisiyla uretilebilir -- gercek hayatta da boyle
    // olur: icerik vardir ama o an cikamaz.
    expect(engine.presentMoment(moment('penalty_for', 20, '0-0'))).toBeDefined();
    engine.choose('c_take');
    while (engine.currentNode()) engine.choose('__continue');

    expect(engine.presentMoment(moment('penalty_for', 70, '1-0'))).toBeUndefined();
    expect(engine.currentNode()).toBeUndefined();
  });

  it('acik moment varken ikinci moment sunulamaz', async () => {
    const engine = await engineFor(4);
    engine.beginMatch(CONTEXT);
    engine.presentMoment(moment('penalty_for', 20, '0-0'));
    expect(() => engine.presentMoment(moment('one_on_one', 30, '0-0'))).toThrow(
      /Onceki mac ani/,
    );
  });

  it('momentDelta YALNIZCA o anin katkisini verir', async () => {
    const engine = await engineFor(4);
    engine.snapshot().flags['teknik'] = 100;
    engine.snapshot().flags['moral'] = 100;
    engine.beginMatch(CONTEXT);

    // SECENEK ID'SI SABIT YAZILMAZ.
    //
    // Bu test eskiden 'c_take' ve 'c_pass' id'lerini sabit yaziyordu ve
    // ikisi de yalnizca `v_asil` varyantinda vardi. Olaya ikinci bir
    // varyant eklenir eklenmez motor onu secti ve test "Gecersiz secim"
    // ile patladi. Oysa testin olctugu sey secenek DEGIL, momentDelta'nin
    // yalnizca o anin katkisini vermesi. Sunulan ilk acik secenegi almak
    // hem niyeti korur hem varyant eklendikce kirilmaz.
    const firstOpen = (): string => {
      const open = engine.availableChoices().find((c) => !c.locked);
      if (!open) throw new Error('acik secenek yok');
      return open.id;
    };

    engine.presentMoment(moment('penalty_for', 20, '0-0'));
    engine.choose(firstOpen());
    while (engine.currentNode()) engine.choose('__continue');
    const first = engine.momentDelta();
    const totalAfterFirst = engine.matchOutcome();

    engine.presentMoment(moment('one_on_one', 70, '1-0'));
    engine.choose(firstOpen());
    while (engine.currentNode()) engine.choose('__continue');
    const second = engine.momentDelta();

    // Ikinci moment birinciyi TEKRAR saymamali.
    expect(second.goals).toBe(engine.matchOutcome().goalsDelta - totalAfterFirst.goalsDelta);
    expect(second.incidents.every((i) => !first.incidents.includes(i))).toBe(true);
    // Toplam yine de biriker.
    expect(engine.matchOutcome().incidents.length).toBe(
      first.incidents.length + second.incidents.length,
    );
  });

  it('momentResolution an kapaninca uretilir', async () => {
    const engine = await engineFor(4);
    engine.beginMatch(CONTEXT);
    expect(engine.momentResolution()).toBeUndefined();

    engine.presentMoment(moment('penalty_for', 88, '1-1'));
    engine.choose('c_take');
    while (engine.currentNode()) engine.choose('__continue');

    const resolution = engine.momentResolution();
    expect(resolution).toBeDefined();
    expect(resolution!.eventId).toBe('evt_match_penalty_for');
    expect(resolution!.moment.minute).toBe(88);
    expect(resolution!.choiceId).toBe('__continue');
    expect(resolution!.outcomeNodeId).not.toBe('');
  });
});

describe('playMatch sarmalayicisi korunur', () => {
  it('duraklayamayan host icin tum anlari kuyruga alir', async () => {
    const engine = await engineFor(4);
    const { decisions } = engine.playMatch({
      context: CONTEXT,
      pendingMoments: [moment('penalty_for', 20, '0-0'), moment('one_on_one', 70, '1-0')],
    });
    expect(decisions).toBe(2);

    // Ilk an acik; kapatilinca ikincisi OTOMATIK gelir.
    expect(engine.currentNode()?.eventId).toBe('evt_match_penalty_for');
    engine.choose('c_take');
    while (engine.currentNode()?.eventId === 'evt_match_penalty_for') engine.choose('__continue');
    expect(engine.currentNode()?.eventId).toBe('evt_match_one_on_one');
  });

  it('bos moment listesi moment fazini atlar', async () => {
    const engine = await engineFor(4);
    const result = engine.playMatch({ context: CONTEXT, pendingMoments: [] });
    expect(result.decisions).toBe(0);
    expect(engine.currentNode()).toBeUndefined();
  });
});

describe('MatchHost portu', () => {
  it('FakeMatchHost portu doldurur ve cezaliyken mac uretmez', async () => {
    const engine = await engineFor(9);
    const host = new FakeMatchHost(9, engine.opponentPool());

    const built = host.buildMatch({
      availability: { available: false, reason: 'PFDK cezasi', matchesRemaining: 2 },
      season: 1,
      week: 3,
      heroClubId: engine.snapshot().clubId,
      hero: engine.heroProfile(),
    });
    expect(built).toBeUndefined();
  });

  it('heroProfile motor flag`lerini sizdirmaz, ozet gecer', async () => {
    const engine = await engineFor(9, 'academy');
    const hero = engine.heroProfile();

    expect(hero.position).toBe('MF');
    expect(hero.stature).toBe(engine.snapshot().stature);
    for (const value of [hero.technical, hero.physical, hero.form, hero.stamina, hero.morale]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    // Ozet, motorun flag sozlugunden hicbir hikaye izi tasimamali.
    expect(Object.keys(hero)).toEqual([
      'position',
      'technical',
      'physical',
      'form',
      'stamina',
      'stature',
      'morale',
      'isCaptain',
    ]);
  });

  it('her arketip OYNANABILIR bir mevkiyle baslar', async () => {
    // Arketipin `startPosition` degeri bir DILEK, garanti degil: ilk surumde
    // GK/DF kilitli oldugu icin (release.json) immigrant ve latebloom DF
    // yerine MF'te basliyor. Test edilmesi gereken sey arketipin ne
    // istedigi degil, oyuncunun oynayabilecegi bir mevkide baslamasi.
    const playable = registry.config.release.playablePositions;
    for (const def of registry.config.archetypes) {
      const engine = await engineFor(3, def.id);
      const position = engine.snapshot().flags['position'];
      expect(playable).toContain(position);
      expect(engine.heroProfile().position).toBe(position);
    }
  });
});
