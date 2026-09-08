/**
 * Icerigi kapilayan eksenler.
 *
 * Uc eksen BAGIMSIZDIR ve birlikte "seviyeye uygunluk" garantisini kurar:
 * ayni yastaki (era) iki oyuncudan biri 2. Lig'de bilinmeyen, digeri Sampiyonlar
 * Liginde ikon olabilir -- ayni olaylari ALMAMALIDIRLAR.
 */

/** Yas evresi. Oyuncunun bedeni ve hayat evresi. */
export const ERAS = ['rookie', 'rise', 'prime', 'veteran', 'twilight'] as const;
export type Era = (typeof ERAS)[number];

/** Sohret. Kimin umurunda oldugun. StatureCalculator tarafindan TURETILIR, elle set edilmez. */
export const STATURES = [
  'nobody',
  'local_talent',
  'starter',
  'star',
  'superstar',
  'icon',
  'legend',
] as const;
export type Stature = (typeof STATURES)[number];

/** Kulup seviyesi. Sahnenin buyuklugu. */
export const CLUB_TIERS = ['amateur', 'lower', 'mid', 'contender', 'elite'] as const;
export type ClubTier = (typeof CLUB_TIERS)[number];

/**
 * Hayat durumu. Hangi icerik havuzunun acik oldugunu belirler.
 * "Her hafta ayni seyler oluyor" hissini kokten bitiren eksen.
 */
export const LIFE_STATES = [
  'playing',
  'injured',
  'suspended',
  'incarcerated',
  'loaned',
  'transfer_listed',
  'national_duty',
  'rehab_clinic',
  'retired',
] as const;
export type LifeState = (typeof LIFE_STATES)[number];

/** Medya cagi. Sezondan turetilir; skandalin nasil patladigini belirler. */
export const MEDIA_ERAS = ['press', 'twitter', 'instagram', 'tiktok', 'deepfake'] as const;
export type MediaEra = (typeof MEDIA_ERAS)[number];

/** Kimlik eksenleri. Secimlerle BIRIKIR; icerik bunlari dogrudan set EDEMEZ. */
export const PERSONA_AXES = ['sadakat', 'mizac', 'durus', 'dogruluk'] as const;
export type PersonaAxis = (typeof PERSONA_AXES)[number];

/** Persona ekseninin flag adi: 'sadakat' -> 'persona_sadakat' */
export type PersonaFlagKey = `persona_${PersonaAxis}`;

/**
 * Olay agirligi. `filler` YOKTUR -- her olay en az 3 secenek ve
 * en az 1 kalici sonuc kancasi tasimak zorundadir.
 */
export const TIERS = ['epic', 'major', 'minor', 'beat'] as const;
export type Tier = (typeof TIERS)[number];

/** Baslangic arketipi. Farkli baslangic yasi, statlari ve ozel icerik ekseni. */
export const ARCHETYPES = [
  'street',
  'academy',
  'bloodline',
  'immigrant',
  'latebloom',
  'influencer',
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** Bir eksenin sirali indeksi -- olcekli efektler ve esik karsilastirmalari icin. */
export function statureIndex(s: Stature): number {
  return STATURES.indexOf(s);
}

export function clubTierIndex(t: ClubTier): number {
  return CLUB_TIERS.indexOf(t);
}

export function eraIndex(e: Era): number {
  return ERAS.indexOf(e);
}

export function mediaEraIndex(m: MediaEra): number {
  return MEDIA_ERAS.indexOf(m);
}

export function personaFlagKey(axis: PersonaAxis): PersonaFlagKey {
  return `persona_${axis}`;
}
