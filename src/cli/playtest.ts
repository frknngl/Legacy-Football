/**
 * PLAYTEST OLCUMU -- `npm run playtest`
 *
 * `simulate` "hangi metin ne zaman tekrar etti, hangi olay hic cikmadi"
 * sorusuna cevap veriyor. Bu arac baska bir soruya cevap veriyor:
 *
 *   OYNAMAK NASIL HISSETTIRIYOR?
 *
 * Ikisi ayri sorular. Icerik kapsamasi %100 olan bir oyun yine de sikici
 * olabilir: her hafta ayni sey oluyorsa, kararlarin hicbiri bir seye
 * baglanmiyorsa, ya da bir bayrak 20. haftada tavana yapisip bir daha
 * hic hareket etmiyorsa.
 *
 * Olculen alti sey:
 *
 *   1. SESSIZ HAFTA     -- kac hafta hicbir hikaye sahnesi cikmadi
 *   2. KILITLI SECIM    -- gosterilen seceneklerin kaci erisilemez ve NEDEN
 *   3. BAYRAK YORUNGESI -- hangi bayrak yasiyor, hangisi tavana yapisik
 *   4. ILERLEME HIZI    -- her stature/era esigine kacinci turda ulasildi
 *   5. KATEGORI ARALIGI -- ayni tonun iki sahnesi arasinda kac hafta var
 *   6. MENAJER DONGUSU  -- imza, teklif, red, birakma
 *
 * Bot ACIK secenekler arasindan RASTGELE secer, hep ilkini degil: hep
 * ilk secenegi secen bir bot iceriginin yalnizca bir koridorunu gorur ve
 * olcum yanli cikar. Menajer tekliflerinde de yari yariya kabul/ret --
 * hep kabul eden bot memnuniyet dususunu, hep reddeden transferi hic
 * olcemezdi.
 */

import { ARCHETYPES, type Archetype } from '../domain/axes.js';
import { ContentLoader } from '../loading/ContentLoader.js';
import { FileSystemContentSource } from '../loading/FileSystemContentSource.js';
import { GameEngine, type PresentedNode, type TurnReport } from '../runtime/GameEngine.js';
import { Rng } from '../selection/Rng.js';
import { EligibilityFilter, type RejectReason } from '../selection/EligibilityFilter.js';
import { randomOpenChoice, runSimulatedMatch } from './runMatch.js';
import {
  averageCountStats,
  countMapStats,
  mergeCountMaps,
  OccurrenceCollector,
  buildMetricsManifest,
  seedSeries,
  writeManifest,
} from './narrativeMetrics.js';
import { selectWorld, weeklySelectionMatchContext } from './world.js';
import { BOT_POLICY_VERSION, botTurn } from './bot.js';

function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function arg(name: string, fallback: string): string {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? (found.split('=')[1] ?? fallback) : fallback;
}

/** Yorungesi izlenen bayraklar. Her biri bir SISTEMIN sesi. */
const TRACKED = [
  'tukenmislik',
  'kondisyon',
  'moral',
  'servet',
  'haftalik_gelir',
  'piyasa_degeri',
  'piyasa_carpani',
  'liderlik',
  'taraftar_destegi',
  'medya_baskisi',
  'form',
  // Moral hedefinin girdisi: soyunma odasi huzuru. Moral dipteyken
  // sebebin burada mi yoksa icerikte mi oldugunu ancak bu ayirir.
  'iliski_takim',
  // Ikisi de artik SONUCA bagli: `iliski_aile` moral hedefini,
  // `iliski_sponsor` sponsorluk gelirini besliyor. Nerede durduklarini
  // gormeden ikisinin de katsayisi ayarlanamaz.
  'iliski_aile',
  'iliski_sponsor',
  // Stature formulunun en agir girdisi (agirlik 25) ve en agir ikincisi.
  // Ikisi de motor tarafindan yazilir; kablolari cekilmezse sessizce 0
  // kalirlar ve `superstar`/`icon`/`legend` kademelerini ULASILAMAZ yapar.
  'potansiyel',
  'teknik',
  'fizik',
  'kupa_sayisi',
  'milli_mac_sayisi',
  // Kadro rekabetinin gorunur ciktisi: kac mac oynandi.
  'kariyer_mac_sayisi',
  // B2/B4: odul ve sozlesme sistemlerinin gorunur ciktilari.
  'sezon_gol_sayisi',
  'sezon_asist_sayisi',
  'odul_sayisi',
  'sozlesme_sezon',
  // Stature formulunun kalan iki girdisi. Puanin HANGI bilesenden geldigini
  // gormek icin altisi da izlenmeli: esik ayari yapan kisi "merdiven hizli"
  // gorup esikleri yukseltirse yanlis yeri onarir -- sorun genelde tek bir
  // bilesenin sinirsiz birikmesidir.
  'medya_itibari',
  'sosyal_medya_takipci',
  // Agir sakatlik karari: kirilganlik kariyere yayilan izdir ve
  // olculmezse tedavi secimlerinin bir sonucu olup olmadigi bilinemez.
  'sakatlik_kirilganligi',
] as const;

interface Trajectory {
  readonly flag: string;
  readonly samples: number[];
}

interface FirstRepeatMarker {
  readonly turn: number;
  readonly season: number;
  readonly week: number;
}

interface SeasonMeasure {
  readonly season: number;
  readonly turns: number;
  readonly activePlayingTurns: number;
  readonly postRetirementTurns: number;
  readonly teamFixtures: number;
  readonly heroMinutesMatches: number;
  readonly starts: number;
  readonly benchEntries: number;
  readonly storyImpressions: number;
  readonly storyUniqueEvents: number;
  readonly storyUniqueVariants: number;
  readonly storyRepeatImpressions: number;
  readonly ambientMatchImpressions: number;
  readonly ambientReactionImpressions: number;
  readonly noStoryWeeks: number;
  readonly longestNoStoryDrought: number;
  readonly firstRepeatWeek: number | undefined;
  readonly rejectionCounts: Map<RejectReason, number>;
}

interface SeasonBucket {
  season: number;
  turns: number;
  activePlayingTurns: number;
  postRetirementTurns: number;
  teamFixtures: number;
  heroMinutesMatches: number;
  starts: number;
  benchEntries: number;
  storyImpressions: number;
  storyRepeatImpressions: number;
  ambientMatchImpressions: number;
  ambientReactionImpressions: number;
  noStoryWeeks: number;
  longestNoStoryDrought: number;
  currentNoStoryDrought: number;
  firstRepeatWeek: number | undefined;
  storyEvents: Set<string>;
  storyVariants: Set<string>;
  storyVariantCounts: Map<string, number>;
  rejectionCounts: Map<RejectReason, number>;
}

interface CareerMeasure {
  readonly seed: number;
  readonly turns: number;
  readonly activePlayingTurns: number;
  readonly postRetirementTurns: number;
  readonly teamFixtures: number;
  readonly heroMinutesMatches: number;
  readonly storyImpressions: number;
  readonly storyUniqueEvents: number;
  readonly storyUniqueVariants: number;
  readonly storyRepeatImpressions: number;
  readonly ambientMatchImpressions: number;
  readonly ambientReactionImpressions: number;
  readonly longestNoStoryDrought: number;
  readonly firstStoryRepeat: FirstRepeatMarker | undefined;
  readonly gateRejectionsForUnseen: Map<RejectReason, number>;
  readonly seasons: readonly SeasonMeasure[];
  /** Hikaye sahnesi cikan tur sayisi (mac/reaction haric). */
  readonly storyTurns: number;
  readonly quietTurns: number;
  readonly choicesShown: number;
  readonly choicesLocked: number;
  /** Kilidi hangi bayrak koydu -> kac kez. */
  readonly lockedBy: Map<string, number>;
  readonly trajectories: Trajectory[];
  /** stature/era etiketi -> ilk ulasilan tur. */
  readonly milestones: Map<string, number>;
  /** kategori -> ardisik sahneler arasindaki aralik listesi. */
  readonly gaps: Map<string, number[]>;
  readonly agentSigned: number;
  readonly agentQuit: number;
  /** Kac kez gercekten kulup degistirildi. */
  readonly transfers: number;
  /** Bunlarin kaci EZELI RAKIBE -- `mem_rakibe_transfer` bunu yaziyor. */
  readonly rivalTransfers: number;
  readonly loansTaken: number;
  /** Tum secenekleri kilitli dugum sayisi -- icerik hatasi gostergesi. */
  readonly deadlocks: number;
  /** Kadro rekabeti: ilk 11 / yedek dagilimi. */
  readonly started: number;
  readonly benched: number;
  /** Bir turda kac hikaye sahnesi cikti -> kac kez. */
  readonly scenesPerTurn: Map<number, number>;
  /**
   * TEKRAR OLCUMU -- programin tek gercek gostergesi.
   *
   * "eventId#variantId" -> bu kariyerde kac kez gosterildi. Ambiyans
   * (mac/tepki) ve hikaye AYRI raporlanir: bir penalti aninin tekrar
   * etmesi normaldir, bir aile sahnesinin tekrar etmesi degildir.
   */
  readonly shownStory: Map<string, number>;
  readonly shownStoryHand: Map<string, number>;
  readonly shownStoryGenerated: Map<string, number>;
  readonly shownAmbient: Map<string, number>;
  readonly handStoryTurns: number;
  /** Ayni metnin IKINCI kez goruldugu ilk tur. */
  readonly firstRepeatTurn: number | undefined;
  /** Kariyer erken bittiyse hangi hata yuzunden. */
  readonly stoppedBy: string | undefined;
  readonly ended: string | undefined;
}

function newSeasonBucket(season: number): SeasonBucket {
  return {
    season,
    turns: 0,
    activePlayingTurns: 0,
    postRetirementTurns: 0,
    teamFixtures: 0,
    heroMinutesMatches: 0,
    starts: 0,
    benchEntries: 0,
    storyImpressions: 0,
    storyRepeatImpressions: 0,
    ambientMatchImpressions: 0,
    ambientReactionImpressions: 0,
    noStoryWeeks: 0,
    longestNoStoryDrought: 0,
    currentNoStoryDrought: 0,
    firstRepeatWeek: undefined,
    storyEvents: new Set(),
    storyVariants: new Set(),
    storyVariantCounts: new Map(),
    rejectionCounts: new Map(),
  };
}

const TRANSIENT_REJECTIONS = new Set<RejectReason>(['cooldown_self', 'cooldown_family', 'once']);

/** Milli ara haftalari -- `CalendarConstraints.internationalWindows`. */
const NATIONAL_WEEKS = new Set([5, 11, 17, 26, 33]);

/** Hikaye disi kategoriler -- bunlar her hafta cikar, sessizligi bozmaz. */
const AMBIENT = new Set(['match', 'reaction']);

async function measure(
  registry: NonNullable<Awaited<ReturnType<ContentLoader['load']>>['registry']>,
  seed: number,
  archetype: Archetype,
  maxTurns: number,
  dbPath: string,
): Promise<CareerMeasure> {
  // DUNYA KARIYER BASINA kurulur, paylasilmaz.
  //
  // Paylasilan bir `simulator` onceki kariyerin yarim kalmis macini
  // tasir: `buildMatch`/`step`/`resume` bir durum makinesidir ve iki
  // kariyer ayni makineyi surerse ikincisi bozuk bir durumda baslar.
  const world = await selectWorld({ registry, seed, dbPath });
  let engine!: GameEngine;
  engine = new GameEngine(registry, {
    seed,
    roster: world.roster,
    world: world.world,
    worldFeed: world.worldFeed,
    selectionMatchContext: ({ season, week, clubId }) =>
      weeklySelectionMatchContext(world, {
        season,
        week,
        clubId,
        availability: engine.availability(),
        hero: engine.heroProfile(),
      }),
  });
  // KIMYA KABLOSU -- simulate'te var, burada yoktu. Simulator "kim
  // kiminle iyi anlasiyor" sorusunu motora bu kanaldan sorar.
  world.simulator.useChemistrySource((id) => engine.chemistryFor(id));
  engine.start(archetype);

  const rng = new Rng(seed ^ 0x5eed);
  const filter = new EligibilityFilter();
  const weeklyEvents = registry.events.filter((e) => e.momentType === undefined && e.scheduledOnly !== true);
  const trajectories = new Map<string, number[]>(TRACKED.map((f) => [f, []]));
  const milestones = new Map<string, number>();
  const gaps = new Map<string, number[]>();
  const lastSeen = new Map<string, number>();
  const lockedBy = new Map<string, number>();
  const scenesPerTurn = new Map<number, number>();
  const occurrences = new OccurrenceCollector(AMBIENT);
  const shownStoryHand = new Map<string, number>();
  const shownStoryGenerated = new Map<string, number>();
  const seasonBuckets = new Map<number, SeasonBucket>();
  const gateRejectionsForUnseen = new Map<RejectReason, number>();
  const careerStoryEvents = new Set<string>();
  const careerStoryVariants = new Set<string>();
  const careerStoryCounts = new Map<string, number>();

  let storyTurns = 0;
  let handStoryTurns = 0;
  let quietTurns = 0;
  let choicesShown = 0;
  let choicesLocked = 0;
  let agentSigned = 0;
  let transfers = 0;
  let rivalTransfers = 0;
  let loansTaken = 0;
  let agentQuit = 0;
  let turns = 0;
  let deadlocks = 0;
  let started = 0;
  let benched = 0;
  let storyRepeatImpressions = 0;
  let firstStoryRepeat: FirstRepeatMarker | undefined;
  let stoppedBy: string | undefined;
  let lastSeason = 1;

  const seasonBucket = (season: number): SeasonBucket => {
    const existing = seasonBuckets.get(season);
    if (existing) return existing;
    const created = newSeasonBucket(season);
    seasonBuckets.set(season, created);
    return created;
  };

  const bumpReason = (map: Map<RejectReason, number>, reason: RejectReason): void => {
    map.set(reason, (map.get(reason) ?? 0) + 1);
  };

  const observeNode = (
    node: PresentedNode,
    turn: number,
    season: number,
    week: number,
  ): { story: boolean; handStory: boolean } => {
    const seen = occurrences.observe(node, turn);
    if (!seen.countedOccurrence) return { story: false, handStory: false };

    const bucket = seasonBucket(season);
    if (seen.ambient) {
      if (seen.category === 'match') bucket.ambientMatchImpressions += 1;
      else if (seen.category === 'reaction') bucket.ambientReactionImpressions += 1;
      return { story: false, handStory: false };
    }

    bucket.storyImpressions += 1;
    bucket.storyEvents.add(node.eventId);
    bucket.storyVariants.add(seen.eventKey);
    careerStoryEvents.add(node.eventId);
    careerStoryVariants.add(seen.eventKey);

    const seasonSeen = bucket.storyVariantCounts.get(seen.eventKey) ?? 0;
    bucket.storyVariantCounts.set(seen.eventKey, seasonSeen + 1);
    if (seasonSeen > 0) {
      bucket.storyRepeatImpressions += 1;
      if (seasonSeen === 1 && bucket.firstRepeatWeek === undefined) {
        bucket.firstRepeatWeek = week;
      }
    }

    const careerSeen = careerStoryCounts.get(seen.eventKey) ?? 0;
    careerStoryCounts.set(seen.eventKey, careerSeen + 1);
    if (careerSeen > 0) {
      storyRepeatImpressions += 1;
      if (careerSeen === 1 && firstStoryRepeat === undefined) {
        firstStoryRepeat = { turn, season, week };
      }
    }

    const ev = registry.get(node.eventId);
    const isHand = ev?.authored === 'hand';
    if (isHand) {
      shownStoryHand.set(seen.eventKey, (shownStoryHand.get(seen.eventKey) ?? 0) + 1);
    } else {
      shownStoryGenerated.set(seen.eventKey, (shownStoryGenerated.get(seen.eventKey) ?? 0) + 1);
    }

    const previous = lastSeen.get(seen.category);
    if (previous !== undefined) {
      const list = gaps.get(seen.category) ?? [];
      list.push(turn - previous);
      gaps.set(seen.category, list);
    }
    lastSeen.set(seen.category, turn);

    return { story: true, handStory: isHand };
  };

  /**
   * Acik sahneleri KAPATIR ve yol boyunca olcum toplar.
   *
   * Hem turun basinda hem MACTAN SONRA cagrilmali: bir mac aninin
   * sonuc dugumu mac dongusunden sonra acik kalir (gercek oyunda
   * oyuncu "devam"a basar). Kapatilmazsa bir sonraki `advanceTurn`
   * "acik karar var" diye patlar -- ilk yazimda kariyerler 2. turda
   * bu yuzden oluyordu.
   *
   * Donen deger: hikaye (mac/reaction disi) sahnesi gorulup gorulmedigi.
   */
  const drain = (
    turn: number,
    season: number,
    week: number,
  ): { storyCount: number; sawHandStory: boolean } => {
    let storyCount = 0;
    let sawHandStory = false;
    for (let guard = 0; guard < 40; guard += 1) {
      const node = engine.currentNode();
      if (!node) break;

      // SAHNE = OLAY, dugum degil.
      //
      // Ilk yazimda her DUGUM bir sahne sayiliyordu. Tipik bir olay bir
      // branch + bir outcome dugumunden olusur, yani her olay "2 sahne"
      // gorunuyor ve ikisi ayni turda oldugu icin kategori araligi 0
      // cikiyordu. "Sahneler patlamalar halinde geliyor" sonucu bu
      // sayim hatasinin eseriydi -- olcum aracinin kendi kusurunu
      // icerik kusuru diye raporlamasi.
      const seen = observeNode(node, turn, season, week);

      if (seen.story) {
        storyCount += 1;
        if (seen.handStory) sawHandStory = true;
      }

      // `node.choices` DEGIL `availableChoices()`: outcome dugumlerinin
      // kendi secenegi yoktur, motor sentetik bir "devam" uretir.
      const choices = engine.availableChoices();
      for (const choice of choices) {
        choicesShown += 1;
        if (choice.locked) {
          choicesLocked += 1;
          // Kilidi koyan bayrak `lockReason`in ilk kelimesi ("liderlik
          // gte 70"). `lockLabel` serbest yazim bir etiket.
          const flag = choice.lockReason?.split(' ')[0] ?? 'bilinmiyor';
          lockedBy.set(flag, (lockedBy.get(flag) ?? 0) + 1);
        }
      }

      const open = choices.filter((ch) => !ch.locked);
      const chosen = open[Math.floor(rng.next() * open.length)] ?? open[0];
      if (!chosen) {
        // TUM SECENEKLER KILITLI. Kilidi ZORLAMIYORUZ: motorun kendi
        // akisinda olmayan bir gecis yapmak, olculen dunyayi oynanan
        // dunyadan farkli kilar. Sayilir ve cikilir.
        deadlocks += 1;
        break;
      }
      engine.choose(chosen.id);
    }
    return { storyCount, sawHandStory };
  };

  for (let t = 0; t < maxTurns; t += 1) {
    let report: TurnReport;
    try {
      report = engine.advanceTurn();
    } catch (error) {
      // Sessizce yutmuyoruz: olcum araci "kariyer 2. turda bitti" deyip
      // hicbir sey soylemezse, olcumun kendisi yalan soyler.
      stoppedBy = (error as Error).message;
      break;
    }
    turns = report.turn;
    const bucket = seasonBucket(report.season);
    bucket.turns += 1;

    const stateAtTurnStart = engine.snapshot();
    const retired =
      stateAtTurnStart.lifeState === 'retired' || stateAtTurnStart.flags['retired'] === true;
    if (retired) bucket.postRetirementTurns += 1;
    else bucket.activePlayingTurns += 1;

    // O sezon henuz gorulmemis haftalik olaylar neden eleniyor?
    const ctx = {
      era: report.era,
      stature: report.stature,
      clubTier: report.clubTier,
      lifeState: report.lifeState,
      mediaEra: report.mediaEra,
      archetype,
      turn: report.turn,
      flags: stateAtTurnStart.flags,
      flagSetTurn: stateAtTurnStart.flagSetTurn,
      seenEvents: stateAtTurnStart.seenEvents,
      seenVariants: stateAtTurnStart.seenVariants,
      storyArcTurns: stateAtTurnStart.storyArcTurns,
      storyBeatTurns: stateAtTurnStart.storyBeatTurns,
      storyBeatCounts: stateAtTurnStart.storyBeatCounts,
      storySignatureTurns: stateAtTurnStart.storySignatureTurns,
      cooldownState: {
        cooldowns: stateAtTurnStart.cooldowns,
        familyCooldowns: stateAtTurnStart.familyCooldowns,
        categoryCooldowns: stateAtTurnStart.categoryCooldowns,
      },
    };
    for (const event of weeklyEvents) {
      if (stateAtTurnStart.seenEvents[event.id] !== undefined) continue;
      const reason = filter.rejectReason(event, ctx);
      if (reason === undefined || TRANSIENT_REJECTIONS.has(reason)) continue;
      bumpReason(bucket.rejectionCounts, reason);
      bumpReason(gateRejectionsForUnseen, reason);
    }

    // MILLI ARA.
    //
    // `internationalWindows` (5, 11, 17, 26, 33) haftalarinda motorun
    // milli davet kapisi cagrilmali. Hicbir host cagirmiyordu; sonuc
    // `milli_mac_sayisi` her kariyerde 0 kaldi ve stature formulundeki
    // agirligi (1.5) hic devreye girmedi. Ayrica `national_duty` hayat
    // durumu hic acilmadigi icin o duruma kapili icerik de olu kaldi.
    // BUYUK TURNUVA: iki yilda bir, sezonun 39. haftasinda.
    if (report.week === 39 && report.season % 2 === 0 && world.countryOfClub && world.calledUp) {
      const h = engine.heroProfile();
      const q = Math.round((h.technical + h.physical) / 2);
      if (world.calledUp(world.countryOfClub(engine.snapshot().clubId), q)) {
        const deep = rng.next() < q / 130;
        engine.reportWorldEvent({
          kind: 'tournament',
          name: (report.season / 2) % 2 === 0 ? 'Dunya Kupasi' : 'Avrupa Sampiyonasi',
          matches: deep ? 7 : 4,
          won: deep && rng.next() < q / 260,
        });
      }
    }

    if (NATIONAL_WEEKS.has(report.week) && world.countryOfClub && world.calledUp) {
      const country = world.countryOfClub(engine.snapshot().clubId);
      // Milli takim SEVIYEYE bakar. `HeroProfile`da tek bir "quality"
      // yok; teknik ve fizik eksenlerinin ortalamasi en yakin karsilik.
      const hero = engine.heroProfile();
      const quality = Math.round((hero.technical + hero.physical) / 2);
      if (world.calledUp(country, quality)) {
        engine.reportWorldEvent({ kind: 'national_call', matches: 2 });
      }
    }


    // SEZON KAPANISI.
    //
    // Hicbir host `finishSeason()` cagirmiyordu. Sonuc: lig sampiyonu hic
    // hesaplanmadi, kume dusme/cikma hic olmadi, dunya otuz sezon boyunca
    // DONUK kaldi ve `kupa_sayisi` her kariyerde 0 kaldi.
    //
    // `kupa_sayisi` stature formulunun en agir girdisi (agirlik 25).
    // Sifir kalinca `superstar` (330), `icon` (460) ve `legend` (620)
    // esikleri normal oyunda ULASILAMAZ oluyor -- yedi kademenin ucu
    // olu. O kademelere kapili icerik de hic cikmiyor.
    if (report.season !== lastSeason) {
      lastSeason = report.season;
      engine.closeAgentSeason(Number(engine.snapshot().flags['form'] ?? 0) >= 55);

      // SOZLESME YENILEME: son yila girildiginde teklif gelir.
      // Bot her zaman kabul eder -- amac mekanigin isledigini olcmek;
      // gercek oyuncunun reddetme hakki `play.ts`te.
      if (numberOf(engine.snapshot().flags['sozlesme_sezon']) <= 1) {
        engine.renewContract(engine.contractOffer());
      }
      const outcome = world.finishSeason();
      const myClub = engine.snapshot().clubId;
      for (const [leagueId, clubId] of Object.entries(outcome.champions)) {
        if (clubId === myClub) engine.reportWorldEvent({ kind: 'trophy', competitionId: leagueId });
      }
    }


    // --- BOT KARARLARI (menajer, transfer, kredi)
    //
    // Eskiden burada yalnizca menajer dongusu vardi ve bot menajere
    // "transfer oldu" dedigi halde kulubu DEGISTIRMIYORDU. Bu yuzden
    // `mem_rakibe_transfer` hic yazilmiyor, rakibe transfer sahnesi hep
    // olu goruluyordu. Kredi kolu da hic denenmiyordu.
    //
    // Karar mantigi artik `cli/bot.ts`te ve `simulate` ile PAYLASILIYOR --
    // iki olcum araci ayni oyuncuyu taklit etmeli, yoksa sayilar
    // karsilastirilamaz.
    const botOut = botTurn(engine, world.roster, rng, report.week);
    if (botOut.agentSigned) agentSigned += 1;
    if (botOut.agentQuit) agentQuit += 1;
    if (botOut.transferred) transfers += 1;
    if (botOut.toRival) rivalTransfers += 1;
    if (botOut.loanTaken) loansTaken += 1;

    // --- SAHNE VE SECIM
    let turnStoryCount = 0;
    let turnSawHandStory = false;
    const drained = drain(report.turn, report.season, report.week);
    turnStoryCount += drained.storyCount;
    if (drained.sawHandStory) turnSawHandStory = true;

    // O haftanin TUM mac slotlari oynanir. Aksi halde yogun haftanin ikinci
    // maci atlanir ve hem yorgunluk hem tekrar ritmi yalnizca ilk maca bakar.
    //
    // Acik dugum kalmissa mac ATLANIR: `presentMoment` acik bir an
    // uzerine ikincisini koymayi reddediyor ve hakli olarak patliyor.
    //
    // Dugum hala acikken mac ATLANIR ama olcum devam eder: ornekleme
    // asagida, `continue` ile atlanmamali.
    const week = engine.snapshot().week;
    const season = engine.snapshot().season;
    const fixtureCount = world.schedule.fixturesFor(engine.snapshot().clubId, week).length;
    bucket.teamFixtures += fixtureCount;
    {
      try {
        for (let slot = 0; slot < fixtureCount; slot += 1) {
          const played = await runSimulatedMatch(
            engine,
            world.simulator,
            {
              onPresented: (node) => {
                const seen = observeNode(node, report.turn, report.season, report.week);
                if (!seen.story) return;
                turnStoryCount += 1;
                if (seen.handStory) turnSawHandStory = true;
              },
              // MAC ANLARI da sayilir. Bunlar `drain()`den gecmez --
              // `runSimulatedMatch` kendi ic dongusunde tuketir. Sayilmazsa
              // sahne butcesinin %21'i olcumun disinda kalir ve tekrar
              // raporu oldugundan iyi gorunur.
              chooseMoment: (_node) => randomOpenChoice(_node, (max) => rng.int(max)),
            },
            { season, week, slot },
          );

          // KADRO REKABETI: yalnizca Hero dakika aldigi maclarda say.
          if (played !== undefined && played.result !== 'none') {
            if (played.minutes > 0) {
              if (engine.snapshot().flags['is_starter'] === false) benched += 1;
              else started += 1;
              bucket.heroMinutesMatches += 1;
              if (engine.snapshot().flags['is_starter'] === false) bucket.benchEntries += 1;
              else bucket.starts += 1;
            }
            world.recordHeroMatch();
          }
        }
        for (const competitionId of world.advanceWeek(week, engine.snapshot().clubId)) {
          engine.reportWorldEvent({ kind: 'trophy', competitionId });
        }
      } catch (error) {
        // Mac ORTASINDA cokme. Olcum araci burada olmemeli: hatayi
        // kaydedip raporlar, cunku bir cokusu gizlemek onu yok saymaktan
        // beterdir -- rapor "her sey yolunda" der ve kimse bakmaz.
        stoppedBy = `mac sirasinda: ${(error as Error).message}`;
        break;
      }
    }

    if (turnStoryCount > 0) {
      storyTurns += 1;
      if (turnSawHandStory) handStoryTurns += 1;
      scenesPerTurn.set(turnStoryCount, (scenesPerTurn.get(turnStoryCount) ?? 0) + 1);
      bucket.currentNoStoryDrought = 0;
    } else {
      quietTurns += 1;
      bucket.noStoryWeeks += 1;
      bucket.currentNoStoryDrought += 1;
      bucket.longestNoStoryDrought = Math.max(
        bucket.longestNoStoryDrought,
        bucket.currentNoStoryDrought,
      );
    }

    // --- ORNEKLEME
    const snap = engine.snapshot();
    for (const flag of TRACKED) {
      const value = snap.flags[flag];
      trajectories.get(flag)!.push(typeof value === 'number' ? value : 0);
    }
    for (const key of [snap.stature, snap.lifeState]) {
      if (!milestones.has(key)) milestones.set(key, report.turn);
    }

    if (snap.ending !== undefined) break;
  }

  const seasons: SeasonMeasure[] = [...seasonBuckets.values()]
    .sort((a, b) => a.season - b.season)
    .map((b) => ({
      season: b.season,
      turns: b.turns,
      activePlayingTurns: b.activePlayingTurns,
      postRetirementTurns: b.postRetirementTurns,
      teamFixtures: b.teamFixtures,
      heroMinutesMatches: b.heroMinutesMatches,
      starts: b.starts,
      benchEntries: b.benchEntries,
      storyImpressions: b.storyImpressions,
      storyUniqueEvents: b.storyEvents.size,
      storyUniqueVariants: b.storyVariants.size,
      storyRepeatImpressions: b.storyRepeatImpressions,
      ambientMatchImpressions: b.ambientMatchImpressions,
      ambientReactionImpressions: b.ambientReactionImpressions,
      noStoryWeeks: b.noStoryWeeks,
      longestNoStoryDrought: b.longestNoStoryDrought,
      firstRepeatWeek: b.firstRepeatWeek,
      rejectionCounts: new Map(b.rejectionCounts),
    }));

  const activePlayingTurns = seasons.reduce((sum, s) => sum + s.activePlayingTurns, 0);
  const postRetirementTurns = seasons.reduce((sum, s) => sum + s.postRetirementTurns, 0);
  const teamFixtures = seasons.reduce((sum, s) => sum + s.teamFixtures, 0);
  const heroMinutesMatches = seasons.reduce((sum, s) => sum + s.heroMinutesMatches, 0);
  const ambientMatchImpressions = seasons.reduce((sum, s) => sum + s.ambientMatchImpressions, 0);
  const ambientReactionImpressions = seasons.reduce((sum, s) => sum + s.ambientReactionImpressions, 0);
  const longestNoStoryDrought =
    seasons.length === 0 ? 0 : Math.max(...seasons.map((s) => s.longestNoStoryDrought));

  return {
    seed,
    turns,
    activePlayingTurns,
    postRetirementTurns,
    teamFixtures,
    heroMinutesMatches,
    storyImpressions: occurrences.storyOccurrences,
    storyUniqueEvents: careerStoryEvents.size,
    storyUniqueVariants: careerStoryVariants.size,
    storyRepeatImpressions,
    ambientMatchImpressions,
    ambientReactionImpressions,
    longestNoStoryDrought,
    firstStoryRepeat,
    gateRejectionsForUnseen,
    seasons,
    storyTurns,
    quietTurns,
    choicesShown,
    choicesLocked,
    lockedBy,
    trajectories: TRACKED.map((f) => ({ flag: f, samples: trajectories.get(f)! })),
    milestones,
    gaps,
    agentSigned,
    agentQuit,
    transfers,
    rivalTransfers,
    loansTaken,
    deadlocks,
    started,
    benched,
    scenesPerTurn,
    shownStory: new Map(occurrences.shownStory),
    shownStoryHand: new Map(shownStoryHand),
    shownStoryGenerated: new Map(shownStoryGenerated),
    shownAmbient: new Map(occurrences.shownAmbient),
    handStoryTurns,
    firstRepeatTurn: occurrences.firstRepeatTurn,
    stoppedBy,
    ended: engine.snapshot().ending,
  };
}

// ------------------------------------------------------------------- rapor

function pct(part: number, whole: number): string {
  return whole === 0 ? '-' : `${Math.round((part / whole) * 100)}%`;
}

function avg(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

function avg1(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const raw = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.round(raw * 10) / 10;
}

function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q));
  return sorted[index] ?? 0;
}

function ratioValue(numerator: number, denominator: number): number | undefined {
  if (denominator <= 0) return undefined;
  return numerator / denominator;
}

function ratioLabel(value: number | undefined): string {
  if (value === undefined) return 'N/A';
  return `${(value * 100).toFixed(1)}%`;
}

function distribution(values: readonly number[]): {
  readonly mean: number;
  readonly median: number;
  readonly p25: number;
  readonly p75: number;
} {
  return {
    mean: avg1(values),
    median: percentile(values, 0.5),
    p25: percentile(values, 0.25),
    p75: percentile(values, 0.75),
  };
}

/**
 * Bir bayrak yorungesinin SAGLIGI.
 *
 * Uc soru: hareket ediyor mu (menzil), tavana yapisti mi (son ceyrekte
 * degisim), ve ne zaman durdu. Tavana yapisan bayrak, uzerine kurulmus
 * her mekanigi de olduruyor -- bu yuzden ayrica isaretleniyor.
 */
function describeTrajectory(t: Trajectory): string {
  const s = t.samples;
  if (s.length === 0) return 'veri yok';
  const min = Math.min(...s);
  const max = Math.max(...s);
  const last = s[s.length - 1]!;
  const tail = s.slice(Math.floor(s.length * 0.75));
  const tailRange = Math.max(...tail) - Math.min(...tail);

  // TAVAN/DIP sezgileri yalnizca 0-100 bayraklari icin anlamli.
  // `servet` 10 milyona ciktiginda "TAVANDA" demek yaniltir; ayni
  // sekilde bir sayac 0'dan 4'e ciktiginda "hic hareket etmiyor"
  // demek de yanlis. Buyuk olcekli bayraklarda ORANSAL bakiyoruz.
  const bounded = max <= 100;
  const span = max - min;
  const flags: string[] = [];
  if (bounded ? span < 5 : span === 0) flags.push('OLU (hic hareket etmiyor)');
  else if (bounded ? tailRange < 3 : tailRange / Math.max(1, max) < 0.02) {
    flags.push('DONMUS (son ceyrekte sabit)');
  }
  if (bounded && last >= 97) flags.push('TAVANDA');
  if (bounded && last <= 3 && max > 10) flags.push('DIPTE');

  // MEDYAN sart: min-max ve son deger yaniltir. Emekli olan oyuncunun
  // morali 0'dir, ama bu "moral hep 0" demek degildir. Bir bayragin
  // kariyer boyunca NEREDE durdugunu yalnizca dagilim soyler -- ve
  // denge ayari (ornegin moralin sahaya etkisi) buna gore yapilir.
  const sorted = [...s].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;

  return (
    `${String(min).padStart(3)} - ${String(max).padStart(3)}  son ${String(last).padStart(3)}` +
    `  [p25 ${String(at(0.25)).padStart(3)} | med ${String(at(0.5)).padStart(3)} | p75 ${String(at(0.75)).padStart(3)}]` +
    (flags.length > 0 ? `   ${flags.join(', ')}` : '')
  );
}

async function main(): Promise<void> {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  if (!loaded.registry) {
    console.log('Icerik yuklenemedi. "npm run validate" calistirin.');
    process.exitCode = 1;
    return;
  }

  const seeds = Number.parseInt(arg('seeds', '6'), 10);
  const maxTurns = Number.parseInt(arg('turns', '900'), 10);
  const seedBase = Number.parseInt(arg('seedBase', '1000'), 10);
  const seedStep = Number.parseInt(arg('seedStep', '37'), 10);
  const manifestPath = arg('manifest', '');
  const archetype = arg('archetype', 'street') as Archetype;
  const dbPath = arg('world', '');

  if (!ARCHETYPES.includes(archetype)) {
    console.log(`Bilinmeyen arketip: ${archetype}`);
    process.exitCode = 1;
    return;
  }

  console.log(`=== PLAYTEST | ${seeds} tohum x ${maxTurns} tur | ${archetype} ===\n`);

  const seedList = seedSeries(seeds, seedBase, seedStep);
  const runs: CareerMeasure[] = [];
  for (const seed of seedList) {
    runs.push(await measure(loaded.registry, seed, archetype, maxTurns, dbPath));
  }

  // --- 1. RITIM
  const totalTurns = runs.reduce((s, r) => s + r.turns, 0);
  const quiet = runs.reduce((s, r) => s + r.quietTurns, 0);
  const handTurns = runs.reduce((s, r) => s + r.handStoryTurns, 0);
  console.log('RITIM');
  console.log(`  Kariyer uzunlugu (ort)   : ${avg(runs.map((r) => r.turns))} tur`);
  console.log(`  Hikaye sahnesi olan hafta: ${pct(totalTurns - quiet, totalTurns)}`);
  console.log(`  ...El sahnesi olan hafta : ${pct(handTurns, totalTurns)}  ${handTurns}/${totalTurns}`);
  console.log(`  SESSIZ hafta             : ${pct(quiet, totalTurns)}  ${quiet}/${totalTurns}`);

  const perTurn = new Map<number, number>();
  for (const r of runs) {
    for (const [n, c] of r.scenesPerTurn) perTurn.set(n, (perTurn.get(n) ?? 0) + c);
  }
  const busyTotal = [...perTurn.values()].reduce((s, v) => s + v, 0);
  console.log('  Hikayeli haftalarda sahne sayisi:');
  for (const [n, c] of [...perTurn].sort((a, b) => a[0] - b[0])) {
    console.log(`    ${n} sahne : ${String(c).padStart(5)}  ${pct(c, busyTotal)}`);
  }

  // --- 1b. TEKRAR  (programin kabul testi)
  //
  // Ambiyans ve hikaye AYRI: bir penalti aninin tekrar etmesi normaldir,
  // bir aile sahnesinin tekrar etmesi degildir. Tek bir ortalama bu iki
  // ayri gercegi tek sayida eritir ve yaniltir.
  const storyRuns = runs.map((r) => r.shownStory);
  const storyHandRuns = runs.map((r) => r.shownStoryHand);
  const storyGenRuns = runs.map((r) => r.shownStoryGenerated);
  const ambientRuns = runs.map((r) => r.shownAmbient);

  const story = averageCountStats(storyRuns);
  const storyHand = averageCountStats(storyHandRuns);
  const storyGen = averageCountStats(storyGenRuns);
  const ambient = averageCountStats(ambientRuns);

  const storyMerged = mergeCountMaps(storyRuns);
  const storyHandMerged = mergeCountMaps(storyHandRuns);
  const storyGenMerged = mergeCountMaps(storyGenRuns);
  const ambientMerged = mergeCountMaps(ambientRuns);

  const storyTotal = countMapStats(storyMerged);
  const storyHandTotal = countMapStats(storyHandMerged);
  const storyGenTotal = countMapStats(storyGenMerged);
  const ambientTotal = countMapStats(ambientMerged);

  console.log('\nTEKRAR');
  console.log(
    `  HIKAYE (kariyer ort.)    : ${story.shows} gosterim / ${story.unique} benzersiz  ` +
      `-> ${story.ratio.toFixed(1)}x tekrar`,
  );
  console.log(
    `    -> EL (kariyer ort.)   : ${storyHand.shows} gosterim / ${storyHand.unique} benzersiz  ` +
      `-> ${storyHand.ratio.toFixed(1)}x tekrar`,
  );
  console.log(
    `    -> URETIM (kariyer ort): ${storyGen.shows} gosterim / ${storyGen.unique} benzersiz  ` +
      `-> ${storyGen.ratio.toFixed(1)}x tekrar`,
  );
  console.log(
    `  AMBIYANS (kariyer ort.)  : ${ambient.shows} gosterim / ${ambient.unique} benzersiz  ` +
      `-> ${ambient.ratio.toFixed(1)}x tekrar`,
  );
  console.log(
    `  HIKAYE (tum kariyer)     : ${storyTotal.shows} gosterim / ${storyTotal.unique} benzersiz (el: ${storyHandTotal.unique}, uretim: ${storyGenTotal.unique})`,
  );
  console.log(
    `  AMBIYANS (tum kariyer)   : ${ambientTotal.shows} gosterim / ${ambientTotal.unique} benzersiz`,
  );
  const repeats = runs
    .map((r) => r.firstRepeatTurn)
    .filter((v): v is number => v !== undefined);
  console.log(
    `  Ilk tekrarin turu (ort)  : ${repeats.length === 0 ? '-- (tekrar yok)' : avg(repeats)}`,
  );

  const worst = [...storyMerged, ...ambientMerged]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.log('  EN COK TEKRAR EDEN 10 METIN:');
  for (const [key, n] of worst) {
    console.log(`    ${String(n).padStart(4)}x  ${key}`);
  }

  // Kategori bazinda tekrar -- nerede en kotu?
  const byCat = new Map<string, { shows: number; uniq: Set<string> }>();
  for (const [key, n] of [...storyMerged, ...ambientMerged]) {
    const cat = key.split('_')[1] ?? '?';
    const cell = byCat.get(cat) ?? { shows: 0, uniq: new Set<string>() };
    cell.shows += n;
    cell.uniq.add(key);
    byCat.set(cat, cell);
  }
  console.log('  KATEGORI BAZINDA:');
  for (const [cat, cell] of [...byCat].sort(
    (a, b) => b[1].shows / b[1].uniq.size - a[1].shows / a[1].uniq.size,
  )) {
    const ratio = cell.shows / cell.uniq.size;
    console.log(
      `    ${cat.padEnd(12)} ${ratio.toFixed(1).padStart(5)}x  ` +
        `(${cell.shows} gosterim / ${cell.uniq.size} metin)`,
    );
  }

  // --- 1c. A3 KARIYER + SEZON RAPORU
  console.log('\nA3 RAPORU  (kariyer + sezon)');
  console.log('  formuller:');
  console.log('    repeat_exposure = storyRepeatImpressions / storyImpressions');
  console.log('    quiet_exposure  = noStoryWeeks / turns');
  console.log('    play_exposure   = heroMinutesMatches / teamFixtures');

  console.log('  KARIYER BAZINDA:');
  for (const run of [...runs].sort((a, b) => a.seed - b.seed)) {
    const first =
      run.firstStoryRepeat === undefined
        ? 'N/A'
        : `S${run.firstStoryRepeat.season} H${run.firstStoryRepeat.week}`;
    const repeatExposure = ratioLabel(ratioValue(run.storyRepeatImpressions, run.storyImpressions));
    const quietExposure = ratioLabel(ratioValue(run.quietTurns, run.turns));
    const playExposure = ratioLabel(ratioValue(run.heroMinutesMatches, run.teamFixtures));
    const gateTop = [...run.gateRejectionsForUnseen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count]) => `${reason}:${count}`)
      .join(', ');
    console.log(
      `    tohum ${String(run.seed).padStart(6)} | tur ${String(run.turns).padStart(4)} ` +
        `aktif ${String(run.activePlayingTurns).padStart(4)} / emekli-sonrasi ${String(run.postRetirementTurns).padStart(4)} ` +
        `| fikstur ${String(run.teamFixtures).padStart(4)} / dakika+ mac ${String(run.heroMinutesMatches).padStart(4)} ` +
        `(11:${run.started}, yedek:${run.benched})`,
    );
    console.log(
      `             hikaye ${run.storyImpressions} (uniqE ${run.storyUniqueEvents}, uniqV ${run.storyUniqueVariants}, tekrar ${run.storyRepeatImpressions}) ` +
        `| ambiyans match/reaction ${run.ambientMatchImpressions}/${run.ambientReactionImpressions}`,
    );
    console.log(
      `             sessiz ${run.quietTurns} (en uzun kuraklik ${run.longestNoStoryDrought}) ` +
        `| ilk tekrar ${first} | exposure repeat ${repeatExposure}, quiet ${quietExposure}, play ${playExposure}` +
        (gateTop.length > 0 ? ` | unseen gate top: ${gateTop}` : ''),
    );
  }

  const repeatExposureRows = runs
    .map((r) => ({ seed: r.seed, value: ratioValue(r.storyRepeatImpressions, r.storyImpressions) }))
    .filter((row): row is { seed: number; value: number } => row.value !== undefined);
  const quietExposureRows = runs
    .map((r) => ({ seed: r.seed, value: ratioValue(r.quietTurns, r.turns) }))
    .filter((row): row is { seed: number; value: number } => row.value !== undefined);
  const playExposureRows = runs
    .map((r) => ({ seed: r.seed, value: ratioValue(r.heroMinutesMatches, r.teamFixtures) }))
    .filter((row): row is { seed: number; value: number } => row.value !== undefined);

  const printExposureSummary = (
    label: string,
    rows: readonly { seed: number; value: number }[],
    worstByMax: boolean,
  ): void => {
    if (rows.length === 0) {
      console.log(`  ${label.padEnd(26)} N/A (0 impression) [mean N/A | med N/A | p25 N/A | p75 N/A]`);
      return;
    }
    const valuesPct = rows.map((r) => r.value * 100);
    const stats = distribution(valuesPct);
    const worst = [...rows].sort((a, b) => (worstByMax ? b.value - a.value : a.value - b.value))[0]!;
    console.log(
      `  ${label.padEnd(26)} ${stats.mean.toFixed(1)}%  ` +
        `[med ${stats.median.toFixed(1)} | p25 ${stats.p25.toFixed(1)} | p75 ${stats.p75.toFixed(1)}]` +
        `  worst tohum ${worst.seed} (${(worst.value * 100).toFixed(1)}%)`,
    );
  };

  console.log('  DAGILIM  (mean/median/p25/p75 + worst exposure):');
  printExposureSummary('repeat exposure', repeatExposureRows, true);
  printExposureSummary('quiet exposure', quietExposureRows, true);
  printExposureSummary('play exposure', playExposureRows, false);

  const bySeasonMetrics = new Map<number, SeasonMeasure[]>();
  for (const run of runs) {
    for (const season of run.seasons) {
      const list = bySeasonMetrics.get(season.season) ?? [];
      list.push(season);
      bySeasonMetrics.set(season.season, list);
    }
  }
  console.log('  SEZON BAZINDA  (kariyer ortalamalari):');
  for (const season of [...bySeasonMetrics.keys()].sort((a, b) => a - b)) {
    const rows = bySeasonMetrics.get(season) ?? [];
    const firstRepeatWeeks = rows
      .map((s) => s.firstRepeatWeek)
      .filter((w): w is number => w !== undefined);
    const gate = new Map<RejectReason, number>();
    for (const row of rows) {
      for (const [reason, count] of row.rejectionCounts) {
        gate.set(reason, (gate.get(reason) ?? 0) + count);
      }
    }
    const gateTop = [...gate.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count]) => `${reason}:${count}`)
      .join(', ');
    const seasonRepeatRows = rows
      .map((r) => ratioValue(r.storyRepeatImpressions, r.storyImpressions))
      .filter((v): v is number => v !== undefined)
      .map((v) => v * 100);

    console.log(
      `    S${String(season).padStart(2, '0')} tur ${avg1(rows.map((r) => r.turns)).toFixed(1)} ` +
        `| aktif ${avg1(rows.map((r) => r.activePlayingTurns)).toFixed(1)} ` +
        `| post-ret ${avg1(rows.map((r) => r.postRetirementTurns)).toFixed(1)} ` +
        `| fikstur ${avg1(rows.map((r) => r.teamFixtures)).toFixed(1)} ` +
        `| dakika+ ${avg1(rows.map((r) => r.heroMinutesMatches)).toFixed(1)} (11 ${avg1(rows.map((r) => r.starts)).toFixed(1)} / yedek ${avg1(rows.map((r) => r.benchEntries)).toFixed(1)})`,
    );
    console.log(
      `         hikaye ${avg1(rows.map((r) => r.storyImpressions)).toFixed(1)} ` +
        `(uniqE ${avg1(rows.map((r) => r.storyUniqueEvents)).toFixed(1)}, uniqV ${avg1(rows.map((r) => r.storyUniqueVariants)).toFixed(1)}, tekrar ${avg1(rows.map((r) => r.storyRepeatImpressions)).toFixed(1)}) ` +
        `| repeat exposure ${seasonRepeatRows.length === 0 ? 'N/A' : `${avg1(seasonRepeatRows).toFixed(1)}%`}`,
    );
    console.log(
      `         ambiyans match/reaction ${avg1(rows.map((r) => r.ambientMatchImpressions)).toFixed(1)}/${avg1(rows.map((r) => r.ambientReactionImpressions)).toFixed(1)} ` +
        `| no-story ${avg1(rows.map((r) => r.noStoryWeeks)).toFixed(1)} ` +
        `| en uzun kuraklik ${avg1(rows.map((r) => r.longestNoStoryDrought)).toFixed(1)} ` +
        `| ilk tekrar hafta ${firstRepeatWeeks.length === 0 ? 'N/A' : percentile(firstRepeatWeeks, 0.5).toFixed(0)}` +
        (gateTop.length > 0 ? ` | unseen gate top: ${gateTop}` : ''),
    );
  }

  // --- 2. SECIM ERISILEBILIRLIGI
  const shown = runs.reduce((s, r) => s + r.choicesShown, 0);
  const locked = runs.reduce((s, r) => s + r.choicesLocked, 0);
  console.log('\nSECIMLER');
  console.log(`  Gosterilen secenek       : ${shown}`);
  console.log(`  Kilitli (erisilemez)     : ${locked}  (${pct(locked, shown)})`);
  const byFlag = new Map<string, number>();
  for (const r of runs) {
    for (const [flag, n] of r.lockedBy) byFlag.set(flag, (byFlag.get(flag) ?? 0) + n);
  }
  const topLocks = [...byFlag].sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [flag, n] of topLocks) {
    console.log(`    ${flag.padEnd(24)} ${String(n).padStart(5)}  ${pct(n, locked)}`);
  }

  // --- 3. BAYRAK YORUNGELERI
  console.log('\nBAYRAK YORUNGELERI  (birlestirilmis)');
  for (const flag of TRACKED) {
    const merged: Trajectory = {
      flag,
      samples: runs.flatMap((r) => r.trajectories.find((t) => t.flag === flag)!.samples),
    };
    console.log(`  ${flag.padEnd(18)} ${describeTrajectory(merged)}`);
  }

  // --- 4. ILERLEME HIZI
  console.log('\nILERLEME  (ilk ulasilan tur, ortalama)');
  const allKeys = new Set(runs.flatMap((r) => [...r.milestones.keys()]));
  const rows = [...allKeys]
    .map((k) => ({
      key: k,
      turn: avg(runs.map((r) => r.milestones.get(k)).filter((v): v is number => v !== undefined)),
      hits: runs.filter((r) => r.milestones.has(k)).length,
    }))
    .sort((a, b) => a.turn - b.turn);
  for (const row of rows) {
    console.log(
      `  ${row.key.padEnd(18)} tur ${String(row.turn).padStart(4)}  ${row.hits}/${runs.length} kariyerde`,
    );
  }

  // --- 4b. SOHRET PUANI BILESENLERI
  //
  // Stature elle set edilmez; alttaki agirlikli toplamdan turetilir. Kademe
  // esiklerini ayarlamadan once puanin NEREDEN geldigine bakilmali: sinirsiz
  // biriken bir girdi (milli mac, kupa) tek basina merdiveni yukari kaydirir
  // ve esik yukseltmek bunu duzeltmez, yalnizca geciktirir.
  const W = loaded.registry.config.progression.statureWeights;
  console.log('\nSOHRET PUANI  (kariyer sonu, ortalama bilesen katkisi)');
  const contribs: { flag: string; value: number; points: number }[] = [];
  for (const [flag, weight] of Object.entries(W)) {
    const finals = runs
      .map((r) => r.trajectories.find((t) => t.flag === flag)?.samples ?? [])
      .filter((s) => s.length > 0)
      .map((s) => s[s.length - 1]!);
    if (finals.length === 0) {
      console.log(`  ${flag.padEnd(22)} IZLENMIYOR (TRACKED'e ekleyin)`);
      continue;
    }
    const value = avg(finals);
    contribs.push({ flag, value, points: value * weight });
  }
  const totalPoints = contribs.reduce((a, c) => a + c.points, 0);
  for (const c of contribs.sort((a, b) => b.points - a.points)) {
    const share = totalPoints > 0 ? Math.round((c.points / totalPoints) * 100) : 0;
    console.log(
      `  ${c.flag.padEnd(22)} ${String(Math.round(c.value)).padStart(9)}` +
        ` -> ${String(Math.round(c.points)).padStart(5)} puan  %${String(share).padStart(2)}`,
    );
  }
  console.log(`  ${'TOPLAM'.padEnd(22)} ${''.padStart(9)}    ${String(Math.round(totalPoints)).padStart(5)} puan`);
  const ladder = loaded.registry.config.progression.statureThresholds
    .map((t) => `${t.id} ${t.threshold}`)
    .join(' | ');
  console.log(`  esikler: ${ladder}`);

  // --- 5. KATEGORI ARALIGI
  console.log('\nKATEGORI ARALIGI  (ayni tonun iki sahnesi arasi, hafta)');
  const catGaps = new Map<string, number[]>();
  for (const r of runs) {
    for (const [cat, list] of r.gaps) {
      catGaps.set(cat, [...(catGaps.get(cat) ?? []), ...list]);
    }
  }
  for (const [cat, list] of [...catGaps].sort((a, b) => avg(a[1]) - avg(b[1]))) {
    const sorted = [...list].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    console.log(
      `  ${cat.padEnd(12)} ort ${String(avg(list)).padStart(3)}  ortanca ${String(median).padStart(3)}` +
        `  en kisa ${String(sorted[0] ?? 0).padStart(3)}  (${list.length} aralik)`,
    );
  }

  // --- 5b. KADRO REKABETI
  //
  // `isStarter` eskiden sabit `true` idi: Hero her mac ilk 11'de
  // basliyordu. Yedek kalma, rotasyon, "bu hafta oynamiyorsun"
  // gerilimi hic yasanmiyordu ve `tactics` kategorisinin anlattigi
  // temanin mekanik karsiligi yoktu.
  const started = runs.reduce((s, r) => s + r.started, 0);
  const benched = runs.reduce((s, r) => s + r.benched, 0);
  console.log('\nKADRO REKABETI');
  console.log(
    `  Ilk 11 : ${started}  |  Yedek : ${benched}  ` +
      `(yedek orani ${pct(benched, started + benched)})`,
  );

  // --- 6. MENAJER
  console.log('\nMENAJER');
  console.log(`  Imzalanan (ort)          : ${avg(runs.map((r) => r.agentSigned))}`);
  console.log(`  Transfer (ort)           : ${avg(runs.map((r) => r.transfers))}`);
  console.log(
    `  ...ezeli rakibe (ort)    : ${avg(runs.map((r) => r.rivalTransfers))}` +
      `  ${runs.some((r) => r.rivalTransfers > 0) ? '' : '  <- HIC OLMADI (mem_rakibe_transfer olu kalir)'}`,
  );
  console.log(`  Kredi cekildi (ort)      : ${avg(runs.map((r) => r.loansTaken))}`);
  console.log(`  Birakan   (ort)          : ${avg(runs.map((r) => r.agentQuit))}`);

  // --- 7. SAGLIK
  //
  // Bu iki satir raporun EN ONEMLI kismi: kariyer erken durduysa
  // yukaridaki her sayi anlamsizdir. Sessizce raporlamak, olcum aracinin
  // yapabilecegi en kotu sey olurdu.
  const deadlocks = runs.reduce((s, r) => s + r.deadlocks, 0);
  if (deadlocks > 0) {
    console.log(`\n  UYARI: ${deadlocks} kez cikilamayan sahne (tum secenekler kilitli).`);
  }
  const halted = runs.filter((r) => r.stoppedBy !== undefined);
  if (halted.length > 0) {
    console.log(`\n  HATA: ${halted.length}/${runs.length} kariyer ERKEN durdu:`);
    for (const r of halted) {
      console.log(`    tohum ${r.seed} @ tur ${r.turns}: ${r.stoppedBy}`);
    }
  }

  console.log('\nSONLAR');
  const endings = new Map<string, number>();
  for (const r of runs) {
    const key = r.ended ?? '(kariyer bitmedi -- tur siniri)';
    endings.set(key, (endings.get(key) ?? 0) + 1);
  }
  for (const [k, n] of [...endings].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(34)} ${n}`);
  }

  const manifest = buildMetricsManifest({
    tool: 'playtest',
    registry: loaded.registry,
    world: dbPath === '' ? 'mock' : dbPath,
    archetype,
    requestedSeeds: seeds,
    requestedTurns: maxTurns,
    seeds: seedList,
    playedTurns: runs.map((r) => r.turns),
    botVersion: BOT_POLICY_VERSION,
  });

  if (manifestPath !== '') {
    await writeManifest(manifest, manifestPath);
    console.log('\nMANIFEST');
    console.log(`  Yazildi                 : ${manifestPath}`);
  } else {
    console.log('\nMANIFEST');
    console.log(`  Icerik hash             : ${manifest.contentHash}`);
    // KAYNAK KIMLIGI: icerik hash'i tek basina bir olcumu geri getirmiyor.
    // Olculdu -- iki kosunun manifesti birebir ayniyken sonuclari
    // farkliydi; fark koddaydi ve manifest onu yakalamiyordu.
    console.log(`  Kaynak hash             : ${manifest.sourceHash}`);
    if (manifest.commit !== undefined) {
      console.log(
        `  Commit                  : ${manifest.commit.slice(0, 12)}` +
          (manifest.dirty === true ? '  (calisma agaci KIRLI -- commit tek basina yetmez)' : ''),
      );
    }
    console.log(`  Dunya                   : ${manifest.world}`);
    console.log(`  Bot surumu              : ${manifest.botVersion}`);
    console.log(`  Tohumlar                : ${manifest.seeds.join(', ')}`);
    console.log(`  Oynanan turlar          : ${manifest.playedTurns.join(', ')}`);
  }
}

void main();
