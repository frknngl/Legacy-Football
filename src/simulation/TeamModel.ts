/**
 * Takim modeli -- 18 kisilik kadrodan sahaya cikan 11'i ve hat guclerini kurar.
 *
 * Hero'nun takiminda kadro ONUN ETRAFINA kurulur: Hero kendi mevkisinde her
 * zaman ilk 11'dedir (cezali/sakat degilse), kalan yerler kaliteye gore dolar.
 * Rakip takim icin boyle bir ayricalik yoktur.
 *
 * KATMAN: yalnizca `domain` okur. Kadro `RosterProvider`dan gelir ama bu sinif
 * portu cagirmaz -- kadro DISARIDAN verilir, boylece test icin sahte kadro
 * enjekte etmek serbesttir.
 */

import {
  POSITION_WEIGHTS,
  type PlayerAttributes,
  type Position,
  type RosterPerson,
} from '../domain/actors.js';
import type { HeroProfile } from '../domain/match.js';

/** Sahaya cikan bir oyuncu. Hero da bu bicimde temsil edilir. */
export interface FieldPlayer {
  readonly sourceId: string;
  readonly name: string;
  readonly position: Position;
  readonly attributes: PlayerAttributes;
  readonly quality: number;
  readonly aggression: number;
  /** Hero mu -- gol/asist Hero'ya yazilacaksa bu bayrak okunur. */
  readonly isHero: boolean;
  /**
   * Hero ile kimyasi (0-100). Yalnizca Hero'nun takiminda anlamli.
   *
   * Motorun flag sozlugu simulatore KAPALI oldugu icin bu deger disaridan
   * enjekte edilir: `SimulatorDeps.chemistryOf` host tarafindan doldurulur.
   * Simulator "kim kiminle iyi anlasiyor"u bilir, "neden"i bilmez.
   */
  readonly chemistryWithHero?: number;
}

export interface TeamLines {
  /** Kaleci kalitesi (0-100). */
  readonly keeper: number;
  readonly defence: number;
  readonly midfield: number;
  readonly attack: number;
  /** Hat ortalamasi -- eslesme gucu karsilastirmasi bunun uzerinden yapilir. */
  readonly overall: number;
  /** Ortalama sertlik -- faul ve kart uretimini besler. */
  readonly aggression: number;
}

export interface TeamSquad {
  readonly clubId: string;
  readonly name: string;
  readonly eleven: readonly FieldPlayer[];
  readonly lines: TeamLines;
  /** Hero sahada mi -- moment uretimi buna bakar. */
  readonly heroOnPitch: boolean;
}

/** 4-4-2: sahadaki mevki dagilimi. */
const FORMATION: Readonly<Record<Position, number>> = { GK: 1, DF: 4, MF: 4, FW: 2 };

function toFieldPlayer(p: RosterPerson, chemistry?: number): FieldPlayer {
  return {
    ...(chemistry === undefined ? {} : { chemistryWithHero: chemistry }),
    sourceId: p.sourceId,
    name: p.displayName,
    position: p.position,
    attributes: p.attributes,
    quality: p.quality,
    aggression: p.aggression,
    isHero: false,
  };
}

/**
 * GUNUN FORMU -- Hero'nun niteliklerine binen carpan (0.86 - 1.16).
 *
 * form 50 + moral 50 = tam 1.00, yani notr.
 */
export function heroDayFactor(hero: HeroProfile): number {
  return (
    0.86 +
    (hero.form / 100) * 0.16 +
    (hero.morale / 100) * 0.12 +
    // Pazuband kucuk ama gercek bir fark: sorumluluk sahada karsilik bulur.
    // Bu alan daha once simulasyonda HIC okunmuyordu.
    (hero.isCaptain ? 0.02 : 0)
  );
}

/**
 * MAC ONCESI TABAN REYTING.
 *
 * OLCULEN SORUN: reyting sabit 6.0'dan basliyor ve yalnizca OLAYLARLA
 * (gol +, asist +0.6, kart -0.3) degisiyordu. Yani moralsiz bir oyuncuyla
 * mutlu bir oyuncunun golsuz maci ayni 6.0'i aliyordu.
 *
 * Bu, moralin gorunmez kalmasinin asil sebebiydi: oyuncunun her mac
 * sonunda GORDUGU sayi gunun formundan tamamen bagimsizdi -- ve `form`
 * bayragi da bu reytinglerden turedigi icin dongu hic kapanmiyordu.
 *
 * Katsayi olculerek secildi: taban 5.4 - 6.6 bandinda oynar, yani olaylar
 * (bir gol ~+1.0) hala baskin kalir. Reyting bir PERFORMANS olcusudur,
 * ruh hali olcusu degil.
 */
export function heroBaseRating(hero: HeroProfile): number {
  return 6 + (heroDayFactor(hero) - 1) * 4;
}

/**
 * Hero'yu sahadaki bir oyuncuya cevirir.
 *
 * Nitelikleri `HeroProfile` OZETINDEN turetilir; simulator motorun flag
 * sozlugunu gormedigi icin baska bir kaynak yoktur ve olmamalidir.
 */
export function heroAsFieldPlayer(hero: HeroProfile, name: string): FieldPlayer {
  const attributes: PlayerAttributes = {
    pace: hero.physical,
    shooting: hero.position === 'FW' ? hero.technical + 8 : hero.technical - 6,
    passing: hero.technical,
    defending: hero.position === 'DF' ? hero.physical + 6 : hero.physical - 12,
    physical: hero.physical,
    goalkeeping: hero.position === 'GK' ? hero.technical : 5,
  };
  // GUNUN FORMU -- niteliklerin TAMAMINA binder.
  //
  // OLCULEN SORUN: bu carpan eskiden yalnizca `quality`ye uygulaniyordu.
  // Ama simulasyonun okudugu alan `quality` degil `attributes`:
  //   - `computeLines`  -> goalkeeping / defending / passing / shooting
  //   - `pickShooter`   -> attributes.shooting
  //   - `pickAssister`  -> attributes.passing
  // `quality` yalnizca `composure` olarak tek bir yerde okunuyordu ve
  // orada da agirligi %30-40 idi.
  //
  // Sonuc olculdu: 500 macta moral 0 ile 100 ARASINDA HICBIR FARK YOKTU
  // (106 gol / 28 asist / 6.258 reyting, bire bir ayni). Form icin de
  // ayni. Yani "moral %6 etkiliyor" bile degil, sifir etkiliyordu.
  //
  // Carpan artik niteliklere uygulaniyor ve `quality` OLCEKLENMIS
  // niteliklerden turetiliyor -- tek uygulama, cift sayim yok.
  const dayFactor = heroDayFactor(hero);

  const clamped = Object.fromEntries(
    Object.entries(attributes).map(([k, v]) => [
      k,
      Math.max(1, Math.min(99, Math.round(v * dayFactor))),
    ]),
  ) as unknown as PlayerAttributes;

  const weights = POSITION_WEIGHTS[hero.position];
  let base = 0;
  for (const [key, weight] of Object.entries(weights)) {
    base += clamped[key as keyof PlayerAttributes] * weight;
  }

  return {
    sourceId: 'hero',
    name,
    position: hero.position,
    attributes: clamped,
    quality: Math.max(1, Math.min(99, Math.round(base))),
    aggression: 50,
    isHero: true,
  };
}

/**
 * Kadrodan ilk 11'i secer.
 *
 * `hero` verilirse kendi mevkisinde GARANTILI olarak kadroya girer ve o
 * mevkiden bir kisi eksik secilir.
 */
export function pickEleven(
  squad: readonly RosterPerson[],
  hero?: FieldPlayer,
  /** Hero ile kimya cozucusu. Verilmezse kimya yok sayilir (zarif bozulma). */
  chemistryOf?: (sourceId: string) => number | undefined,
): readonly FieldPlayer[] {
  const asField = (p: RosterPerson): FieldPlayer =>
    toFieldPlayer(p, chemistryOf?.(p.sourceId));
  const eleven: FieldPlayer[] = [];
  const heroPosition = hero?.position;

  for (const position of ['GK', 'DF', 'MF', 'FW'] as const) {
    const need = FORMATION[position] - (heroPosition === position ? 1 : 0);
    const pool = squad
      .filter((p) => p.position === position)
      .sort((a, b) => b.quality - a.quality)
      .slice(0, Math.max(0, need))
      .map(asField);
    eleven.push(...pool);
  }

  if (hero) eleven.push(hero);

  // Kadro eksikse (yaralanma, kucuk kadro) en iyi kalanlarla tamamlanir --
  // simulator 11'den az oyuncuyla sahaya cikmaz.
  if (eleven.length < 11) {
    const used = new Set(eleven.map((p) => p.sourceId));
    const filler = squad
      .filter((p) => !used.has(p.sourceId))
      .sort((a, b) => b.quality - a.quality)
      .slice(0, 11 - eleven.length)
      .map(asField);
    eleven.push(...filler);
  }

  return eleven;
}

/** Ilk 11'den hat guclerini hesaplar. */
export function computeLines(eleven: readonly FieldPlayer[]): TeamLines {
  const avg = (players: readonly FieldPlayer[], read: (p: FieldPlayer) => number): number =>
    players.length === 0 ? 40 : players.reduce((s, p) => s + read(p), 0) / players.length;

  const keepers = eleven.filter((p) => p.position === 'GK');
  const defenders = eleven.filter((p) => p.position === 'DF');
  const midfielders = eleven.filter((p) => p.position === 'MF');
  const forwards = eleven.filter((p) => p.position === 'FW');

  const keeper = avg(keepers, (p) => p.attributes.goalkeeping);
  // Savunma yalniz stoperlerin isi degil; orta saha da geri kosar.
  const defence =
    avg(defenders, (p) => p.attributes.defending) * 0.75 +
    avg(midfielders, (p) => p.attributes.defending) * 0.25;
  const midfield = avg(midfielders, (p) => p.attributes.passing);
  const attack =
    avg(forwards, (p) => p.attributes.shooting) * 0.7 +
    avg(midfielders, (p) => p.attributes.passing) * 0.3;

  return {
    keeper: Math.round(keeper),
    defence: Math.round(defence),
    midfield: Math.round(midfield),
    attack: Math.round(attack),
    overall: Math.round(keeper * 0.15 + defence * 0.3 + midfield * 0.3 + attack * 0.25),
    aggression: Math.round(avg(eleven, (p) => p.aggression)),
  };
}

export function buildTeam(
  clubId: string,
  name: string,
  squad: readonly RosterPerson[],
  hero?: FieldPlayer,
  /** Hero ile kimya cozucusu -- yalnizca Hero'nun takiminda dolu. */
  chemistryOf?: (sourceId: string) => number | undefined,
): TeamSquad {
  const eleven = pickEleven(squad, hero, chemistryOf);
  return {
    clubId,
    name,
    eleven,
    lines: computeLines(eleven),
    heroOnPitch: eleven.some((p) => p.isHero),
  };
}
