/**
 * UCTAN UCA ZINCIR: sike -> sorusturma -> hukum -> hapis -> tahliye -> geri donus
 *
 * Planin 8. dogrulama adimi ve oyunun en degerli anlatisi. Kritik olan sadece
 * zincirin akmasi degil: HAPISTEYKEN mac ve medya olaylarinin CIKMAMASI.
 * Hayat durumu makinesi calismiyorsa oyuncu hucrede penalti kullanir.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import type { ScheduledEvent } from '../src/domain/state.js';

let registry: ContentRegistry;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
});

function scheduled(eventId: string, dueTurn: number): ScheduledEvent {
  return {
    eventId,
    dueTurn,
    priority: 'forced',
    onIneligible: 'fire',
    maxDeferTurns: 40,
    sourceEventId: 'test',
    sourceTurn: 1,
    deferredTurns: 0,
  };
}

/** Sike kabul edilmis bir kariyer kurup sorusturmayi vadesine koyar. */
function primedEngine(seed: number): GameEngine {
  const engine = new GameEngine(registry, { seed });
  engine.start('street');
  const state = engine.snapshot();
  state.flags['mem_accepted_fixing'] = true;
  state.flagSetTurn['mem_accepted_fixing'] = 1;
  state.scheduledEvents.push(scheduled('evt_legal_betting_investigation', 2));
  return engine;
}

function closeOpenNodes(engine: GameEngine, limit = 20): void {
  let guard = 0;
  while (engine.currentNode() && guard < limit) {
    const open = engine.availableChoices().find((c) => !c.locked);
    if (!open) break;
    engine.choose(open.id);
    guard += 1;
  }
}

/** Hukum cikana kadar tohum deneyerek mahkumiyet dalini yakalar. */
function convictedEngine(): GameEngine {
  for (let seed = 1; seed < 60; seed += 1) {
    const engine = primedEngine(seed);
    engine.advanceTurn();
    if (engine.currentNode()?.eventId !== 'evt_legal_betting_investigation') continue;
    engine.choose('c_deny');
    closeOpenNodes(engine);
    if (engine.snapshot().lifeState === 'incarcerated') return engine;
  }
  throw new Error('Hicbir tohumda mahkumiyet dali cikmadi -- roll agirliklari bozulmus olabilir.');
}

describe('Zincir: sike -> hapis -> geri donus', () => {
  it('1. adim: zamanlanmis sorusturma tam vadesinde calisir', () => {
    const engine = primedEngine(11);
    const report = engine.advanceTurn();
    expect(report.presented?.eventId).toBe('evt_legal_betting_investigation');
    expect(report.presented?.choices.length).toBe(4);
  });

  it('2. adim: mahkumiyet lifeState`i incarcerated yapar ve kariyeri durdurur', () => {
    const engine = convictedEngine();
    const state = engine.snapshot();
    expect(state.lifeState).toBe('incarcerated');
    expect(state.flags['mem_was_incarcerated']).toBe(true);
    expect(state.flags['sentence_weeks']).toBe(80);
    expect(state.flags['piyasa_degeri']).toBe(0);
    expect(engine.availability().available).toBe(false);
  });

  it('3. adim: HAPISTEYKEN yalnizca hapishane havuzu acilir', () => {
    const engine = convictedEngine();
    const categories = new Set<string>();

    for (let i = 0; i < 25; i += 1) {
      const report = engine.advanceTurn();
      if (report.presented) categories.add(report.presented.category);
      closeOpenNodes(engine);
    }

    // Mac, roportaj ve medya olaylari KAPALI olmali.
    expect(categories.has('match')).toBe(false);
    expect(categories.has('reaction')).toBe(false);
    // Hapishane havuzu BOS olmamali -- oyuncu 80 hafta boslukta kalamaz.
    expect(categories.has('life')).toBe(true);
  });

  it('4. adim: hukum bitince tahliye olayi cikar', () => {
    const engine = convictedEngine();
    engine.snapshot().flags['sentence_weeks'] = 0;

    let found = false;
    for (let i = 0; i < 15; i += 1) {
      const report = engine.advanceTurn();
      if (report.presented?.eventId === 'evt_life_prison_release') {
        found = true;
        break;
      }
      closeOpenNodes(engine);
    }
    expect(found).toBe(true);
  });

  it('5. adim: tahliye amator ligden geri donus arkini acar', () => {
    const engine = convictedEngine();
    engine.snapshot().flags['sentence_weeks'] = 0;

    for (let i = 0; i < 15; i += 1) {
      const report = engine.advanceTurn();
      if (report.presented?.eventId === 'evt_life_prison_release') {
        engine.choose('c_climb');
        closeOpenNodes(engine);
        break;
      }
      closeOpenNodes(engine);
    }

    const state = engine.snapshot();
    expect(state.lifeState).toBe('playing');
    // club_tier turetilmis bir degerdir; icerik ona ancak clubTier EFEKTIYLE
    // dokunabilir. Bu gecisin gerceklesmesi o sozlesmenin calistigini kanitlar.
    expect(state.clubTier).toBe('amateur');
    expect(state.flags['club_tier']).toBe('amateur');
    expect(engine.availability().available).toBe(true);
    expect(state.flags['haftalik_gelir']).toBe(4000);
  });

  it('6. adim: tahliye sonrasi sohret dibe vurur', () => {
    const engine = convictedEngine();
    engine.snapshot().flags['sentence_weeks'] = 0;
    for (let i = 0; i < 15; i += 1) {
      const report = engine.advanceTurn();
      if (report.presented?.eventId === 'evt_life_prison_release') {
        engine.choose('c_climb');
        closeOpenNodes(engine);
        break;
      }
      closeOpenNodes(engine);
    }
    // Tahliye olmus bir mahkum "yildiz" olarak kalamaz: sohret dibe vurmali.
    //
    // Tam olarak `nobody` BEKLENMEZ. Tahliyeden sonra oyuncu yeniden oynuyor
    // ve `evt_life_prison_release`in kendisi +25 taraftar destegi veriyor;
    // esik 60'ta oldugu icin bu on tur, korpus her buyudugunde kilpayi bir
    // yanina dusen bir sinav olur. Zemin katin ULASILABILIR oldugu ayri bir
    // yerde kanitlaniyor (StatureCalculator: local_talent -> nobody).
    // Burada kanitlanmasi gereken sey zincirin sohreti COKERTTIGI.
    for (let i = 0; i < 10; i += 1) {
      engine.advanceTurn();
      closeOpenNodes(engine);
    }
    expect(['nobody', 'local_talent']).toContain(engine.snapshot().stature);
  });
});

describe('LifeStateMachine sinirlari', () => {
  it('retired MUTLAK sondur -- hicbir duruma geri donulmez', async () => {
    const { LifeStateMachine } = await import('../src/runtime/LifeStateMachine.js');
    const machine = new LifeStateMachine();
    for (const to of ['playing', 'injured', 'loaned', 'national_duty'] as const) {
      expect(machine.canTransition('retired', to)).toBe(false);
    }
  });

  it('hapisten dogrudan sahaya donulebilir ama milli takima gidilemez', async () => {
    const { LifeStateMachine } = await import('../src/runtime/LifeStateMachine.js');
    const machine = new LifeStateMachine(registry.config.lifeStates);
    expect(machine.canTransition('incarcerated', 'playing')).toBe(true);
    expect(machine.canTransition('incarcerated', 'national_duty')).toBe(false);
  });

  it('hapiste mac ve medya kategorileri KAPALI, sahada hepsi acik', async () => {
    const { LifeStateMachine } = await import('../src/runtime/LifeStateMachine.js');
    const machine = new LifeStateMachine(registry.config.lifeStates);
    expect(machine.isCategoryOpen('incarcerated', 'match')).toBe(false);
    expect(machine.isCategoryOpen('incarcerated', 'reaction')).toBe(false);
    expect(machine.isCategoryOpen('incarcerated', 'life')).toBe(true);
    expect(machine.isCategoryOpen('playing', 'match')).toBe(true);
    expect(machine.canPlay('incarcerated')).toBe(false);
    expect(machine.canPlay('playing')).toBe(true);
  });
});
