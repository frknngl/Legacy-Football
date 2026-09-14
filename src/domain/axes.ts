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

/**
 * Kimlik eksenleri. Secimlerle BIRIKIR; icerik bunlari dogrudan set EDEMEZ.
 *
 * CEKIRDEK DORT eksen once gelir -- `PersonaAccumulator.initial()` sirayi
 * korur ve eski kayitlar bu dortluyle uyumlu kalir.
 *
 * GENIS EKSENLER (2026-09 genislemesi):
 *   Olculdu: icerik 545 olayda 22 ayri eksen kullaniyordu; motor yalnizca
 *   dordunu taniyordu. Kalan 18'i `parse.ts` "Bilinmeyen kimlik ekseni"
 *   diye REDDEDIYOR ve o olaylari yukleyemiyordu -- 141 kullanim, 31 test
 *   dosyasini kirmizi birakan zincirin basi.
 *
 *   Karar: SOZLUK GENISLETILDI, icerik DEGISMEDI. Bir senaryonun
 *   "profesyonellik" demesi bir hata degil; motorun onu tanimamasi hataydi.
 *
 * NOT ('ozguven' / 'özgüven'):
 *   Ikisi de icerikte gecerli olarak duruyor (9 + 1 kullanim) ve ayni
 *   kavrami anlatiyor. Ikisi de TANINIYOR cunku tek bir icerik satirini bile
 *   degistirmemek bu genislemenin sarti. Birlestirmek istenirse tek dosyalik
 *   bir duzeltmedir -- ama bu motorun degil, yazarin karari.
 */
export const PERSONA_AXES = [
  // --- cekirdek dortlu
  'sadakat',
  'mizac',
  'durus',
  'dogruluk',
  // --- genis eksenler
  'profesyonellik',
  'zeka',
  'ego',
  'cesaret',
  'merhamet',
  'özgüven',
  'liderlik',
  'hırs',
  'umursamazlik',
  'sabır',
  'cömertlik',
  'disiplin',
  'icekapaniklik',
  'güven',
  'icgoru',
  'inat',
  'ozguven',
  'yetenek',
] as const;
export type PersonaAxis = (typeof PERSONA_AXES)[number];

/**
 * Baslangicta bir eksenin degeri.
 *
 * Notr 50: hicbir eksende basli basina iyi ya da kotu degilsin; kimlik
 * secimlerle birikir.
 */
export const PERSONA_START = 50;

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
