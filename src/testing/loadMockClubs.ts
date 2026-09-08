/**
 * `content/mock/clubs.json` okuyucusu.
 *
 * `ContentLoader` bu yolu GORMEZ (yalnizca `orchestrator/` ve `events/` isler),
 * bu yuzden mock dunya kendi okuyucusuyla gelir. DB entegrasyonunda bu dosya
 * ve okudugu JSON birlikte silinir.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CLUB_TIERS, type ClubTier } from '../domain/axes.js';
import { ContentError } from '../domain/errors.js';
import type { ClubInfo, LeagueInfo } from '../domain/roster.js';

const MOCK_PATH = 'mock/clubs.json';

export async function loadMockClubs(contentDir: string): Promise<readonly ClubInfo[]> {
  const file = join(contentDir, ...MOCK_PATH.split('/'));
  const raw: unknown = JSON.parse(await readFile(file, 'utf-8'));
  const list = (raw as { clubs?: unknown }).clubs;
  if (!Array.isArray(list)) {
    throw new ContentError('mock/clubs.json icinde "clubs" dizisi yok.', MOCK_PATH);
  }

  return list.map((entry, i) => {
    const c = entry as Record<string, unknown>;
    const tier = String(c['tier'] ?? '');
    if (!(CLUB_TIERS as readonly string[]).includes(tier)) {
      throw new ContentError(`clubs[${i}].tier gecersiz: "${tier}"`, MOCK_PATH);
    }
    const club: ClubInfo = {
      id: String(c['id'] ?? `clb_${i}`),
      name: String(c['name'] ?? 'Bilinmeyen'),
      city: String(c['city'] ?? ''),
      stadium: String(c['stadium'] ?? ''),
      tier: tier as ClubTier,
      league: String(c['league'] ?? 'tr_1'),
      reputation: Number(c['reputation'] ?? 50),
      foreignRatio: Number(c['foreignRatio'] ?? 0),
      ...(typeof c['rivalId'] === 'string' ? { rivalId: c['rivalId'] } : {}),
    };
    return club;
  });
}

/**
 * Lig piramidini okur. `clubs.json` icindeki `leagues` blogu eksikse
 * kuluplerin `league` alanindan tek basamakli bir piramit turetilir --
 * eski bir veri dosyasi motoru dusurmez.
 */
export async function loadMockLeagues(contentDir: string): Promise<readonly LeagueInfo[]> {
  const file = join(contentDir, ...MOCK_PATH.split('/'));
  const raw: unknown = JSON.parse(await readFile(file, 'utf-8'));
  const list = (raw as { leagues?: unknown }).leagues;

  if (!Array.isArray(list)) {
    const clubs = (raw as { clubs?: { league?: unknown }[] }).clubs ?? [];
    const ids = [...new Set(clubs.map((c) => String(c.league ?? 'tr_1')))];
    return ids.map((id, i) => ({ id, label: id, level: i + 1, promoted: 0, relegated: 0 }));
  }

  return list.map((entry, i) => {
    const l = entry as Record<string, unknown>;
    const id = String(l['id'] ?? `lg_${i}`);
    return {
      id,
      label: String(l['label'] ?? id),
      level: Number(l['level'] ?? i + 1),
      promoted: Number(l['promoted'] ?? 0),
      relegated: Number(l['relegated'] ?? 0),
    };
  });
}
