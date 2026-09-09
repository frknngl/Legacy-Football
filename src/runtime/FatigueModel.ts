/**
 * YORGUNLUK -- maç yükü, toparlanma ve sakatlık riski.
 *
 * NEDEN SIMDI:
 *   Uc flag yillardir tanimliydi ve TUKETEN taraf da baglıydı:
 *     kondisyon     -> heroProfile().physical ve .stamina
 *     tukenmislik   -> stamina'yi dogrudan yiyor (kondisyon - tukenmislik*0.5)
 *     sakatlik_riski-> hicbir sey okumuyordu
 *   Ama URETEN taraf yoktu: hicbir sey bu flag'lere yazmiyordu. Yani takvim
 *   uc maclik bir hafta uretse de oyuncu ayni tazelikte sahaya cikiyordu.
 *
 *   Takvim artik gercek yogunluk uretiyor (hafta ici + hafta sonu, milli ara,
 *   kupa, Avrupa), dolayisiyla yorgunlugun baglanacagi zemin var.
 *
 * TASARIM:
 *   Yorgunluk IKI eksende tutulur ve bu ayrim onemli:
 *
 *     tukenmislik : KISA vadeli. Mac oynayinca artar, dinlenince duser.
 *                   Sahaya ne kadar yorgun ciktigin.
 *     kondisyon   : UZUN vadeli. Antrenman ve maclarla korunur; sakatlikta ve
 *                   yasla asinir. Ne kadar dayanikli oldugun.
 *
 *   Tek bir sayi olsaydi "uc mac oynadim, iki hafta dinlendim, eski halime
 *   dondum" olurdu; oysa 34 yasindaki bir oyuncu icin donmez.
 *
 * KATMAN: saf hesap, durum tutmaz. `GameEngine` cagirir.
 */

import type { MatchImportance } from '../domain/match.js';
import type { LifeState } from '../domain/axes.js';

/** Buyuk maclar daha cok yorar: tempo, baski, seyahat. */
const IMPORTANCE_LOAD: Readonly<Record<MatchImportance, number>> = {
  league: 1,
  derby: 1.25,
  cup: 1.1,
  cup_final: 1.4,
  european: 1.35,
  national: 1.3,
};

export interface MatchLoad {
  readonly minutes: number;
  readonly importance: MatchImportance;
  readonly age: number;
  /** 0-100. Yuksek profesyonellik yuku hafifletir (beslenme, uyku, bakim). */
  readonly professionalism: number;
}

export interface FatigueDelta {
  readonly tukenmislik: number;
  readonly kondisyon: number;
}

/**
 * Bir macin yorgunluk maliyeti.
 *
 * 90 dakika lig maci ~8 tukenmislik ekler. Bir sezonda 38 mac = ~300 ham yuk;
 * haftalik toparlanma bunun cogunu geri alir, ama uc maclik haftalar
 * BIRIKTIRIR -- istenen davranis bu.
 */
export function matchLoad(load: MatchLoad): FatigueDelta {
  const share = Math.max(0, Math.min(1, load.minutes / 90));
  const importance = IMPORTANCE_LOAD[load.importance] ?? 1;

  // 30 yasindan sonra ayni mac daha cok yorar.
  const ageFactor = load.age <= 29 ? 1 : 1 + (load.age - 29) * 0.07;
  // Profesyonellik yuku en fazla %25 hafifletir -- disiplin yardim eder ama
  // maci oynamamis gibi yapmaz.
  const care = 1 - Math.max(0, Math.min(25, (load.professionalism - 50) * 0.5)) / 100;

  return {
    tukenmislik: round1(8 * share * importance * ageFactor * care),
    // Mac kondisyonu hafifce ASINDIRIR; asil kayip toparlanamamaktan gelir.
    kondisyon: -round1(0.6 * share * importance),
  };
}

export interface RecoveryInput {
  readonly matchesThisWeek: number;
  readonly age: number;
  readonly professionalism: number;
  readonly lifeState: LifeState;
  readonly currentKondisyon: number;
  readonly currentTukenmislik: number;
}

/** Antrenmanla ulasilabilecek kondisyon tavani. */
const PEAK_FITNESS = 92;

/**
 * Haftalik toparlanma.
 *
 * MAC SAYISINA DUYARLI: bos hafta tam toparlanma, tek mac kismi, uc mac
 * neredeyse hic. Takvimin uc maclik haftalar uretmesinin oyuncu icin bir
 * ANLAMI olmasi buradan gelir.
 *
 * HAYAT DURUMU:
 *   injured / rehab_clinic -> tukenmislik hizli duser (dinleniyor) ama
 *   kondisyon da duser (antrenman yok). Sahaya donen oyuncu dinc ama
 *   hazirliksizdir -- gercek olan da bu.
 */
export function weeklyRecovery(input: RecoveryInput): FatigueDelta {
  const care = 1 + Math.max(-0.2, Math.min(0.25, (input.professionalism - 50) / 200));
  const ageFactor = input.age <= 28 ? 1 : Math.max(0.55, 1 - (input.age - 28) * 0.05);

  if (input.lifeState === 'injured' || input.lifeState === 'rehab_clinic') {
    return {
      tukenmislik: -round1(6 * care),
      // Antrenmansiz gecen her hafta kondisyonu yer.
      kondisyon: -round1(2.2),
    };
  }
  if (input.lifeState === 'incarcerated') {
    return { tukenmislik: -round1(4), kondisyon: -round1(3.5) };
  }

  // KALIBRASYON:
  //   Normal bir hafta = 1 mac = +8 yuk. Toparlanma bunu KARSILAMALI, yoksa
  //   tukenmislik sezon ortasinda tavana yapisir ve eksen bilgi tasimayi
  //   birakir (olculdu: 20. haftada 97, sezon sonuna kadar orada).
  //   Gercek futbolcu da 50 mac oynayip tukenmeden sezonu bitirir; tukenme
  //   YOGUNLUK ANLARINDA olur, ortalama tempoda degil.
  //
  //   Bos hafta 14, tek mac 8.6, iki mac 6.3, uc mac 4.9.
  //   -> tek maclik hafta net -0.6 (hafif toparlanma)
  //   -> uc maclik hafta net +24.7 (sert sicrama, sonraki haftalarda erir)
  const density = 14 / (1 + input.matchesThisWeek * 0.62);
  const rest = round1(density * care * ageFactor);

  // Kondisyon ancak DINLENIRKEN degil, DUZENLI OYNARKEN artar; oynamayan
  // oyuncu da form tutamaz.
  //
  // GERI KAZANIM HIZLANIR: acik ne kadar buyukse haftalik kazanc o kadar
  // yuksek. Sabit bir oranla (0.95/hafta) uzun bir sakatliktan donen oyuncu
  // -- sakatlikta -2.2/hafta kaybederken -- eski haline iki buçuk kat surede
  // donerdi ve kariyer tek sakatlikla kalici olarak bozulurdu (olculdu:
  // kondisyon 70 -> 47). Gercek oyuncu mac kondisyonunu bes-alti haftada
  // toplar; son puanlar yavas gelir.
  const room = PEAK_FITNESS - input.currentKondisyon;
  const trainingGain = (input.matchesThisWeek === 0 ? 0.6 : 0.95) + Math.max(0, room) * 0.09;
  const gain = room <= 0 ? 0 : round1(Math.min(room, trainingGain * ageFactor * care));

  return { tukenmislik: -Math.min(rest, input.currentTukenmislik), kondisyon: gain };
}

/**
 * Sakatlik riski -- TURETILIR, birikmez.
 *
 * Her tur yeniden hesaplanir: tukenmislik ana surucu, yas ve dusuk kondisyon
 * carpan. Boylece "iki hafta dinlendim, risk dustu" dogru sekilde calisir;
 * birikimli bir sayac bunu yapamazdi.
 */
export function injuryRisk(
  tukenmislik: number,
  kondisyon: number,
  age: number,
): number {
  const base = 6;
  const fatigue = tukenmislik * 0.55;
  const unfit = Math.max(0, 70 - kondisyon) * 0.25;
  const ageRisk = age <= 30 ? 0 : (age - 30) * 1.4;
  return Math.round(Math.max(0, Math.min(95, base + fatigue + unfit + ageRisk)));
}

/**
 * Riskin haftalik sakatlanma olasiligina cevrimi.
 *
 * `sakatlik_riski` 0-95 arasi bir GOSTERGE; dogrudan olasilik degil. Oyle
 * olsaydi risk 30'da her hafta %30 sakatlanma olurdu ve kimse sezonu
 * bitiremezdi. Olcek: risk 30 -> ~%1.8/hafta (~sezonda 0.7 sakatlik),
 * risk 60 -> ~%3.6/hafta. Gercek futbolcu istatistiklerine yakin.
 */
export function weeklyInjuryChance(risk: number): number {
  return Math.max(0, Math.min(0.12, (risk / 100) * 0.06));
}

/**
 * Sakatligin agirligi -- risk yukseldikce daha uzun.
 * `roll` 0-1 arasi tohumlu bir cekilis.
 */
export function injuryWeeks(risk: number, roll: number, severeRoll = 1): number {
  // AGIR SAKATLIK KUYRUGU.
  //
  // OLCULEN SORUN: bu fonksiyon riskten TUREYEN bir sure veriyordu ve
  // gercek oyunda `sakatlik_riski` medyani 6-15 arasinda kaliyor
  // (`tukenmislik` medyani 0, p75 5 -- yorgunluk epizodik). O bantta
  // formul yalnizca 1-3 hafta uretebiliyor: `Math.min(12, ...)` tavani
  // hicbir zaman yaklasilmayan bir suslemeydi ve kariyeri tanimlayan
  // sakatlik HIC olmuyordu.
  //
  // Gercek futbolda kuyruk yorgunluktan BAGIMSIZDIR: capraz bag en dinc
  // haftanda da kopar. Bu yuzden ayri bir cekim -- riske bakmaz.
  if (severeRoll < SEVERE_INJURY_CHANCE) {
    // 10-30 hafta: sezonun kalani ya da daha fazlasi.
    return Math.round(10 + roll * 20);
  }
  const severity = 1 + Math.floor(roll * (2 + risk / 22));
  return Math.max(1, Math.min(12, severity));
}

/**
 * Bir sakatligin AGIR olma olasiligi -- yorgunluktan bagimsiz.
 *
 * KALIBRASYON OLCULDU: `weeklyInjuryChance` 26 sezonluk bir kariyerde
 * ~7,3 sakatlik uretiyor (risk medyani ~12). %6'da bu, kariyer basina
 * 0,44 agir sakatlik demekti -- yani kariyerlerin yarisindan cogunda
 * tedavi karari HIC sorulmuyordu ve modul suslemeye donuyordu.
 *
 * %12 ile kariyer basina ~0,88: cogu kariyerde bir kez, bazilarinda hic,
 * nadiren iki kez. Kariyeri tanimlayan sakatlik boyle olmali -- garanti
 * degil ama beklenebilir.
 *
 * NOT: asil dusuk olan sakatlik SIKLIGININ kendisi (sezonda 0,28;
 * gercek futbolcu ortalamasi 1-2). O `weeklyInjuryChance` kalibrasyonu
 * ayri bir denge karari ve kendi gerekcesi yazili; burada
 * degistirilmedi.
 */
export const SEVERE_INJURY_CHANCE = 0.12;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
