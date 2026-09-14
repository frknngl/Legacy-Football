/**
 * IMPORT ORKESTRASI -- CSV klasoru -> world.db.
 *
 * Asamalar sirayla calisir ve her biri `IssueLog`a yazar. Hicbir asama
 * "veri temiz" varsaymaz; eksik lig, tuhaf kulup sayisi, kimliksiz kulup
 * rapor edilir ve GUI bu raporu listeler.
 *
 * YENIDEN CALISTIRILABILIR: ayni world.db uzerine tekrar import etmek
 * guvenlidir. Maskeler `mask_binding` kilidinden gelir, degismez; yalnizca
 * degisken alanlar (lig, itibar, basamak, mac sayisi) guncellenir.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openWorldDb, persistIssues, recordProvenance, IssueLog } from './db.js';
import { MaskBinder, EMPTY_RULES, type ManualRules } from './masking.js';
import { DEFAULT_SCOPE, type ImportScope } from './scope.js';
import { buildCompetitions } from './pipeline/competitions.js';
import { emitWorld, type EmitResult } from './pipeline/emit.js';
import { importPlayers, type PlayerStageResult } from './pipeline/players.js';
import { recomputeReputation } from './pipeline/reputation.js';
import { generateReferees, type RefereeStageResult } from './pipeline/referees.js';
import { generateAgents, type AgentStageResult } from './pipeline/agents.js';
import { computeBudgets } from './pipeline/budgets.js';
import { deriveRivalries } from './pipeline/rivalries.js';
import { importFc26, type Fc26StageResult } from './pipeline/fc26.js';
import { generateFreeManagers, generateStaff, type StaffStageResult } from './pipeline/staff.js';
import { importAgencies, type AgencyStageResult } from './pipeline/agency.js';
import { seedReference, applyCountryAdjectives } from './pipeline/reference.js';
import {
  buildCups,
  fillRefereeEligibility,
  computeFinancialPower,
  computeSquadValue,
  linkAgentsToAgencies,
} from './pipeline/derive.js';

export const REPO_URL = 'https://github.com/salimt/football-datasets';

/**
 * Kaynak dosya adlari.
 *
 * Iki yerlesim de kabul edilir:
 *   <data>/team_details/team_details.csv   -- reponun kendi duzeni
 *   <data>/team_details.csv                -- dosyalari duz atmis kullanici
 * Kullaniciyi klasor yeniden duzenlemeye zorlamak gereksiz surtunme.
 */
export const SOURCE_FILES = {
  teamDetails: 'team_details.csv',
  seasons: 'team_competitions_seasons.csv',
  playerProfiles: 'player_profiles.csv',
  marketValue: 'player_latest_market_value.csv',
  /** FC26 anligi -- nitelik, mevki ve lig kaynagi. */
  fc26: 'FC26_20250921.csv',
  /** Teknik direktor KIMLIKLERI (nitelik tasimaz). */
  coaches: 'male_coaches.csv',
} as const;

/** Once repo duzenini, sonra duz klasoru dener. */
export function resolveSource(dataDir: string, fileName: string): string | undefined {
  const stem = fileName.replace(/\.csv$/, '');
  for (const candidate of [join(dataDir, stem, fileName), join(dataDir, fileName)]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export interface ImportOptions {
  /** `datalake/transfermarkt` klasoru. */
  readonly dataDir: string;
  readonly dbPath: string;
  readonly scope?: ImportScope;
  readonly rulesPath?: string;
  /**
   * Besleme kaynagi.
   *
   *   'fc26'          -> FC26 anligi. Nitelikler GERCEK, mevki gercek,
   *                      lig seviyesi gercek. Varsayilan.
   *   'transfermarkt' -> eski hat. Nitelikler piyasa degerinden TAHMIN.
   *
   * Iki hat da ayni semayi doldurur; fark verinin nereden geldigi.
   */
  readonly source?: 'fc26' | 'transfermarkt';
}

export interface ImportReport {
  readonly emit: EmitResult;
  readonly fc26: Fc26StageResult | undefined;
  readonly players: PlayerStageResult | undefined;
  readonly staff: StaffStageResult | undefined;
  readonly agencies: AgencyStageResult | undefined;
  readonly referees: RefereeStageResult;
  readonly agents: AgentStageResult;
  readonly log: IssueLog;
}

export async function runImport(options: ImportOptions): Promise<ImportReport> {
  const scope = options.scope ?? DEFAULT_SCOPE;
  const log = new IssueLog();

  // KAYNAK SECIMI -- acikca verilmediyse ELDEKI DOSYAYA gore.
  //
  // Varsayilan FC26'dir (nitelikler gercek), ama o dosya yoksa ve
  // Transfermarkt dosyalari varsa eski hatta duseriz. Sabit bir varsayilan,
  // yalnizca Transfermarkt verisi olan bir klasorde anlasilmaz bir
  // "dosya bulunamadi" hatasi verirdi.
  const source =
    options.source ??
    (resolveSource(options.dataDir, SOURCE_FILES.fc26) !== undefined
      ? 'fc26'
      : 'transfermarkt');
  if (options.source === undefined) {
    log.info('import', `kaynak otomatik secildi: ${source}`);
  }

  const rules = await loadRules(options.rulesPath, log);
  const db = openWorldDb(options.dbPath);

  try {
    // REFERANS TOHUMU HER SEYDEN ONCE.
    //
    // Lig-ulke eslemesi, isim havuzlari, nitelik bantlari, rol tanimlari ve
    // KURATORLU MASKE ESLEMESI veritabaninda yasar; butun asamalar onlari
    // DB'den okur. Tohum var olan satiri EZMEZ -- editorde yapilmis
    // duzeltmeler korunur.
    //
    // SIRA KRITIK: `MaskBinder` kuratorlu kurallari KURULURKEN okur.
    // Tohumdan once kurulursa tablo bos gorunur ve 'Manchester City ->
    // Manchester Blue' gibi elle secilmis adlarin hicbiri uygulanmaz --
    // olculdu, tam olarak bu oluyordu.
    seedReference(db, log);

    const binder = new MaskBinder(db, rules);

    let emit: EmitResult;
    let fc26: Fc26StageResult | undefined;
    let players: PlayerStageResult | undefined;

    if (source === 'fc26') {
      // --- FC26 HATTI (varsayilan)
      //
      // Tek dosya ulke + lig + kulup + oyuncu + NITELIK tasiyor. Nitelikler
      // GERCEK; piyasa degerinden tahmin edilmiyor.
      const fc26File = requireFile(options.dataDir, SOURCE_FILES.fc26);
      fc26 = await importFc26({ file: fc26File, db, binder, log, scope });
      emit = {
        countries: fc26.countries,
        competitions: fc26.competitions,
        clubs: fc26.clubs,
        freshMasks: 0,
        reusedMasks: 0,
      };
    } else {
      // --- TRANSFERMARKT HATTI (eski)
      //
      // Korunuyor: kupa yapisi, sezon gecmisi ve mac sayisi tuhafliklari
      // (MLS 33, konferans ligleri) yalnizca bu kaynakta var.
      const teamDetailsFile = requireFile(options.dataDir, SOURCE_FILES.teamDetails);
      const seasonsFile = requireFile(options.dataDir, SOURCE_FILES.seasons);
      const drafts = await buildCompetitions({ teamDetailsFile, seasonsFile, scope, log });
      emit = emitWorld(db, drafts, binder, scope, log);

      const profilesFile = resolveSource(options.dataDir, SOURCE_FILES.playerProfiles);
      const valuesFile = resolveSource(options.dataDir, SOURCE_FILES.marketValue);
      if (profilesFile !== undefined && valuesFile !== undefined) {
        players = await importPlayers({ profilesFile, valuesFile, db, binder, log });
      } else {
        const missing: string[] = [];
        if (profilesFile === undefined) missing.push(SOURCE_FILES.playerProfiles);
        if (valuesFile === undefined) missing.push(SOURCE_FILES.marketValue);
        log.warn('players', `oyuncu asamasi atlandi -- eksik dosya: ${missing.join(', ')}`);
      }
    }

    const hasPlayers = (fc26?.players ?? 0) > 0 || players !== undefined;

    if (hasPlayers) {
      // Kadro degeri once: itibar, butce ve finansal guc onu okuyor.
      computeSquadValue(db, log);
      // Oyuncular yazildi -> itibar artik ON TAHMINDEN degil KADRO
      // DEGERINDEN hesaplanabilir. clubTier'i belirleyen otorite budur.
      recomputeReputation(db, log);
      // Butceler kadro degerinden turer -- oyuncular yazildiktan SONRA.
      computeBudgets(db, log);
      // EZELI RAKIPLIK: kaynakta yok, itibar yakinligindan turetilir.
      deriveRivalries(db, log);
    }

    // ULKE KUPALARI -- turnuva olarak VERITABANINA yazilir.
    //
    // Eskiden kupalar yalnizca CALISMA ANINDA vardi: `dbWorld.ts` her
    // acilista `cup_<ulke>` diye uyduruyordu. Yani kupanin adi yoktu,
    // itibari yoktu, hakem uygunlugu tanimlanamiyordu ve editor onu
    // goremiyordu. Artik gercek birer `competition` satiri.
    // Ulke sifatlari -- lig adlari bunlardan turedi, ulke satirlari
    // yazildiktan SONRA isaretlenir.
    applyCountryAdjectives(db);

    const cups = buildCups(db, binder, scope, log);

    // TEKNIK HEYET: kimlik gercek (male_coaches.csv), nitelik uretilmis.
    // Kuluplerden SONRA -- tier ve ulke okunuyor.
    const staff = await generateStaff({
      db,
      binder,
      log,
      seed: scope.sourceSeason,
      coachesFile: resolveSource(options.dataDir, SOURCE_FILES.coaches),
    });

    // BOSTA HOCALAR -- kuluplerin hocalari dokuldukten SONRA.
    // Kovulan hocanin yerine gelecek isim havuzu; bkz. pipeline/staff.ts.
    generateFreeManagers({ db, binder, log, seed: scope.sourceSeason });

    // HAKEMLER: hicbir kaynakta yok, tohumdan uretilir.
    const referees = generateReferees({
      db,
      binder,
      log,
      seed: scope.sourceSeason,
    });

    // Hangi turnuva hangi kokarti zorunlu kilar -- turnuvalar (kupalar
    // dahil) yazildiktan ve hakemler uretildikten SONRA.
    fillRefereeEligibility(db, log);

    // MENAJERLER (kisi) -- Hero'nun temsilcisi.
    const agents = generateAgents({
      db,
      binder,
      log,
      seed: scope.sourceSeason,
    });

    // MENAJERLIK SIRKETLERI -- kaynakta GERCEKTEN var (4.842 sirket).
    // Oyuncular yazildiktan sonra, cunku musteri eslestirmesi yapiyor.
    const agencies = hasPlayers
      ? await importAgencies({
          db,
          binder,
          log,
          seed: scope.sourceSeason,
          profilesFile: resolveSource(options.dataDir, SOURCE_FILES.playerProfiles),
        })
      : undefined;

    // Menajerleri sirketlere bagla ve finansal gucu hesapla.
    linkAgentsToAgencies(db, log);
    computeFinancialPower(db, log);

    recordProvenance(db, {
      repoUrl: REPO_URL,
      sourceSeason: scope.sourceSeason,
      scope,
      sourceKind: source,
    });

    db.exec('DELETE FROM import_issue');
    persistIssues(db, log);
    log.info('import', `${cups} ulke kupasi olusturuldu`);
    return { emit, fc26, players, staff, agencies, referees, agents, log };
  } finally {
    db.close();
  }
}

function requireFile(dataDir: string, fileName: string): string {
  const found = resolveSource(dataDir, fileName);
  if (found !== undefined) return found;
  throw new Error(
    `Kaynak dosya bulunamadi: ${fileName}\n` +
      `  Arandi: ${join(dataDir, fileName.replace(/\.csv$/, ''), fileName)}\n` +
      `          ${join(dataDir, fileName)}\n` +
      `  Repo: ${REPO_URL}`,
  );
}

async function loadRules(path: string | undefined, log: IssueLog): Promise<ManualRules> {
  if (path === undefined) return EMPTY_RULES;
  if (!existsSync(path)) {
    log.warn('rules', `kural dosyasi yok, algoritmaya dusuluyor: ${path}`);
    return EMPTY_RULES;
  }
  const raw: unknown = JSON.parse(await readFile(path, 'utf-8'));
  const r = raw as Partial<ManualRules>;
  const rules: ManualRules = {
    club: r.club ?? {},
    competition: r.competition ?? {},
    country: r.country ?? {},
  };
  log.info(
    'rules',
    `elle kuratorlu esleme: ${Object.keys(rules.club).length} kulup, ` +
      `${Object.keys(rules.competition).length} turnuva, ${Object.keys(rules.country).length} ulke`,
  );
  return rules;
}
