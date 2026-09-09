/**
 * world.db KADRO SAGLAYICI -- `MockRosterProvider`in gercek dunya karsiligi.
 *
 * `src/domain/roster.ts` bu ani yillar once tarif etmisti:
 *   "DB ENTEGRASYONUNDA: bu dosya degismez. `DbRosterProvider` bu arayuzu
 *    uygular, `src/cli/*.ts` icindeki mock enjeksiyonu degisir."
 * Aynen oyle oldu: `RosterProvider` arayuzuna, motora ve icerik dosyalarina
 * TEK SATIR dokunulmadi.
 *
 * NEDEN SENKRON:
 *   `GameEngine.present()` senkrondur. `node:sqlite` de senkrondur -- bu
 *   tesaduf degil, secim sebebiydi. Bir async surucu butun cagri zincirini
 *   kirardi.
 *
 * MASKELI ISIM:
 *   Kulup ve oyuncu adlari `name_masked` / `last_masked` kolonlarindan okunur.
 *   Gercek adlar DB'de duruyor ama motora HIC girmez; boylece bir metin
 *   sablonunun yanlislikla gercek ismi basmasi yapisal olarak imkansiz.
 *
 * VERIDE OLMAYANLAR:
 *   Transfermarkt kazimasinda teknik heyet (baskan, doktor, fizyoterapist...)
 *   ve liderlik/sertlik gibi kisilik olculeri YOK. Bunlar tohumdan uretilir --
 *   mock saglayicinin yaptigi isin aynisi, ama yalnizca eksik olan icin.
 */

import {
  overallFor,
  type AnyPerson,
  type PlayerAttributes,
  type Position,
  type RosterPerson,
  type SlotDefinition,
  type StaffPerson,
  type StaffRole,
} from '../domain/actors.js';
import type { ClubInfo, LeagueInfo, RosterProvider } from '../domain/roster.js';
import { CLUB_TIERS, type ClubTier } from '../domain/axes.js';
import { hashString, NameForge, type NameConfig } from '../evaluation/NameForge.js';
import { Rng } from '../selection/Rng.js';
import type { DatabaseSyncType } from './sqlite.js';
import type { TransferOverlay } from '../domain/transfer.js';
import type { AgentProfile } from '../domain/agent.js';

/** Kadrosu bundan az olan kulup tohumdan tamamlanir. */
const MIN_SQUAD = 18;

const STAFF_SHAPE: readonly { role: StaffRole; minAge: number; maxAge: number }[] = [
  { role: 'manager', minAge: 42, maxAge: 66 },
  { role: 'assistant', minAge: 35, maxAge: 55 },
  { role: 'president', minAge: 46, maxAge: 70 },
  { role: 'sporting_director', minAge: 38, maxAge: 60 },
  { role: 'doctor', minAge: 32, maxAge: 60 },
  { role: 'physio', minAge: 28, maxAge: 50 },
];

/**
 * Uyruk -> isim havuzu kokeni.
 *
 * `origin` yalnizca METADATA: oyuncu adlari zaten DB'den maskeli geliyor,
 * uretilmiyor. Yine de dogru doldurmak, tohumdan TAMAMLANAN oyuncularin
 * kulubun uyruk dokusuna benzemesini saglar.
 */
const ORIGIN_BY_COUNTRY: Readonly<Record<string, string>> = {
  Brazil: 'br',
  Portugal: 'br',
  Spain: 'es',
  Argentina: 'es',
  Mexico: 'es',
  Colombia: 'es',
  France: 'fr',
  Belgium: 'fr',
  Serbia: 'rs',
  Croatia: 'rs',
  'Bosnia-Herzegovina': 'rs',
  Türkiye: 'tr',
  Turkey: 'tr',
};

interface ClubRow {
  id: number;
  name_masked: string;
  short_masked: string;
  city: string;
  stadium: string;
  tier: string;
  competition_id: number | null;
  reputation: number;
  rival_club_id: number | null;
  country_masked: string | null;
}

interface PlayerRow {
  id: number;
  first_masked: string;
  last_masked: string;
  birth_year: number | null;
  nationality: string;
  position: string;
  height_cm: number | null;
  pace: number;
  shooting: number;
  passing: number;
  defending: number;
  physical: number;
  goalkeeping: number;
  overall: number;
}

export interface DbRosterOptions {
  readonly db: DatabaseSyncType;
  /**
   * Transfer ortusu -- `world.db`nin uzerine serilen kariyer durumu.
   *
   * world.db SALT OKUNUR ve kariyer boyunca degismez; transfer ise kariyere
   * ozeldir. Bu yuzden kadro sorgusu once veritabanini okur, sonra ortuyu
   * uygular. Ayni world.db ile yirmi farkli kariyer oynanabilir.
   */
  readonly overlay?: TransferOverlay;
  readonly names: NameConfig;
  readonly slots: readonly SlotDefinition[];
  readonly seed: number;
}

export class DbRosterProvider implements RosterProvider {
  private readonly forge: NameForge;
  private readonly clubList: readonly ClubInfo[];
  private readonly byId: Map<string, ClubInfo>;
  private readonly squadCache = new Map<string, readonly RosterPerson[]>();
  private readonly staffCache = new Map<string, readonly StaffPerson[]>();
  private readonly personIndex = new Map<string, AnyPerson>();
  private readonly staffGender = new Map<StaffRole, 'male' | 'female' | 'any'>();
  private readonly squadStmt;

  constructor(private readonly opts: DbRosterOptions) {
    this.forge = new NameForge(opts.names);

    for (const slot of opts.slots) {
      if (slot.source === 'staff' && slot.staffRole !== undefined) {
        this.staffGender.set(slot.staffRole, slot.gender ?? 'any');
      }
    }

    this.squadStmt = opts.db.prepare(
      `SELECT p.id, p.first_masked, p.last_masked, p.birth_year, p.nationality,
              p.position, p.height_cm,
              a.pace, a.shooting, a.passing, a.defending, a.physical, a.goalkeeping, a.overall
       FROM player p JOIN player_attributes a ON a.player_id = p.id
       WHERE p.club_id = ?
       ORDER BY a.overall DESC`,
    );

    const rows = opts.db
      .prepare(
        `SELECT c.id, c.name_masked, c.short_masked, c.city, c.stadium, c.tier,
                c.competition_id, c.reputation, c.rival_club_id,
                n.name_masked AS country_masked
         FROM club c LEFT JOIN country n ON n.id = c.country_id
         ORDER BY c.reputation DESC`,
      )
      .all() as unknown as ClubRow[];

    this.clubList = rows.map((r) => toClubInfo(r));
    this.byId = new Map(this.clubList.map((c) => [c.id, c]));
  }

  clubs(): readonly ClubInfo[] {
    return this.clubList;
  }

  club(clubId: string): ClubInfo | undefined {
    return this.byId.get(clubId);
  }

  /** Piramidi `competition` tablosundan okur -- `LeagueModel` bunu bekler. */
  leagues(): readonly LeagueInfo[] {
    const rows = this.opts.db
      .prepare(
        `SELECT id, name_masked, level, promoted, relegated FROM competition ORDER BY level, id`,
      )
      .all() as unknown as {
      id: number;
      name_masked: string;
      level: number | null;
      promoted: number;
      relegated: number;
    }[];

    return rows.map((r) => ({
      id: String(r.id),
      label: r.name_masked,
      level: r.level ?? 9,
      promoted: r.promoted,
      relegated: r.relegated,
    }));
  }

  squad(clubId: string): readonly RosterPerson[] {
    const cached = this.squadCache.get(clubId);
    if (cached) return cached;

    const club = this.byId.get(clubId);
    if (!club) return [];

    const rows = this.squadStmt.all(Number(clubId)) as unknown as PlayerRow[];
    const overlay = this.opts.overlay;
    const members = overlay
      ? [
          // Bu kulupten GIDENLERI cikar...
          ...rows.filter((r) => overlay.clubOf(r.id, clubId) === clubId),
          // ...ve bu kulube GELENLERI ekle.
          ...this.incomingFor(clubId, overlay),
        ]
      : rows;
    const rng = this.rngFor(`${clubId}:squad`);
    const numbers = rng.shuffle([...Array(40).keys()].map((n) => n + 2));

    const people: RosterPerson[] = members.map((row, i) =>
      this.toRosterPerson(row, club, i, numbers[i] ?? i + 2, rng),
    );

    // Kaynak anliginda bazi kuluplerin kadrosu eksik geliyor (6 kisiye kadar
    // dusuyor). 11v11 simulasyonu bunu kaldiramaz; eksik olan TOHUMDAN
    // tamamlanir. Uydurulan oyuncu `gen:` onekiyle isaretlidir, gercek
    // oyuncudan ayirt edilebilir.
    if (people.length < MIN_SQUAD) {
      people.push(...this.fillSquad(club, people, MIN_SQUAD - people.length));
    }

    this.squadCache.set(clubId, people);
    for (const p of people) this.personIndex.set(p.sourceId, p);
    return people;
  }

  staff(clubId: string): readonly StaffPerson[] {
    const cached = this.staffCache.get(clubId);
    if (cached) return cached;

    const club = this.byId.get(clubId);
    if (!club) return [];

    // Teknik heyet kaynakta YOK -- tohumdan uretilir.
    const rng = this.rngFor(`${clubId}:staff`);
    const roll = (): number => rng.next();

    const people: StaffPerson[] = STAFF_SHAPE.map(({ role, minAge, maxAge }) => {
      const origin = this.forge.originFor(club.tier, roll);
      const name = this.forge.forge({ gender: this.staffGender.get(role) ?? 'any', origin }, roll);
      return {
        sourceId: `db:${clubId}:s_${role}`,
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

  private agentCache: readonly AgentProfile[] | undefined;

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

  /**
   * MENAJER HAVUZU.
   *
   * Bir kez okunup onbellege alinir: 96 satirlik sabit bir tablo ve
   * kariyer boyunca DEGISMEZ (Hero'nun o menajerle iliskisi GameState'te
   * durur, burada degil). Her cagride sorgulamak bosuna is olurdu.
   *
   * Yalnizca MASKELI ad donulur -- bu saglayicinin degismezi.
   */
  agents(): readonly AgentProfile[] {
    if (this.agentCache === undefined) {
      const rows = this.opts.db
        .prepare(
          'SELECT id, name_masked, archetype, reach, negotiation, loyalty,' +
            ' patience, commission, reputation FROM agent',
        )
        .all() as unknown as {
        id: number;
        name_masked: string;
        archetype: string;
        reach: number;
        negotiation: number;
        loyalty: number;
        patience: number;
        commission: number;
        reputation: number;
      }[];
      this.agentCache = rows.map((r) => ({
        id: r.id,
        name: r.name_masked,
        archetype: r.archetype as AgentProfile['archetype'],
        reach: r.reach,
        negotiation: r.negotiation,
        loyalty: r.loyalty,
        patience: r.patience,
        commission: r.commission,
        reputation: r.reputation,
      }));
    }
    return this.agentCache;
  }

  // ------------------------------------------------------------- ic isleyis

  private toRosterPerson(
    row: PlayerRow,
    club: ClubInfo,
    index: number,
    shirt: number,
    rng: Rng,
  ): RosterPerson {
    const attributes: PlayerAttributes = {
      pace: row.pace,
      shooting: row.shooting,
      passing: row.passing,
      defending: row.defending,
      physical: row.physical,
      goalkeeping: row.goalkeeping,
    };
    const position = row.position as Position;
    const age = row.birth_year === null ? 26 : clamp(CURRENT_YEAR - row.birth_year, 16, 44);
    const spread = Math.floor(rng.next() * 20) - 10;

    return {
      sourceId: `db:${club.id}:p${row.id}`,
      first: row.first_masked,
      last: row.last_masked,
      displayName: `${row.first_masked} ${row.last_masked}`.trim(),
      age,
      position,
      // Liderlik kaynakta yok: yas + seviye + kucuk bir dagilim.
      // Kadronun en yaslisi ve en iyisi kaptan adayi olur.
      leadership: clamp(20 + (age - 17) * 2.2 + (row.overall - 60) * 0.35 + spread, 5, 95),
      // `quality` NITELIKLERDEN turer -- motorun sozlesmesi bu yonde.
      quality: overallFor(position, attributes),
      aggression: clamp(aggressionFor(position, attributes) + spread * 0.5, 5, 95),
      attributes,
      origin: ORIGIN_BY_COUNTRY[row.nationality] ?? 'tr',
      gender: 'male',
      clubId: club.id,
      // En iyi kaleci 1 numarayi alir; gerisi tohumlu.
      shirtNumber: position === 'GK' && index === 0 ? 1 : shirt,
    };
  }

  /** Eksik kadroyu kulup seviyesine uygun uretilmis oyuncularla tamamlar. */
  private fillSquad(
    club: ClubInfo,
    existing: readonly RosterPerson[],
    count: number,
  ): RosterPerson[] {
    const rng = this.rngFor(`${club.id}:fill`);
    const roll = (): number => rng.next();
    const missing = missingPositions(existing, count);

    return missing.map((position, i) => {
      const origin = this.forge.originFor(club.tier, roll);
      const name = this.forge.forge({ gender: 'male', origin }, roll);
      // Tamamlama oyuncusu kadronun ORTALAMASININ altinda: gercek veriyi
      // golgelemesin, yalnizca sahaya 11 kisi ciksin.
      const level = clamp(averageQuality(existing, club.reputation) - 6 + roll() * 8, 15, 90);
      const attributes = forgeAttributes(position, level, roll);

      return {
        sourceId: `db:${club.id}:gen${i}`,
        first: name.first,
        last: name.last,
        displayName: name.displayName,
        age: 19 + Math.floor(roll() * 14),
        position,
        leadership: clamp(25 + roll() * 40, 5, 95),
        quality: overallFor(position, attributes),
        aggression: clamp(40 + roll() * 30, 5, 95),
        attributes,
        origin: name.origin,
        gender: name.gender,
        clubId: club.id,
        shirtNumber: 60 + i,
      };
    });
  }

  /**
   * Ortu sayesinde bu kulube gelmis oyuncular.
   *
   * Kadro onbellegi transferden sonra `invalidate()` ile temizlenmeli, yoksa
   * eski kadro donmeye devam eder.
   */
  private incomingFor(clubId: string, overlay: TransferOverlay): PlayerRow[] {
    const ids = overlay
      .all()
      .filter((t) => overlay.clubOf(t.playerId, t.fromClubId) === clubId)
      .map((t) => t.playerId);
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(',');
    return this.opts.db
      .prepare(
        `SELECT p.id, p.first_masked, p.last_masked, p.birth_year, p.nationality,
                p.position, p.height_cm,
                a.pace, a.shooting, a.passing, a.defending, a.physical, a.goalkeeping, a.overall
         FROM player p JOIN player_attributes a ON a.player_id = p.id
         WHERE p.id IN (${placeholders})
         ORDER BY a.overall DESC`,
      )
      .all(...ids) as unknown as PlayerRow[];
  }

  /** Transferden sonra cagrilir: kadro onbellegi bayatlamasin. */
  invalidate(clubId?: string): void {
    if (clubId === undefined) this.squadCache.clear();
    else this.squadCache.delete(clubId);
  }

  private rngFor(key: string): Rng {
    return new Rng((this.opts.seed ^ hashString(key)) >>> 0);
  }
}

const CURRENT_YEAR = new Date().getFullYear();

function toClubInfo(row: ClubRow): ClubInfo {
  const tier = (CLUB_TIERS as readonly string[]).includes(row.tier)
    ? (row.tier as ClubTier)
    : 'mid';
  return {
    id: String(row.id),
    // MASKELI ad -- gercek ad motora hic girmez.
    name: row.name_masked,
    city: row.city,
    stadium: row.stadium,
    tier,
    league: String(row.competition_id ?? 0),
    reputation: row.reputation,
    // EZELI RAKIP.
    //
    // OLCULEN SORUN: bu alan HIC doldurulmuyordu. Veritabaninda
    // `rival_club_id` 300/303 kulupte doluydu (`pipeline/rivalries.ts`
    // ozellikle onu kurmak icin yazilmis) ama sorguya bile alinmiyordu.
    //
    // Sonuc sessizdi ve buyuktu: `play.ts` transferde
    // `club?.rivalId === target.id` diye bakiyor, bu her zaman false
    // donuyordu. Yani EZELI RAKIBE TRANSFER oyuncu icin de imkansizdi;
    // `mem_rakibe_transfer` hic yazilmiyor ve
    // `evt_transfer_rakibe_gecis_hesaplasma` hep olu goruluyordu.
    ...(row.rival_club_id === null ? {} : { rivalId: String(row.rival_club_id) }),
    // Enflasyon ULKEYE baglidir; kulubun ulkesi motora ulasmali.
    ...(row.country_masked === null || row.country_masked === undefined
      ? {}
      : { countryName: row.country_masked }),
    // Yabanci orani kadronun kendisinden turer; ayri bir alan tutmaya gerek yok.
    foreignRatio: 0,
  };
}

/** Sertlik kaynakta yok: mevki + fizik iyi bir vekil. Stoper sert, kanat degil. */
function aggressionFor(position: Position, a: PlayerAttributes): number {
  const base = position === 'DF' ? 62 : position === 'MF' ? 52 : position === 'FW' ? 44 : 36;
  return base + (a.physical - 60) * 0.25 + (a.defending - 50) * 0.15;
}

/** Formasyonun acik biraktigi mevkileri sirayla doner. */
function missingPositions(existing: readonly RosterPerson[], count: number): Position[] {
  const need: Readonly<Record<Position, number>> = { GK: 2, DF: 6, MF: 6, FW: 4 };
  const have: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const p of existing) have[p.position] += 1;

  const out: Position[] = [];
  // Once acigi en buyuk mevki -- kalecisiz kadro kalmasin.
  while (out.length < count) {
    let pick: Position = 'MF';
    let worst = -Infinity;
    for (const position of ['GK', 'DF', 'MF', 'FW'] as const) {
      const deficit = need[position] - have[position];
      if (deficit > worst) {
        worst = deficit;
        pick = position;
      }
    }
    have[pick] += 1;
    out.push(pick);
  }
  return out;
}

function averageQuality(people: readonly RosterPerson[], fallback: number): number {
  if (people.length === 0) return fallback;
  return people.reduce((s, p) => s + p.quality, 0) / people.length;
}

/** Tamamlama oyuncusu icin mevkiye uygun nitelik seti. */
function forgeAttributes(position: Position, level: number, roll: () => number): PlayerAttributes {
  const shape: Readonly<Record<Position, PlayerAttributes>> = {
    GK: { pace: 45, shooting: 15, passing: 55, defending: 35, physical: 80, goalkeeping: 100 },
    DF: { pace: 70, shooting: 35, passing: 70, defending: 100, physical: 92, goalkeeping: 4 },
    MF: { pace: 74, shooting: 66, passing: 100, defending: 64, physical: 70, goalkeeping: 2 },
    FW: { pace: 88, shooting: 100, passing: 62, defending: 26, physical: 78, goalkeeping: 2 },
  };
  const base = shape[position];
  const scale = level / 78;
  const one = (v: number): number => clamp(Math.round(v * scale + (roll() * 6 - 3)), 1, 99);

  return {
    pace: one(base.pace),
    shooting: one(base.shooting),
    passing: one(base.passing),
    defending: one(base.defending),
    physical: one(base.physical),
    goalkeeping: one(base.goalkeeping),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}
