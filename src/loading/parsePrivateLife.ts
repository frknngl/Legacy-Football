/**
 * Ozel hayat dengesini ayristirir.
 *
 * `parseGames`/`parseAssets`/`parseMarkets` ile ayni desen: denge
 * ICERIKTIR ve bozuk bir tanim oyunu DUSURMEZ -- atlanir. Dosya hic
 * yoksa ozel hayat kolu kapali kalir, oyun yine calisir.
 */

import type { ContactKind, PrivateLifeConfig, Stage, StageRule } from '../domain/privateLife.js';

const STAGES: readonly Stage[] = ['yok', 'tanisma', 'iliski', 'birlikte', 'evli', 'ayrilik'];

export function parsePrivateLife(doc: unknown): PrivateLifeConfig {
  if (typeof doc !== 'object' || doc === null) return { contacts: [], stages: [] };
  const d = doc as Record<string, unknown>;

  const contacts: ContactKind[] = [];
  for (const item of Array.isArray(d['contacts']) ? d['contacts'] : []) {
    if (typeof item !== 'object' || item === null) continue;
    const c = item as Record<string, unknown>;
    const id = str(c['id']);
    const label = str(c['label']);
    const closeness = num(c['closeness']);
    if (id === undefined || label === undefined) continue;
    if (closeness === undefined || closeness <= 0) continue;

    contacts.push({
      id,
      label,
      closeness,
      kondisyon: num(c['kondisyon']) ?? 0,
      tukenmislik: num(c['tukenmislik']) ?? 0,
      ...(Array.isArray(c['lifeStates'])
        ? { lifeStates: c['lifeStates'].filter((s): s is string => typeof s === 'string') }
        : {}),
      ...(STAGES.find((s) => s === c['minStage']) === undefined
        ? {}
        : { minStage: c['minStage'] as Stage }),
      ...(num(c['perWeek']) === undefined ? {} : { perWeek: num(c['perWeek'])! }),
      ...(num(c['maxCloseness']) === undefined ? {} : { maxCloseness: num(c['maxCloseness'])! }),
      ...(c['offSeasonOnly'] === true ? { offSeasonOnly: true } : {}),
      ...(str(c['note']) === undefined ? {} : { note: str(c['note'])! }),
    });
  }

  const stages: StageRule[] = [];
  for (const item of Array.isArray(d['stages']) ? d['stages'] : []) {
    if (typeof item !== 'object' || item === null) continue;
    const s = item as Record<string, unknown>;
    const from = STAGES.find((x) => x === s['from']);
    const to = STAGES.find((x) => x === s['to']);
    const label = str(s['label']);
    if (from === undefined || to === undefined || label === undefined) continue;
    stages.push({
      from,
      to,
      label,
      minCloseness: num(s['minCloseness']) ?? 0,
      minWeeks: num(s['minWeeks']) ?? 0,
    });
  }

  return { contacts, stages };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
