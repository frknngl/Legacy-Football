/**
 * Varlik katalogunu ayristirir.
 *
 * `parseGames` ile ayni desen: katalog ICERIKTIR, bozuk bir tanim oyunu
 * DUSURMEZ -- atlanir. Calisma zamaninda bir varligin eksik olmasi,
 * oyunun hic acilmamasindan iyidir.
 */

import type { AssetDefinition, AssetKind } from '../domain/assets.js';

const KINDS: readonly AssetKind[] = ['araba', 'ev', 'arsa', 'isletme'];

export function parseAssets(doc: unknown): readonly AssetDefinition[] {
  if (typeof doc !== 'object' || doc === null) return [];
  const raw = (doc as { assets?: unknown }).assets;
  if (!Array.isArray(raw)) return [];

  const out: AssetDefinition[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const a = item as Record<string, unknown>;
    const id = str(a['id']);
    const label = str(a['label']);
    const kind = KINDS.find((k) => k === a['kind']);
    const price = num(a['price']);
    if (id === undefined || label === undefined || kind === undefined) continue;
    if (price === undefined || price <= 0) continue;

    out.push({
      id,
      label,
      kind,
      price,
      upkeep: num(a['upkeep']) ?? 0,
      yearlyDrift: num(a['yearlyDrift']) ?? 0,
      visibility: Math.max(0, Math.min(100, num(a['visibility']) ?? 0)),
      ...(str(a['note']) === undefined ? {} : { note: str(a['note'])! }),
    });
  }
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
