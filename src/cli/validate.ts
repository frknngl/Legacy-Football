/**
 * `npm run validate`
 *
 * Tum kurallari calistirir. Hata varsa exit code 1 -- CI kapisi budur.
 * `--warnings` uyarilari da gosterir, `--strict` uyarilari da hata sayar.
 */

import { readFile } from 'node:fs/promises';
import { ContentLoader } from '../loading/ContentLoader.js';
import { FileSystemContentSource } from '../loading/FileSystemContentSource.js';
import { formatReport, Validator, type ValidationConfig } from '../validation/Validator.js';

const showWarnings = process.argv.includes('--warnings') || process.argv.includes('--strict');
const strict = process.argv.includes('--strict');

async function loadConfig(): Promise<ValidationConfig> {
  try {
    return JSON.parse(await readFile('validation.config.json', 'utf-8')) as ValidationConfig;
  } catch {
    return {};
  }
}

const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();

if (!loaded.registry) {
  console.error('Icerik yuklenemedi -- zorunlu orkestratör dosyalari eksik olabilir.\n');
  for (const i of loaded.issues) {
    console.error(`  ${i.file}${i.path ? ` @ ${i.path}` : ''}: ${i.message}`);
  }
  process.exit(1);
}

const report = new Validator(undefined, await loadConfig()).run(loaded.registry, loaded.issues);
console.log(formatReport(report, { showWarnings }));

const failed = report.errors > 0 || (strict && report.warnings > 0);
if (!failed) {
  console.log('\nGecti.');
} else if (!showWarnings && report.warnings > 0) {
  console.log(`(${report.warnings} uyari gizlendi -- gormek icin: npm run validate -- --warnings)`);
}
process.exit(failed ? 1 : 0);
