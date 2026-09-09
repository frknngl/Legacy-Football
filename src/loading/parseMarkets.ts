/**
 * Piyasa katalogunu ayristirir.
 *
 * `parseGames`/`parseAssets` ile ayni desen: katalog ICERIKTIR ve bozuk
 * bir tanim oyunu DUSURMEZ -- atlanir. Calisma zamaninda bir
 * enstrumanin eksik olmasi, oyunun hic acilmamasindan iyidir.
 */

import type { Instrument, InstrumentKind } from '../domain/market.js';

const KINDS: readonly InstrumentKind[] = ['hisse', 'endeks', 'kripto'];

export function parseMarkets(doc: unknown): readonly Instrument[] {
  if (typeof doc !== 'object' || doc === null) return [];
  const raw = (doc as { instruments?: unknown }).instruments;
  if (!Array.isArray(raw)) return [];

  const out: Instrument[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const i = item as Record<string, unknown>;
    const id = str(i['id']);
    const label = str(i['label']);
    const kind = KINDS.find((k) => k === i['kind']);
    const basePrice = num(i['basePrice']);
    const volatility = num(i['volatility']);
    if (id === undefined || label === undefined || kind === undefined) continue;
    if (basePrice === undefined || basePrice <= 0) continue;
    if (volatility === undefined || volatility <= 0) continue;

    out.push({
      id,
      label,
      kind,
      basePrice,
      drift: num(i['drift']) ?? 0,
      volatility,
      minWealth: num(i['minWealth']) ?? 0,
      ...(num(i['dividend']) === undefined ? {} : { dividend: num(i['dividend'])! }),
      ...(str(i['note']) === undefined ? {} : { note: str(i['note'])! }),
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
