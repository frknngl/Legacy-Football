/**
 * KIMYA ve SOYUNMA ODASI -- durum yonetimi.
 *
 * Saf matematik `domain/chemistry.ts`te; burasi onu kariyer durumuna uygular
 * ve odanin toplam havasini hesaplar. Ayrim katman kuralindan geliyor:
 * `simulation` da ayni matematigi okuyor ve `runtime`i import edemez.
 */

export {
  applyChemistry,
  assistWeightFactor,
  chanceFactor,
  chemistryDecay,
  chemistryGain,
} from '../domain/chemistry.js';

/**
 * SOYUNMA ODASI HUZURU -- squad slotlarinin agirlikli ortalamasi.
 *
 * Kaptan ve teknik direktor odanin tonunu belirler; kadronun geri kalani
 * arka plandir. Duz ortalama alsaydik 18 kisilik bir kadroda kaptanla
 * iliskinin bozulmasi hicbir sey degistirmezdi.
 */
export const HARMONY_WEIGHTS: Readonly<Record<string, number>> = {
  captain: 3,
  manager: 3,
  star_teammate: 2.5,
  assistant: 1.5,
  rival_teammate: 1.5,
  keeper: 1.2,
  veteran: 1.2,
  youngster: 1,
};

export function dressingRoomHarmony(
  relations: ReadonlyMap<string, number>,
): number | undefined {
  let total = 0;
  let weight = 0;
  for (const [slotId, relation] of relations) {
    const w = HARMONY_WEIGHTS[slotId] ?? 0;
    if (w === 0) continue;
    total += relation * w;
    weight += w;
  }
  return weight === 0 ? undefined : Math.round(total / weight);
}

/** Huzurun haftalik moral kaymasi. */
export function harmonyMoraleDrift(harmony: number | undefined): number {
  if (harmony === undefined) return 0;
  if (harmony < 35) return -2;
  if (harmony > 70) return 1;
  return 0;
}

/**
 * MORAL HEDEFI -- moral bir SAYAC degil, durumun yankisidir.
 *
 * OLCULEN SORUN: moral tek yonlu bir mandaldi.
 *   - Icerik 93 pozitif (+850) karsilik 503 negatif (-5329) efekt yaziyor
 *   - Motorun tek duzeltmesi de asimetrikti (uyum<35 -> -2, uyum>70 -> +1)
 *   - Hicbir TOPARLANMA yoktu
 * Sonuc: 6 kariyerlik olcumde moralin MEDYANI 0 cikti (p25 0, p75 8).
 * Yani moral bir sinyal degil, sabitti -- ve sahaya baglanmasi anlamsizdi.
 *
 * Cozum: her hafta moral bir HEDEFE dogru kayar. Hedef oyuncunun gercek
 * durumundan turer: soyunma odasi huzuru ve son maclardaki form. Icerik
 * soklari (bir olay -15 yazar) hala aninda ve serttir; fark, zamanla
 * toparlanabilmesidir.
 *
 * Neden `form` girdisi: iyi oynayan mutlu olur. Bu, kariyerin kendi
 * dongusunu kapatir -- moral sahayi, saha morali etkiler.
 */
export function moraleTarget(
  harmony: number | undefined,
  form: number,
  /**
   * AILE ILISKISI -- `iliski_aile`.
   *
   * OLCULEN SORUN: bu bayragi dort icerik olayi yaziyordu ve NE icerik NE
   * motor okuyordu. "Babanla konustun, arayi duzelttin" yazan sahnenin
   * hicbir sonucu yoktu.
   *
   * Aile moralin ZEMINI: soyunma odasi ve form haftalik dalgalanmadir,
   * aile arkada durur. Katkisi bu yuzden huzurdan kucuk ama sifir degil.
   */
  family = 70,
): number {
  const harmonyPart = harmony === undefined ? 0 : (harmony - 50) * 0.4;
  const formPart = (form - 50) * 0.3;
  // Varsayilan 70 oldugu icin referans da 70: ailesi normal olan oyuncu
  // ne prim alir ne ceza yer.
  const familyPart = (family - 70) * 0.25;
  // 15-85 bandi: ne tam mutsuzluk ne tam huzur kalici olabilir.
  return Math.max(15, Math.min(85, 50 + harmonyPart + formPart + familyPart));
}

/**
 * Hedefe dogru haftalik kayma. Boslugun beste biri, en cok 5 puan.
 *
 * Yavas OLMALI: tek haftada hedefe sicrasaydi icerigin yazdigi -15'lik
 * sok bir sonraki hafta silinir ve kararlarin agirligi kaybolurdu.
 */
export function moraleRecovery(current: number, target: number): number {
  const gap = target - current;
  if (Math.abs(gap) < 1) return 0;
  const step = gap / 5;
  return Math.max(-5, Math.min(5, step));
}
