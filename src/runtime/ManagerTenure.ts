/**
 * TEKNIK DIREKTORUN OMRU.
 *
 * OLCULEN SORUN: `yonetim_baskisi` bayragini **17 icerik olayi yaziyor**
 * ve motor onu HIC okumuyordu. Yani "hocayla atistin, yonetim rahatsiz"
 * yazan her sahne sessizce etkisizdi -- bayrak buyuyor, hicbir sey
 * olmuyordu.
 *
 * Bu, isyan senaryosunun da eksik ayagiydi. Denetimde dort ayaktan ucu
 * zaten kuruluydu:
 *   kapi   -- `liderlik` istatistigi ve secenek kilitleri  (vardi)
 *   riza   -- takim arkadasinin `trust` degeri              (vardi)
 *   icra   -- kasitli kotu oynamak (`MatchDeltaEffect`)     (vardi)
 *   sonuc  -- hocanin GITMESI                               (YOKTU)
 *
 * Burasi dorduncusu. Ve ozellikle yeni bir "isyan" mekanigi DEGIL:
 * icerigin zaten yazdigi baskiyi bir sonuca bagliyor. Oyuncu isyani
 * secmeden de hoca kovulabilir (kotu sezon, dagilmis soyunma odasi) --
 * isyan yalnizca bu sureci HIZLANDIRIR.
 *
 * Saf matematik burada; slot dokumu ve bildirimler `GameEngine`de.
 */

/**
 * Hocanin koltugundaki baski (0-100).
 *
 * Uc girdi, ucu de zaten var olan sinyaller:
 *   1. `yonetim_baskisi` -- icerigin yazdigi dogrudan baski (17 olay)
 *   2. soyunma odasi huzuru -- dagilmis oda once hocayi yakar
 *   3. hero'nun formu -- yildizi kotu oynayan takim puan kaybeder
 *
 * Ucuncu girdi bilerek ZAYIF: bu bir futbolcu kariyeri simulasyonu, ve
 * tek oyuncunun formu hocayi tek basina kovduramaz. Ama kasitli kotu
 * oynamak (isyan) formu dusurdugu icin dolayli bir kol acilir.
 */
export function sackPressure(input: {
  boardPressure: number;
  harmony: number | undefined;
  form: number;
}): number {
  const board = clamp(input.boardPressure);
  // Huzur 50 notr; 20'ye duserse +24, 80'e cikarsa -18 katki.
  const harmonyPart = input.harmony === undefined ? 0 : (50 - clamp(input.harmony)) * 0.6;
  // Form 50 notr, katki dar tutuldu (en fazla +/-10).
  const formPart = (50 - clamp(input.form)) * 0.2;
  return clamp(board + harmonyPart + formPart);
}

/**
 * Kovulma esigi.
 *
 * Sert bir esik yerine OLASILIK: 70'in uzerinde her hafta artan bir sans.
 * Sebebi anlati -- "bu hafta gidecek" diye sayilabilen bir hoca gerilim
 * uretmez. 100 baskida haftalik sans ~%12, yani ortalama sekiz hafta.
 */
export function sackChance(pressure: number): number {
  if (pressure < SACK_THRESHOLD) return 0;
  return ((pressure - SACK_THRESHOLD) / (100 - SACK_THRESHOLD)) * 0.12;
}

export const SACK_THRESHOLD = 70;

/**
 * Yeni hocanin devraldigi baski.
 *
 * Sifirlanmaz: yonetim yeni hocayi da izliyor ve kulup zaten sorunlu.
 * Ama belirgin sekilde duser -- yoksa ilk hafta ikinci hoca da kovulur
 * ve kulup bir donme dolaba doner.
 */
export function pressureAfterSack(pressure: number): number {
  return Math.round(pressure * 0.35);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}
