/**
 * Validator ve rapor.
 *
 * SEVERITY TERFISI: `validation.config.json` bir kuralin varsayilan
 * severity'sini ezebilir. Icerik dalgalari ilerledikce kapsama kurallari
 * `warn` -> `error` cekilir. Dalga daha yazilmadan hepsini `error` yapmak
 * build'i hic yesile dondurmez ve validator'a guveni bitirir.
 */

import type { ContentRegistry } from '../loading/ContentRegistry.js';
import type { LoadIssue } from '../loading/ContentLoader.js';
import { ALL_RULES } from './rules/index.js';
import type { Finding, Severity, ValidationRule } from './Rule.js';

export interface ValidationConfig {
  /** Kural adi -> severity ezmesi. `off` kurali tamamen kapatir. */
  readonly severities?: Readonly<Record<string, Severity | 'off'>>;
}

export interface ValidationReport {
  readonly findings: readonly Finding[];
  readonly errors: number;
  readonly warnings: number;
  readonly rulesRun: number;
  readonly eventCount: number;
  /** Kullanilmayan (artik gereksiz) muafiyetler. */
  readonly staleWaivers: readonly { file: string; rule: string }[];
}

export class Validator {
  constructor(
    private readonly rules: readonly ValidationRule[] = ALL_RULES,
    private readonly config: ValidationConfig = {},
    /**
     * Kismi bir icerik seti dogrulaniyorsa `false` verin: korpus geneli
     * kurallar atlanir. Tek dosyalik bir sette "21 moment tipi kapsanmamis"
     * demek yanlis degil, ANLAMSIZDIR.
     */
    private readonly corpusComplete = true,
  ) {}

  run(registry: ContentRegistry, loadIssues: readonly LoadIssue[] = []): ValidationReport {
    const findings: Finding[] = [];

    // Ayristirma sorunlari her zaman hatadir: sema tutmuyorsa gerisi anlamsiz.
    for (const issue of loadIssues) {
      findings.push({
        rule: 'SchemaRule',
        severity: 'error',
        file: issue.file,
        message: issue.message,
        ...(issue.path ? { path: issue.path } : {}),
        ...(issue.hint !== undefined ? { fix: issue.hint } : {}),
      });
    }

    const ctx = { registry, events: registry.events };
    let rulesRun = 0;

    // Hangi muafiyet gercekten bir bulguyu bastirdi?
    const usedWaivers = new Set<string>();

    for (const rule of this.rules) {
      const override = this.config.severities?.[rule.name];
      if (override === 'off') continue;
      if (!this.corpusComplete && rule.scope === 'corpus') continue;
      rulesRun += 1;

      for (const f of rule.check(ctx)) {
        findings.push(override ? { ...f, severity: override } : f);
      }

      // Bu kuralin bastirdigi olaylari isaretle.
      for (const event of registry.events) {
        if (event.lint?.ignore.includes(rule.name)) {
          usedWaivers.add(`${event.id}::${rule.name}`);
        }
      }
    }

    const knownRules = new Set(this.rules.map((r) => r.name));
    const staleWaivers: { file: string; rule: string }[] = [];
    for (const event of registry.events) {
      for (const ruleName of event.lint?.ignore ?? []) {
        if (!knownRules.has(ruleName)) {
          staleWaivers.push({ file: event.sourceFile ?? event.id, rule: ruleName });
        }
      }
    }

    return {
      findings,
      errors: findings.filter((f) => f.severity === 'error').length,
      warnings: findings.filter((f) => f.severity === 'warn').length,
      rulesRun,
      eventCount: registry.events.length,
      staleWaivers,
    };
  }
}

/** Raporu insan okunur metne cevirir. */
export function formatReport(report: ValidationReport, opts: { showWarnings: boolean }): string {
  const lines: string[] = [];
  const byFile = new Map<string, Finding[]>();

  for (const f of report.findings) {
    if (!opts.showWarnings && f.severity === 'warn') continue;
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }

  for (const [file, findings] of [...byFile.entries()].sort()) {
    lines.push('');
    lines.push(file);
    for (const f of findings) {
      const tag = f.severity === 'error' ? 'HATA ' : 'UYARI';
      lines.push(`  ${tag} ${f.rule}${f.path ? ` @ ${f.path}` : ''}`);
      lines.push(`        ${f.message}`);
      if (f.fix) lines.push(`        -> ${f.fix}`);
    }
  }

  for (const w of report.staleWaivers) {
    lines.push('');
    lines.push(`${w.file}`);
    lines.push(`  UYARI UnusedWaiverRule`);
    lines.push(`        Bilinmeyen kural icin muafiyet: "${w.rule}"`);
    lines.push(`        -> Kural adi degismis ya da silinmis; muafiyeti kaldirin.`);
  }

  lines.push('');
  lines.push(
    `${report.eventCount} olay | ${report.rulesRun} kural | ${report.errors} hata | ${report.warnings} uyari`,
  );
  return lines.join('\n');
}
