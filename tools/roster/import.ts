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
  /** Hakem havuzu -- kod degil VERI. Yeni hakem eklemek icin bu dosya. */
  readonly refereePoolPath?: string;
  readonly agentPoolPath?: string;
}

export const DEFAULT_REFEREE_POOL = 'tools/roster/referee-pool.json';
export const DEFAULT_AGENT_POOL = 'tools/roster/agent-pool.json';

export interface ImportReport {
  readonly emit: EmitResult;
  readonly players: PlayerStageResult | undefined;
  readonly referees: RefereeStageResult;
  readonly agents: AgentStageResult;
  readonly log: IssueLog;
}

export async function runImport(options: ImportOptions): Promise<ImportReport> {
  const scope = options.scope ?? DEFAULT_SCOPE;
  const log = new IssueLog();

  const teamDetailsFile = requireFile(options.dataDir, SOURCE_FILES.teamDetails);
  const seasonsFile = requireFile(options.dataDir, SOURCE_FILES.seasons);

  // Oyuncu asamasi OPSIYONEL: dosyalar yoksa turnuva/kulup katmani yine
  // uretilir. Boylece 26 MB'lik profil dosyasi olmadan da takvim uzerinde
  // calisilabilir.
  const profilesFile = resolveSource(options.dataDir, SOURCE_FILES.playerProfiles);
  const valuesFile = resolveSource(options.dataDir, SOURCE_FILES.marketValue);

  const rules = await loadRules(options.rulesPath, log);
  const db = openWorldDb(options.dbPath);

  try {
    const binder = new MaskBinder(db, rules);
    const drafts = await buildCompetitions({ teamDetailsFile, seasonsFile, scope, log });
    const emit = emitWorld(db, drafts, binder, scope, log);

    let players: PlayerStageResult | undefined;
    if (profilesFile !== undefined && valuesFile !== undefined) {
      players = await importPlayers({ profilesFile, valuesFile, db, binder, log });
      // Oyuncular yazildi -> itibar artik ON TAHMINDEN degil KADRO DEGERINDEN
      // hesaplanabilir. clubTier'i belirleyen otorite budur.
      recomputeReputation(db, log);
      // Butceler kadro degerinden turer -- oyuncular yazildiktan SONRA.
      // Transfer piyasasinin uzerine kurulacagi zemin budur.
      computeBudgets(db, log);
      // EZELI RAKIPLIK: kaynakta yok, itibar yakinligindan turetilir.
      // Itibar kadro degerinden hesaplandiktan SONRA -- yoksa rakiplikler
      // on tahmin uzerine kurulur.
      deriveRivalries(db, log);
    } else {
      const missing: string[] = [];
      if (profilesFile === undefined) missing.push(SOURCE_FILES.playerProfiles);
      if (valuesFile === undefined) missing.push(SOURCE_FILES.marketValue);
      log.warn('players', `oyuncu asamasi atlandi -- eksik dosya: ${missing.join(', ')}`);
    }

    // HAKEMLER: kaynakta yok, tohumdan uretilir. Kuluplerden SONRA cunku
    // ulke ve turnuva sayisini okuyor.
    const referees = generateReferees({
      db,
      binder,
      log,
      seed: scope.sourceSeason,
      poolPath: options.refereePoolPath ?? DEFAULT_REFEREE_POOL,
    });

    // MENAJERLER: hakemlerle ayni gerekce -- kaynakta kullanilabilir veri
    // yok. Ulke ve turnuva sayisini okudugu icin kuluplerden sonra.
    const agents = generateAgents({
      db,
      binder,
      log,
      seed: scope.sourceSeason,
      poolPath: options.agentPoolPath ?? DEFAULT_AGENT_POOL,
    });

    recordProvenance(db, {
      repoUrl: REPO_URL,
      sourceSeason: scope.sourceSeason,
      scope,
    });

    db.exec('DELETE FROM import_issue');
    persistIssues(db, log);
    return { emit, players, referees, agents, log };
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
