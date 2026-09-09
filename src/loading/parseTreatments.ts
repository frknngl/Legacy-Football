/**
 * Tedavi katalogunu ayristirir.
 *
 * Digerleriyle ayni desen: denge ICERIKTIR ve bozuk bir tanim oyunu
 * DUSURMEZ. Dosya yoksa agir sakatlik karari sorulmaz, sakatlik eskisi
 * gibi yalnizca surer -- yani oyun calismaya devam eder.
 */

import type { Treatment, TreatmentConfig } from '../domain/injury.js';

export function parseTreatments(doc: unknown): TreatmentConfig {
  const empty: TreatmentConfig = { seriousWeeks: 6, fragilityDecay: 0.25, treatments: [] };
  if (typeof doc !== 'object' || doc === null) return empty;
  const d = doc as Record<string, unknown>;

  const treatments: Treatment[] = [];
  for (const item of Array.isArray(d['treatments']) ? d['treatments'] : []) {
    if (typeof item !== 'object' || item === null) continue;
    const t = item as Record<string, unknown>;
    const id = str(t['id']);
    const label = str(t['label']);
    const weekMultiplier = num(t['weekMultiplier']);
    if (id === undefined || label === undefined || weekMultiplier === undefined) continue;

    treatments.push({
      id,
      label,
      weekMultiplier: Math.max(0, weekMultiplier),
      fragility: num(t['fragility']) ?? 0,
      ...(num(t['fragilityHeal']) === undefined ? {} : { fragilityHeal: num(t['fragilityHeal'])! }),
      ...(num(t['cost']) === undefined ? {} : { cost: num(t['cost'])! }),
      ...(num(t['collapseChance']) === undefined
        ? {}
        : { collapseChance: num(t['collapseChance'])! }),
      ...(num(t['weeklyToll']) === undefined ? {} : { weeklyToll: num(t['weeklyToll'])! }),
      ...(str(t['trace']) === undefined ? {} : { trace: str(t['trace'])! }),
      ...(str(t['note']) === undefined ? {} : { note: str(t['note'])! }),
    });
  }

  return {
    seriousWeeks: num(d['seriousWeeks']) ?? empty.seriousWeeks,
    fragilityDecay: num(d['fragilityDecay']) ?? empty.fragilityDecay,
    treatments,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
