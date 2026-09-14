/**
 * world.db acma / kurma ve import gunlugu.
 *
 * KATMAN: `tools/` yalnizca `tools/` icinden import edilir. Motor (`src/`) bu
 * dosyayi GORMEZ -- oyun tarafi ileride `src/adapters/DbRosterProvider.ts` ile
 * ayni veritabanini SALT OKUR. Boylece importer'i degistirmek motoru
 * derlemekten bagimsiz kalir.
 */

import { DatabaseSync } from './sqlite.js';
import type { DatabaseSyncType } from './sqlite.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { WORLD_SCHEMA, WORLD_SCHEMA_VERSION } from './schema.js';

export type Severity = 'error' | 'warn' | 'info';

export interface Issue {
  readonly severity: Severity;
  readonly stage: string;
  readonly entityKind?: string;
  readonly externalKey?: string;
  readonly message: string;
}

/**
 * Import sirasinda biriken sorunlar.
 *
 * Import "temiz veri" varsaymaz: Ligue 1 bu anlikta 17 kulup gosteriyor
 * (gercegi 18), 506 kulubun ligi bos, oyuncularin %51,6'sinin piyasa degeri
 * sifir. Bunlari sessizce duzeltmek yanlis veriyi GORUNMEZ yapar; toplayip
 * raporlamak elle duzeltmenin onunu acar.
 */
export class IssueLog {
  private readonly items: Issue[] = [];

  add(issue: Issue): void {
    this.items.push(issue);
  }

  error(stage: string, message: string, entityKind?: string, externalKey?: string): void {
    this.add({ severity: 'error', stage, message, ...spread(entityKind, externalKey) });
  }

  warn(stage: string, message: string, entityKind?: string, externalKey?: string): void {
    this.add({ severity: 'warn', stage, message, ...spread(entityKind, externalKey) });
  }

  info(stage: string, message: string, entityKind?: string, externalKey?: string): void {
    this.add({ severity: 'info', stage, message, ...spread(entityKind, externalKey) });
  }

  all(): readonly Issue[] {
    return this.items;
  }

  count(severity: Severity): number {
    return this.items.filter((i) => i.severity === severity).length;
  }

  /** Ozet satiri -- CLI ciktisinin son satiri. */
  summary(): string {
    return `${this.count('error')} hata, ${this.count('warn')} uyari, ${this.count('info')} bilgi`;
  }
}

// `exactOptionalPropertyTypes` acik: undefined'i alan olarak YAZMAK yasak,
// alani hic koymamak gerekiyor.
function spread(
  entityKind?: string,
  externalKey?: string,
): { entityKind?: string; externalKey?: string } {
  return {
    ...(entityKind === undefined ? {} : { entityKind }),
    ...(externalKey === undefined ? {} : { externalKey }),
  };
}

/**
 * Veritabanini acar; yoksa olusturur ve semayi kurar.
 *
 * SEMA SURUMU KAPISI:
 *   `CREATE TABLE IF NOT EXISTS` var olan bir tabloyu GORMEZDEN GELIR --
 *   yeni kolonlari eklemez. Yani eski surumlu bir world.db sessizce acilir
 *   ve ilk INSERT'te "no such column" diye patlar; ya da daha kotusu,
 *   okuma tarafinda eksik kolon NULL gibi davranir.
 *
 *   Bu yuzden surum ACIKCA karsilastirilir ve eskiyse anlasilir bir hata
 *   verilir. Otomatik migration YAZILMADI: world.db bir TUREV urun --
 *   kaynak CSV'lerden yeniden uretilir ve uretmek dakikalar surer. Bir
 *   migration hatti bakim yuku olurdu ve karsiligi yok.
 */
export function openWorldDb(path: string): DatabaseSyncType {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  assertSchemaVersion(db, path);
  db.exec(WORLD_SCHEMA);
  return db;
}

/** Var olan bir veritabaninin semasi bu surumle uyumlu mu. */
function assertSchemaVersion(db: DatabaseSyncType, path: string): void {
  // Tablo henuz yoksa bu taze bir veritabani -- kontrol edilecek bir sey yok.
  const exists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='source_dataset'`)
    .get();
  if (exists === undefined) return;

  const row = db
    .prepare('SELECT MAX(schema_version) AS v FROM source_dataset')
    .get() as { v: number | null } | undefined;
  const found = row?.v ?? null;
  if (found === null || found === WORLD_SCHEMA_VERSION) return;

  db.close();
  throw new Error(
    `${path} sema surumu ${found}, beklenen ${WORLD_SCHEMA_VERSION}.\n` +
      `  world.db bir TUREV urundur -- migration yerine yeniden uretilir.\n` +
      `  Silin ve yeniden ithal edin:  npm run roster -- import --data=<klasor>`,
  );
}

/** Import gunlugunu veritabanina yazar. GUI bu tabloyu listeler. */
export function persistIssues(db: DatabaseSyncType, log: IssueLog): void {
  const stmt = db.prepare(
    `INSERT INTO import_issue(severity, stage, entity_kind, external_key, message)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const i of log.all()) {
    stmt.run(i.severity, i.stage, i.entityKind ?? null, i.externalKey ?? null, i.message);
  }
}

export interface ProvenanceInput {
  readonly repoUrl: string;
  readonly sourceSeason: number;
  readonly scope: unknown;
  /** Hangi dataset besledi: 'fc26' | 'transfermarkt'. */
  readonly sourceKind?: string;
}

/** Kokeni yazar: hangi anliktan, hangi filtreyle. */
export function recordProvenance(db: DatabaseSyncType, input: ProvenanceInput): void {
  db.prepare(
    `INSERT INTO source_dataset(
       repo_url, source_season, scope_json, schema_version, imported_at, source_kind)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    input.repoUrl,
    input.sourceSeason,
    JSON.stringify(input.scope),
    WORLD_SCHEMA_VERSION,
    new Date().toISOString(),
    input.sourceKind ?? 'transfermarkt',
  );
}
