/**
 * Enflasyon yapilandirmasini ayristirir.
 *
 * Veri ICERIKTE (`content/economy/inflation.json`) cunku bunlar GERCEK
 * olculerdir ve guncellenmeleri kod degisikligi gerektirmemeli.
 * Dosya yoksa varsayilan kullanilir: oyun enflasyonsuz da calisir.
 */

import type { CountryInflation, InflationConfig } from '../domain/inflation.js';

const FALLBACK: CountryInflation = { name: 'default', mean: 2.5, volatility: 2 };

export function parseInflation(doc: unknown): InflationConfig {
  if (typeof doc !== 'object' || doc === null) {
    return { countries: [], fallback: FALLBACK };
  }
  const raw = doc as Record<string, unknown>;

  const countries: CountryInflation[] = [];
  for (const item of Array.isArray(raw['countries']) ? raw['countries'] : []) {
    if (typeof item !== 'object' || item === null) continue;
    const c = item as Record<string, unknown>;
    const name = typeof c['name'] === 'string' ? c['name'] : undefined;
    const mean = typeof c['mean'] === 'number' ? c['mean'] : undefined;
    if (name === undefined || mean === undefined) continue;
    countries.push({
      name,
      mean,
      volatility: typeof c['volatility'] === 'number' ? c['volatility'] : 2,
      ...(typeof c['note'] === 'string' ? { note: c['note'] } : {}),
    });
  }

  const d = raw['default'];
  const fallback: CountryInflation = isObj(d)
    ? {
        name: 'default',
        mean: typeof d['mean'] === 'number' ? d['mean'] : FALLBACK.mean,
        volatility: typeof d['volatility'] === 'number' ? d['volatility'] : FALLBACK.volatility,
      }
    : FALLBACK;

  return { countries, fallback };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
