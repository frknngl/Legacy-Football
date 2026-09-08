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
