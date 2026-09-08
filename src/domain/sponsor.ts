/**
 * SPONSORLUK GELIRI.
 *
 * OLCULEN SORUN: `iliski_sponsor` bayragini **12 icerik olayi yaziyordu**
 * ve NE icerik NE motor onu okuyordu. "Cekimde surat astin, marka
 * rahatsiz" yazan her sahne sessizce etkisizdi.
 *
 * TASARIM: sponsorluk bir HEDIYE degil, bir KAPI. Iliskisi bozuk oyuncuya
 * marka para vermez -- 35'in altinda gelir SIFIRDIR. Boylece 12 sahnenin
 * yazdigi her puan gercek bir bedele donusur.
 *
 * Ikinci girdi sohret: bilinmeyen oyuncuya kimse sponsor olmaz. Ucuncusu
 * medya itibari -- skandal bir isimle marka calismaz.
 *
 * Miktar bilerek MUTEVAZI. Olcum zaten "icerik maastan cok para veriyor"
 * diyor (901 turluk kariyerde olaylar 8,8M, maas 3,3M); dorduncu bir
 * bolluk musluğu acmak ekonomiyi busbutun anlamsiz kilardi. Sponsorluk
 * en iyi ihtimalle maasin ucte biri kadar.
 */

/** Bu esigin altinda sponsorluk geliri YOKTUR. */
export const SPONSOR_FLOOR = 35;

/**
 * Haftalik sponsorluk geliri.
 *
 * @param relation `iliski_sponsor` (0-100)
 * @param fameIndex sohret merdivenindeki yer (0-1)
 * @param mediaStanding `medya_itibari` (0-100)
 * @param wage haftalik maas -- olcek referansi
 */
export function sponsorIncome(
  relation: number,
  fameIndex: number,
  mediaStanding: number,
  wage: number,
): number {
  if (relation < SPONSOR_FLOOR) return 0;
  if (wage <= 0) return 0;

  // Esikten tavana 0-1: 35'te sifir kazanc, 100'de tam.
  const trust = (relation - SPONSOR_FLOOR) / (100 - SPONSOR_FLOOR);
  // Sohret carpani: cirak neredeyse hicbir sey, ikon tam pay.
  const fame = Math.max(0, Math.min(1, fameIndex));
  // Skandal bir isim markayi kacirir; 50 notr.
  const media = 0.5 + Math.max(0, Math.min(100, mediaStanding)) / 200;

  return Math.round(wage * 0.33 * trust * fame * media);
}
