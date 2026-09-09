/**
 * MEDYA -- baskinin sonmesi ve itibarin toparlanmasi.
 *
 * OLCULEN SORUN: iki bayrak da ZIT uclarda kilitliydi.
 *
 *   `medya_baskisi`  medyan 99,99  (p25 98,8)   TAVANDA
 *   `medya_itibari`  medyan 15                  dipte
 *
 * Ikisi de tek yonlu mandaldi. Baskiyi yalnizca icerik yukseltiyor,
 * hicbir sey dusurmuyordu; itibara ise icerik net -851 yaziyor (176
 * pozitif / 232 negatif) ve toparlanma yoktu.
 *
 * Sonuc: her iki bayrak da SABIT hale geliyor ve okunmalari anlamsizlasiyor.
 * Tavana yapismis bir baski "su an ne kadar baski var" sorusuna cevap
 * vermez; dipte kalmis bir itibar da oyle. Moralde ve sponsor iliskisinde
 * ayni tuzak vardi, cozum de ayni.
 *
 * NEDEN BU MEKANIK DOGRU: haber dongusu gercekten soner. Bir hafta herkes
 * seni konusur, uc hafta sonra baska bir sey olur. Itibar ise sahadaki ve
 * saha disindaki davranisin yavas bir ortalamasidir -- tek bir skandalla
 * silinmez, tek bir golle geri gelmez.
 */

/**
 * HAFTALIK HABER DONGUSU -- baski kendiliginden soner.
 *
 * Oransal: yuksek baski hizli duser (gundem doludur, senden baskasi da
 * vardir), dusuk baski yavas. Taban sifir degil: bir profesyonel futbolcu
 * uzerinde her zaman biraz gozlem vardir.
 */
export function pressureDecay(current: number): number {
  const floor = 8;
  if (current <= floor) return 0;
  // Fazlanin onda biri, en az 1 puan -- yoksa 100'den inmesi otuz hafta surer.
  return -Math.max(1, (current - floor) / 10);
}

/**
 * ITIBAR HEDEFI -- davranisin ve tanınırlığın yavas ortalamasi.
 *
 * Uc girdi:
 *   taraftar destegi -- seni sevenler basina da yansir
 *   disiplin sicili  -- kart, ceza, skandal; YUKSEK olmasi KOTU
 *   sohret           -- taninmayan oyuncu hakkinda yazi cikmaz
 */
export function reputationTarget(
  fanSupport: number,
  disciplineRecord: number,
  fameIndex: number,
): number {
  const fans = clamp(fanSupport);
  const discipline = clamp(disciplineRecord);
  const fame = Math.max(0, Math.min(1, fameIndex));
  const raw = 25 + (fans - 50) * 0.35 + fame * 25 - discipline * 0.3;
  return Math.max(5, Math.min(85, raw));
}

/**
 * Hedefe dogru haftalik kayma -- boslugun sekizde biri, en cok 2,5 puan.
 *
 * Bilerek YAVAS: itibar bir ruh hali degil, yillarin birikimi. Tek bir
 * sahnenin yazdigi -10 haftalarca tasinmali, ertesi hafta silinmemeli.
 */
export function reputationDrift(current: number, target: number): number {
  const gap = target - current;
  if (Math.abs(gap) < 1) return 0;
  // Olculerek secildi: onikide bir / 1,5 tavaniyla icerigin drenajina
  // (net -851, 408 efekt) yetismiyordu ve medyan 15'te kaliyordu.
  return Math.max(-2.5, Math.min(2.5, gap / 8));
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}
