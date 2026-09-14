/**
 * Varsayilan sans cozucu -- xG benzeri matematiksel model.
 *
 * Kalibrasyon hedefleri (gercek futbol istatistiklerine yaslanir):
 *   penalti        ~0.76
 *   1v1            ~0.35
 *   ceza sahasi    ~0.10
 *   30m sut        <0.05
 *
 * Model uc carpandan olusur: pozisyonun geometrisi (mesafe + aci), sutorun
 * niteligi, ve savunmanin durumu (baski + kaleci). Ucu de 1 civarinda
 * carpanlardir; hicbiri tek basina sonucu belirlemez.
 */

import type {
  ChanceContext,
  ChanceResolver,
  ChanceResult,
} from '../domain/chance.js';

/** Pozisyon turune gore taban gol beklentisi. */
const BASE_XG: Readonly<Record<string, number>> = {
  penalty: 0.76,
  one_on_one: 0.35,
  rebound: 0.3,
  header: 0.12,
  open_play: 0.11,
  free_kick: 0.07,
  long_range: 0.04,
};

/**
 * Her pozisyon turunun REFERANS mesafesi.
 *
 * Geometri carpani bu mesafeden SAPMAYI olcer. Sabit bir referans (ornegin
 * hep 12m) kullanmak, tabani zaten uzak mesafeyi varsayan `long_range` gibi
 * turleri IKINCI KEZ cezalandirir ve 30m sutu 0.005'e cakar.
 */
const REFERENCE_DISTANCE: Readonly<Record<string, number>> = {
  penalty: 11,
  one_on_one: 10,
  rebound: 8,
  header: 7,
  open_play: 12,
  free_kick: 22,
  long_range: 28,
};

/**
 * NOTR NOKTALAR -- carpanlarin TIPIK girdide 1.0 vermesini saglar.
 *
 * OLCULEN SORUN: dort carpan (geometri, sutor, baski, kaleci) tek tek
 * makul gorunuyordu ama TIPIK girdilerde carpimlari 1.0 degil ~0.63
 * ediyordu. Sonuc: `BASE_XG` tablosu "open_play = 0.11" diyordu, gercekte
 * uretilen 0.068 idi. Her pozisyon turu ilan ettiginin ucte ikisine
 * dusuyordu ve kimse bunu gormuyordu.
 *
 * Olculdu (denk takimlar, varsayilan taktik):
 *   pozisyon/mac 24.9  (hedef ~24 -- DOGRU)
 *   ort xG       0.078 (hedef ~0.11)
 *   gol/mac      1.96  (gercek futbol ~2.7)
 *
 * Tur bazinda carpan: open_play 0.619 · header 0.665 · long_range 0.631
 *                     one_on_one 0.666 · free_kick 0.678
 *
 * Carpanlarin EGIMI degismedi -- yalnizca tabanlari tipik girdide 1.0
 * verecek sekilde kaydirildi. Boylece `BASE_XG` okunabilir bir sozlesme
 * olur: bir sayiyi degistiren kisi sonucun ne olacagini bilir.
 */
const NEUTRAL_SHOOTER = 0.37; //   skill 70 -> 1.00
const NEUTRAL_PRESSURE = 1.33; // pressure 60 -> 1.00
const NEUTRAL_KEEPER = 1.3375; //  keeper 75 -> 1.00

/**
 * GLOBAL xG KALIBRASYONU.
 *
 * Carpanlar notr noktalarina oturtulduktan sonra bile geometri ORTALAMADA
 * 1.0 vermiyor: `Timeline` pozisyonlari referans geometrinin biraz altinda
 * uretiyor (aci U[12,72], ortalama 42 -- referans 45; mesafeler referansin
 * ~2 m uzaginda). Bu bilincli bir tercih olabilir -- her pozisyon ideal
 * noktadan gelmez -- ama sonucu `BASE_XG` tablosunu sessizce asagi cekmek.
 *
 * Bu sabit o farki ACIKCA kapatir. Degeri teorik degil OLCULMUSTUR:
 * gercek futbolda mac basina ~2.7 gol duser; model denk takimlarda
 * (seviye 75) bu degeri verecek sekilde ayarlandi.
 *
 * Olcum (tmp/audit/calib.ts):
 *   duzeltme oncesi   gol/mac 1.96 · ort xG 0.078
 *   notr noktalardan sonra  2.39 · 0.096
 *   bu sabitle              ~2.7 · ~0.107
 */
const XG_CALIBRATION = 1.11;

/** Sut isabetsizse hangi sonuca dagilir (toplamlari 1). */
const MISS_SPLIT = { saved: 0.45, off_target: 0.35, blocked: 0.14, rebound: 0.06 } as const;

export class MathChanceResolver implements ChanceResolver {
  resolve(context: ChanceContext, roll: number): ChanceResult {
    const xG = this.expectedGoals(context);

    if (roll < xG) {
      return { outcome: 'goal', xG, playerRating: 1 + xG * 0.6 };
    }

    // Kacan sutun nasil kacugi: kalan araliga oransal dagitilir.
    const rest = (roll - xG) / Math.max(1e-6, 1 - xG);
    let acc = 0;
    for (const [outcome, share] of Object.entries(MISS_SPLIT)) {
      acc += share;
      if (rest < acc) {
        return {
          outcome: outcome as ChanceResult['outcome'],
          xG,
          // Iyi pozisyonu kacirmak daha cok cezalandirilir.
          playerRating: -0.3 - xG * 0.5,
        };
      }
    }
    return { outcome: 'saved', xG, playerRating: -0.3 - xG * 0.5 };
  }

  /** Pozisyonun gol beklentisi (0-1). Testler bunu dogrudan olcer. */
  expectedGoals(context: ChanceContext): number {
    const base = BASE_XG[context.kind] ?? 0.1;

    // Penalti geometriden etkilenmez; nokta hep ayni yerdedir. Yetenek de
    // burada BASTIRILIR: gercek futbolda penalti donusum orani sutorden
    // sutore %70-%88 arasinda oynar, acik oyundaki gibi iki katina cikmaz.
    if (context.kind === 'penalty') {
      const skill = context.shooter.shooting * 0.6 + context.shooter.composure * 0.4;
      const shooter = 0.85 + (skill / 100) * 0.3;
      const keeper = 1.08 - (context.keeperQuality / 100) * 0.2;
      return clamp01(base * shooter * keeper);
    }

    return clamp01(
      base *
        XG_CALIBRATION *
        this.geometryFactor(context) *
        this.shooterFactor(context) *
        this.defenceFactor(context) *
        this.keeperFactor(context),
    );
  }

  /**
   * Mesafe ve aci. Pozisyon turunun REFERANS mesafesinden sapma olculur;
   * uzaklastikca ustel duser, aci daraldikca dogrusal duser.
   */
  private geometryFactor(context: ChanceContext): number {
    const distance = Math.max(1, context.distance);
    const reference = REFERENCE_DISTANCE[context.kind] ?? 12;
    const distanceFactor = Math.exp(-(distance - reference) / 11);
    // 45 derece "normal" aci; 10 derecelik bir aci sansi ucte bire indirir.
    const angleFactor = 0.25 + 0.75 * Math.min(1, context.angle / 45);
    return distanceFactor * angleFactor;
  }

  /**
   * Sut yetenegi ve soguk kanlilik. TIPIK sutorde (70) tam 1.0.
   *
   * Egim korundu (0.9): 50 -> 0.82, 90 -> 1.18. Degisen yalnizca taban,
   * boylece `BASE_XG` tablosu soyledigi seyi yapar (bkz. NEUTRAL notu).
   */
  private shooterFactor(context: ChanceContext): number {
    const skill = context.shooter.shooting * 0.7 + context.shooter.composure * 0.3;
    return NEUTRAL_SHOOTER + (skill / 100) * 0.9;
  }

  /** Uzerindeki baski. TIPIK baskida (60) tam 1.0; baskisiz sut daha kolay. */
  private defenceFactor(context: ChanceContext): number {
    return NEUTRAL_PRESSURE - (context.pressure / 100) * 0.55;
  }

  /** Kaleci kalitesi. TIPIK kalecide (75) tam 1.0; elit kaleci sansi azaltir. */
  private keeperFactor(context: ChanceContext): number {
    return NEUTRAL_KEEPER - (context.keeperQuality / 100) * 0.45;
  }
}

function clamp01(v: number): number {
  return Math.max(0.005, Math.min(0.97, v));
}
