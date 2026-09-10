/**
 * ORTAK MAC DONGUSU.
 *
 * Uc CLI (`demo`, `play`, `simulate`) bugune kadar ayni bes adimi kendi
 * icinde kopyaliyordu: mac kur, anlari sun, karari al, deltayi host'a ver,
 * sonucu motora bildir. Kopyalar birbirinden ufak farklarla ayrilmisti --
 * `simulate` moment kontrolunu atliyor, `demo` sonuc node'unu iki kez
 * basiyordu. Tek dongu bu tur sapmalari imkansiz kilar.
 *
 * KATMAN: `cli` motoru ve host portunu birbirine baglar. Motor host'u,
 * host motoru bilmez.
 */

import {
  emptyMomentDelta,
  type HostMatch,
  type MatchHost,
  type MatchOutcomeDelta,
  type MatchResultReport,
  type MomentDelta,
  type PendingMoment,
  type PlayerAvailability,
} from '../domain/match.js';
import type { GameEngine, PresentedNode, TurnReport } from '../runtime/GameEngine.js';

/** O hafta ilgili slotta fikstur yok: motor bunu ayri bir sonuc olarak gorur. */
const NO_FIXTURE_RESULT: MatchResultReport = {
  result: 'none',
  rating: 0,
  goals: 0,
  assists: 0,
  minutes: 0,
  cards: 0,
};

/**
 * Maci gozlemleyen ve karar veren yuzey.
 *
 * `demo` rastgele secer ve anlatiyi basar, `play` oyuncuya sorar, `simulate`
 * sessizce rastgele secer. Ucu de yalnizca bu arayuzu doldurur.
 */
export interface MatchUi {
  /** Motorda oyuncuya gosterilen dugum. Olcum araclari bunu dinler. */
  onPresented?(node: PresentedNode): void;
  /**
   * Bir mac ani sunuldu. Donen deger secilecek `choiceId`.
   * `undefined` donerse an atlanir (gecersiz girdi ya da kilitsiz secenek yok).
   */
  chooseMoment(node: PresentedNode): Promise<string | undefined> | string | undefined;
  onUnavailable?(availability: PlayerAvailability): void;
  onMatchStart?(match: HostMatch): void;
  onDropped?(dropped: readonly PendingMoment[]): void;
  /**
   * Secim uygulandi. Tam rapor gecilir: `demo` bildirimleri basar,
   * `simulate` sahne sayar, `play` uyarilari gosterir.
   */
  onChoiceMade?(report: TurnReport): void;
  onResult?(match: HostMatch, result: MatchResultReport, delta: MatchOutcomeDelta): void;
  /** Duraklamali akista: gol, kart, sakatlik gibi ara olaylar. */
  onHighlight?(highlight: MatchHighlight): void;
  /** Duraklamali akista: bir karar ani sunulmak uzere. */
  onDecision?(moment: PendingMoment): void;
}

/** Duraklayabilen host'un ek yuzeyi. `MatchSimulator` bunu doldurur. */
export interface PausableHost extends MatchHost {
  step(): SimStepLike;
  resume(delta: MomentDelta): void;
  runToEnd(): MatchResultReport;
}

export interface MatchHighlight {
  readonly minute: number;
  readonly text: string;
  readonly scoreline: string;
  readonly scorer?: string;
  readonly assist?: string;
}

type SimStepLike =
  | { readonly kind: 'hero_moment'; readonly moment: PendingMoment }
  | ({ readonly kind: 'highlight' } & MatchHighlight)
  | { readonly kind: 'full_time'; readonly report: MatchResultReport };

export interface RunMatchOptions {
  readonly season: number;
  readonly week: number;
  /** O haftanin kacinci maci -- yogun haftalarda 0'dan buyuk olur. */
  readonly slot?: number;
  /** Sonsuz donguye karsi guvenlik -- bozuk icerik CLI'yi kilitlemesin. */
  readonly maxMoments?: number;
}

/**
 * Bir hafta oynatir. Mac yoksa (bos hafta, ceza, sakatlik) motora bos sonuc
 * bildirilir ve `undefined` doner.
 */
export async function runMatch(
  engine: GameEngine,
  host: MatchHost,
  ui: MatchUi,
  options: RunMatchOptions,
): Promise<MatchResultReport | undefined> {
  const availability = engine.availability();
  if (!availability.available) ui.onUnavailable?.(availability);
  const match = host.buildMatch({
    availability,
    season: options.season,
    week: options.week,
    heroClubId: engine.snapshot().clubId,
    hero: engine.heroProfile(),
    ...(options.slot === undefined ? {} : { slot: options.slot }),
  });

  if (!match) {
    if (availability.available) ui.onUnavailable?.(availability);
    engine.finalizeMatch(NO_FIXTURE_RESULT);
    return undefined;
  }

  ui.onMatchStart?.(match);

  const { dropped } = engine.playMatch({
    context: match.context,
    pendingMoments: match.pendingMoments,
  });
  if (dropped.length > 0) ui.onDropped?.(dropped);

  const limit = options.maxMoments ?? 20;
  for (let guard = 0; guard < limit; guard += 1) {
    const node = engine.currentNode();
    if (!node || !node.isMoment) break;

    ui.onPresented?.(node);

    const choiceId = await ui.chooseMoment(node);
    if (choiceId === undefined) break;

    const chosen = node.choices.find((c) => c.id === choiceId);
    if (!chosen || chosen.locked) break;

    // Ayni kisa devre tuzagi (bkz. asagidaki uzun not): once CAGIR,
    // sonra bildir. `ui.onChoiceMade?.(engine.choose(...))` yazilirsa
    // geri cagrim verilmedigi anda secim hic uygulanmaz.
    const report = engine.choose(choiceId);
    ui.onChoiceMade?.(report);
  }

  const delta = engine.matchOutcome();
  const result = host.applyDelta(match, delta);
  engine.finalizeMatch(result);
  ui.onResult?.(match, result, delta);
  return result;
}

/**
 * DURAKLAMALI mac dongusu -- simulator icin.
 *
 * `runMatch`ten farki: anlar onceden bilinmez. Simulator dakika dakika
 * ilerler, bir karar anina gelince DURUR, motor oyuncuya sorar, cevap skora
 * islenir ve mac ayni yerden devam eder. 20. dakikada atilan gol, 70.
 * dakikadaki anin skor baglaminda gorunur.
 */
export async function runSimulatedMatch(
  engine: GameEngine,
  simulator: PausableHost,
  ui: MatchUi,
  options: RunMatchOptions,
): Promise<MatchResultReport | undefined> {
  const availability = engine.availability();
  if (!availability.available) ui.onUnavailable?.(availability);
  const match = simulator.buildMatch({
    availability,
    season: options.season,
    week: options.week,
    heroClubId: engine.snapshot().clubId,
    hero: engine.heroProfile(),
    ...(options.slot === undefined ? {} : { slot: options.slot }),
  });

  if (!match) {
    if (availability.available) ui.onUnavailable?.(availability);
    engine.finalizeMatch(NO_FIXTURE_RESULT);
    return undefined;
  }

  ui.onMatchStart?.(match);
  engine.beginMatch(match.context);

  const limit = options.maxMoments ?? 400;
  let report: MatchResultReport | undefined;

  for (let guard = 0; guard < limit; guard += 1) {
    const step = simulator.step();

    if (step.kind === 'full_time') {
      report = step.report;
      break;
    }

    if (step.kind === 'highlight') {
      ui.onHighlight?.(step);
      continue;
    }

    // Karar ani: motor icerik bulursa oyuncuya sorulur.
    const decision = engine.presentMoment(step.moment);
    if (!decision) {
      // Karsiligi olan icerik yok -- an sessizce gecilir, mac durmaz.
      simulator.resume(emptyMomentDelta());
      continue;
    }

    ui.onDecision?.(step.moment);
    let closed = false;
    for (let inner = 0; inner < 20 && !closed; inner += 1) {
      const node = engine.currentNode();
      if (!node) {
        closed = true;
        break;
      }
      if (!node.isMoment) {
        closed = true;
        break;
      }
      ui.onPresented?.(node);
      const choiceId = await ui.chooseMoment(node);
      const chosen = choiceId === undefined ? undefined : node.choices.find((c) => c.id === choiceId);
      if (!chosen || chosen.locked) {
        closed = true;
        break;
      }
      // DIKKAT: `ui.onChoiceMade?.(engine.choose(...))` YAZMAYIN.
      //
      // JavaScript'te `a?.(b())` ifadesi `a` tanimsizsa `b()`yi HIC
      // CALISTIRMAZ -- opsiyonel cagri, argumanlariyla birlikte kisa
      // devre yapar. Eski hali tam olarak boyleydi: `onChoiceMade`
      // vermeyen bir host'ta mac ani secimi sessizce yutuluyor, dugum
      // ilerlemiyor, ic dongu 20 kez bosa donup dugumu ACIK birakiyordu.
      // Bir sonraki `presentMoment` de "onceki mac ani hala acik" diye
      // patliyordu -- yani mac ORTASINDA cokuyordu.
      //
      // `simulate` bu hatayi hic gormedi cunku tesadufen `onChoiceMade`
      // veriyor. Once CAGIR, sonra bildir.
      const madeReport = engine.choose(chosen.id);
      ui.onChoiceMade?.(madeReport);
    }

    // Kararin skora katkisi ANINDA islenir; mac oradan devam eder.
    simulator.resume(engine.momentDelta());
  }

  const finalReport = report ?? simulator.runToEnd();
  const delta = engine.matchOutcome();
  engine.finalizeMatch(finalReport);
  ui.onResult?.(match, finalReport, delta);
  return finalReport;
}

/** Kilitsiz seceneklerden birini rastgele secen yardimci -- demo ve simulate icin. */
export function randomOpenChoice(node: PresentedNode, pick: (max: number) => number): string | undefined {
  const open = node.choices.filter((c) => !c.locked);
  if (open.length === 0) return undefined;
  return open[pick(open.length)]?.id;
}
