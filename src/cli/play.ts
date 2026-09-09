/**
 * OYNANABILIR PLAYGROUND -- `npm run play`
 *
 * Motor UI-bagimsiz kalir; bu dosya yalnizca ince bir terminal adaptörudur.
 * Hikayeleri, kilitli secenekleri ve kelebek gunlugunu burada gercekten
 * oynayarak gorebilirsiniz.
 *
 * Komutlar:
 *   1..9      secim yap
 *   <enter>   sonraki haftaya gec
 *   :state    flag'ler, sohret, hayat durumu, kimlik eksenleri
 *   :why      bu olay neden cikti (kelebek gunlugu)
 *   :mac      sahte host ile bir mac oyna (moment kararlari gelir)
 *   :save     kaydet   |  :load  yukle
 *   :q        cik
 */

import { createPrompt } from './prompt.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';
import { ARCHETYPES, type Archetype } from '../domain/axes.js';
import type { Position } from '../domain/actors.js';

/** Mevki etiketleri -- terminalde okunabilir olsun. */
const POSITION_LABELS: Readonly<Record<Position, string>> = {
  GK: 'Kaleci',
  DF: 'Defans',
  MF: 'Orta saha',
  FW: 'Forvet',
};
import { ContentLoader } from '../loading/ContentLoader.js';
import { FileSystemContentSource } from '../loading/FileSystemContentSource.js';
import { GameEngine, type TurnReport } from '../runtime/GameEngine.js';
import { runSimulatedMatch } from './runMatch.js';
import { selectWorld, describeWorld, type GameWorld } from './world.js';
import { windowAt } from '../domain/transfer.js';
import { WalletLedger, WALLET_KINDS, WALLET_LABELS } from '../runtime/WalletLedger.js';

const SAVE_PATH = '.saves/play.json';

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  grey: (s: string) => `\x1b[90m${s}\x1b[0m`,
};

function wrap(text: string, width = 78): string {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if ((line + word).length > width) {
        out.push(line.trimEnd());
        line = '';
      }
      line += `${word} `;
    }
    out.push(line.trimEnd());
  }
  return out.join('\n');
}

function header(r: TurnReport): string {
  return c.grey(
    `S${r.season} H${r.week} | ${r.age} yas | ${r.era} | ${r.stature} | ${r.clubTier} | ${r.mediaEra} | ${r.lifeState}`,
  );
}

function renderReport(r: TurnReport): void {
  console.log('');
  console.log(header(r));
  for (const n of r.notices) console.log(c.yellow(`  * ${n}`));

  if (r.ending) {
    console.log('');
    console.log(c.bold(c.red(`=== ${r.ending.title} ===`)));
    console.log(wrap(r.ending.epilogue));
    return;
  }

  const p = r.presented;
  if (!p) {
    console.log(c.dim('  (bu hafta sakin gecti)'));
    return;
  }

  console.log('');
  console.log(c.bold(c.cyan(p.title)) + c.grey(`  [${p.category}/${p.tier}${p.isMoment ? ' - MAC ANI' : ''}]`));
  console.log('');
  console.log(wrap(p.text));
  console.log('');
  p.choices.forEach((choice, i) => {
    if (choice.locked) {
      const label = choice.lockLabel ? `${choice.lockLabel} ` : '';
      console.log(
        c.grey(`  ${i + 1}) ${label}${choice.text}`) + c.red(`  <- kilitli: ${choice.lockReason ?? '?'}`),
      );
    } else {
      console.log(`  ${c.bold(String(i + 1))}) ${choice.text}`);
    }
  });
}

function renderState(engine: GameEngine): void {
  const s = engine.snapshot();
  console.log('');
  console.log(c.bold('--- DURUM ---'));
  console.log(
    `sohret=${s.stature}  kulup=${s.clubTier}  hayat=${s.lifeState}  medya=${s.mediaEra}  arketip=${s.archetype}`,
  );
  console.log(
    `kimlik: sadakat=${s.persona.sadakat} mizac=${s.persona.mizac} durus=${s.persona.durus} dogruluk=${s.persona.dogruluk}`,
  );
  const interesting = [
    'servet', 'borc', 'form', 'moral', 'taraftar_destegi', 'medya_itibari',
    'skandal_seviyesi', 'disiplin_sicili', 'suspension_matches', 'teknik', 'liderlik',
  ];
  console.log(interesting.map((k) => `${k}=${String(s.flags[k])}`).join('  '));

  const mem = Object.keys(s.flagSetTurn);
  if (mem.length > 0) {
    console.log(c.grey(`hafiza izleri: ${mem.map((m) => `${m}@t${s.flagSetTurn[m]}`).join(', ')}`));
  }
  if (s.scheduledEvents.length > 0) {
    console.log(
      c.yellow(
        `kuyruk: ${s.scheduledEvents.map((e) => `${e.eventId}@t${e.dueTurn}${e.priority === 'forced' ? '!' : ''}`).join(', ')}`,
      ),
    );
  }
  const av = engine.availability();
  if (!av.available) console.log(c.red(`sahaya cikamaz: ${av.reason} (${av.matchesRemaining})`));
}

/** Bir mac oynatir; moment kararlari geldiginde oyuncuya sorar. */
async function playOneMatch(
  engine: GameEngine,
  sim: GameWorld,
  ask: (q: string) => Promise<string>,
): Promise<void> {
  const week = engine.snapshot().week;
  await runSimulatedMatch(
    engine,
    sim.simulator,
    {
      onUnavailable: (av) =>
        console.log(c.red(`
Bu hafta kadroda yoksun: ${av.reason} (kalan ${av.matchesRemaining})`)),
      onMatchStart: (match) => {
        console.log('');
        console.log(
          c.bold(`>> MAC: ${match.context.opponentName} (${match.context.importance})`) +
            c.grey(`  ${match.pendingMoments.length} kritik an`),
        );
      },
      onHighlight: (h) =>
        console.log(
          c.grey(`  ${String(h.minute).padStart(2)}'  ${h.text}`) +
            (h.scorer !== undefined ? c.green(`   [${h.scoreline}]`) : ''),
        ),
      onDecision: (moment) =>
        console.log(c.yellow(`
  ${moment.minute}' -- ${moment.type}`)),
      chooseMoment: async (node) => {
        console.log('');
        console.log(c.bold(c.cyan(node.title)));
        console.log(wrap(node.text));
        node.choices.forEach((ch, i) => {
          if (ch.locked) {
            console.log(c.grey(`  ${i + 1}) ${ch.lockLabel ?? ''} ${ch.text}`) + c.red('  <- kilitli'));
          } else {
            console.log(`  ${c.bold(String(i + 1))}) ${ch.text}`);
          }
        });
        // Gecerli bir secim gelene kadar sorar; bos girdi ani atlar.
        for (;;) {
          const answer = (await ask('> ')).trim();
          if (answer === '') return undefined;
          const chosen = node.choices[Number.parseInt(answer, 10) - 1];
          if (chosen && !chosen.locked) return chosen.id;
          console.log(c.red('Gecersiz secim.'));
        }
      },
      onChoiceMade: (report) => {
        for (const n of report.notices) console.log(c.yellow(`  * ${n}`));
      },
      onResult: (_match, result, delta) => {
        console.log('');
        console.log(
          c.green(
            `<< SONUC: ${result.result} | reyting ${result.rating} | ${result.goals} gol ${result.assists} asist`,
          ),
        );
        if (delta.goalsDelta !== 0 || delta.redCard || delta.injuryWeeks > 0) {
          console.log(
            c.grey(
              `   (motor deltasi: gol ${delta.goalsDelta}, kirmizi ${delta.redCard}, sakatlik ${delta.injuryWeeks} hafta)`,
            ),
          );
        }
      },
    },
    { season: engine.snapshot().season, week },
  );
  // Hero'nun skoru tabloya islenir, ayni haftanin diger maclari cozulur.
  sim.recordHeroMatch();
  // KUPA: hero'nun kulubu bu hafta bir sey kazandiysa motora bildir.
  // `kupa_sayisi` stature formulunun en agir girdisi (agirlik 25) ve
  // bu kablo cekilmeden HER kariyerde 0 kaliyordu.
  for (const competitionId of sim.advanceWeek(week, engine.snapshot().clubId)) {
    engine.reportWorldEvent({ kind: 'trophy', competitionId });
  }
}

/**
 * MENAJER PIYASASI -- haftalik teklif akisi.
 *
 * Neden burada ve motorda degil: hangi kulubun ilgilendigi bir DUNYA
 * sorusu (piyasa, itibar, kadro ihtiyaci), menajerin o kapiyi acip
 * acamayacagi bir KARIYER sorusu. Motor ikincisini biliyor, host
 * birincisini. Bu yuzden aday kulubu host secer, karari motor verir.
 */
async function agentTurn(
  engine: GameEngine,
  sim: GameWorld,
  ask: (q: string) => Promise<string>,
): Promise<void> {
  const state = engine.snapshot();
  const current = engine.currentAgent();

  // --- MENAJERSIZ: liste yalnizca TRANSFER PENCERESINDE ve pencere
  // basina BIR KEZ acilir.
  //
  // Ilk yazimda her hafta aciliyordu ve oyun "menajer sec" ekranindan
  // ibaret hale geliyordu. Menajer bulmak bir AN olmali, surekli acik
  // duran bir menu degil.
  if (current === undefined) {
    if (windowAt(state.week) === undefined) return;
    if (state.turn - lastAgentPitchTurn < 8) return;
    const options = engine.agentOptions(4);
    if (options.length === 0) return;
    lastAgentPitchTurn = state.turn;
    console.log('');
    console.log(c.bold('Menajer arayanlar var:'));
    options.forEach((a, i) => {
      const label = ARCHETYPE_LABELS[a.archetype] ?? a.archetype;
      console.log(
        `  ${c.bold(String(i + 1))}) ${a.name}  ${c.grey(
          `${label} | erisim ${a.reach} | komisyon %${(a.commission * 100).toFixed(1)} | sadakat ${a.loyalty}`,
        )}`,
      );
    });
    console.log(c.grey('  0) Simdilik menajersiz devam et'));
    const pick = Number.parseInt(await ask('> '), 10) - 1;
    const chosen = options[pick];
    if (chosen) {
      engine.signAgent(chosen.id);
      console.log(c.yellow(`${chosen.name} ile anlastin.`));
    }
    return;
  }

  // --- MENAJERLI: kulup ilgisi -> teklif zari -> karar.
  const club = sim.roster.club(state.clubId);
  const target = pickInterestedClub(sim, state.clubId, state.turn);
  if (target === undefined) return;

  const rolled = engine.rollAgentOffer({
    clubReputation: target.reputation ?? 50,
    currentClubReputation: club?.reputation ?? 50,
    playingChance: playingChanceAt(sim, target.id),
    form: numberOf(state.flags['form']),
    seasonGoals: numberOf(state.flags['sezon_gol']),
    windowOpen: windowAt(state.week) !== undefined,
  });
  if (!rolled) return;

  console.log('');
  console.log(
    c.bold(`${current.profile.name} aradi: `) +
      `${target.name} seni istiyor. ${c.grey(`(itibar ${target.reputation})`)}`,
  );
  console.log(c.grey('  1) Kabul et   2) Reddet'));
  const answer = (await ask('> ')).trim();

  if (answer === '1') {
    const rival = club?.rivalId !== undefined && club.rivalId === target.id;
    engine.reportWorldEvent({
      kind: 'transfer',
      toClubId: target.id,
      toClubName: target.name,
      toRival: rival,
    });
    engine.reportAgentOutcome('transfer_done');
    // Onayi BURADA yaziyoruz, motorun bildirim tamponuna guvenerek degil:
    // `advanceTurn` her turun basinda tamponu temizliyor, dolayisiyla
    // turun ORTASINDA dusen bir bildirim hicbir zaman ekrana ulasmiyor.
    console.log(
      rival
        ? c.red(`${target.name}'e imza attin -- EZELI RAKIBE. Bunu kimse unutmayacak.`)
        : c.yellow(`Yeni kulubun: ${target.name}.`),
    );
  } else {
    engine.reportAgentOutcome('offer_rejected');
    const after = engine.currentAgent();
    if (after === undefined) {
      console.log(c.red(`${current.profile.name} seninle calismayi birakti.`));
    }
  }
}

/**
 * MENAJER MASASI -- `:menajer`
 *
 * Sistemin erisilemeyen yarisi buradan aciliyor. Olculdu: `GameEngine`in
 * 32 public metodundan dordu hicbir host tarafindan cagrilmiyordu ve
 * dordu de menajer sistemine aitti:
 *
 *   negotiateCommission  -- komisyon pazarligi yazildi, oynanamiyordu
 *   releaseAgent         -- menajeri kovamiyordun
 *   terminationFeeNow    -- fesih bedeli hesaplaniyor, gosterilmiyordu
 *   closeAgentSeason     -- sezon dongusu yok -> `seasonsTogether` hep 0
 *                           -> pazarliktaki sadakat primi hic devreye
 *                           girmiyordu
 *
 * `play.ts` yalnizca IMZA ve TEKLIF akisini bagliyordu; arketiplerin
 * farki (super_agent sabirsiz, family sadik) oyuncuya hic ulasmiyordu.
 */
/**
 * CUZDAN MASASI.
 *
 * OLCULEN SORUN: `servet` tek bir sayiydi. Kariyer boyunca 2,5 binden
 * 10,5 milyona cikiyordu ama "para nereye gitti" HIC gorunmuyordu.
 * Kumar ve kredi gelmeden once bu gorunur olmali -- kaybin okunmadigi
 * bir ekonomide risk almak bir karar degil, gurultudur.
 */
/**
 * KUMAR MASASI.
 *
 * Miktari OYUNCU secer -- kumarin bir karar olmasinin tek sebebi bu.
 * Eskiden `social` sahneleri `servet`e sabit bir sayi yaziyordu.
 */
/**
 * TELEFON.
 *
 * Bu masa modelin TERMINAL render'idir. Ayni `engine.phone()` ciktisini
 * bir web arayuzu kart olarak, 3D bir sahne ekrana doku olarak
 * cizebilir -- motor hicbirini bilmez.
 */
/**
 * VARLIK MASASI.
 *
 * Oyuncu para biriktiriyor ve onunla YAPACAK BIR SEY bulamiyordu
 * (servet medyani 5,4 milyon, harcama yeri yok). Uc eksen ayrisiyor:
 * getiri, gider, goze batma.
 */
async function assetDesk(
  engine: GameEngine,
  ask: (q: string) => Promise<string>,
): Promise<void> {
  const money = (n: number): string => Math.round(n).toLocaleString('tr-TR');
  const owned = engine.ownedAssets();
  const catalog = engine.assetCatalog();
  const wealth = Number(engine.snapshot().flags['servet'] ?? 0);

  console.log('');
  console.log(c.bold('VARLIKLAR') + c.grey(`   bakiye ${money(wealth)} TL`));

  if (owned.length > 0) {
    console.log(c.grey('  Sende olanlar'));
    for (const item of owned) {
      const def = catalog.find((d) => d.id === item.id);
      const paid = def?.price ?? item.value;
      const arrow = item.value >= paid ? c.green('▲') : c.red('▼');
      console.log(
        `    ${arrow} ${(def?.label ?? item.id).padEnd(26)} ${money(item.value).padStart(12)} TL` +
          c.grey(`   (alis ${money(paid)}, gider ${money(def?.upkeep ?? 0)}/hafta)`),
      );
    }
  }

  const buyable = catalog.filter((d) => !owned.some((o) => o.id === d.id));
  if (buyable.length > 0) {
    console.log('');
    console.log(c.grey('  Alinabilir'));
    buyable.forEach((d, i) => {
      const trend = d.yearlyDrift >= 0 ? c.green(`+%${Math.round(d.yearlyDrift * 100)}/yil`) : c.red(`%${Math.round(d.yearlyDrift * 100)}/yil`);
      const afford = wealth >= d.price ? '' : c.red('  (paran yetmiyor)');
      console.log(
        `    ${c.bold(String(i + 1))}) ${d.label.padEnd(26)} ${money(d.price).padStart(12)} TL  ${trend}${afford}`,
      );
      if (d.note) console.log(c.grey(`       ${d.note}`));
    });
  }

  console.log(c.grey('  <enter> vazgec | s<no> sat'));
  const answer = (await ask('  > ')).trim();
  if (answer === '') return;

  try {
    if (answer.startsWith('s')) {
      const si = Number.parseInt(answer.slice(1), 10) - 1;
      const target = owned[si];
      if (target === undefined) return;
      const got = engine.sellAsset(target.id);
      console.log(c.green(`    Satildi: ${money(got)} TL`));
      return;
    }
    const bi = Number.parseInt(answer, 10) - 1;
    const pick = buyable[bi];
    if (pick === undefined) return;
    engine.buyAsset(pick.id);
    console.log(c.green(`    ${pick.label} senin.`));
  } catch (error) {
    console.log(c.red(`    ${(error as Error).message}`));
  }
}

function phoneDesk(engine: GameEngine): void {
  const p = engine.phone();
  const money = (n: number): string => Math.round(n).toLocaleString('tr-TR');

  console.log('');
  console.log(c.bold('TELEFON') + c.grey(`   ${money(p.followers)} takipci`) +
    (p.unread > 0 ? c.red(`   ${p.unread} yeni`) : ''));

  for (const n of p.notifications) {
    console.log(n.urgent ? c.red(`  ! ${n.text}`) : c.yellow(`  · ${n.text}`));
  }

  if (p.feed.length > 0) {
    console.log('');
    console.log(c.grey('  AKIS'));
    for (const item of p.feed.slice(0, 6)) {
      const tone = item.tone === 'olumlu' ? c.green('+') : item.tone === 'olumsuz' ? c.red('-') : c.grey('·');
      console.log(`    ${tone} ${c.grey(`[${item.source}]`)} ${item.text}`);
    }
  }

  if (p.threads.length > 0) {
    console.log('');
    console.log(c.grey('  MESAJLAR'));
    for (const t of p.threads.slice(0, 6)) {
      const mark = t.unread ? c.red('*') : ' ';
      const quiet = t.silentTurns >= 12 ? c.grey(`  (${t.silentTurns} hafta sessiz)`) : '';
      console.log(`   ${mark} ${t.name.padEnd(22)} ${c.grey(t.preview)}${quiet}`);
    }
  }
}

async function casinoDesk(
  engine: GameEngine,
  ask: (q: string) => Promise<string>,
): Promise<void> {
  const money = (n: number): string => Math.round(n).toLocaleString('tr-TR');
  const games = engine.gameOptions();

  console.log('');
  console.log(c.bold('MASALAR'));
  if (games.length === 0) {
    console.log(c.grey('  Hicbir masaya oturacak paran yok.'));
    return;
  }
  games.forEach((g, i) => {
    console.log(`  ${c.bold(String(i + 1))}) ${g.label}` + c.grey(`   ${g.note ?? ''}`));
  });
  console.log(c.grey('  <enter> vazgec'));

  const gi = Number.parseInt((await ask('  > ')).trim(), 10) - 1;
  const game = games[gi];
  if (game === undefined) return;

  console.log('');
  console.log(c.bold(`  ${game.label}`));
  game.options.forEach((o, i) => {
    console.log(`    ${c.bold(String(i + 1))}) ${o.label}`);
  });
  const oi = Number.parseInt((await ask('    > ')).trim(), 10) - 1;
  const option = game.options[oi];
  if (option === undefined) return;

  const wealth = Number(engine.snapshot().flags['servet'] ?? 0);
  console.log(
    c.grey(`    Bakiye ${money(wealth)} TL  |  ${money(game.minStake)}-${money(game.maxStake)} TL`),
  );
  const stake = Number.parseInt((await ask('    Ne kadar? ')).trim(), 10);

  try {
    const result = engine.placeBet(game.id, option.id, stake);
    console.log(
      result.won
        ? c.green(`    Kazandin. +${money(result.delta)} TL`)
        : c.red(`    Kaybettin. ${money(result.delta)} TL`),
    );
  } catch (error) {
    console.log(c.red(`    ${(error as Error).message}`));
  }
}

async function walletDesk(
  engine: GameEngine,
  ask: (q: string) => Promise<string>,
): Promise<void> {
  const state = engine.snapshot();
  const money = (n: number): string => Math.round(n).toLocaleString('tr-TR');

  console.log('');
  console.log(c.bold('CUZDAN'));
  console.log(
    `  Bakiye ${c.bold(money(Number(state.flags['servet'] ?? 0)) + ' TL')}` +
      c.grey(`   haftalik maas ${money(Number(state.flags['haftalik_gelir'] ?? 0))} TL`),
  );

  const borc = Number(state.flags['borc'] ?? 0);
  if (borc > 0) console.log(c.red(`  Borc   ${money(borc)} TL`));

  const weekly = WalletLedger.weeklyNet(state, 40);
  if (weekly !== 0) {
    const arrow = weekly > 0 ? c.green('+') : c.red('');
    console.log(c.grey(`  Son sezon haftalik net: ${arrow}${money(weekly)} TL`));
  }

  // --- KATEGORI OZETI (kariyer boyu, defter sinirindan bagimsiz)
  const rows = WALLET_KINDS.map((kind) => ({
    kind,
    label: WALLET_LABELS[kind],
    net: WalletLedger.net(state, kind),
  })).filter((r) => r.net !== 0);

  if (rows.length > 0) {
    console.log('');
    console.log(c.grey('  Kariyer boyunca'));
    for (const r of rows.sort((a, b) => Math.abs(b.net) - Math.abs(a.net))) {
      const sign = r.net > 0 ? c.green(`+${money(r.net)}`) : c.red(money(r.net));
      console.log(`    ${r.label.padEnd(20)} ${sign} TL`);
    }
  }

  // --- SON HAREKETLER
  const recent = WalletLedger.recent(state, 12);
  if (recent.length === 0) {
    console.log(c.grey('\n  Henuz hareket yok.'));
    return;
  }
  console.log('');
  console.log(c.grey('  Son hareketler'));
  for (const e of recent) {
    const sign = e.amount > 0 ? c.green(`+${money(e.amount)}`) : c.red(money(e.amount));
    console.log(
      `    ${c.grey(`t${String(e.turn).padStart(4)}`)} ${sign.padEnd(22)} ${c.grey(e.label)}`,
    );
  }

  await loanSection(engine, ask, money);
}

/**
 * KREDI BOLUMU.
 *
 * Acik kredi varsa durumu, yoksa teklifleri gosterir. Tefeci teklifi
 * bilerek AYNI listede duruyor: "ucuz olan bitince pahali olan kaliyor"
 * ayrimini oyuncunun kendisi gormeli.
 */
async function loanSection(
  engine: GameEngine,
  ask: (q: string) => Promise<string>,
  money: (n: number) => string,
): Promise<void> {
  const loan = engine.currentLoan();
  if (loan !== undefined) {
    console.log('');
    console.log(c.bold('  KREDI'));
    console.log(
      `    ${loan.lender === 'tefeci' ? c.red('Tefeci') : 'Banka'}` +
        c.grey(`  haftalik ${money(loan.weekly)} TL  |  ${loan.weeksLeft} hafta kaldi`),
    );
    if (loan.missed > 0) {
      console.log(c.red(`    ${loan.missed} taksit kacirildi -- ucunde is degisir.`));
    }
    return;
  }

  const offers = engine.loanOffers();
  if (offers.length === 0) return;

  console.log('');
  console.log(c.bold('  KREDI ALABILIRSIN'));
  offers.forEach((o, i) => {
    const name = o.lender === 'tefeci' ? c.red('Tefeci') : 'Banka';
    console.log(
      `    ${c.bold(String(i + 1))}) ${name}  ${money(o.principal)} TL` +
        c.grey(`  ->  ${o.weeks} hafta x ${money(o.weekly)} TL  (toplam ${money(o.total)})`),
    );
  });
  console.log(c.grey('    <enter> vazgec'));

  const pick = Number.parseInt((await ask('    > ')).trim(), 10) - 1;
  const chosen = offers[pick];
  if (chosen === undefined) return;

  engine.takeLoan(chosen);
  console.log(c.green(`    ${money(chosen.principal)} TL hesabina gecti.`));
}

async function agentDesk(engine: GameEngine, ask: (q: string) => Promise<string>): Promise<void> {
  const current = engine.currentAgent();
  if (current === undefined) {
    console.log(c.grey('Su an menajerin yok. Transfer penceresinde teklif gelir.'));
    return;
  }

  const { profile, state } = current;
  const income = Number(engine.snapshot().flags['haftalik_gelir'] ?? 0);
  const fee = engine.terminationFeeNow(income, 2);
  const label = ARCHETYPE_LABELS[profile.archetype] ?? profile.archetype;

  console.log('');
  console.log(c.bold(`${profile.name}  ${c.grey(`(${label})`)}`));
  console.log(
    c.grey(
      `  memnuniyet ${Math.round(state.satisfaction)}/100 | komisyon %${(state.commission * 100).toFixed(1)} | ` +
        `birlikte ${state.seasonsTogether} sezon | reddedilen teklif ${state.rejectedOffers}`,
    ),
  );
  console.log(c.grey(`  erisim ${profile.reach} | sadakat ${profile.loyalty} | sabir ${profile.patience}`));
  console.log(c.grey(`  fesih bedeli: ${fee.toLocaleString('tr-TR')}`));
  console.log('');
  const left = Number(engine.snapshot().flags['sozlesme_sezon'] ?? 0);
  console.log(c.grey(`  sozlesme: ${left} sezon kaldi`));
  console.log('');
  console.log('  1) Komisyon pazarligi yap');
  console.log('  2) Menajeri birak (fesih)');
  console.log('  3) Sozlesme yenileme teklifini gor');
  console.log('  0) Kapat');

  const pick = (await ask('> ')).trim();

  if (pick === '1') {
    const raw = (await ask(`Yeni komisyon yuzdesi (su an %${(state.commission * 100).toFixed(1)}): `)).trim();
    const proposed = Number.parseFloat(raw.replace(',', '.')) / 100;
    if (!Number.isFinite(proposed) || proposed <= 0 || proposed > 0.5) {
      console.log(c.grey('Gecersiz oran.'));
      return;
    }
    const result = engine.negotiateCommission(proposed);
    if (result.accepted) {
      console.log(c.yellow(`Kabul etti. Yeni komisyon: %${(proposed * 100).toFixed(1)}`));
    } else {
      console.log(c.red(`Reddetti (${result.reason}). Memnuniyeti dustu.`));
      if (engine.currentAgent() === undefined) {
        console.log(c.red(`${profile.name} seninle calismayi birakti.`));
      }
    }
    return;
  }

  if (pick === '3') {
    // SOZLESME YENILEME.
    //
    // Menajerin `negotiation` gucu teklifi buyutur; menajersiz oyuncu
    // TABANI alir. Menajer tutmanin en somut karsiligi bu -- komisyon
    // odedigin sey burada geri geliyor (ya da gelmiyor).
    const offer = engine.contractOffer();
    const yearly = offer.weeklyWage * 52 * offer.seasons;
    const cut = Math.round(yearly * state.commission);
    console.log('');
    console.log(c.bold('KULUBUN TEKLIFI'));
    console.log(`  haftalik: ${offer.weeklyWage.toLocaleString('tr-TR')}`);
    console.log(`  sure    : ${offer.seasons} sezon`);
    console.log(c.grey(`  menajer komisyonu (imzada kesilir): ${cut.toLocaleString('tr-TR')}`));
    console.log(c.grey('  Kabul et? (e/h)'));
    if ((await ask('> ')).trim().toLowerCase() === 'e') {
      engine.renewContract(offer);
      console.log(c.yellow('Imzalandi.'));
    } else {
      console.log(c.grey('Reddettin. Sozlesme sayaci islemeye devam ediyor.'));
    }
    return;
  }

  if (pick === '2') {
    console.log(c.grey(`Fesih bedeli ${fee.toLocaleString('tr-TR')}. Onayliyor musun? (e/h)`));
    if ((await ask('> ')).trim().toLowerCase() !== 'e') return;
    engine.releaseAgent();
    console.log(c.yellow(`${profile.name} ile yollariniz ayrildi.`));
  }
}

/** Menajer teklif listesinin son gosterildigi tur -- pencere basina bir kez. */
let lastAgentPitchTurn = -99;


/**
 * BUYUK TURNUVA -- iki yilda bir, sezonun son haftasinda.
 *
 * Gercek takvim: Dunya Kupasi ve Avrupa Sampiyonasi ikiser yilda bir,
 * donusumlu olarak her CIFT yaz. Sezonu 40 haftalik modelledigimiz icin
 * 39. hafta "yaz" yerine geciyor.
 *
 * Davet kosulu milli macinkiyle AYNI (`calledUp`): turnuvaya kadroda
 * olmayan cagrilmaz. Sampiyonluk kalitenin ve sansin isi -- oyuncunun
 * gucu ne kadar yuksekse ihtimal o kadar artar ama garanti degildir.
 */
function tournamentWeek(
  engine: GameEngine,
  sim: GameWorld,
  report: { season: number; week: number },
  rng: () => number,
): void {
  if (report.week !== 39 || report.season % 2 !== 0) return;
  if (!sim.countryOfClub || !sim.calledUp) return;

  const hero = engine.heroProfile();
  const quality = Math.round((hero.technical + hero.physical) / 2);
  if (!sim.calledUp(sim.countryOfClub(engine.snapshot().clubId), quality)) return;

  const name = (report.season / 2) % 2 === 0 ? 'Dunya Kupasi' : 'Avrupa Sampiyonasi';
  // Yedi mac tam turnuva; erken elenirse dort.
  const deep = rng() < quality / 130;
  engine.reportWorldEvent({
    kind: 'tournament',
    name,
    matches: deep ? 7 : 4,
    won: deep && rng() < quality / 260,
  });
}

/** Milli ara haftalari -- `CalendarConstraints.internationalWindows`. */
const NATIONAL_WEEKS = new Set([5, 11, 17, 26, 33]);

/**
 * SEZON KAPANISI ve MILLI ARA.
 *
 * Ikisi de hicbir host tarafindan cagrilmiyordu:
 *   * `finishSeason()` cagrilmadigi icin LIG SAMPIYONU hic hesaplanmadi,
 *     kume dusme/cikma hic olmadi, dunya otuz sezon donuk kaldi ve
 *     `kupa_sayisi` her kariyerde 0 kaldi.
 *   * Milli davet kapisi cagrilmadigi icin `milli_mac_sayisi` 0 kaldi ve
 *     `national_duty` hayat durumu hic acilmadi.
 *
 * Ikisi de stature formulunun girdisi (kupa 25, milli mac 1.5 agirlik).
 * Sifir kalinca `superstar` (330), `icon` (460) ve `legend` (620)
 * esikleri ULASILAMAZ oluyordu -- yedi kademenin ucu olu, o kademelere
 * kapili icerik de gorunmez. Olculdu: kablolar cekilince `star` 1/6
 * kariyerden 3/3'e, `superstar` hicten 1/3'e cikti.
 */
let lastSeason = 1;

function seasonAndNational(
  engine: GameEngine,
  sim: GameWorld,
  report: { season: number; week: number },
): void {
  if (report.season !== lastSeason) {
    lastSeason = report.season;

    // MENAJER SEZONU KAPANIR.
    //
    // Cagrilmadigi icin `seasonsTogether` hep 0 kaliyordu ve
    // `negotiationChance` icindeki sadakat primi (sezon basina +0.04)
    // hic devreye girmiyordu. Yani "uzun sure birlikte calismak" hicbir
    // sey kazandirmiyordu -- arketip secimini anlamli kilan seylerden
    // biri sessizce olu duruyordu.
    //
    // Formda mi: son bes macin ortalamasi (form) 55 uzeriyse evet.
    engine.closeAgentSeason(Number(engine.snapshot().flags['form'] ?? 0) >= 55);

    const outcome = sim.finishSeason();
    const myClub = engine.snapshot().clubId;
    for (const [leagueId, clubId] of Object.entries(outcome.champions)) {
      if (clubId === myClub) {
        engine.reportWorldEvent({ kind: 'trophy', competitionId: leagueId });
      }
    }
  }

  tournamentWeek(engine, sim, report, () => Math.random());

  if (NATIONAL_WEEKS.has(report.week) && sim.countryOfClub && sim.calledUp) {
    const hero = engine.heroProfile();
    const quality = Math.round((hero.technical + hero.physical) / 2);
    if (sim.calledUp(sim.countryOfClub(engine.snapshot().clubId), quality)) {
      engine.reportWorldEvent({ kind: 'national_call', matches: 2 });
    }
  }
}

const ARCHETYPE_LABELS: Record<string, string> = {
  super_agent: 'Super Ajan',
  family: 'Aile Uyesi',
  developer: 'Gelisim Odakli',
  opportunist: 'Firsatci',
  journeyman: 'Siradan',
};

/**
 * Bu hafta Hero'yla kim ilgileniyor.
 *
 * ITIBAR BANDI SART:
 *   Ilk yazimda aday kulup tum listeden rastgele seciliyordu ve 89
 *   itibarli kulupteki oyuncuya 26 itibarli kulup teklif getiriyordu.
 *   Menajer sistemi teknik olarak calisiyordu ama sonuc sacmaydi --
 *   "kim ister" sorusunun cevabi "herkes" olamaz.
 *
 *   Band: mevcut kulubun 12 puan altindan yukarisi. Asagi dogru kucuk
 *   bir tolerans var cunku forma sansi icin bir basamak inmek gercek
 *   bir kariyer karari; ama iki lig birden dusmek teklif degil hakaret.
 *
 * Secim turdan turetilir -- `Math.random` DEGIL ve motorun RNG'sine de
 * dokunmaz: kaydet/yukle determinizmi bozulmasin.
 */
function pickInterestedClub(sim: GameWorld, currentClubId: string, turn: number) {
  const current = sim.roster.club(currentClubId)?.reputation ?? 50;
  const clubs = sim.roster
    .clubs()
    .filter((cl) => cl.id !== currentClubId && (cl.reputation ?? 0) >= current - 12);
  if (clubs.length === 0) return undefined;
  return clubs[(turn * 2654435761) % clubs.length];
}

function playingChanceAt(sim: GameWorld, clubId: string): number {
  const squad = sim.roster.squad(clubId);
  // Kaba tahmin: kadro ne kadar guclu, ilk 11 sansi o kadar dusuk.
  const avg = squad.length === 0 ? 60 : squad.reduce((s, p) => s + (p.quality ?? 60), 0) / squad.length;
  return Math.max(5, Math.min(95, Math.round(110 - avg)));
}

function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

async function main(): Promise<void> {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  if (loaded.issues.length > 0) {
    console.log(c.red(`Icerikte ${loaded.issues.length} sorun var. "npm run validate" calistirin.`));
    for (const i of loaded.issues.slice(0, 10)) {
      console.log(c.grey(`  [${i.file}] ${i.path}: ${i.message}`));
    }
  }
  if (!loaded.registry) {
    console.log(c.red('Icerik yuklenemedi.'));
    process.exitCode = 1;
    return;
  }
  console.log(c.grey(`${loaded.eventCount} olay yuklendi.`));

  const { ask, close } = await createPrompt(stdin, stdout);

  console.log('');
  console.log(c.bold('LEGACY FOOTBALL V3 -- playground'));
  console.log('Arketip sec:');
  loaded.registry.config.archetypes.forEach((a, i) => {
    console.log(`  ${c.bold(String(i + 1))}) ${a.label} ${c.grey(`(${a.startAge} yas)`)} - ${a.note}`);
  });

  const pick = Number.parseInt(await ask('> '), 10) - 1;
  const archetype: Archetype =
    loaded.registry.config.archetypes[pick]?.id ?? (ARCHETYPES[0] as Archetype);

  const seedArg = process.argv.find((a) => a.startsWith('--seed='));
  const seed = seedArg ? Number.parseInt(seedArg.split('=')[1] ?? '1', 10) : 20260907;

  const dbPath = process.argv.find((a) => a.startsWith('--world='))?.split('=')[1] ?? '';
  const sim = await selectWorld({ registry: loaded.registry, seed, dbPath });
  console.log(`dunya: ${describeWorld(sim, dbPath)}`);
  const engine = new GameEngine(loaded.registry, {
    seed,
    roster: sim.roster,
    world: sim.world,
    worldFeed: sim.worldFeed,
  });
  // Kimya kablosu: motor kuruldu, simulator artik 'kim kiminle iyi
  // anlasiyor' sorusunu sorabilir. Motorun flag sozlugu yine kapali.
  sim.simulator.useChemistrySource((id) => engine.chemistryFor(id));

  // --- MEVKI SECIMI
  //
  // Arketip "nereden geldigini" belirler, mevki "ne olacagini". Oyun testinde
  // ilk gorulen eksik buydu: arketip secilip dogrudan oyuna duselüyordu.
  const archetypeDef = loaded.registry.config.archetypes.find((a) => a.id === archetype)!;
  console.log('');
  console.log(c.bold('Mevkin ne?'));
  const options = engine.positionOptions();
  const playable = options.filter((o) => o.playable);
  playable.forEach((o, i) => {
    const tag = o.position === archetypeDef.startPosition ? c.grey('  (arketipin dogali)') : '';
    console.log(`  ${c.bold(String(i + 1))}) ${POSITION_LABELS[o.position]}${tag}`);
  });
  // Kilitli mevkiler de GORUNUR -- ama sebebiyle. "Yakinda" demek yerine
  // neyin eksik oldugunu soylemek durust.
  for (const o of options.filter((x) => !x.playable)) {
    console.log(`  ${c.grey('-')} ${c.grey(POSITION_LABELS[o.position])} ${c.grey(`[kilitli: ${o.reason ?? 'henuz acilmadi'}]`)}`);
  }
  const posPick = Number.parseInt(await ask('> '), 10) - 1;
  const position = playable[posPick]?.position ?? archetypeDef.startPosition;

  // --- ILK KULUP SECIMI
  //
  // Ayni seviyeden birkac kulup sunulur. Fark ITIBAR: guclu kulupte ilk 11
  // zor, zayifta kolay. Oyuncunun "buyuk kulupte yedek mi, kucukte oynayan mi"
  // tercihini BILEREK yapabilmesi icin sans yuzdesi de gosterilir.
  const clubOptions = engine.startingClubOptions(archetype);
  let clubId: string | undefined;
  if (clubOptions.length > 0) {
    console.log('');
    console.log(c.bold('Ilk imzayi kime atiyorsun?'));
    clubOptions.forEach((o, i) => {
      console.log(
        `  ${c.bold(String(i + 1))}) ${o.name}  ${c.grey(`itibar ${o.reputation} | ilk 11 sansi ~%${o.playingChance}`)}`,
      );
    });
    const clubPick = Number.parseInt(await ask('> '), 10) - 1;
    clubId = clubOptions[clubPick]?.clubId ?? clubOptions[0]!.clubId;
  }

  console.log('');
  renderReport(
    engine.start(archetype, {
      position,
      ...(clubId === undefined ? {} : { clubId }),
    }),
  );
  console.log(c.grey('\nKomutlar: <enter> hafta gec | 1-9 sec | :mac | :cuzdan | :kumar | :varlik | :telefon | :menajer | :state | :why | :save | :load | :q'));

  for (;;) {
    const input = (await ask('\n> ')).trim();

    if (input === ':q') break;

    if (input === ':varlik') {
      await assetDesk(engine, ask);
      continue;
    }

    if (input === ':telefon') {
      phoneDesk(engine);
      continue;
    }

    if (input === ':kumar') {
      await casinoDesk(engine, ask);
      continue;
    }

    if (input === ':cuzdan') {
      await walletDesk(engine, ask);
      continue;
    }

    if (input === ':menajer') {
      await agentDesk(engine, ask);
      continue;
    }

    if (input === ':state') {
      renderState(engine);
      continue;
    }

    if (input === ':why') {
      const node = engine.currentNode();
      if (!node) {
        console.log(c.grey('Acik bir olay yok.'));
        continue;
      }
      const reasons = engine.explain(node.eventId);
      if (reasons.length === 0) {
        console.log(c.grey('Bu olayin arkasinda gecmis bir karar yok -- kosulsuz cikti.'));
      } else {
        console.log(c.yellow('Bu olay su yuzden cikti:'));
        for (const r of reasons) console.log(c.yellow(`  - ${r}`));
      }
      continue;
    }

    if (input === ':save') {
      await mkdir('.saves', { recursive: true });
      await writeFile(SAVE_PATH, JSON.stringify(engine.save(), null, 2), 'utf-8');
      console.log(c.green(`Kaydedildi: ${SAVE_PATH}`));
      continue;
    }

    if (input === ':load') {
      try {
        engine.load(JSON.parse(await readFile(SAVE_PATH, 'utf-8')));
        console.log(c.green('Yuklendi.'));
      } catch {
        console.log(c.red('Kayit bulunamadi.'));
      }
      continue;
    }

    if (input === ':mac') {
      try {
        await playOneMatch(engine, sim, ask);
      } catch (err) {
        console.log(c.red((err as Error).message));
      }
      continue;
    }

    const node = engine.currentNode();

    if (input === '') {
      if (node) {
        console.log(c.red('Once bu karari ver (1-9).'));
        continue;
      }
      try {
        const report = engine.advanceTurn();
        renderReport(report);
        seasonAndNational(engine, sim, report);
        // Menajer piyasasi haftalik dongunun parcasi: teklif akisi
        // olaylardan BAGIMSIZ isler, cunku transfer bir sahne degil bir
        // surec -- her hafta arka planda birileri seni izliyor.
        await agentTurn(engine, sim, ask);
      } catch (err) {
        console.log(c.red((err as Error).message));
      }
      continue;
    }

    const idx = Number.parseInt(input, 10) - 1;
    if (Number.isNaN(idx) || !node) {
      console.log(c.grey('Anlasilmadi. <enter> ile haftayi gec ya da :q ile cik.'));
      continue;
    }
    const choice = node.choices[idx];
    if (!choice) {
      console.log(c.red('Boyle bir secenek yok.'));
      continue;
    }
    if (choice.locked) {
      console.log(c.red(`Kilitli: ${choice.lockReason ?? 'kosul saglanmiyor'}`));
      continue;
    }
    renderReport(engine.choose(choice.id));
  }

  close();
  console.log(c.grey('\nGorusuruz.'));
}

await main();
