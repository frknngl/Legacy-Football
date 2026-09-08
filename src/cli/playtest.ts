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
import { GameEngine, type TurnReport } from '../runtime/GameEngine.js';
import { Rng } from '../selection/Rng.js';
import { randomOpenChoice, runSimulatedMatch } from './runMatch.js';
import { selectWorld } from './world.js';
import { botTurn } from './bot.js';

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
] as const;

interface Trajectory {
  readonly flag: string;
  readonly samples: number[];
}

interface CareerMeasure {
  readonly seed: number;
  readonly turns: number;
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
  readonly shownAmbient: Map<string, number>;
  /** Ayni metnin IKINCI kez goruldugu ilk tur. */
  readonly firstRepeatTurn: number | undefined;
  /** Kariyer erken bittiyse hangi hata yuzunden. */
  readonly stoppedBy: string | undefined;
  readonly ended: string | undefined;
}

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
  const engine = new GameEngine(registry, {
    seed,
    roster: world.roster,
    world: world.world,
    worldFeed: world.worldFeed,
  });
  // KIMYA KABLOSU -- simulate'te var, burada yoktu. Simulator "kim
  // kiminle iyi anlasiyor" sorusunu motora bu kanaldan sorar.
  world.simulator.useChemistrySource((id) => engine.chemistryFor(id));
  engine.start(archetype);

  const rng = new Rng(seed ^ 0x5eed);
  const trajectories = new Map<string, number[]>(TRACKED.map((f) => [f, []]));
  const milestones = new Map<string, number>();
  const gaps = new Map<string, number[]>();
  const lastSeen = new Map<string, number>();
  const lockedBy = new Map<string, number>();
  const scenesPerTurn = new Map<number, number>();
  /** Son sayilan olay -- ayni olayin dugumleri tekrar sayilmasin. */
  let lastEventKey: string | undefined;
  const shownStory = new Map<string, number>();
  const shownAmbient = new Map<string, number>();
  let firstRepeatTurn: number | undefined;

  let storyTurns = 0;
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
  let stoppedBy: string | undefined;
  let lastSeason = 1;

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
  const drain = (turn: number): boolean => {
    let sawStory = false;
    let inThisTurn = 0;
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
      const category = node.category ?? 'bilinmiyor';
      const eventKey = node.variantId ? `${node.eventId}#${node.variantId}` : node.eventId;

      // Tekrar sayimi: olay basina, dugum basina DEGIL. Ayni olayin
      // branch ve outcome dugumleri tek sahnedir.
      if (eventKey !== lastEventKey) {
        const bucket = AMBIENT.has(category) ? shownAmbient : shownStory;
        const before = bucket.get(eventKey) ?? 0;
        bucket.set(eventKey, before + 1);
        if (before === 1 && firstRepeatTurn === undefined) firstRepeatTurn = turn;
      }

      if (!AMBIENT.has(category) && eventKey !== lastEventKey) {
        lastEventKey = eventKey;
        sawStory = true;
        const previous = lastSeen.get(category);
        if (previous !== undefined) {
          const list = gaps.get(category) ?? [];
          list.push(turn - previous);
          gaps.set(category, list);
        }
        lastSeen.set(category, turn);
        inThisTurn += 1;
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
    // KAC SAHNE AYNI TURDA: kategori araliginin ortancasi 0 cikiyordu,
    // yani ayni tonun iki sahnesi ayni hafta icinde arka arkaya
    // geliyor. Sebebin zincirleme mi yoksa secici mi oldugunu ayirt
    // etmek icin turdaki sahne sayisini da sayiyoruz.
    if (inThisTurn > 0) {
      scenesPerTurn.set(inThisTurn, (scenesPerTurn.get(inThisTurn) ?? 0) + 1);
    }
    return sawStory;
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
    const sawStory = drain(report.turn);

    if (sawStory) storyTurns += 1;
    else quietTurns += 1;

    // Mac oynanir: yorgunluk, form ve kondisyon yorungeleri ancak
    // sahaya cikilirsa hareket eder. Macsiz bir olcum, yorgunluk
    // sisteminin olu oldugu sonucunu verirdi -- yanlis olarak.
    //
    // Acik dugum kalmissa mac ATLANIR: `presentMoment` acik bir an
    // uzerine ikincisini koymayi reddediyor ve hakli olarak patliyor.
    //
    // Dugum hala acikken mac ATLANIR ama olcum devam eder: ornekleme
    // asagida, `continue` ile atlanmamali.
    const week = engine.snapshot().week;
    {
      try {
        await runSimulatedMatch(
          engine,
          world.simulator,
          {
          // MAC ANLARI da sayilir. Bunlar `drain()`den gecmez --
          // `runSimulatedMatch` kendi ic dongusunde tuketir. Sayilmazsa
          // sahne butcesinin %21'i olcumun disinda kalir ve tekrar
          // raporu oldugundan iyi gorunur.
          chooseMoment: (node) => {
            const key = node.variantId ? `${node.eventId}#${node.variantId}` : node.eventId;
            const before = shownAmbient.get(key) ?? 0;
            shownAmbient.set(key, before + 1);
            if (before === 1 && firstRepeatTurn === undefined) firstRepeatTurn = report.turn;
            return randomOpenChoice(node, (max) => rng.int(max));
          },
        },
          { season: engine.snapshot().season, week },
        );
          // KADRO REKABETI olcumu: bu mac ilk 11'de mi baslandi.
        if (engine.snapshot().flags['is_starter'] === false) benched += 1;
        else started += 1;
      world.recordHeroMatch();
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

  return {
    seed,
    turns,
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
    shownStory,
    shownAmbient,
    firstRepeatTurn,
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
  const archetype = arg('archetype', 'street') as Archetype;
  const dbPath = arg('world', '');

  if (!ARCHETYPES.includes(archetype)) {
    console.log(`Bilinmeyen arketip: ${archetype}`);
    process.exitCode = 1;
    return;
  }

  console.log(`=== PLAYTEST | ${seeds} tohum x ${maxTurns} tur | ${archetype} ===\n`);

  const runs: CareerMeasure[] = [];
  for (let i = 0; i < seeds; i += 1) {
    runs.push(await measure(loaded.registry, 1000 + i * 37, archetype, maxTurns, dbPath));
  }

  // --- 1. RITIM
  const totalTurns = runs.reduce((s, r) => s + r.turns, 0);
  const quiet = runs.reduce((s, r) => s + r.quietTurns, 0);
  console.log('RITIM');
  console.log(`  Kariyer uzunlugu (ort)   : ${avg(runs.map((r) => r.turns))} tur`);
  console.log(`  Hikaye sahnesi olan hafta: ${pct(totalTurns - quiet, totalTurns)}`);
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
  const merge = (pick: (r: CareerMeasure) => Map<string, number>) => {
    const total = new Map<string, number>();
    for (const r of runs) {
      for (const [k, n] of pick(r)) total.set(k, (total.get(k) ?? 0) + n);
    }
    const shows = [...total.values()].reduce((s, v) => s + v, 0);
    return { total, shows, unique: total.size, ratio: total.size === 0 ? 0 : shows / total.size };
  };
  const story = merge((r) => r.shownStory);
  const ambient = merge((r) => r.shownAmbient);

  console.log('\nTEKRAR');
  console.log(
    `  HIKAYE    : ${story.shows} gosterim / ${story.unique} benzersiz  ` +
      `-> ${story.ratio.toFixed(1)}x tekrar`,
  );
  console.log(
    `  AMBIYANS  : ${ambient.shows} gosterim / ${ambient.unique} benzersiz  ` +
      `-> ${ambient.ratio.toFixed(1)}x tekrar`,
  );
  const repeats = runs
    .map((r) => r.firstRepeatTurn)
    .filter((v): v is number => v !== undefined);
  console.log(
    `  Ilk tekrarin turu (ort)  : ${repeats.length === 0 ? '-- (tekrar yok)' : avg(repeats)}`,
  );

  const worst = [...story.total, ...ambient.total]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.log('  EN COK TEKRAR EDEN 10 METIN:');
  for (const [key, n] of worst) {
    console.log(`    ${String(n).padStart(4)}x  ${key}`);
  }

  // Kategori bazinda tekrar -- nerede en kotu?
  const byCat = new Map<string, { shows: number; uniq: Set<string> }>();
  for (const [key, n] of [...story.total, ...ambient.total]) {
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
}

void main();
