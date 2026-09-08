/**
 * Mock kadro saglayici -- DB gelene kadar dunyanin kaynagi.
 *
 * Elle yazilan veri MINIMUMDA: `content/mock/clubs.json` icindeki 16 kulup
 * satiri + isim havuzlari. Kadrolar veri DEGIL, tohumdan URETILIR:
 * `hash(seed + clubId)` ile her kulup her calistirmada AYNI kadroyu dokar,
 * ama farkli tohum tamamen farkli bir dunya verir.
 *
 * DB entegrasyonunda bu sinif silinir; `DbRosterProvider` ayni arayuzu uygular.
 */

import {
  ATTRIBUTE_KEYS,
  overallFor,
  POSITION_WEIGHTS,
  POSITIONS,
  type AttributeKey,
  type PlayerAttributes,
  type Position,
  type RosterPerson,
  type SlotDefinition,
  type StaffPerson,
  type StaffRole,
  type AnyPerson,
} from '../domain/actors.js';
import type { ClubInfo, RosterProvider } from '../domain/roster.js';
import { hashString, NameForge, type NameConfig } from '../evaluation/NameForge.js';
import { Rng } from '../selection/Rng.js';

/** 18 kisilik kadronun mevki dagilimi. */
const SQUAD_SHAPE: readonly Position[] = [
  'GK', 'GK',
  'DF', 'DF', 'DF', 'DF', 'DF', 'DF',
  'MF', 'MF', 'MF', 'MF', 'MF', 'MF',
  'FW', 'FW', 'FW', 'FW',
];

const STAFF_SHAPE: readonly { role: StaffRole; minAge: number; maxAge: number }[] = [
  { role: 'manager', minAge: 42, maxAge: 66 },
  { role: 'assistant', minAge: 35, maxAge: 55 },
  { role: 'president', minAge: 46, maxAge: 70 },
  { role: 'sporting_director', minAge: 38, maxAge: 60 },
  { role: 'doctor', minAge: 32, maxAge: 60 },
  { role: 'physio', minAge: 28, maxAge: 50 },
];

/**
 * Mevkiye gore nitelik egilimi -- oyuncunun genel seviyesine EKLENIR.
 *
 * Saha disi mevkiler icin `goalkeeping` dibe cakilir; bu, overall'i etkilemez
 * (agirligi 0) ama "stoper kaleye gecti" gibi bir senaryoda dogru sonucu verir.
 */
const ATTRIBUTE_AFFINITY: Readonly<Record<Position, Readonly<Record<AttributeKey, number>>>> = {
  GK: { pace: -25, shooting: -40, passing: -8, defending: -18, physical: 2, goalkeeping: 30 },
  DF: { pace: -2, shooting: -22, passing: -4, defending: 18, physical: 10, goalkeeping: -55 },
  MF: { pace: 0, shooting: -4, passing: 16, defending: 0, physical: -2, goalkeeping: -55 },
  FW: { pace: 10, shooting: 18, passing: -2, defending: -20, physical: 0, goalkeeping: -55 },
};

/**
 * Egilimlerin agirlikli toplami. Her nitelikten cikarilir ki overall oyuncunun
 * hedeflenen seviyesine geri otursun.
 *
 * Bu duzeltme olmadan kaleciler sistematik olarak yuksek `quality` alir ve
 * `highest:quality` casting kurali her kulupte kaleciyi secerdi.
 */
const AFFINITY_BIAS: Readonly<Record<Position, number>> = Object.fromEntries(
  POSITIONS.map((position) => {
    const weights = POSITION_WEIGHTS[position];
    const affinity = ATTRIBUTE_AFFINITY[position];
    let bias = 0;
    for (const key of ATTRIBUTE_KEYS) bias += affinity[key] * weights[key];
    return [position, bias];
  }),
) as Record<Position, number>;

/** Hedef seviyeden mevkiye uygun nitelik seti uretir. */
function forgeAttributes(
  position: Position,
  level: number,
  roll: () => number,
): PlayerAttributes {
  const affinity = ATTRIBUTE_AFFINITY[position];
  const bias = AFFINITY_BIAS[position];
  const value = (key: AttributeKey): number =>
    clamp(Math.round(level + affinity[key] - bias + (roll() * 10 - 5)), 1, 99);

  return {
    pace: value('pace'),
    shooting: value('shooting'),
    passing: value('passing'),
    defending: value('defending'),
    physical: value('physical'),
    goalkeeping: value('goalkeeping'),
  };
}

export interface MockRosterOptions {
  readonly clubs: readonly ClubInfo[];
  readonly names: NameConfig;
  /** Personel cinsiyet ipuclari roles.json'dan okunur. */
  readonly slots: readonly SlotDefinition[];
  readonly seed: number;
}

export class MockRosterProvider implements RosterProvider {
  private readonly forge: NameForge;
  private readonly byId: Map<string, ClubInfo>;
  private readonly squadCache = new Map<string, readonly RosterPerson[]>();
  private readonly staffCache = new Map<string, readonly StaffPerson[]>();
  private readonly personIndex = new Map<string, AnyPerson>();
  private readonly staffGender = new Map<StaffRole, 'male' | 'female' | 'any'>();

  constructor(private readonly opts: MockRosterOptions) {
    this.forge = new NameForge(opts.names);
    this.byId = new Map(opts.clubs.map((c) => [c.id, c]));
    for (const slot of opts.slots) {
      if (slot.source === 'staff' && slot.staffRole !== undefined) {
        this.staffGender.set(slot.staffRole, slot.gender ?? 'any');
      }
    }
  }

  clubs(): readonly ClubInfo[] {
    return this.opts.clubs;
  }

  club(clubId: string): ClubInfo | undefined {
    return this.byId.get(clubId);
  }

  squad(clubId: string): readonly RosterPerson[] {
    const cached = this.squadCache.get(clubId);
    if (cached) return cached;

    const club = this.byId.get(clubId);
    if (!club) return [];

    const rng = this.rngFor(`${clubId}:squad`);
    const roll = (): number => rng.next();
    // Nitelikler AYRI bir tohum kanalindan gelir: boylece nitelik modeli
    // eklemek mevcut isim/yas akisini kaydirmaz ve dunya ayni kalir.
    const attrRng = this.rngFor(`${clubId}:attributes`);
    const attrRoll = (): number => attrRng.next();
    const numbers = rng.shuffle([...Array(30).keys()].map((n) => n + 2));

    const people: RosterPerson[] = SQUAD_SHAPE.map((position, i) => {
      const origin = this.forge.originFor(club.tier, roll);
      const name = this.forge.forge({ gender: 'male', origin }, roll);
      // Ilk ve son indeks kadronun en genci ve en yaslisini GARANTI eder;
      // youngster/veteran slotlari bos kalmasin.
      const age =
        i === SQUAD_SHAPE.length - 1 ? 17 : i === 0 ? 35 : 19 + Math.floor(roll() * 15);
      const spread = () => Math.floor(roll() * 30) - 15;
      const level = clamp(club.reputation + spread(), 15, 99);
      const attributes = forgeAttributes(position, level, attrRoll);

      return {
        sourceId: `mock:${clubId}:p${i}`,
        first: name.first,
        last: name.last,
        displayName: name.displayName,
        age,
        position,
        leadership: clamp(30 + (age - 17) * 2 + spread(), 5, 95),
        // quality artik ELLE degil, mevkiye gore agirlikli overall olarak turer.
        quality: overallFor(position, attributes),
        aggression: clamp(45 + spread(), 5, 95),
        attributes,
        origin: name.origin,
        gender: name.gender,
        clubId,
        shirtNumber: position === 'GK' && i === 0 ? 1 : (numbers[i] ?? i + 2),
      };
    });

    this.squadCache.set(clubId, people);
    for (const p of people) this.personIndex.set(p.sourceId, p);
    return people;
  }

  staff(clubId: string): readonly StaffPerson[] {
    const cached = this.staffCache.get(clubId);
    if (cached) return cached;

    const club = this.byId.get(clubId);
    if (!club) return [];

    const rng = this.rngFor(`${clubId}:staff`);
    const roll = (): number => rng.next();

    const people: StaffPerson[] = STAFF_SHAPE.map(({ role, minAge, maxAge }) => {
      // Teknik heyet yerelligi kadrodan yuksektir; yalnizca elit kuluplerde yabanci.
      const origin = club.tier === 'elite' ? this.forge.originFor(club.tier, roll) : 'tr';
      const name = this.forge.forge({ gender: this.staffGender.get(role) ?? 'any', origin }, roll);
      return {
        sourceId: `mock:${clubId}:s_${role}`,
        first: name.first,
        last: name.last,
        displayName: name.displayName,
        age: minAge + Math.floor(roll() * (maxAge - minAge)),
        role,
        origin: name.origin,
        gender: name.gender,
        clubId,
      };
    });

    this.staffCache.set(clubId, people);
    for (const p of people) this.personIndex.set(p.sourceId, p);
    return people;
  }

  lookup(sourceId: string): AnyPerson | undefined {
    const hit = this.personIndex.get(sourceId);
    if (hit) return hit;
    // Onbellek sogukken kimlikten kulubu cozup o kadroyu isitiriz.
    const clubId = sourceId.split(':')[1];
    if (clubId === undefined || !this.byId.has(clubId)) return undefined;
    this.squad(clubId);
    this.staff(clubId);
    return this.personIndex.get(sourceId);
  }

  private rngFor(key: string): Rng {
    return new Rng((this.opts.seed ^ hashString(key)) >>> 0);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
