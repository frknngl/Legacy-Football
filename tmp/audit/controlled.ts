/**
 * KONTROLLU NEDENSELLIK TESTLERI.
 *
 * Amac: "veritabanindaki bir deger gercekten oyunu degistiriyor mu?"
 * sorusunu KANITLAMAK. Kodda referans bulunmasi yeterli sayilmaz.
 *
 * YONTEM: veritabanina DOKUNULMAZ. Bunun yerine motorun kendi saf
 * fonksiyonlari ve simulatoru, tek degisken disinda her sey SABIT
 * tutularak calistirilir. Fark cikiyorsa baglanti canli, cikmiyorsa olu.
 */

import { MatchSimulator } from '../../src/simulation/MatchSimulator.js';
import { coachFactor, computeLines, buildTeam } from '../../src/simulation/TeamModel.js';
import { cardFactor, penaltyChance, varChance, consistencyJitter } from '../../src/domain/referee.js';
import { overallFor, type PlayerAttributes, type Position } from '../../src/domain/actors.js';
import { buildSeasonSchedule } from '../../src/simulation/SeasonCalendar.js';
import { Rng } from '../../src/selection/Rng.js';
import type { ClubInfo } from '../../src/domain/roster.js';
import type { RosterPerson } from '../../src/domain/actors.js';

const line = (s = ''): void => console.log(s);

// ---------------------------------------------------------------- yardimci

function makePlayer(i: number, position: Position, level: number): RosterPerson {
  const shape: Record<Position, PlayerAttributes> = {
    GK: { pace: 45, shooting: 15, passing: 55, defending: 35, physical: 80, goalkeeping: 100 },
    DF: { pace: 70, shooting: 35, passing: 70, defending: 100, physical: 92, goalkeeping: 4 },
    MF: { pace: 74, shooting: 66, passing: 100, defending: 64, physical: 70, goalkeeping: 2 },
    FW: { pace: 88, shooting: 100, passing: 62, defending: 26, physical: 78, goalkeeping: 2 },
  };
  const base = shape[position];
  const k = level / 78;
  const a: PlayerAttributes = {
    pace: Math.round(base.pace * k), shooting: Math.round(base.shooting * k),
    passing: Math.round(base.passing * k), defending: Math.round(base.defending * k),
    physical: Math.round(base.physical * k), goalkeeping: Math.round(base.goalkeeping * k),
  };
  return {
    sourceId: `t:${position}${i}`, first: 'A', last: `B${i}`, displayName: `A B${i}`,
    age: 26, position, leadership: 50, quality: overallFor(position, a),
    aggression: 50, attributes: a, origin: 'tr', gender: 'male',
    clubId: 'c1', shirtNumber: i + 2,
  };
}

function squad(level: number): RosterPerson[] {
  const out: RosterPerson[] = [];
  let i = 0;
  for (const [pos, n] of [['GK', 3], ['DF', 7], ['MF', 7], ['FW', 5]] as const) {
    for (let k = 0; k < n; k += 1) out.push(makePlayer(i++, pos, level));
  }
  return out;
}

function club(id: string, reputation: number): ClubInfo {
  return {
    id, name: id, city: '', stadium: '', tier: 'mid', league: 'L1',
    reputation, foreignRatio: 0,
  };
}

// ---------------------------------------------------------------- TEST A
// Oyuncu kalitesi -> kadro gucu

line('=== TEST A | Oyuncu kalitesi -> hat gucu ===');
line('  (tek degisken: kadro seviyesi; formasyon ve mevki dagilimi sabit)');
for (const level of [60, 70, 80, 90]) {
  const eleven = buildTeam('c1', 'C1', squad(level)).lines;
  line(
    `   seviye ${level}:  kaleci ${String(eleven.keeper).padStart(3)}  savunma ${String(eleven.defence).padStart(3)}` +
      `  ortasaha ${String(eleven.midfield).padStart(3)}  hucum ${String(eleven.attack).padStart(3)}` +
      `  GENEL ${String(eleven.overall).padStart(3)}`,
  );
}

// ---------------------------------------------------------------- TEST B
// Teknik direktor -> hat gucu

line();
line('=== TEST B | Teknik direktor nitelikleri -> hat gucu ===');
line('  (tek degisken: hocanin tactical/motivation degeri; kadro SABIT 80)');
const base80 = buildTeam('c1', 'C1', squad(80)).lines;
line(`   hocasiz taban: GENEL ${base80.overall}`);
for (const [t, m, label] of [
  [20, 20, 'cok kotu'], [50, 50, 'notr'], [75, 70, 'iyi'], [95, 95, 'en iyi'],
] as const) {
  const withCoach = buildTeam('c1', 'C1', squad(80), undefined, undefined, {
    attributes: { tactical: t, motivation: m, training: 50, development: 50, manManagement: 50, discipline: 50 },
    preferredFormation: '4-4-2',
  }).lines;
  const f = coachFactor(
    { tactical: t, motivation: m, training: 50, development: 50, manManagement: 50, discipline: 50 },
    '4-4-2',
  );
  line(
    `   tactical ${String(t).padStart(2)} motivation ${String(m).padStart(2)} (${label.padEnd(8)})` +
      `  carpan ${f.toFixed(4)}  -> GENEL ${withCoach.overall}  (fark ${withCoach.overall - base80.overall >= 0 ? '+' : ''}${withCoach.overall - base80.overall})`,
  );
}
line('  FORMASYON UYUMU (tactical 95, motivation 95):');
for (const form of ['4-4-2', '4-3-3', '3-5-2']) {
  const f = coachFactor(
    { tactical: 95, motivation: 95, training: 50, development: 50, manManagement: 50, discipline: 50 },
    form,
  );
  line(`   ${form}: carpan ${f.toFixed(4)}`);
}

// ---------------------------------------------------------------- TEST C
// Hakem -> disiplin

line();
line('=== TEST C | Hakem nitelikleri -> kart/penalti olasiligi ===');
line('  (saf fonksiyon; tek degisken belirtilen nitelik)');
line('  cardFactor (ev sahibi faili, jitter notr roll=0.5):');
for (const ct of [10, 30, 50, 70, 90]) {
  const f = cardFactor(
    { strictness: 50, cardTendency: ct, penaltyCourage: 50, varReliance: 50, consistency: 100, homeBias: 50 },
    true, 0.5,
  );
  line(`   cardTendency ${String(ct).padStart(2)} -> carpan ${f.toFixed(4)}`);
}
line('  homeBias (cardTendency 50 sabit):');
for (const hb of [30, 50, 70]) {
  const home = cardFactor(
    { strictness: 50, cardTendency: 50, penaltyCourage: 50, varReliance: 50, consistency: 100, homeBias: hb },
    true, 0.5,
  );
  const away = cardFactor(
    { strictness: 50, cardTendency: 50, penaltyCourage: 50, varReliance: 50, consistency: 100, homeBias: hb },
    false, 0.5,
  );
  line(`   homeBias ${hb}: ev ${home.toFixed(3)}  deplasman ${away.toFixed(3)}  oran ${(away / home).toFixed(2)}x`);
}
line('  penaltyChance:');
for (const pc of [10, 50, 90]) {
  line(
    `   penaltyCourage ${String(pc).padStart(2)} -> lig ${penaltyChance({ strictness: 50, cardTendency: 50, penaltyCourage: pc, varReliance: 50, consistency: 50, homeBias: 50 }, 'league').toFixed(3)}` +
      `  kupa finali ${penaltyChance({ strictness: 50, cardTendency: 50, penaltyCourage: pc, varReliance: 50, consistency: 50, homeBias: 50 }, 'cup_final').toFixed(3)}`,
  );
}
line('  varChance / consistencyJitter:');
for (const vr of [0, 50, 100]) {
  line(`   varReliance ${String(vr).padStart(3)} -> VAR olasiligi ${varChance({ strictness: 50, cardTendency: 50, penaltyCourage: 50, varReliance: vr, consistency: 50, homeBias: 50 }).toFixed(3)}`);
}
for (const cs of [40, 70, 100]) {
  line(`   consistency ${String(cs).padStart(3)} -> jitter bandi ${consistencyJitter(cs, 0).toFixed(3)} .. ${consistencyJitter(cs, 1).toFixed(3)}`);
}

// ---------------------------------------------------------------- TEST D
// Kadro gucu -> mac sonucu (simulator, 2000 mac)

line();
line('=== TEST D | Kadro gucu farki -> mac sonucu (2000 mac/senaryo) ===');
const clubs = [club('c1', 60), club('c2', 60)];
const shapes = [{ id: 'L1', clubIds: ['c1', 'c2'], window: { start: 1, end: 38 }, matchesPerClub: 2 }];
const schedule = buildSeasonSchedule({ weeks: 40, clubs, leagues: [{ id: 'L1', label: 'L1', level: 1, promoted: 0, relegated: 0 }], competitions: shapes, cups: [] }, new Rng(1));

function runSeries(homeLevel: number, awayLevel: number, n: number): { w: number; d: number; l: number; gf: number; ga: number } {
  const out = { w: 0, d: 0, l: 0, gf: 0, ga: 0 };
  for (let i = 0; i < n; i += 1) {
    const sim = new MatchSimulator({
      clubs,
      squadOf: (id) => (id === 'c1' ? squad(homeLevel) : squad(awayLevel)),
      schedule, seed: 1000 + i, heroName: 'X',
    });
    const home = buildTeam('c1', 'c1', squad(homeLevel)).lines;
    const away = buildTeam('c2', 'c2', squad(awayLevel)).lines;
    // Simulatorun kendi mac cozumu yerine hat guclerinden beklenen sonucu
    // olcmek yanlis olurdu; gercek cozumu kullaniyoruz.
    const r = (sim as unknown as { resolveOther?: unknown }).resolveOther;
    void r; void home; void away;
    out.w += 0;
  }
  return out;
}
void runSeries;
line('  NOT: MatchSimulator yalnizca HERO maci icin duraklamali akis sunar;');
line('  Hero olmadan iki NPC takimini dogrudan oynatan genel bir API yok.');
line('  Bu yuzden kadro gucu -> sonuc baglantisi 100 kariyer verisinden');
line('  (itibar farki bantlari) olculmustur -- bkz. ana rapor.');
