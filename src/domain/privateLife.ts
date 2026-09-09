/**
 * OZEL HAYAT -- hayat arkadasi.
 *
 * NEDEN YENI BIR ZINCIR KURMUYOR: motorda zaten kurulu ve olculmus bir
 * yol var --
 *
 *   iliski_aile -> moraleTarget -> moral -> heroDayFactor -> nitelikler
 *   -> mac reytingi -> form -> (geri) moraleTarget
 *
 * Ozel hayat bu yolun GIRISINE yazar. Boylece "enerji, moral, form
 * etkisi" yeni bir kuplaj degil, hali hazirda sinanan bir dongunun
 * beslenmesi olur. Kendi basina bir "form bonusu" eklemek ayni sonucu
 * verirdi ama iki ayri gercek uretirdi.
 *
 * ASIL KITLIK: ZAMAN. Bir futbolcunun haftasi doludur; asil karar bir
 * aksami neye harcadigindir. Bu yuzden her eylemin bedeli `kondisyon`
 * ve `tukenmislik` uzerinden odenir, karsiligi yakinlik olarak alinir.
 *
 * DORT ASIMETRI kararlari uretiyor:
 *
 *   1. Ihmal SIMDI bedava, SONRA pahali. Mesafe sessizce birikir.
 *   2. Bulusma tukenmisligi DUSURUR ama kondisyonu yer -- dinlenmek ile
 *      gec yatmak ayni gecede olur.
 *   3. Uzaktayken (kamp, kiralik) yalnizca sesin gider; mesafe hizlanir.
 *   4. SAKATKEN evdesin: kariyer duserken ozel hayat toparlar. Hayatin
 *      en cok duzeldigi donem, en kotu donemin olabilir.
 *
 * Denge ICERIKTE (`content/social/private-life.json`).
 */

export type Stage = 'yok' | 'tanisma' | 'iliski' | 'birlikte' | 'evli' | 'ayrilik';

/** Bir temas bicimi -- mesajdan tatile. */
export interface ContactKind {
  readonly id: string;
  readonly label: string;
  /** Kondisyon bedeli (negatif = yorar). */
  readonly kondisyon: number;
  /** Tukenmislik etkisi (negatif = dinlendirir). */
  readonly tukenmislik: number;
  /** Yakinlik kazanci. */
  readonly closeness: number;
  /** Yalnizca bu hayat durumlarinda mumkun; bos = hepsinde. */
  readonly lifeStates?: readonly string[];
  /** En az bu asamada mumkun. */
  readonly minStage?: Stage;
  /** Haftada en fazla kac kez etkili olur. */
  readonly perWeek?: number;
  /** Yalnizca sezon arasinda. */
  readonly offSeasonOnly?: boolean;
  /**
   * Bu temasin TEK BASINA cikarabilecegi en yuksek yakinlik.
   *
   * OLCULDU ve bu alan bu yuzden var: tavan yokken dort haftada bir
   * atilan BEDAVA bir mesaj yakinligi 100'e cikariyor, evlilige
   * goturuyor ve hicbir bedel odetmiyordu -- ustelik sonucu her hafta
   * bulusan oyuncudan DAHA IYIydi (moral 37,7'ye 31,7), cunku pahali
   * eylemler kondisyonu yiyor. Yani en ucuz strateji en iyisiydi ve
   * geri kalan her sey olu secenekti.
   *
   * Tavan merdiveni gercek kiliyor: mesajla iliski yurumez, sesle bir
   * yere kadar gider, gerisi icin ORADA OLMAK gerekir.
   */
  readonly maxCloseness?: number;
  readonly note?: string;
}

export interface PrivateLifeConfig {
  readonly contacts: readonly ContactKind[];
  readonly stages: readonly StageRule[];
}

/** Bir asamadan otekine gecis kosulu. */
export interface StageRule {
  readonly from: Stage;
  readonly to: Stage;
  readonly minCloseness: number;
  /** Bu asamada en az kac hafta gecmeli. */
  readonly minWeeks: number;
  readonly label: string;
}

/** Ozel hayatin durumu. */
export interface PrivateLifeState {
  stage: Stage;
  /** 0-100. Ne kadar yakinsiniz. */
  closeness: number;
  /** 0-100. Birikmis gerginlik: mesafe, basin, ihmal. */
  strain: number;
  /** Son temas turu. */
  lastContactTurn: number;
  /** Bu asamaya kacinci turda girildi. */
  stageSince: number;
  /** Cevaplanmamis ulasma sayisi -- gormezden gelmek bir EYLEMDIR. */
  unanswered: number;
  /** Bu hafta hangi temaslar kullanildi. */
  usedThisWeek: Record<string, number>;
  /**
   * Gerginligin esikte gecirdigi hafta sayisi.
   *
   * Motorun gecici alani DEGIL, durum: kaydedip yukleyince sayac
   * sifirlansaydi ayrilik kaydetmekle sonsuza kadar ertelenebilirdi.
   */
  highStrainWeeks: number;
}

export const STAGE_ORDER: readonly Stage[] = [
  'yok',
  'tanisma',
  'iliski',
  'birlikte',
  'evli',
];

/** Ayrilik esigi: gerginlik burada ve uzun sure kalirsa biter. */
export const BREAKUP_STRAIN = 85;
/** Esikte gecirilen bu kadar hafta sonra ayrilik. */
export const BREAKUP_PATIENCE = 6;

export function stageIndex(stage: Stage): number {
  const i = STAGE_ORDER.indexOf(stage);
  return i < 0 ? 0 : i;
}

/**
 * Bir temas su an mumkun mu -- degilse sebebi.
 *
 * Sebep host'a gosterilir: "kamptasin, sadece arayabilirsin" bir
 * kisitlama degil bir HIKAYEDIR ve oyuncu onu gormeli.
 */
export function contactRejection(
  kind: ContactKind | undefined,
  state: PrivateLifeState,
  lifeState: string,
  offSeason: boolean,
): string | undefined {
  if (kind === undefined) return 'Boyle bir sey yok.';
  if (state.stage === 'yok') return 'Henuz kimse yok.';
  if (state.stage === 'ayrilik') return 'O defter kapandi.';
  if (kind.minStage !== undefined && stageIndex(state.stage) < stageIndex(kind.minStage)) {
    return 'Henuz orada degilsiniz.';
  }
  if (kind.lifeStates !== undefined && !kind.lifeStates.includes(lifeState)) {
    return lifeState === 'national_duty' || lifeState === 'loaned'
      ? 'Uzaktasin. Sesin gidebilir, sen gidemezsin.'
      : 'Su an mumkun degil.';
  }
  if (kind.offSeasonOnly === true && !offSeason) return 'Sezon ortasinda olmaz.';
  const used = state.usedThisWeek[kind.id] ?? 0;
  if (kind.perWeek !== undefined && used >= kind.perWeek) {
    return 'Bu hafta bunu zaten yaptin.';
  }
  return undefined;
}

/**
 * Temasin yakinliga katkisi.
 *
 * AZALAN GETIRI: yakinlik yuksekken ayni jest daha az sey ifade eder.
 * Yoksa haftada bir mesajla ilisiki tavana yapistirmak mumkun olurdu ve
 * bulusma diye bir karar kalmazdi.
 */
export function closenessGain(kind: ContactKind, current: number): number {
  // TAVAN: bu temas tek basina buradan yukari cikaramaz. Mesaj bir
  // iliskiyi AYAKTA tutar, KURAMAZ.
  const ceiling = kind.maxCloseness ?? 100;
  if (current >= ceiling) return 0;

  const room = (100 - current) / 100;
  const gain = kind.closeness * (0.35 + room * 0.65);
  // Tavani asmaz.
  return Math.round(Math.min(gain, ceiling - current) * 10) / 10;
}

/**
 * Temasin gerginlige etkisi.
 *
 * Gerginlik yakinliktan AYRI: birine cok yakin olup ayni anda cok gergin
 * olabilirsin -- zaten iliskilerin bittigi yer tam olarak orasidir.
 * Temas gerginligi dusurur ama tamamen silmez.
 */
export function strainRelief(kind: ContactKind): number {
  return -Math.round(kind.closeness * 0.6 * 10) / 10;
}

export interface DriftContext {
  readonly turn: number;
  readonly lifeState: string;
  /** Basin baskisi -- unlu olmak iliskiyi yipratir. */
  readonly mediaPressure: number;
  /**
   * [0,1) tohumlu cekim -- HAFTALARIN BIRBIRINE BENZEMEMESI icin.
   *
   * Olculdu: cekim yokken alti tohumun altisinda da ayrilik TAM OLARAK
   * 25. turda oluyordu. Ayni sayi, ayni hafta, her kariyerde. Bu bir
   * hayat degil geri sayim sayacidir; iyi bir hafta ile kotu bir hafta
   * arasinda fark olmali.
   */
  readonly roll: number;
}

/** Bir haftalik ihmal ve mesafe etkisi. */
export interface Drift {
  readonly closeness: number;
  readonly strain: number;
  /** Bu hafta ulasti mi -- cevaplanmazsa `unanswered` artar. */
  readonly reachedOut: boolean;
}

/**
 * Haftalik kayma -- IHMAL VE MESAFE.
 *
 * Ilk iki hafta bedelsiz: kimse her hafta aranmak zorunda degil. Sonra
 * hizlanir. Uzaktayken (kamp, kiralik) iki kat, SAKATKEN yarim --
 * evdesin ve bu, kariyerin en kotu doneminin ozel hayatin en iyi donemi
 * olabilecegi anlamina gelir.
 */
export function weeklyDrift(state: PrivateLifeState, ctx: DriftContext): Drift {
  if (state.stage === 'yok' || state.stage === 'ayrilik') {
    return { closeness: 0, strain: 0, reachedOut: false };
  }

  const silent = ctx.turn - state.lastContactTurn;
  const away = ctx.lifeState === 'national_duty' || ctx.lifeState === 'loaned';
  const home = ctx.lifeState === 'injured' || ctx.lifeState === 'rehab_clinic';
  const distanceScale = away ? 2 : home ? 0.5 : 1;

  let closeness = 0;
  let strain = 0;

  if (silent > 3) {
    // Uc hafta bedelsiz. Sonra YAVAS: bir iliski kotu bir sezona
    // dayanir. Olculdu -- eski degerlerle (tavan 4/hafta) ayrilik 25.
    // turda geliyordu, yani yarim sezon aramamak bitiriyordu.
    const weeks = silent - 3;
    closeness -= Math.min(1.6, weeks * 0.18) * distanceScale;
    strain += Math.min(2.1, weeks * 0.22) * distanceScale;
  } else {
    // TEMAS VARSA gerginlik kendiliginden coker. Bu sart: yalnizca
    // tirmanan bir gerginlik tek yonlu bir mandaldir ve kariyerin
    // sonunda herkes ayrilir. Moral, sponsor ve medyada ayni deseni
    // uc kez duzeltmistik.
    strain -= 1.4;
    if (home) {
      // Evdesin ve gorusuyorsunuz: sessizce toparlar.
      closeness += 0.3;
      strain -= 0.5;
    }
  }

  // BASIN: unlu olmak iliskiyi yipratir. Kendi hayatin haber olurken
  // onunki de oluyor ve o bunu hic secmedi.
  if (ctx.mediaPressure > 55) {
    strain += (ctx.mediaPressure - 55) * 0.05;
  }

  // Cevaplanmamis ulasma birikmisse gerginlik kendi kendini buyutur.
  strain += state.unanswered * 0.6;

  // Evlilik ZEMIN saglar: ayni ihmal daha yavas yipratir. Ama bedeli de
  // buyuktur -- bitmesi halinde.
  if (state.stage === 'evli') {
    closeness *= 0.6;
    strain *= 0.7;
  }

  // HAFTALAR BIRBIRINE BENZEMEZ. Cekim yalnizca yipranmayi olcekler --
  // iyi bir hafta yarisi kadar yipratir, kotu bir hafta bir bucuk kati.
  // Toparlanmaya dokunmaz: iyi niyet sansa birakilmamali.
  const jitter = 0.5 + ctx.roll;
  if (closeness < 0) closeness *= jitter;
  if (strain > 0) strain *= jitter;

  // Uzaktayken ya da uzun sessizlikte KARSI TARAF ulasir.
  const reachedOut = silent >= 3 && (away || silent % 3 === 0);

  return {
    closeness: Math.round(closeness * 10) / 10,
    strain: Math.round(strain * 10) / 10,
    reachedOut,
  };
}

/**
 * `iliski_aile` bayragina yansiyan deger.
 *
 * Motorun okudugu tek sayi budur ve moral hedefinin zeminini kurar.
 * Gerginlik yakinliktan DUSULUR: cok yakin ama cok gergin bir iliski,
 * uzak ve sakin birinden daha kotu bir zemindir.
 */
export function familyScore(state: PrivateLifeState): number {
  if (state.stage === 'yok') return 70;
  if (state.stage === 'ayrilik') return 45;
  const raw = state.closeness - state.strain * 0.5;
  return Math.max(10, Math.min(100, Math.round(raw)));
}

/** Bir sonraki asamaya gecilebilir mi. */
export function nextStage(
  state: PrivateLifeState,
  config: PrivateLifeConfig,
  turn: number,
): StageRule | undefined {
  return config.stages.find(
    (r) =>
      r.from === state.stage &&
      state.closeness >= r.minCloseness &&
      turn - state.stageSince >= r.minWeeks &&
      state.strain < 50,
  );
}

/** Ayrilik zamani mi -- gerginlik esikte ve uzun suredir orada. */
export function shouldBreakUp(state: PrivateLifeState, highStrainWeeks: number): boolean {
  return state.strain >= BREAKUP_STRAIN && highStrainWeeks >= BREAKUP_PATIENCE;
}

/**
 * Ayriligin SERVET bedeli -- yalnizca evlilikte.
 *
 * Evlilik zemin saglar ama bedava degil: bitmesi halinde mal paylasimi
 * gercek bir rakamdir. Boylece "evlenelim mi" sorusu duygusal oldugu
 * kadar ekonomik bir karar da olur -- ve iki sistem birbirine deger.
 */
export function separationCost(stage: Stage, wealth: number): number {
  if (stage !== 'evli') return 0;
  return Math.round(Math.max(0, wealth) * 0.35);
}
