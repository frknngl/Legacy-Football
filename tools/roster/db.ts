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

/** Veritabanini acar; yoksa olusturur ve semayi kurar. */
export function openWorldDb(path: string): DatabaseSyncType {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(WORLD_SCHEMA);
  return db;
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
}

/** Kokeni yazar: hangi anliktan, hangi filtreyle. */
export function recordProvenance(db: DatabaseSyncType, input: ProvenanceInput): void {
  db.prepare(
    `INSERT INTO source_dataset(repo_url, source_season, scope_json, schema_version, imported_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    input.repoUrl,
    input.sourceSeason,
    JSON.stringify(input.scope),
    WORLD_SCHEMA_VERSION,
    new Date().toISOString(),
  );
}
