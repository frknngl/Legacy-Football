/**
 * UCTAN UCA ZINCIR: VAR -> roportaj -> PFDK -> ceza -> geri donus
 *
 * Planin 7. dogrulama adimi. Bu zincir calismazsa motorun geri besleme dongusu
 * (karar -> sonuc -> yeni karar) calismiyor demektir; kalan icerigin anlami yok.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { GameEngine } from '../src/runtime/GameEngine.js';
import { createMockWorld } from '../src/testing/mockWorld.js';
import type { PendingMoment } from '../src/domain/match.js';

let registry: ContentRegistry;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  expect(loaded.registry).toBeDefined();
  registry = loaded.registry!;
});

const VAR_MOMENT: PendingMoment = {
  type: 'var_review_against',
  minute: 71,
  scoreline: '1-1',
  opponent: 'Goztepe',
  importance: 'derby',
};

/** Motoru VAR momenti sunulmus, karari verilmis ve mac bitmis hale getirir. */
function playVarMatch(engine: GameEngine, choiceId: string): void {
  const { decisions } = engine.playMatch({
    context: {
      opponentName: 'Goztepe',
      importance: 'derby',
      isStarter: true,
    },
    pendingMoments: [VAR_MOMENT],
  });
  expect(decisions).toBe(1);

  const node = engine.currentNode();
  expect(node?.eventId).toBe('evt_match_var_against');
  expect(node?.isMoment).toBe(true);

  // SECENEK KIMLIGINE SIKI BAGLANMA.
  //
  // Olay varyantlandi ve her varyantin kendi secenek kimlikleri var
  // (`c_walk` yalnizca `v_asil`de). Motor bir varyant sectiginde sabit
  // kimlik `Gecersiz secim` ile patliyordu -- test icerik buyudukce
  // kirilan bir kimlige bagliydi.
  //
  // Testin GERCEK garantisi bu degil: hangi secenek secilirse secilsin
  // `inc_var_against` acilmali. Bunu `VariantIncidentRule` zaten her
  // varyant icin ZORUNLU kiliyor. Kimlik varsa kullanilir, yoksa ilk
  // acik secenek alinir.
  const wanted = node?.choices.find((c) => c.id === choiceId && !c.locked);
  const fallback = node?.choices.find((c) => !c.locked);
  const picked = wanted ?? fallback;
  expect(picked, 'acik secenek yok').toBeDefined();
  engine.choose(picked!.id);

  // roll / outcome zinciri bitene kadar ilerle.
  let guard = 0;
  while (engine.currentNode() && guard < 10) {
    engine.choose('__continue');
    guard += 1;
  }

  engine.finalizeMatch({ result: 'draw', rating: 6.4, goals: 0, assists: 0, minutes: 90, cards: 1 });
}

/** Belirli bir olay cikana kadar tur ilerletir. */
function advanceUntil(engine: GameEngine, eventId: string, maxTurns: number): number | undefined {
  for (let i = 0; i < maxTurns; i += 1) {
    const report = engine.advanceTurn();
    if (report.presented?.eventId === eventId) return report.turn;
    // Cikan baska bir olay varsa ilk kilitsiz secimle kapat.
    let guard = 0;
    while (engine.currentNode() && guard < 12) {
      const open = engine.availableChoices().find((c) => !c.locked);
      if (!open) break;
      engine.choose(open.id);
      guard += 1;
    }
  }
  return undefined;
}

/**
 * PFDK'yi zamanlayan secenegi ETKISINDEN bulur, kimliginden degil.
 *
 * `evt_react_var_controversy` varyantlandi ve her varyantin kendi
 * secenek kimlikleri var (`c_tff` yalnizca `v_asil`de). Sabit kimlige
 * baglanan test icerik buyudukce kiriliyordu.
 *
 * Testin GERCEK garantisi kimlik degil SOZLESME: bu sahnede PFDK
 * durusmasini kuyruga alan bir yol OLMALI.
 *
 * Sevk iki yerde olabilir ve varyantlar ikisini de kullaniyor:
 *   - secenegin kendi `effects` alaninda      (`v_asil` boyle yapiyor)
 *   - secenegin gittigi sonucun `onEnter`inda (`v_yuzlesme` boyle)
 * Bu yuzden secenegin HEDEFI de taranir.
 */
function findScheduling(engine: GameEngine, eventId: string): string | undefined {
  const node = engine.currentNode();
  if (!node) return undefined;
  const event = registry.get(node.eventId);
  if (!event) return undefined;

  // AKTIF varyantin dugumlerine bak: dugum kimlikleri varyantlar
  // arasinda AYNI olabilir, baska varyanta bakmak yanlis eslesme uretir.
  const nodes =
    node.variantId === undefined
      ? event.nodes
      : event.variants?.find((v) => v.id === node.variantId)?.nodes;
  if (!nodes) return undefined;

  const schedules = (effects: readonly unknown[] | undefined): boolean =>
    (effects ?? []).some(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        (e as { op?: string }).op === 'schedule' &&
        (e as { event?: string }).event === eventId,
    );

  for (const choice of nodes[node.nodeId]?.choices ?? []) {
    const unlocked = node.choices.some((c) => c.id === choice.id && !c.locked);
    if (!unlocked) continue;
    const target = choice.target === undefined ? undefined : nodes[choice.target];
    if (schedules(choice.effects) || schedules(target?.onEnter)) return choice.id;
  }
  return undefined;
}

describe('Zincir: VAR -> PFDK -> ceza', () => {
  it('1. adim: VAR momenti sunulur ve karar skoru etkiler', () => {
    const engine = new GameEngine(registry, { seed: 42 });
    engine.start('street');
    playVarMatch(engine, 'c_walk');

    // Hakeme yurumek sari ya da kirmizi getirir; her iki durumda da
    // inc_var_against acilmis olmali -- roportaj penceresi budur.
    expect(engine.snapshot().flags['inc_var_against']).toBe(true);

    const delta = engine.matchOutcome();
    expect(delta.incidents.length).toBeGreaterThan(0);
    expect(delta.incidents.map((i) => i.flag)).toContain('inc_var_against');
    // Moment baglami metin enterpolasyonu icin yazilmis olmali.
    expect(engine.snapshot().flags['inc_minute']).toBe(71);
    expect(engine.snapshot().flags['inc_opponent']).toBe('Goztepe');
  });

  it('2. adim: inc_var_against roportaj olayini tetikler', () => {
    const engine = new GameEngine(registry, { seed: 7 });
    engine.start('street');
    playVarMatch(engine, 'c_turn');

    const turn = advanceUntil(engine, 'evt_react_var_controversy', 8);
    expect(turn).toBeDefined();

    const node = engine.currentNode();
    expect(node?.eventId).toBe('evt_react_var_controversy');
    // Secenek SAYISI varyanta gore degisir; sabitlemek testi icerige
    // baglar. Yapisal garanti: en az uc secenek ve en az biri acik.
    expect(node?.choices.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(node?.choices.some((c) => !c.locked)).toBe(true);
  });

  it('3. adim: "TFF’ye salla" PFDK’yi GARANTILI olarak kuyruga alir', () => {
    const engine = new GameEngine(registry, { seed: 7 });
    engine.start('street');
    playVarMatch(engine, 'c_turn');
    advanceUntil(engine, 'evt_react_var_controversy', 8);

    const beforeTurn = engine.snapshot().turn;
    const tff = findScheduling(engine, 'evt_legal_pfdk_hearing');
    expect(tff, 'PFDK sevk eden secenek yok').toBeDefined();
    engine.choose(tff!);

    const queued = engine.snapshot().scheduledEvents;
    expect(queued).toHaveLength(1);
    expect(queued[0]?.eventId).toBe('evt_legal_pfdk_hearing');
    expect(queued[0]?.priority).toBe('forced');
    // GECIKME varyanta gore degisir; sabitlemek testi metne baglar.
    // Sozlesme "kac tur sonra" degil: SEVK GARANTILI ve YAKIN olmali --
    // haftalar sonra gelen bir durusma zincirin baglantisini koparir.
    const due = queued[0]?.dueTurn ?? 0;
    expect(due).toBeGreaterThan(beforeTurn);
    expect(due).toBeLessThanOrEqual(beforeTurn + 4);
  });

  it('4. adim: PFDK tam vadesinde ve TAM BIR KEZ calisir', () => {
    const engine = new GameEngine(registry, { seed: 7 });
    engine.start('street');
    playVarMatch(engine, 'c_turn');
    advanceUntil(engine, 'evt_react_var_controversy', 8);
    engine.choose(findScheduling(engine, 'evt_legal_pfdk_hearing') ?? 'c_tff');

    // Olayin sonuc node'unu kapat.
    let guard = 0;
    while (engine.currentNode() && guard < 5) {
      engine.choose('__continue');
      guard += 1;
    }

    // VADE varyanta gore degisir; sabit tur saymak testi metne baglar.
    // Sozlesme: durusma YAKIN bir vadede ve TAM BIR KEZ calisir.
    const due = engine.snapshot().scheduledEvents[0]?.dueTurn ?? 0;
    const fired = advanceUntil(engine, 'evt_legal_pfdk_hearing', 6);
    expect(fired, 'PFDK hic calismadi').toBeDefined();
    expect(fired).toBe(due);
    // Kuyruk bosalmali -- olay iki kez calismamali.
    expect(engine.snapshot().scheduledEvents).toHaveLength(0);
  });

  it('5. adim: "arkasinda dur" 3 mac ceza verir, host oyuncuyu kadroya yazamaz', () => {
    const engine = new GameEngine(registry, { seed: 7 });
    engine.start('street');
    playVarMatch(engine, 'c_turn');
    advanceUntil(engine, 'evt_react_var_controversy', 8);
    engine.choose(findScheduling(engine, 'evt_legal_pfdk_hearing') ?? 'c_tff');
    while (engine.currentNode()) engine.choose('__continue');
    advanceUntil(engine, 'evt_legal_pfdk_hearing', 5);

    expect(engine.currentNode()?.eventId).toBe('evt_legal_pfdk_hearing');
    engine.choose('c_stand');

    expect(engine.snapshot().flags['suspension_matches']).toBe(3);
    expect(engine.snapshot().lifeState).toBe('suspended');

    const availability = engine.availability();
    expect(availability.available).toBe(false);
    expect(availability.matchesRemaining).toBe(3);
  });

  it('6. adim: ceza 3 macta biter ve oyuncu sahaya doner', () => {
    const engine = new GameEngine(registry, { seed: 7 });
    engine.start('street');
    playVarMatch(engine, 'c_turn');
    advanceUntil(engine, 'evt_react_var_controversy', 8);
    engine.choose(findScheduling(engine, 'evt_legal_pfdk_hearing') ?? 'c_tff');
    while (engine.currentNode()) engine.choose('__continue');
    advanceUntil(engine, 'evt_legal_pfdk_hearing', 5);
    engine.choose('c_stand');
    while (engine.currentNode()) engine.choose('__continue');

    // Host kadroya yazmadigi her mac icin cezayi bir azaltir.
    for (let i = 3; i > 0; i -= 1) {
      expect(engine.availability().available).toBe(false);
      engine.finalizeMatch({
        result: 'draw',
        rating: 0,
        goals: 0,
        assists: 0,
        minutes: 0,
        cards: 0,
      });
    }

    expect(engine.snapshot().flags['suspension_matches']).toBe(0);
    expect(engine.availability().available).toBe(true);
    expect(engine.snapshot().lifeState).toBe('playing');
  });

  it('7. adim: cezaliyken HAPISHANE degil ceza havuzu acilir, mac olaylari kapanir', () => {
    const engine = new GameEngine(registry, { seed: 7 });
    engine.start('street');
    playVarMatch(engine, 'c_turn');
    advanceUntil(engine, 'evt_react_var_controversy', 8);
    engine.choose(findScheduling(engine, 'evt_legal_pfdk_hearing') ?? 'c_tff');
    while (engine.currentNode()) engine.choose('__continue');
    advanceUntil(engine, 'evt_legal_pfdk_hearing', 5);
    engine.choose('c_stand');
    while (engine.currentNode()) engine.choose('__continue');

    // Cezali durumda mac kategorisindeki olaylar UYGUN OLMAMALI.
    const found = advanceUntil(engine, 'evt_life_suspended_stands', 10);
    expect(found).toBeDefined();
    expect(engine.snapshot().lifeState).toBe('suspended');
  });

  it('8. adim: KELEBEK GUNLUGU tetigi yazan karara kadar geri izler', () => {
    const engine = new GameEngine(registry, { seed: 7 });
    engine.start('street');
    playVarMatch(engine, 'c_turn');
    const reactionTurn = advanceUntil(engine, 'evt_react_var_controversy', 8);
    expect(reactionTurn).toBeDefined();

    const reasons = engine.explain('evt_react_var_controversy');
    // inc_var_against’i macta yazan karar izlenebilmeli.
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons[0]).toMatch(/Sezon \d+, Hafta \d+/);
  });
});

describe('Mac sozlesmesi: zarif bozulma', () => {
  it('pendingMoments bos gonderilirse moment fazi atlanir, hata olmaz', () => {
    const engine = new GameEngine(registry, { seed: 1 });
    engine.start('academy');

    const result = engine.playMatch({
      context: { opponentName: 'Bolu', importance: 'league', isStarter: true },
      pendingMoments: [],
    });

    expect(result.decisions).toBe(0);
    expect(result.dropped).toHaveLength(0);
    expect(engine.currentNode()).toBeUndefined();

    engine.finalizeMatch({
      result: 'win',
      rating: 7.2,
      goals: 1,
      assists: 0,
      minutes: 90,
      cards: 0,
    });
    expect(engine.snapshot().flags['last_match_result']).toBe('win');
    expect(engine.snapshot().flags['form']).toBe(72);
  });

  it('karsiligi olmayan moment tipi SESSIZCE dusurulur', () => {
    const engine = new GameEngine(registry, { seed: 1 });
    engine.start('academy');

    // 21 moment tipinin hepsinin artik icerigi var; "karsiliksiz an" ancak
    // UYGUNLUK kapisiyla uretilebilir. Ayni tipten iki an: ikincisi ayni olaya
    // dustugu icin dusurulur -- bir mac icinde ayni sahne iki kez oynanmaz.
    const result = engine.playMatch({
      context: { opponentName: 'Bolu', importance: 'league', isStarter: true },
      pendingMoments: [
        { type: 'penalty_for', minute: 20, scoreline: '0-0', opponent: 'Bolu', importance: 'league' },
        { type: 'penalty_for', minute: 75, scoreline: '0-0', opponent: 'Bolu', importance: 'league' },
      ],
    });

    expect(result.decisions).toBe(1);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.minute).toBe(75);
  });
});

describe('Penalti zinciri', () => {
  it('penalti golu MatchOutcomeDelta.goalsDelta olarak host’a doner', () => {
    const engine = new GameEngine(registry, { seed: 3 });
    engine.start('academy');
    // Teknigi yukselterek isabet dalini garantiye yaklastir.
    engine.snapshot().flags['teknik'] = 100;
    engine.snapshot().flags['moral'] = 100;

    engine.playMatch({
      context: { opponentName: 'Sariyer', importance: 'cup_final', isStarter: true },
      pendingMoments: [
        {
          type: 'penalty_for',
          minute: 88,
          scoreline: '1-1',
          opponent: 'Sariyer',
          importance: 'cup_final',
        },
      ],
    });

    expect(engine.currentNode()?.eventId).toBe('evt_match_penalty_for');
    engine.choose('c_take');
    while (engine.currentNode()) engine.choose('__continue');

    const delta = engine.matchOutcome();
    // Ya gol ya kacirma; ikisi de gecerli ama biri MUTLAKA incident yazmali.
    const flags = delta.incidents.map((i) => i.flag);
    expect(
      flags.includes('inc_scored_penalty') || flags.includes('inc_missed_penalty'),
    ).toBe(true);
    if (flags.includes('inc_scored_penalty')) expect(delta.goalsDelta).toBe(1);
  });

  it('metin yer tutuculari doldurulur', async () => {
    // Kimlik katmani ACIK: {actor.*} tokenlerinin de cozuldugunu dogrular.
    const mock = await createMockWorld('content', registry, 5);
    const engine = new GameEngine(registry, { seed: 3, ...mock });
    engine.start('academy');
    engine.snapshot().flags['teknik'] = 100;
    engine.snapshot().flags['moral'] = 100;
    engine.playMatch({
      context: { opponentName: 'Karsiyaka', importance: 'derby', isStarter: true },
      pendingMoments: [
        {
          type: 'penalty_for',
          minute: 63,
          scoreline: '0-1',
          opponent: 'Karsiyaka',
          importance: 'derby',
        },
      ],
    });

    expect(engine.currentNode()?.eventId).toBe('evt_match_penalty_for');
    const text = engine.currentNode()?.text ?? '';
    expect(text).toContain('63');
    expect(text).toContain('Karsiyaka');
    expect(text).toContain('0-1');
    expect(text).not.toContain('{');
  });
});
