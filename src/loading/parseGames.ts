/**
 * Kumar katalogunu ayristirir.
 *
 * Katalog ICERIKTIR: kasanin avantajini ayarlamak kod degisikligi
 * gerektirmemeli. Bozuk bir tanim oyunu DUSURMEZ -- atlanir ve
 * `GameCatalogRule` build zamaninda bildirir. Calisma zamaninda bir
 * masanin eksik olmasi, oyunun acilmamasindan iyidir.
 */

import type { BetOption, GameDefinition } from '../domain/gambling.js';

export function parseGames(doc: unknown): readonly GameDefinition[] {
  if (typeof doc !== 'object' || doc === null) return [];
  const raw = (doc as { games?: unknown }).games;
  if (!Array.isArray(raw)) return [];

  const out: GameDefinition[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const g = item as Record<string, unknown>;
    const id = typeof g['id'] === 'string' ? g['id'] : undefined;
    const label = typeof g['label'] === 'string' ? g['label'] : undefined;
    if (id === undefined || label === undefined) continue;

    const options: BetOption[] = [];
    for (const o of Array.isArray(g['options']) ? g['options'] : []) {
      if (typeof o !== 'object' || o === null) continue;
      const opt = o as Record<string, unknown>;
      const optId = typeof opt['id'] === 'string' ? opt['id'] : undefined;
      const optLabel = typeof opt['label'] === 'string' ? opt['label'] : undefined;
      const chance = typeof opt['chance'] === 'number' ? opt['chance'] : undefined;
      const payout = typeof opt['payout'] === 'number' ? opt['payout'] : undefined;
      if (optId === undefined || optLabel === undefined) continue;
      if (chance === undefined || payout === undefined) continue;
      options.push({ id: optId, label: optLabel, chance, payout });
    }
    if (options.length === 0) continue;

    out.push({
      id,
      label,
      minWealth: num(g['minWealth'], 0),
      minStake: num(g['minStake'], 100),
      maxStake: num(g['maxStake'], 1_000_000),
      options,
      ...(typeof g['note'] === 'string' ? { note: g['note'] } : {}),
    });
  }
  return out;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
