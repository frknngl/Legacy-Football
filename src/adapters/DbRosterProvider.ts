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
  /**
   * FC26 anligindan GELEN degerler. Transfermarkt hatti tasimaz -> NULL.
   * Null geldiginde eski tahmin yoluna dusulur (zarif bozulma).
   */
  aggression: number | null;
  composure: number | null;
  intl_reputation: number | null;
  shirt_number: number | null;
}

interface StaffRow {
  id: number;
  name_masked: string;
  first_masked: string;
  last_masked: string;
  role: string;
  birth_year: number | null;
  origin: string;
  reputation: number;
  tactical: number | null;
  training: number | null;
  development: number | null;
  motivation: number | null;
  man_management: number | null;
  discipline: number | null;
  preferred_formation: string | null;
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
  private readonly freeStaffCache = new Map<string, readonly StaffPerson[]>();
  private readonly personIndex = new Map<string, AnyPerson>();
  private readonly staffGender = new Map<StaffRole, 'male' | 'female' | 'any'>();
  private readonly squadStmt;
  /**
   * Teknik heyet sorgusu -- OPSIYONEL.
   *
   * `staff` tablosu v5 ile geldi. Eski bir world.db ile calisirken
   * `prepare` patlar; bu yuzden hazirlama denemesi sarmalanir ve
   * basarisizlikta saglayici tohum yoluna duser. Motorun eski veriyle
   * calismayi reddetmesi icin bir sebep yok.
   */
  private readonly staffStmt: ReturnType<DatabaseSyncType['prepare']> | undefined;
  private readonly freeStaffStmt: ReturnType<DatabaseSyncType['prepare']> | undefined;

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
              p.aggression, p.composure, p.intl_reputation, p.shirt_number,
              a.pace, a.shooting, a.passing, a.defending, a.physical, a.goalkeeping, a.overall
       FROM player p JOIN player_attributes a ON a.player_id = p.id
       WHERE p.club_id = ?
       ORDER BY a.overall DESC`,
    );

    this.staffStmt = prepareOrUndefined(
      opts.db,
      `SELECT s.id, s.name_masked, s.first_masked, s.last_masked, s.role,
              s.birth_year, s.origin, s.reputation,
              a.tactical, a.training, a.development, a.motivation,
              a.man_management, a.discipline, a.preferred_formation
       FROM staff s LEFT JOIN staff_attributes a ON a.staff_id = s.id
       WHERE s.club_id = ?`,
    );

    // BOSTA HEYET -- kulube atanmamis kisiler.
    //
    // SIRALAMA IKI OLCUTLU ve ikisi de kasitli:
    //
    //   1. ITIBAR YAKINLIGI -- nitelige gore DEGIL. Once 'a.overall DESC'
    //      yazilmisti ve olcumde her kulup havuzun en iyisini aliyordu:
    //      dort ard arda kovulmada gelen hocalarin taktik degeri
    //      74/74/74/79 ciktil. Yani her kovulma bir YUKSELTMEYE donusuyordu
    //      ve kume hattindaki takimla dev kulup ayni hocayi celbediyordu.
    //      Itibar farkina gore siralamak bunu kendiliginden duzeltir.
    //
    //   2. ULKE -- ESITLIK BOZUCU, kapi DEGIL. Once mutlak kapiydi ve
    //      olcumde itibari 96 olan bir kulube havuzun en iyi yerli hocasi
    //      (itibar 61) geliyordu; itibari 94 olan yabanci hoca sirada ondan
    //      SONRA bekliyordu. Gercek bir dev en iyi ismi yurt disindan da
    //      alir. Ulke tercihi artik sekiz itibar puani degerinde: yakin
    //      adaylarda yerliyi one alir, arayi acan farki kapatmaz.
    this.freeStaffStmt = prepareOrUndefined(
      opts.db,
      `SELECT s.id, s.name_masked, s.first_masked, s.last_masked, s.role,
              s.birth_year, s.origin, s.reputation,
              a.tactical, a.training, a.development, a.motivation,
              a.man_management, a.discipline, a.preferred_formation
       FROM staff s LEFT JOIN staff_attributes a ON a.staff_id = s.id
       WHERE s.club_id IS NULL AND s.role = ?
       ORDER BY abs(s.reputation - coalesce(
                      (SELECT reputation FROM club WHERE id = ?), 50))
                - 8 * (s.country_id IS NOT NULL
                       AND s.country_id = (SELECT country_id FROM club WHERE id = ?)) ASC`,
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
    // ULKE DE OKUNUR: terfi/dusme piramidi ulke icinde kalmali. Bu kolon
    // sorguya alinmadigi surece `LeagueModel` butun ulkeleri tek piramit
    // sanar ve dunya birkac sezonda iki lige cokerdi (bkz. LeagueInfo.country).
    const rows = this.opts.db
      .prepare(
        `SELECT id, name_masked, level, promoted, relegated, country_id
         FROM competition ORDER BY level, id`,
      )
      .all() as unknown as {
      id: number;
      name_masked: string;
      level: number | null;
      promoted: number;
      relegated: number;
      country_id: number | null;
    }[];

    return rows.map((r) => ({
      id: String(r.id),
      label: r.name_masked,
      level: r.level ?? 9,
      promoted: r.promoted,
      relegated: r.relegated,
      ...(r.country_id === null ? {} : { country: String(r.country_id) }),
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

    // ONCE VERITABANI.
    //
    // `staff` tablosu geldiginde teknik heyet artik tohumdan uretilmiyor:
    // kimlik gercek (male_coaches.csv), nitelikler import asamasinda
    // deterministik olarak uretilmis ve KALICI. Ayni dunyada yirmi kariyer
    // ayni hocalari gorur.
    const fromDb = this.staffFromDb(clubId);
    if (fromDb.length > 0) {
      this.staffCache.set(clubId, fromDb);
      for (const p of fromDb) this.personIndex.set(p.sourceId, p);
      return fromDb;
    }

    // Tablo bossa (eski world.db, ya da oyuncu asamasi atlanmis import)
    // eski tohum yoluna dusulur -- oyun calismaya devam eder.
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

  /**
   * Teknik heyeti veritabanindan okur.
   *
   * `staff_attributes` LEFT JOIN'dir: doktor, fizyoterapist ve baskan
   * nitelik tasimaz (bir doktorun taktik bilgisi anlamsiz) ve o satirlar
   * hic yazilmaz. Nitelik yoksa `attributes` alani KONULMAZ -- okuyan
   * taraf yoklugunda notr davranir.
   *
   * Tablo bos donerse cagiran eski tohum yoluna duser.
   */
  /** Satir -> kisi. Atanmis ve bosta heyet ayni esleme kullanir. */
  private staffPerson(r: StaffRow, sourceId: string, clubId: string): StaffPerson {
    const first = r.first_masked === '' ? r.name_masked : r.first_masked;
    const last = r.last_masked;
    const attributes =
      r.tactical === null
        ? undefined
        : {
            tactical: r.tactical,
            training: r.training ?? 50,
            development: r.development ?? 50,
            motivation: r.motivation ?? 50,
            manManagement: r.man_management ?? 50,
            discipline: r.discipline ?? 50,
          };

    return {
      sourceId,
      first,
      last,
      displayName: `${first} ${last}`.trim(),
      age: r.birth_year === null ? 50 : clamp(CURRENT_YEAR - r.birth_year, 25, 80),
      role: r.role as StaffRole,
      origin: r.origin,
      gender: 'male' as const,
      clubId,
      ...(attributes === undefined ? {} : { attributes }),
      reputation: r.reputation,
    };
  }

  /**
   * BOSTA TEKNIK HEYET.
   *
   * KIMLIK DESENI FARKLI ve bu kasitli: atanmis heyet `db:<kulup>:s_<rol>`
   * desenini kullanir -- yani KOLTUGU adlandirir, kisiyi degil. Kovulan
   * hocanin yerine gelen kisi ayni deseni alsaydi aktor arsivi yeni hocayi
   * eskisiyle AYNI kisi sanar ve kovulmayla biten iliskiyi geri yuklerdi.
   * Bosta hocalar o yuzden `db:free:s_<id>` ile, yani KISI kimligiyle
   * yasar; kulup degistirse de ayni kalir.
   */
  freeStaff(role: StaffRole, clubId?: string): readonly StaffPerson[] {
    if (!this.freeStaffStmt) return [];
    const cacheKey = `${role}:${clubId ?? ''}`;
    const cached = this.freeStaffCache.get(cacheKey);
    if (cached) return cached;

    const club = clubId === undefined ? -1 : Number(clubId);
    const rows = this.freeStaffStmt.all(role, club, club) as unknown as StaffRow[];

    // KULUP ALANI: sorulan kulup yazilir. Bosta bir hocanin kulubu yoktur
    // ama bu liste her zaman "su kulube kim gelebilir" diye sorulur ve
    // `CastingDirector` aktoru baglarken `person.clubId`yi kullanir --
    // yani gelecek kulup. Kulup verilmemisse alan bos kalir.
    const people = rows.map((r) => this.staffPerson(r, `db:free:s_${r.id}`, clubId ?? ''));
    this.freeStaffCache.set(cacheKey, people);
    for (const p of people) this.personIndex.set(p.sourceId, p);
    return people;
  }

  private staffFromDb(clubId: string): StaffPerson[] {
    if (!this.staffStmt) return [];
    const rows = this.staffStmt.all(Number(clubId)) as unknown as StaffRow[];
    if (rows.length === 0) return [];

    // Kimlik `db:<kulup>:s_<rol>` deseninde KALIR. Tohumdan uretilen
    // heyetle ayni bicim: `lookup()` kimligi kuluple cozuyor ve arsiv
    // kayitlari bu desene gore yazilmis durumda. Kaynak degisti diye
    // kimlik bicimini degistirmek eski kariyerlerin aktor arsivini
    // sahipsiz birakirdi.
    return rows.map((r) => this.staffPerson(r, `db:${clubId}:s_${r.role}`, clubId));
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
      // SIRKET ETKISI.
      //
      // Menajer bir KISI, arkasindaki sirket bir KURUM. Sirketin nufuzu
      // menajerin acabilecegi kapiyi OLCEKLER -- ezmez. Wasserman'da
      // calisan bir menajer ayni yetenekteki bagimsiz bir menajerden daha
      // cok kapi acar, ama arketip carpani (0.2x-1.8x) hala baskin kalir.
      //
      // Sirket yoksa (eski world.db, ya da sirket asamasi atlanmis import)
      // LEFT JOIN NULL doner ve etki sifir olur -- zarif bozulma.
      const rows = this.opts.db
        .prepare(
          `SELECT g.id, g.name_masked, g.archetype, g.reach, g.negotiation,
                  g.loyalty, g.patience, g.commission, g.reputation,
                  a.influence AS agency_influence,
                  a.negotiation_power AS agency_negotiation
           FROM agent g LEFT JOIN agency a ON a.id = g.agency_id`,
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
        agency_influence: number | null;
        agency_negotiation: number | null;
      }[];
      this.agentCache = rows.map((r) => ({
        id: r.id,
        name: r.name_masked,
        archetype: r.archetype as AgentProfile['archetype'],
        // Katsayilar DAR tutuldu: sirket bir menajeri bir kademe yukari
        // tasir, sinif atlatmaz. 0.15 x 50 = en fazla +/-7.5 puan.
        reach: blend(r.reach, r.agency_influence, 0.15),
        negotiation: blend(r.negotiation, r.agency_negotiation, 0.12),
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
      // LIDERLIK.
      //
      // Kaynakta dogrudan yok ama FC26 `international_reputation` (1-5)
      // tasiyor: milli takim ve kuresel taninirlik olcusu, kaptanlik
      // adayligiyla dogrudan ilgili. Varsa yas ve seviyenin yaninda UCUNCU
      // girdi olur; yoksa eski iki girdili tahmin surer.
      leadership: clamp(
        20 +
          (age - 17) * 2.2 +
          (row.overall - 60) * 0.35 +
          (row.intl_reputation === null ? 0 : (row.intl_reputation - 1) * 6) +
          spread,
        5,
        95,
      ),
      // `quality` NITELIKLERDEN turer -- motorun sozlesmesi bu yonde.
      quality: overallFor(position, attributes),
      // SERTLIK -- artik GERCEK veriden.
      //
      // OLCULEN SORUN: `player.aggression` kolonu FC26'nin
      // `mentality_aggression` degeriyle DOLUYDU ama sorguya hic
      // alinmiyordu; motor `aggressionFor()` ile mevkiden TAHMIN
      // uretiyordu (DF 62 / MF 52 / FW 44 / GK 36 tabani).
      // `MatchSimulator` faul esigini `offender.aggression / 220` ile
      // hesapladigi icin uydurulmus deger dogrudan maca giriyordu.
      aggression:
        row.aggression === null
          ? clamp(aggressionFor(position, attributes) + spread * 0.5, 5, 95)
          : clamp(row.aggression, 5, 95),
      attributes,
      ...(row.composure === null ? {} : { composure: clamp(row.composure, 1, 99) }),
      origin: ORIGIN_BY_COUNTRY[row.nationality] ?? 'tr',
      gender: 'male',
      clubId: club.id,
      // FORMA NUMARASI -- gercegi varsa o.
      //
      // Eskiden tamami tohumdan cekiliyordu. Gercek numara kadroyu
      // taninir kilar; yoksa eski davranis (en iyi kaleci 1, gerisi
      // tohumlu) surer.
      shirtNumber:
        row.shirt_number !== null && row.shirt_number > 0
          ? row.shirt_number
          : position === 'GK' && index === 0
            ? 1
            : shirt,
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
                p.aggression, p.composure, p.intl_reputation, p.shirt_number,
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

/**
 * Sorguyu hazirlamayi dener; tablo yoksa `undefined` doner.
 *
 * Sema surumleri arasinda zarif bozulma: yeni bir tablo eklendiginde eski
 * bir world.db ile acilan oyun patlamaz, o ozelligi kapali calistirir.
 */
function prepareOrUndefined(
  db: DatabaseSyncType,
  sql: string,
): ReturnType<DatabaseSyncType['prepare']> | undefined {
  try {
    return db.prepare(sql);
  } catch {
    return undefined;
  }
}

/**
 * Menajer niteligini sirket degeriyle harmanlar.
 *
 * Sirket degeri yoksa nitelik AYNEN doner. 0-100 bandi her durumda korunur
 * -- `reachFit()` bandin disindaki bir degerle cagrilirsa olasilik
 * hesaplari bozulur.
 */
function blend(base: number, agencyValue: number | null, weight: number): number {
  if (agencyValue === null) return base;
  return clamp(base + (agencyValue - 50) * weight, 0, 100);
}
