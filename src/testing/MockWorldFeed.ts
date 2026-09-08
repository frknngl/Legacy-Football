/**
 * Mock haber akisi -- `{world.*}` yer tutucularini besler.
 *
 * Icerik "sampiyonluk yarisinin lideri" diye yazar, hangi kulup oldugunu
 * bilmez. Dunya degisince metin kendiliginde dogru okunur.
 */

import type { ClubInfo, Headline, WorldFeed, WorldProvider } from '../domain/roster.js';
import { hashString } from '../evaluation/NameForge.js';
import { Rng } from '../selection/Rng.js';

const TEMPLATES: readonly { id: string; text: string; tags: readonly string[] }[] = [
  { id: 'title_race', text: '{leader} zirvede, {second} bir puan geride. Lig son haftaya kaliyor.', tags: ['title'] },
  { id: 'relegation', text: '{bottom} kume hattinda; yonetim teknik direktorle gorusuyor.', tags: ['relegation'] },
  { id: 'transfer', text: 'Sezonun rekor transferi: {recordClub} kasasini acti, rakam {recordFee}.', tags: ['transfer'] },
  { id: 'derby', text: '{leader} - {second} derbisi biletleri iki saatte tukendi.', tags: ['derby'] },
  { id: 'crisis', text: '{bottom} taraftari tesise yurudu. Kulup aciklama yapmadi.', tags: ['crisis'] },
  { id: 'europe', text: 'Avrupa kurasi cekildi; {leader} gruplarda favori gosteriliyor.', tags: ['europe'] },
];

export class MockWorldFeed implements WorldFeed {
  private readonly league: string;

  constructor(
    private readonly world: WorldProvider,
    private readonly clubs: readonly ClubInfo[],
    private readonly seed: number,
    league?: string,
  ) {
    this.league = league ?? mostPopulatedLeague(clubs);
  }

  tokens(season: number, week: number): Readonly<Record<string, string>> {
    const table = this.world.standings(this.league);
    const rng = new Rng((this.seed ^ hashString(`feed:${season}:${week}`)) >>> 0);
    const name = (clubId: string | undefined): string =>
      this.clubs.find((c) => c.id === clubId)?.name ?? 'bilinmeyen kulup';

    const recordClub = this.clubs[rng.int(this.clubs.length)];
    const fee = (8 + rng.int(45)) * 1_000_000;

    return {
      title_race_leader: name(table[0]?.clubId),
      title_race_second: name(table[1]?.clubId),
      relegation_bottom: name(table[table.length - 1]?.clubId),
      transfer_record_club: recordClub?.name ?? 'bilinmeyen kulup',
      transfer_record: fee.toLocaleString('tr-TR'),
    };
  }

  headlines(season: number, week: number): readonly Headline[] {
    const t = this.tokens(season, week);
    return TEMPLATES.map((tpl) => ({
      id: tpl.id,
      tags: tpl.tags,
      text: tpl.text
        .replace('{leader}', t['title_race_leader'] ?? '')
        .replace('{second}', t['title_race_second'] ?? '')
        .replace('{bottom}', t['relegation_bottom'] ?? '')
        .replace('{recordClub}', t['transfer_record_club'] ?? '')
        .replace('{recordFee}', t['transfer_record'] ?? ''),
    }));
  }
}

function mostPopulatedLeague(clubs: readonly ClubInfo[]): string {
  const counts = new Map<string, number>();
  for (const c of clubs) counts.set(c.league, (counts.get(c.league) ?? 0) + 1);
  let best = 'tr_1';
  let bestCount = -1;
  for (const [league, n] of counts) {
    if (n > bestCount) {
      best = league;
      bestCount = n;
    }
  }
  return best;
}
