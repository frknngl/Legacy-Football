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
export const SPONSOR_FLOOR = 20;

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
  // Skandal bir isim markayi kacirir -- ama bu bir CARPAN, kapi degil.
  //
  // Ilk kalibrasyonda `0.5 + media/200` idi. `medya_itibari` medyani 15
  // oldugu icin (o bayrak da tek yonlu: icerik net -851 yaziyor) bu
  // carpani 0.575'e kilitliyor ve sponsorluk gelirini maasin %0,3'une
  // dusuruyordu -- yani bayragi gelire baglamak hicbir sey degistirmiyordu.
  const media = 0.6 + Math.max(0, Math.min(100, mediaStanding)) / 250;

  // Katsayi olculerek secildi. Hedef gradyan:
  //   taninmayan oyuncu (sohret 0.4, iliski 33, medya 15) -> maasin ~%2,6'si
  //   efsane (sohret 1, iliski 65, medya 50)              -> maasin ~%27'si
  // Sponsorluk bir YILDIZ gelirdir; cirak icin sifira yakin olmasi dogru.
  return Math.round(wage * 0.6 * trust * fame * media);
}

/**
 * SPONSOR ILISKISININ HEDEFI.
 *
 * OLCULEN SORUN: `iliski_sponsor` 50'den basliyor, icerik ona net -62
 * yaziyor (4 pozitif / 8 negatif) ve TOPARLANMA yoktu. Alti kariyerlik
 * olcumde medyani 24 cikti -- yani bayrak tek yonlu bir mandaldi ve
 * gelire baglamak tek basina onu canlandirmiyordu. Moralde de aynen bu
 * olmustu.
 *
 * Cozum ayni: bayrak bir HEDEFE dogru kayar. Hedef sohret ve medya
 * itibarindan turer -- markalar unlu ve temiz oyuncunun pesinden
 * kendiliginden kosar, taninmayan oyuncuyu aramaz.
 *
 * Boylece 12 icerik efekti hedefin ETRAFINDA sok olarak calisir:
 * "cekimde surat astin" gercekten para kaybettirir, ama kariyeri
 * boyunca cezalandirmaz.
 */
export function sponsorTarget(fameIndex: number, mediaStanding: number): number {
  const fame = Math.max(0, Math.min(1, fameIndex));
  const media = Math.max(0, Math.min(100, mediaStanding));
  return Math.max(10, Math.min(90, 20 + fame * 50 + (media - 50) * 0.3));
}

/**
 * Hedefe dogru haftalik kayma -- boslugun onda biri, en cok 2 puan.
 *
 * Moraldeki toparlanmadan YAVAS: sponsorluk iliskisi haftalik ruh hali
 * degil, yillik bir itibar meselesidir.
 */
export function sponsorDrift(current: number, target: number): number {
  const gap = target - current;
  if (Math.abs(gap) < 1) return 0;
  return Math.max(-2, Math.min(2, gap / 10));
}
