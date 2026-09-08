/**
 * NITELIK TURETME -- kaynakta OLMAYAN tek sey.
 *
 * `player_profiles.csv` 34 kolon tasiyor: mevki, ayak, boy, dogum tarihi,
 * uyruk, kulup, sozlesme. Ama pace/shooting/passing/defending/physical/
 * goalkeeping YOK -- bu FIFA verisi degil, Transfermarkt verisi. Elimizdeki
 * tek guc sinyali PIYASA DEGERI.
 *
 * YON ONEMLI:
 *   Motorun sozlesmesi (src/domain/actors.ts) quality'yi NITELIKLERDEN turetir
 *   (`overallFor`), tersi degil. O yuzden burada da su sirayla gidilir:
 *
 *     1. piyasa degeri -> hedef overall   (log olcek + yas duzeltmesi)
 *     2. alt mevki     -> nitelik PROFILI (goreli sekil)
 *     3. profil, hedefi TUTTURACAK sekilde olceklenir
 *
 *   Ters yon (once overall yazip nitelikleri uydurmak) "kaliteli ama sut
 *   atamayan santrfor" uretirdi ve simulator bunu her macta gosterirdi.
 *
 * NEDEN LOGARITMIK:
 *   Kapsam icindeki 6.878 oyuncunun degeri 50.000 EUR ile 200.000.000 EUR
 *   arasinda -- 4.000 kat. Dogrusal esleme oyuncularin %90'ini 0-100
 *   olceginin en alt iki puanina yigardi. log10 ile aralik 4.70-8.30'a
 *   duser ve esit dagilir.
 *
 * KATMAN NOTU:
 *   Bu dosya `src/domain/actors.ts`i BILEREK import eder. Kural "src, tools'u
 *   gormez" seklindedir; ters yon serbesttir ve burada zorunludur: agirliklari
 *   (`POSITION_WEIGHTS`) kopyalasaydik motorunkiyle sessizce ayrisir ve
 *   uretilen kadro simulatorun okudugundan baska bir sey anlatirdi. `domain`
 *   zaten sifir bagimlilikli taban katman.
 */

import {
  overallFor,
  POSITION_WEIGHTS,
  type PlayerAttributes,
  type Position,
} from '../../../src/domain/actors.js';

export type { Position };

/** log10(piyasa degeri) capalari -- kapsam ici gercek dagilimdan olculdu. */
const LOG_FLOOR = 4.7; //  50.000 EUR  -> p1
const LOG_CEIL = 8.3; // 200.000.000 EUR -> max

/** Bu araligin hedef overall karsiligi. */
const OVERALL_FLOOR = 45;
const OVERALL_CEIL = 97;

/**
 * Alt mevki profilleri -- GORELI agirliklar, mutlak deger degil.
 *
 * Sayilar 0-100 degil, birbirine gore orandir. Olcekleme adimi bunlari hedef
 * overall'a tasir; bu yuzden bir profili degistirmek oyuncuyu guclendirmez,
 * yalnizca gucunun NEREYE dagildigini degistirir.
 */
type Shape = Readonly<Record<keyof PlayerAttributes, number>>;

const SHAPES: Readonly<Record<string, Shape>> = {
  Goalkeeper: { pace: 0.5, shooting: 0.15, passing: 0.75, defending: 0.4, physical: 1.0, goalkeeping: 1.15 },

  'Defender - Centre-Back': { pace: 0.8, shooting: 0.4, passing: 0.8, defending: 1.15, physical: 1.05, goalkeeping: 0.05 },
  'Defender - Right-Back': { pace: 1.1, shooting: 0.5, passing: 0.9, defending: 0.95, physical: 0.85, goalkeeping: 0.05 },
  'Defender - Left-Back': { pace: 1.1, shooting: 0.5, passing: 0.9, defending: 0.95, physical: 0.85, goalkeeping: 0.05 },
  'Defender - Sweeper': { pace: 0.75, shooting: 0.4, passing: 0.85, defending: 1.15, physical: 1.0, goalkeeping: 0.05 },

  'Midfield - Defensive Midfield': { pace: 0.8, shooting: 0.6, passing: 1.0, defending: 1.05, physical: 1.0, goalkeeping: 0.02 },
  'Midfield - Central Midfield': { pace: 0.85, shooting: 0.75, passing: 1.1, defending: 0.72, physical: 0.78, goalkeeping: 0.02 },
  'Midfield - Attacking Midfield': { pace: 0.95, shooting: 0.95, passing: 1.1, defending: 0.45, physical: 0.68, goalkeeping: 0.02 },
  'Midfield - Right Midfield': { pace: 1.05, shooting: 0.75, passing: 1.0, defending: 0.7, physical: 0.75, goalkeeping: 0.02 },
  'Midfield - Left Midfield': { pace: 1.05, shooting: 0.75, passing: 1.0, defending: 0.7, physical: 0.75, goalkeeping: 0.02 },

  'Attack - Centre-Forward': { pace: 0.95, shooting: 1.15, passing: 0.7, defending: 0.3, physical: 0.92, goalkeeping: 0.02 },
  'Attack - Second Striker': { pace: 1.0, shooting: 1.05, passing: 0.9, defending: 0.35, physical: 0.75, goalkeeping: 0.02 },
  'Attack - Right Winger': { pace: 1.15, shooting: 0.95, passing: 0.9, defending: 0.35, physical: 0.7, goalkeeping: 0.02 },
  'Attack - Left Winger': { pace: 1.15, shooting: 0.95, passing: 0.9, defending: 0.35, physical: 0.7, goalkeeping: 0.02 },
};

/** Alt mevki bos ya da tanimsizsa kaba mevkinin ortalama profili. */
const FALLBACK_SHAPES: Readonly<Record<Position, Shape>> = {
  GK: SHAPES['Goalkeeper']!,
  DF: SHAPES['Defender - Centre-Back']!,
  MF: SHAPES['Midfield - Central Midfield']!,
  FW: SHAPES['Attack - Centre-Forward']!,
};

/** `main_position` -> motorun dort mevkisi. */
export function toPosition(mainPosition: string): Position | undefined {
  switch (mainPosition.trim()) {
    case 'Goalkeeper':
      return 'GK';
    case 'Defender':
      return 'DF';
    case 'Midfield':
      return 'MF';
    case 'Attack':
      return 'FW';
    default:
      return undefined;
  }
}

export function shapeFor(position: Position, subPosition: string): Shape {
  return SHAPES[subPosition.trim()] ?? FALLBACK_SHAPES[position];
}

/**
 * Piyasa degeri + yas -> hedef overall.
 *
 * YAS DUZELTMESI NEDEN GEREKLI:
 *   Transfermarkt degeri POTANSIYELI fiyatlar. 18 yasindaki 30 milyonluk bir
 *   oyuncu bugun 30 milyonluk bir oyuncu kadar iyi DEGILDIR; 34 yasindaki 5
 *   milyonluk bir oyuncu ise degerinin ima ettiginden iyidir. Duzeltme
 *   yapilmazsa akademi cocuklari sahada yildizlari geceriyor.
 */
export function targetOverall(marketValue: number, age: number | undefined): number {
  const log = Math.log10(Math.max(marketValue, 10_000));
  const t = (log - LOG_FLOOR) / (LOG_CEIL - LOG_FLOOR);
  let overall = OVERALL_FLOOR + (OVERALL_CEIL - OVERALL_FLOOR) * clamp01(t);

  if (age !== undefined) {
    if (age < 21) overall -= (21 - age) * 2.5; // potansiyel primi geri alinir
    else if (age > 30) overall += (age - 30) * 1.2; // deger duser, yetenek durur
  }

  return clamp(Math.round(overall), 30, 99);
}

/**
 * Potansiyel: genc oyuncuda degerin ima ettigi tavan, yaslida bugunku hali.
 * Faz F (transfer piyasasi) bunu okuyacak.
 */
export function potentialFor(overall: number, age: number | undefined): number {
  if (age === undefined || age >= 24) return overall;
  return clamp(overall + Math.round((24 - age) * 2.2), overall, 99);
}

/**
 * Tavana yaklasirken SIKISTIRAN egri -- sert kirpma yerine.
 *
 * NEDEN:
 *   Sert kirpma (`min(x, 99)`) ile hedefi tutturma dongusu birbirini besliyor:
 *   bir nitelik 99'a kirpilinca agirlikli ortalama hedefin altinda kaliyor,
 *   dongu olcegi buyutuyor, bu sefer BASKA nitelikler de 99'a kirpiliyor.
 *   Sonuc gozlendi: Mbappe pac98 sho99 phy99 -- her ekseni ayni anda maksimum
 *   olan bir oyuncu. Simulator boyle bir kadroda mevki farkini okuyamaz.
 *
 *   Sikistirma monotondur ve doyma uretmez: 85 altindaki degerler aynen gecer,
 *   ustundekiler 99'a asimptotik yaklasir. Boylece sut ile fizik arasindaki
 *   fark tavanda da korunur.
 */
/**
 * Boy, profili AYRISTIRAN tek ek sinyal.
 *
 * Piyasa degeri + alt mevki ayni olan iki oyuncu birebir ayni niteliklere
 * dusuyordu (Mbappe ve Haaland: ikisi de santrfor, ikisi de en ust deger
 * bandi). Kaynakta bulunan ve gercekten ayirt edici olan tek alan boy:
 * 195 cm'lik santrfor ile 178 cm'lik santrfor ayni oyuncu degil.
 *
 * Etki KUCUK tutuldu (+/-%8): boy bir gosterge, belirleyici degil.
 * Toplam guc korunur -- kazanc/kayip agirlikli ortalamada birbirini goturur,
 * yalnizca dagilim degisir.
 */
const REFERENCE_HEIGHT = 182;

function applyHeight(shape: Shape, heightCm?: number): Shape {
  if (heightCm === undefined || heightCm < 150 || heightCm > 215) return shape;
  const d = (heightCm - REFERENCE_HEIGHT) / 100; // ~ -0.15 .. +0.15
  return {
    pace: shape.pace * (1 - d * 0.55),
    shooting: shape.shooting,
    passing: shape.passing * (1 - d * 0.25),
    defending: shape.defending * (1 + d * 0.3),
    physical: shape.physical * (1 + d * 0.8),
    goalkeeping: shape.goalkeeping * (1 + d * 0.35),
  };
}

const SOFT_KNEE = 85;
const HARD_CEIL = 99;

export function softCeiling(value: number): number {
  if (value <= SOFT_KNEE) return value;
  const room = HARD_CEIL - SOFT_KNEE;
  return SOFT_KNEE + room * (1 - Math.exp(-(value - SOFT_KNEE) / room));
}

/**
 * Profili hedef overall'a olcekler ve GERCEKLESEN overall'i birlikte doner.
 *
 * Sikistirma yuzunden hedef her zaman tam tutturulamaz (ozellikle 95+
 * kalecilerde). Bu durumda UYDURMAK yerine gerceklesen deger yazilir:
 * `overallFor(position, attributes)` ile birebir ayni sayi. Motorun
 * sozlesmesi quality'yi niteliklerden turetiyor; DB'de baska bir sayi tutmak
 * ikisini sessizce ayristirirdi.
 */
export function deriveAttributes(
  position: Position,
  subPosition: string,
  target: number,
  heightCm?: number,
): { attributes: PlayerAttributes; overall: number } {
  const shape = applyHeight(shapeFor(position, subPosition), heightCm);
  const weights = POSITION_WEIGHTS[position];

  let raw = 0;
  for (const key of KEYS) raw += shape[key] * weights[key];
  if (raw <= 0) raw = 1;

  let scale = target / raw;
  let attributes = build(shape, scale);

  // Sonumlu Newton adimlari: sikistirma monoton oldugu icin yakinsar.
  for (let i = 0; i < 6; i += 1) {
    const achieved = weighted(attributes, weights);
    if (achieved <= 0 || Math.abs(achieved - target) < 0.4) break;
    scale *= (target / achieved) ** 0.7;
    attributes = build(shape, scale);
  }

  return { attributes, overall: overallFor(position, attributes) };
}

const KEYS: readonly (keyof PlayerAttributes)[] = [
  'pace',
  'shooting',
  'passing',
  'defending',
  'physical',
  'goalkeeping',
];

function build(shape: Shape, scale: number): PlayerAttributes {
  const one = (raw: number): number => clamp(Math.round(softCeiling(raw * scale)), 1, HARD_CEIL);
  return {
    pace: one(shape.pace),
    shooting: one(shape.shooting),
    passing: one(shape.passing),
    defending: one(shape.defending),
    physical: one(shape.physical),
    goalkeeping: one(shape.goalkeeping),
  };
}

function weighted(a: PlayerAttributes, w: Readonly<Record<keyof PlayerAttributes, number>>): number {
  let total = 0;
  for (const key of KEYS) total += a[key] * w[key];
  return total;
}

/**
 * Piyasa degeri yoksa kulup itibarindan tahmin.
 *
 * Kapsam icindeki 7.276 oyuncunun 398'inde (%5,5) deger yok. Bunlari atmak
 * kadroyu delik birakirdi; sifir saymak kulubun en kotu oyuncusu yapardi.
 * Kulup itibari makul bir taban verir ve satir `fallback` isaretlenir --
 * GUI'de once bunlar gosterilecek.
 */
export function fallbackValue(clubReputation: number): number {
  // itibar 18 -> ~120k, itibar 96 -> ~9M
  const t = clamp01((clubReputation - 18) / 78);
  return Math.round(10 ** (5.08 + t * 1.87));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
