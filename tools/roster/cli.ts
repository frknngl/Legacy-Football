/**
 * ROSTER TOOL CLI -- `npm run roster`
 *
 *   npm run roster -- import --data=<datalake/transfermarkt> [--db=...] [--rules=...]
 *   npm run roster -- report [--db=...]
 *   npm run roster -- list   [--db=...]
 *
 * GUI bu hattin uzerine oturacak; komut satiri once geliyor cunku veri
 * dogrulugu arayuzden once cozulmeli. Gorunmeyen bir hatayi arayuzle
 * kesfetmek pahali.
 */

import { openWorldDb } from './db.js';
import { DEFAULT_SCOPE, type ImportScope } from './scope.js';
import { runImport, REPO_URL, DEFAULT_REFEREE_POOL } from './import.js';

const DEFAULT_DB = 'data/world.db';
const DEFAULT_RULES = 'tools/roster/mask-rules.json';

function arg(name: string, fallback: string): string {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? (found.split('=').slice(1).join('=') || fallback) : fallback;
}

function has(name: string): boolean {
  return process.argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
}

function usage(): void {
  console.log(`
Roster & Lisans Araci

  npm run roster -- import --data=<yol>   CSV klasorunden world.db uretir
  npm run roster -- report                Import kalite raporunu gosterir
  npm run roster -- list                  Ithal edilen ligleri listeler

Secenekler
  --data=<yol>      Klonun 'datalake/transfermarkt' klasoru (import icin zorunlu)
  --db=<yol>        Hedef veritabani (varsayilan: ${DEFAULT_DB})
  --rules=<yol>     Elle maske eslemesi (varsayilan: ${DEFAULT_RULES})
  --referees=<yol>  Hakem havuzu (varsayilan: ${DEFAULT_REFEREE_POOL})
  --season=<yil>    Kaynak sezon (varsayilan: ${DEFAULT_SCOPE.sourceSeason})
  --countries=a,b   Ulke filtresi (varsayilan: ${DEFAULT_SCOPE.countries.length} ulke)
  --levels=1,2      Seviye filtresi

Veri: ${REPO_URL}
  DIKKAT: player_performances.csv ve transfer_history.csv Git LFS arkasinda.
  'git lfs install' yapilmadan bu iki dosya 134 byte'lik isaretci olarak iner.
`);
}

async function cmdImport(): Promise<void> {
  const dataDir = arg('data', '');
  if (dataDir === '') {
    console.error("Hata: --data=<yol> zorunlu. Ornek:\n  npm run roster -- import --data=../football-datasets/datalake/transfermarkt");
    process.exitCode = 1;
    return;
  }

  const scope: ImportScope = {
    ...DEFAULT_SCOPE,
    sourceSeason: Number(arg('season', String(DEFAULT_SCOPE.sourceSeason))),
    ...(has('countries') ? { countries: arg('countries', '').split(',').map((s) => s.trim()) } : {}),
    ...(has('levels')
      ? { levels: arg('levels', '').split(',').map((s) => Number(s.trim())).filter(Number.isFinite) }
      : {}),
  };

  const dbPath = arg('db', DEFAULT_DB);
  console.log(`Kaynak : ${dataDir}`);
  console.log(`Hedef  : ${dbPath}`);
  console.log(`Kapsam : ${scope.countries.length} ulke, seviye ${scope.levels.join('/')}, sezon ${scope.sourceSeason}\n`);

  const { emit, players, referees, log } = await runImport({
    dataDir,
    dbPath,
    scope,
    rulesPath: arg('rules', DEFAULT_RULES),
    refereePoolPath: arg('referees', DEFAULT_REFEREE_POOL),
  });

  console.log('');
  for (const issue of log.all().filter((i) => i.severity !== 'info')) {
    const mark = issue.severity === 'error' ? 'HATA ' : 'UYARI';
    console.log(`  ${mark} [${issue.stage}] ${issue.message}`);
  }

  const freshMasks = emit.freshMasks + (players?.freshMasks ?? 0);
  const reusedMasks = emit.reusedMasks + (players?.reusedMasks ?? 0);

  console.log(`
Yazildi
  ulke        ${emit.countries}
  turnuva     ${emit.competitions}
  kulup       ${emit.clubs}
  oyuncu      ${players === undefined ? '- (atlandi)' : `${players.imported} (${players.fallbackValues} tahmini deger)`}
  hakem       ${referees.generated} (${referees.manual} elle) -- ${Object.entries(referees.byBadge).map(([b, n]) => `${b} ${n}`).join(', ')}
  maske       ${freshMasks} yeni kilit, ${reusedMasks} korunan

${log.summary()}`);

  if (log.count('error') > 0) process.exitCode = 1;
}

function cmdReport(): void {
  const db = openWorldDb(arg('db', DEFAULT_DB));
  try {
    const rows = db
      .prepare(
        `SELECT severity, stage, message FROM import_issue
         ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, id`,
      )
      .all() as { severity: string; stage: string; message: string }[];

    if (rows.length === 0) {
      console.log('Kayitli sorun yok. Once `import` calistirin.');
      return;
    }
    for (const r of rows) {
      console.log(`  ${r.severity.toUpperCase().padEnd(5)} [${r.stage}] ${r.message}`);
    }
    const errors = rows.filter((r) => r.severity === 'error').length;
    const warns = rows.filter((r) => r.severity === 'warn').length;
    console.log(`\n${errors} hata, ${warns} uyari, ${rows.length - errors - warns} bilgi`);
  } finally {
    db.close();
  }
}

function cmdList(): void {
  const db = openWorldDb(arg('db', DEFAULT_DB));
  try {
    const rows = db
      .prepare(
        `SELECT c.name_real, c.name_masked, c.level, c.club_count, c.format_kind,
                c.matches_per_club, c.reputation, co.name_real AS country
         FROM competition c JOIN country co ON co.id = c.country_id
         ORDER BY co.name_real, c.level`,
      )
      .all() as {
      name_real: string;
      name_masked: string;
      level: number;
      club_count: number;
      format_kind: string;
      matches_per_club: number | null;
      reputation: number;
      country: string;
    }[];

    if (rows.length === 0) {
      console.log('Veritabani bos. Once `import` calistirin.');
      return;
    }

    console.log(
      `${'ulke'.padEnd(13)} ${'gercek ad'.padEnd(26)} ${'maske'.padEnd(20)} ${'lvl'.padStart(3)} ${'kulup'.padStart(5)} ${'mac'.padStart(4)}  format`,
    );
    console.log('-'.repeat(96));
    for (const r of rows) {
      console.log(
        `${r.country.padEnd(13)} ${r.name_real.slice(0, 26).padEnd(26)} ${r.name_masked.slice(0, 20).padEnd(20)} ` +
          `${String(r.level).padStart(3)} ${String(r.club_count).padStart(5)} ` +
          `${String(r.matches_per_club ?? '-').padStart(4)}  ${r.format_kind}`,
      );
    }

    const clubs = db.prepare('SELECT COUNT(*) AS n FROM club').get() as { n: number };
    const masks = db.prepare('SELECT COUNT(*) AS n FROM mask_binding').get() as { n: number };
    console.log(`\n${rows.length} lig, ${clubs.n} kulup, ${masks.n} kilitli maske`);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case 'import':
      await cmdImport();
      break;
    case 'report':
      cmdReport();
      break;
    case 'list':
      cmdList();
      break;
    default:
      usage();
  }
}

await main();
