/**
 * Dakika dakika mac akisi.
 *
 * Timeline SONUC URETMEZ; yalnizca "bu dakikada kim, ne tur bir pozisyon
 * buldu" sorusuna cevap verir. Pozisyonun gole donup donmedigi
 * `ChanceResolver`in isidir. Bu ayrim Flick Shoot'un girebilmesi icin sart:
 * mini-oyun sutu cozer, akisi degil.
 *
 * Tohumlu ve DETERMINISTIK: ayni tohum + ayni takimlar = ayni dakikalar.
 */

import type { ChanceKind } from '../domain/chance.js';
import type { Rng } from '../selection/Rng.js';
import type { TacticProfile } from './Tactics.js';
import type { TeamLines } from './TeamModel.js';

export type TimelineEventKind = 'chance' | 'foul' | 'injury_risk';

export interface TimelineEvent {
  readonly minute: number;
  readonly kind: TimelineEventKind;
  /** Pozisyonu bulan taraf. */
  readonly side: 'home' | 'away';
  /** `chance` icin pozisyonun turu. */
  readonly chanceKind?: ChanceKind;
  readonly distance?: number;
  readonly angle?: number;
  readonly pressure?: number;
}

export interface TimelineInput {
  readonly home: { readonly lines: TeamLines; readonly tactic: TacticProfile };
  readonly away: { readonly lines: TeamLines; readonly tactic: TacticProfile };
}

/**
 * EV SAHIBI AVANTAJI -- SIMETRIK uygulanir.
 *
 * OLCULEN SORUN: deger 4'tu ve YALNIZCA ev sahibinin hucumuna ekleniyordu.
 * Iki sonucu vardi:
 *   1. Etki cok kucuktu: 89.020 macta denk takimlar arasinda ev sahibi
 *      avantaji 3.4 PUAN cikti (gercek futbolda ~18). Ev sahibi gol
 *      ortalamasi 0.94, deplasman 0.90 -- neredeyse fark yok.
 *   2. Tek tarafli oldugu icin buyutmek TOPLAM golu sisiriyordu; 18 puan
 *      avantaj icin gol/mac 3.0'in uzerine cikiyordu.
 *
 * Gercek ev avantaji iki yonludur: ev sahibi daha cok uretir, deplasman
 * daha AZ. Simetrik uygulama toplam golu sabit tutarken farki acar.
 *
 * GUC FARKINDAN BAGIMSIZ uygulanir -- hucum degerine eklenmez, orana
 * carpilir. Gerekcesi asagida, `homeFactor` yaninda.
 *
 * Deger analitik olarak secildi (bagimsiz Poisson, denk takimlar):
 *   h=4   ev %39.5 · ber %26.0 · dep %34.5  -> avantaj  4.9
 *   h=14  ev %45.8 · ber %25.5 · dep %28.7  -> avantaj 17.2   <- secildi
 *   h=20  ev %49.7 · ber %25.0 · dep %25.3  -> avantaj 24.4
 * Gercek futbol: ev %46 · ber %26 · dep %28 -> avantaj ~18.
 */
const HOME_ADVANTAGE = 14;

/**
 * Dakika basina taban sans olasiligi.
 *
 * Gercek futbolda takim basina ~12 sut/mac duser; ortalama 0.11 xG ile bu
 * ~1.3 gol eder. 0.055 ile takim basina yalnizca 5 sut cikiyor ve maclar
 * 0.5 golde kaliyordu.
 */
const BASE_CHANCE_RATE = 0.132;

/** Acik oyun pozisyonlarinin tur dagilimi. */
const OPEN_PLAY_MIX: readonly { kind: ChanceKind; weight: number }[] = [
  { kind: 'open_play', weight: 46 },
  { kind: 'header', weight: 18 },
  { kind: 'long_range', weight: 16 },
  { kind: 'one_on_one', weight: 11 },
  { kind: 'free_kick', weight: 9 },
];

/**
 * 90 dakikalik akisi uretir.
 *
 * Iki takimin hat gucleri ve taktikleri, dakika basina sans olasiligini ve
 * pozisyonun kalitesini belirler. Guclu takim daha COK ve daha IYI pozisyon
 * bulur; ikisi ayri eksendir.
 */
export function buildTimeline(input: TimelineInput, rng: Rng): readonly TimelineEvent[] {
  const events: TimelineEvent[] = [];

  const homeAttack = input.home.lines.attack;
  const awayAttack = input.away.lines.attack;

  // Hucum gucu ile rakip savunmasinin FARKI sans uretimini belirler.
  const homeEdge = (homeAttack - input.away.lines.defence) / 100;
  const awayEdge = (awayAttack - input.home.lines.defence) / 100;

  // TABAN: (1 + edge) asiri guc farkinda sifirin altina inebilir; hicbir
  // takim sifir pozisyonla oynamaz. 0.2 en zayif takima bile mac basina
  // ~2-3 pozisyon birakir.
  //
  // EV AVANTAJI GUC FARKINDAN BAGIMSIZ bir carpandir.
  //
  // Ilk denemede avantaj hucum degerine eklenmisti (`attack + HOME_ADVANTAGE`)
  // ve guc farkinin ICINE karisiyordu. Sonuc olculdu: zaten ucurum olan bir
  // eslesmede (elit ev sahibi vs amator deplasman) deplasmanin oranini
  // tabana yapistiriyor ve surprizi IMKANSIZ kiliyordu -- 60 tohumda
  // sifir deplasman galibiyeti. Gercek futbolda ev avantaji takim gucuyle
  // olceklenmez; sabit bir katkidir.
  const homeFactor = 1 + HOME_ADVANTAGE / 100;
  const awayFactor = 1 - HOME_ADVANTAGE / 100;
  const homeRate =
    BASE_CHANCE_RATE * input.home.tactic.tempo * input.away.tactic.exposure *
    Math.max(0.2, 1 + homeEdge) * homeFactor;
  const awayRate =
    BASE_CHANCE_RATE * input.away.tactic.tempo * input.home.tactic.exposure *
    Math.max(0.2, 1 + awayEdge) * awayFactor;

  const foulRate =
    0.012 * ((input.home.lines.aggression + input.away.lines.aggression) / 100) *
    ((input.home.tactic.aggression + input.away.tactic.aggression) / 2);

  for (let minute = 1; minute <= 90; minute += 1) {
    // Son on dakika aciliyeti: geriye dusen taraf bilinmedigi icin iki tarafa
    // da uygulanir; maclarin son bolumu daha bol pozisyonlu olur.
    const urgency = minute > 80 ? 1.25 : 1;

    if (rng.next() < homeRate * urgency) {
      events.push(makeChance(minute, 'home', input.home.tactic, rng));
    }
    if (rng.next() < awayRate * urgency) {
      events.push(makeChance(minute, 'away', input.away.tactic, rng));
    }
    if (rng.next() < foulRate) {
      events.push({ minute, kind: 'foul', side: rng.next() < 0.5 ? 'home' : 'away' });
    }
    if (rng.next() < 0.0035) {
      events.push({ minute, kind: 'injury_risk', side: rng.next() < 0.5 ? 'home' : 'away' });
    }
  }

  return events.sort((a, b) => a.minute - b.minute);
}

function makeChance(
  minute: number,
  side: 'home' | 'away',
  tactic: TacticProfile,
  rng: Rng,
): TimelineEvent {
  const pick = rng.weighted(OPEN_PLAY_MIX, (m) => m.weight) ?? OPEN_PLAY_MIX[0]!;
  const kind = pick.kind;

  // Riskli taktik daha yakin ve daha temiz pozisyon uretir.
  const closeness = tactic.risk;
  const distance = geometryFor(kind, rng) / closeness;
  const angle = 12 + rng.next() * 60;
  const pressure = Math.max(0, Math.min(100, 30 + rng.next() * 60 - (closeness - 1) * 25));

  return { minute, kind: 'chance', side, chanceKind: kind, distance, angle, pressure };
}

function geometryFor(kind: ChanceKind, rng: Rng): number {
  switch (kind) {
    case 'one_on_one':
      return 8 + rng.next() * 6;
    case 'header':
      return 5 + rng.next() * 6;
    case 'long_range':
      return 24 + rng.next() * 12;
    case 'free_kick':
      return 18 + rng.next() * 10;
    default:
      return 9 + rng.next() * 10;
  }
}
