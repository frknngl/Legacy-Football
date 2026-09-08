/**
 * IMPORT KAPSAMI -- dunyanin ne kadarini iceri aliyoruz.
 *
 * Kaynakta sezon 2024 icin 162 turnuva ve 1.676 kulup var; hepsini almak
 * ne oynanabilir ne de tasinabilir. Kapsam VERIDIR: yeni bir ulke eklemek
 * kod degil satir gerektirir.
 *
 * Varsayilan 8 ulke x seviye 1-2 = 16 lig / ~308 kulup / ~7.700 oyuncu.
 * Sampiyonlar Ligi ve Dunya Kupasi icin fazlasiyla yeterli, world.db ~20 MB.
 */

/** Takvim penceresi varsayilanlari. Faz A (takvim) bunlari okuyacak. */
export interface WindowDefaults {
  readonly start: number;
  readonly end: number;
  readonly slot: 'weekend' | 'midweek';
}

export interface ImportScope {
  /** `team_details.country_name` ile birebir eslesir. */
  readonly countries: readonly string[];
  /** `season_league_level_level_number` degerleri. */
  readonly levels: readonly number[];
  /** Hangi sezonun anligi taban alinacak. */
  readonly sourceSeason: number;
  /** Kac sezon geriye bakip kulup gucu hesaplanacak. */
  readonly historySeasons: number;
  readonly leagueWindow: WindowDefaults;
}

/**
 * ULKE KATSAYISI -- ayni seviyedeki ligler esit degildir.
 *
 * NEDEN GEREKLI:
 *   Guc, mac basi puandan turetiliyor. Ama rekabet dengesi zayif bir ligde
 *   sampiyon 2.4 puan/mac alir, guclu bir ligde 2.1. Katsayisiz olcumde
 *   Sporting CP, Real Madrid'in USTUNE cikiyor -- ve bu yalnizca bir siralama
 *   guzellik sorunu degil: `clubTier` icerik kapilama eksenidir, 'elite'
 *   yanlis kulube verilirse Sampiyonlar Ligi sahnesi yanlis oyuncuya cikar.
 *
 * ROLU DARALDI:
 *   Oyuncu asamasi baglandi; itibar artik KADRO PIYASA DEGERINDEN yeniden
 *   hesaplaniyor (pipeline/reputation.ts) ve clubTier'i o belirliyor. Bu
 *   katsayi yalnizca ON TAHMIN icin kaldi: kulupler oyunculardan once
 *   yazilmak zorunda oldugu icin (oyuncunun club_id'si lazim) o anda kadro
 *   degeri henuz yok. On tahmin de bosa gitmiyor -- piyasa degeri olmayan
 *   %5 oyuncunun taban degeri buradan uretiliyor.
 */
export const COUNTRY_COEFFICIENT: Readonly<Record<string, number>> = {
  England: 1.0,
  Spain: 0.97,
  Italy: 0.94,
  Germany: 0.93,
  France: 0.86,
  Portugal: 0.76,
  Netherlands: 0.74,
  Türkiye: 0.72,
};

export const DEFAULT_COEFFICIENT = 0.6;

export const DEFAULT_SCOPE: ImportScope = {
  countries: [
    'England',
    'Spain',
    'Italy',
    'Germany',
    'France',
    'Portugal',
    'Netherlands',
    'Türkiye',
  ],
  levels: [1, 2],
  sourceSeason: 2024,
  historySeasons: 5,
  leagueWindow: { start: 1, end: 38, slot: 'weekend' },
};

/**
 * Genc takim / rezerv / B takimi eleyicisi.
 *
 * Kaynak 2.175 kulubun icine "Napoli Under 18", "CD Mafra U23", "Premier
 * League 2" gibi satirlari karistiriyor. Bunlar seviye filtresinden bazen
 * geciyor (Premier League 2'nin level'i BOS), bu yuzden isim tarafindan da
 * bakariz.
 */
const YOUTH_PATTERNS: readonly RegExp[] = [
  /\bU\d{2}\b/i,
  /\bUnder[- ]?\d{2}\b/i,
  /\bYouth\b/i,
  /\bAcademy\b/i,
  /\bReserves?\b/i,
  /\bJuvenil\b/i,
  /\bPrimavera\b/i,
  /\bII\b/,
  /\bB\)$/,
];

export function isYouthOrReserve(clubName: string): boolean {
  return YOUTH_PATTERNS.some((p) => p.test(clubName));
}

/**
 * Kulup adindaki kaynak eki temizler.
 * Transfermarkt adlari "Galatasaray SK (141)" bicimindedir.
 */
export function cleanClubName(raw: string): string {
  return raw.replace(/\s*\(\d+\)\s*$/, '').trim();
}

/** Kaynakta oyuncusuz/kulupsuz durumu isaretleyen sahte kulupler. */
export const SENTINEL_CLUBS: readonly string[] = ['Retired', 'Without Club', 'Unknown'];
