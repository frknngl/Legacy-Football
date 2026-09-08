/**
 * TURNUVA + KULUP CIKARIMI -- takvimin veri temeli.
 *
 * Bu asamanin tek isi su soruya kaynaktan cevap vermek:
 *   "Bu ligde kac kulup var ve her kulup kac mac oynuyor?"
 *
 * Ikinci soruyu FORMULLE cevaplamak yanlis. Gercek veri (sezon 2024):
 *
 *   Championship   24 kulup -> 46 mac      2x(N-1) tutuyor
 *   Premier League 20 kulup -> 38 mac      tutuyor
 *   J1 League      20 kulup -> 34 mac      TUTMUYOR
 *   MLS            30 kulup -> 33 mac      konferans
 *   Torneo Apertura 30 kulup -> 16 mac     grup asamasi
 *   USL Champ.     26 kulup -> 27/28/29    ayni ligde kulupten kulube DEGISIYOR
 *
 * Bu yuzden `season_total_matches` OKUNUR, hesaplanmaz; ve kulupler farkli
 * sayilar gosteriyorsa format `explicit` olur ve sayi kulup satirinda tutulur.
 *
 * ITIBAR: kulup gucu de veriden gelir -- son sezonlarin mac basi puani, lig
 * seviyesiyle agirliklanip tum ithal evrende yuzdeliklenir. Elle yazilmis bir
 * itibar tablosu 308 kulupte surdurulemez ve her yeni ulke eklendiginde
 * yeniden kalibre edilmesi gerekirdi.
 */

import { readCsv, readCsvAll, num, opt } from '../csv.js';
import type { IssueLog } from '../db.js';
import {
  cleanClubName,
  isYouthOrReserve,
  COUNTRY_COEFFICIENT,
  DEFAULT_COEFFICIENT,
  type ImportScope,
} from '../scope.js';

export type ClubTier = 'amateur' | 'lower' | 'mid' | 'contender' | 'elite';

export type CompetitionFormat =
  | { readonly kind: 'round_robin'; readonly legs: 1 | 2; readonly matchesPerClub: number }
  | { readonly kind: 'conference'; readonly matchesPerClub: number }
  | { readonly kind: 'group_phase'; readonly matchesPerClub: number }
  | { readonly kind: 'explicit' };

export interface ClubDraft {
  readonly externalKey: string;
  readonly nameReal: string;
  readonly countryName: string;
  readonly competitionKey: string;
  /** Yalnizca `explicit` formatta dolu. */
  readonly matchesPerClub?: number;
  /** Seviye agirlikli mac basi puan -- itibarin ham girdisi. */
  readonly strength: number;
  reputation: number;
  tier: ClubTier;
}

export interface CompetitionDraft {
  readonly externalKey: string;
  readonly nameReal: string;
  readonly countryName: string;
  readonly level: number;
  readonly format: CompetitionFormat;
  readonly clubCount: number;
  /** Mac sayisinin ima ettigi kulup sayisi -- doluysa kaynakta kulup eksik. */
  readonly impliedClubCount?: number;
  readonly clubs: readonly ClubDraft[];
  reputation: number;
  promoted: number;
  relegated: number;
}

// --------------------------------------------------------------- kaynak kolonlari

const TD_COLUMNS = ['club_id', 'club_name', 'country_name'] as const;

const TCS_COLUMNS = [
  'club_id',
  'competition_id',
  'competition_name',
  'season_id',
  'season_league_level_level_number',
  'season_total_matches',
  'season_points',
  'team_name',
] as const;

interface TeamDetail {
  readonly clubId: string;
  readonly nameReal: string;
  readonly country: string;
}

/**
 * NOT: kaynakta SEHIR alani yok (`team_details` yalnizca ulke tasiyor).
 * Sehir derbisi bu yuzden kulup adindan cikarilamiyor; rakiplik lig ici
 * itibar yakinligindan turetiliyor. Sehir verisi gelirse `deriveRivalries`
 * onu otomatik kullanir -- kod degismez.
 */

/** `team_details.csv` -> kulup kimlik sozlugu. 2.175 satir, tamami bellege alinir. */
export async function loadTeamDetails(file: string): Promise<Map<string, TeamDetail>> {
  const rows = await readCsvAll(file, { requireColumns: [...TD_COLUMNS] });
  const out = new Map<string, TeamDetail>();
  for (const r of rows) {
    const clubId = opt(r['club_id']);
    const country = opt(r['country_name']);
    if (clubId === undefined || country === undefined) continue;
    out.set(clubId, {
      clubId,
      nameReal: cleanClubName(r['club_name'] ?? ''),
      country,
    });
  }
  return out;
}

interface SeasonRow {
  readonly clubId: string;
  readonly competitionKey: string;
  readonly competitionName: string;
  readonly season: number;
  readonly level: number | undefined;
  readonly matches: number | undefined;
  readonly points: number | undefined;
}

/**
 * `team_competitions_seasons.csv` -> hem guncel kadro dizilimi hem gecmis.
 *
 * Akisli okunur: dosya bugun 11 MB ama kaynak buyudukce buyur; tek seferde
 * okumak bir sinir belirlemek olurdu.
 */
async function loadSeasons(file: string, log: IssueLog): Promise<SeasonRow[]> {
  const rows: SeasonRow[] = [];
  let malformed = 0;

  for await (const r of readCsv(
    file,
    { requireColumns: [...TCS_COLUMNS] },
    () => {
      malformed += 1;
    },
  )) {
    const clubId = opt(r['club_id']);
    const competitionKey = opt(r['competition_id']);
    const season = num(r['season_id']);
    if (clubId === undefined || competitionKey === undefined || season === undefined) continue;

    rows.push({
      clubId,
      competitionKey,
      competitionName: opt(r['competition_name']) ?? competitionKey,
      season,
      level: num(r['season_league_level_level_number']),
      matches: num(r['season_total_matches']),
      points: num(r['season_points']),
    });
  }

  if (malformed > 0) {
    log.warn('competitions', `${malformed} bozuk satir atlandi (kolon sayisi basliga uymuyor)`);
  }
  return rows;
}

// --------------------------------------------------------------- format cikarimi

export interface FormatDetection {
  readonly format: CompetitionFormat;
  /**
   * Mac sayisinin IMA ETTIGI kulup sayisi.
   *
   * Gozlenenden buyukse kaynak anligi eksiktir -- format degil VERI sorunu.
   * Bu ayrim onemli: eksik veriyi 'conference' diye kaydetmek takvimi yanlis
   * bir format uzerine kurar ve hata bir daha gorunmez.
   */
  readonly impliedClubCount?: number;
}

/**
 * Kulup sayisi + mac sayisi dagilimindan formati cikarir.
 *
 * Cift devre VARSAYILMAZ. Ama tersi de yapilmaz: mac sayisi tam olarak
 * 2x(N'-1) kalibina oturuyorsa ve N' gozlenen kulup sayisindan buyukse, bu
 * "farkli bir format" degil "eksik kulup"tur.
 *
 *   Championship  22 kulup / 46 mac -> 46 = 2x(24-1) -> 24 kulup olmali, 2 eksik
 *   Torneo Apert. 30 kulup / 16 mac -> hicbir kalip tutmuyor -> gercekten grup
 */
export function detectFormat(
  clubCount: number,
  matchCounts: readonly number[],
): FormatDetection {
  const distinct = [...new Set(matchCounts.filter((m) => m > 0))];

  if (distinct.length === 0) return { format: { kind: 'explicit' } };

  if (distinct.length > 1) {
    // Ayni ligde kulupler farkli sayida mac oynuyor (USL gibi). Tek bir sayi
    // yazmak yalan olurdu.
    return { format: { kind: 'explicit' } };
  }

  const m = distinct[0]!;

  if (m === 2 * (clubCount - 1)) {
    return { format: { kind: 'round_robin', legs: 2, matchesPerClub: m } };
  }
  if (m === clubCount - 1) {
    return { format: { kind: 'round_robin', legs: 1, matchesPerClub: m } };
  }

  // Cift devre kalibina oturuyor ama daha COK kulup gerektiriyor -> eksik veri.
  //
  // YALNIZCA cift devre icin bu cikarimi yapariz. Tek devre kalibi (m + 1 > N)
  // cazip gorunuyor ama yaniltici: 1-2. seviyede gercek tek devreli lig
  // neredeyse yok, buna karsilik konferans formatlari var. MLS (30 kulup /
  // 33 mac) tek devre kalibina "oturuyor" ve 4 kulup eksik saniliyordu --
  // oysa format konferans. Belirsizlikte gozlenen sayiyi korumak, uydurulmus
  // bir kulup sayisi uzerine takvim kurmaktan guvenli.
  //
  // Ust sinir: ima edilen sayi gozlenenin 1.5 katini asiyorsa bu "eksik veri"
  // degil "baska format"tir.
  if (m % 2 === 0) {
    const implied = m / 2 + 1;
    if (implied > clubCount && implied <= clubCount * 1.5) {
      return {
        format: { kind: 'round_robin', legs: 2, matchesPerClub: m },
        impliedClubCount: implied,
      };
    }
  }

  // Mac sayisi kulup sayisindan az: herkes herkesle oynamiyor demektir.
  if (m < clubCount - 1) return { format: { kind: 'group_phase', matchesPerClub: m } };
  return { format: { kind: 'conference', matchesPerClub: m } };
}

/** Formatin beyan ettigi mac sayisi; `explicit`te kulup satirina bakilir. */
export function declaredMatches(format: CompetitionFormat): number | undefined {
  return format.kind === 'explicit' ? undefined : format.matchesPerClub;
}

// --------------------------------------------------------------- guc / itibar

/** Ust ligde 1.5 puan/mac, alt ligde 1.5 puan/mactan daha degerlidir. */
function levelFactor(level: number): number {
  if (level <= 1) return 1;
  if (level === 2) return 0.72;
  if (level === 3) return 0.52;
  return 0.38;
}

/**
 * Kulup gucu: son sezonlarin seviye agirlikli mac basi puani.
 *
 * Yakin sezonlar daha agir: bes sezon once kume dusen bir kulup bugun ayni
 * kulup degil.
 */
function computeStrength(
  history: readonly SeasonRow[],
  scope: ImportScope,
  country: string,
): number {
  const recent = [...history]
    .filter((h) => h.season <= scope.sourceSeason)
    .sort((a, b) => b.season - a.season)
    .slice(0, scope.historySeasons);

  const coefficient = COUNTRY_COEFFICIENT[country] ?? DEFAULT_COEFFICIENT;

  let weighted = 0;
  let weight = 0;
  recent.forEach((h, i) => {
    if (h.matches === undefined || h.matches <= 0 || h.points === undefined) return;
    const ppm = h.points / h.matches;
    const w = 1 / (i + 1); // 1, 1/2, 1/3 ...
    weighted += ppm * levelFactor(h.level ?? 3) * coefficient * w;
    weight += w;
  });

  return weight > 0 ? weighted / weight : 0;
}

/**
 * Ham gucu 10-99 itibarina cevirir -- YUZDELIK ile.
 *
 * Sabit bir formul (ornegin `40 + 30*ppm`) her yeni ulke eklendiginde yeniden
 * kalibre edilmek zorunda kalirdi. Yuzdelik, ithal evren ne olursa olsun
 * kullanilabilir bir dagilim uretir.
 */
function assignReputations(clubs: readonly ClubDraft[]): void {
  const ranked = [...clubs].sort((a, b) => a.strength - b.strength);
  const n = ranked.length;
  ranked.forEach((club, i) => {
    club.reputation = n <= 1 ? 55 : Math.round(18 + (78 * i) / (n - 1));
  });
}

/**
 * Itibar + seviye -> kulup basamagi.
 *
 * Seviye TAVAN koyar: 2. lig kulubu Avrupa eliti olamaz, itibari ne olursa
 * olsun. `clubTier` icerigin kapilama eksenidir; oraya sizan bir hata
 * "Sampiyonlar Ligi sahnesi 2. lig oyuncusuna cikti" demektir.
 */
export function tierFor(reputation: number, level: number): ClubTier {
  if (level >= 3) return 'amateur';
  // 2. lig kulubu 'mid'in ustune cikamaz -- tavan seviyeden gelir, itibardan degil.
  if (level === 2) return reputation >= 70 ? 'mid' : reputation >= 44 ? 'lower' : 'amateur';
  if (reputation >= 90) return 'elite';
  if (reputation >= 78) return 'contender';
  if (reputation >= 58) return 'mid';
  return 'lower';
}

// --------------------------------------------------------------- ana asama

export interface CompetitionStageInput {
  readonly teamDetailsFile: string;
  readonly seasonsFile: string;
  readonly scope: ImportScope;
  readonly log: IssueLog;
}

export async function buildCompetitions(
  input: CompetitionStageInput,
): Promise<readonly CompetitionDraft[]> {
  const { scope, log } = input;
  const details = await loadTeamDetails(input.teamDetailsFile);
  const seasons = await loadSeasons(input.seasonsFile, log);

  log.info('competitions', `${details.size} kulup kimligi, ${seasons.length} sezon satiri okundu`);

  // Kulup basina gecmis -- guc hesabi icin.
  const historyByClub = new Map<string, SeasonRow[]>();
  for (const row of seasons) {
    const list = historyByClub.get(row.clubId);
    if (list) list.push(row);
    else historyByClub.set(row.clubId, [row]);
  }

  const countries = new Set(scope.countries);
  const levels = new Set(scope.levels);

  // Kaynak sezonun kadro dizilimi.
  const current = seasons.filter((r) => r.season === scope.sourceSeason);
  if (current.length === 0) {
    log.error('competitions', `sezon ${scope.sourceSeason} icin hic satir yok -- kapsam bos kalacak`);
    return [];
  }

  const byCompetition = new Map<string, SeasonRow[]>();
  let skippedYouth = 0;
  let skippedCountry = 0;
  let skippedLevel = 0;
  let skippedUnknown = 0;

  for (const row of current) {
    const detail = details.get(row.clubId);
    if (!detail) {
      skippedUnknown += 1;
      continue;
    }
    if (!countries.has(detail.country)) {
      skippedCountry += 1;
      continue;
    }
    if (row.level === undefined || !levels.has(row.level)) {
      skippedLevel += 1;
      continue;
    }
    if (isYouthOrReserve(detail.nameReal)) {
      skippedYouth += 1;
      log.info('competitions', `genc/rezerv takim elendi: ${detail.nameReal}`, 'club', row.clubId);
      continue;
    }

    const list = byCompetition.get(row.competitionKey);
    if (list) list.push(row);
    else byCompetition.set(row.competitionKey, [row]);
  }

  log.info(
    'competitions',
    `elenen: ${skippedCountry} ulke disi, ${skippedLevel} seviye disi, ${skippedYouth} genc/rezerv, ${skippedUnknown} kimliksiz`,
  );

  const allClubs: ClubDraft[] = [];
  const drafts: CompetitionDraft[] = [];

  for (const [key, rows] of byCompetition) {
    // Ayni kulup ayni ligde iki kez gorunebilir (kaynak tekrari); teklestir.
    const unique = new Map<string, SeasonRow>();
    for (const r of rows) if (!unique.has(r.clubId)) unique.set(r.clubId, r);
    const members = [...unique.values()];

    const level = members[0]?.level ?? 99;
    const first = members[0];
    if (!first) continue;

    const detail0 = details.get(first.clubId)!;
    const matchCounts = members.map((m) => m.matches ?? 0);
    const { format, impliedClubCount } = detectFormat(members.length, matchCounts);

    if (format.kind === 'explicit') {
      const distinct = [...new Set(matchCounts.filter((m) => m > 0))].sort((a, b) => a - b);
      log.warn(
        'competitions',
        `${first.competitionName}: kulupler farkli sayida mac oynuyor (${distinct.join('/')}) -- format 'explicit'`,
        'competition',
        key,
      );
    }

    const clubs: ClubDraft[] = members.map((m) => {
      const d = details.get(m.clubId)!;
      const strength = computeStrength(historyByClub.get(m.clubId) ?? [], scope, d.country);
      const draft: ClubDraft = {
        externalKey: m.clubId,
        nameReal: d.nameReal,
        countryName: d.country,
        competitionKey: key,
        strength,
        reputation: 50,
        tier: 'mid',
        ...(format.kind === 'explicit' && m.matches !== undefined && m.matches > 0
          ? { matchesPerClub: m.matches }
          : {}),
      };
      return draft;
    });

    allClubs.push(...clubs);
    drafts.push({
      externalKey: key,
      nameReal: first.competitionName,
      countryName: detail0.country,
      level,
      format,
      clubCount: members.length,
      clubs,
      reputation: 50,
      promoted: 0,
      relegated: 0,
      ...(impliedClubCount === undefined ? {} : { impliedClubCount }),
    });
  }

  // Itibar tum evren uzerinden yuzdeliklenir -- lig ici degil.
  assignReputations(allClubs);
  for (const club of allClubs) {
    const comp = drafts.find((d) => d.externalKey === club.competitionKey)!;
    club.tier = tierFor(club.reputation, comp.level);
  }
  for (const d of drafts) {
    d.reputation = Math.round(d.clubs.reduce((s, c) => s + c.reputation, 0) / d.clubs.length);
  }

  applyPromotionQuotas(drafts);
  flagSuspiciousSizes(drafts, log);

  return drafts.sort(
    (a, b) => a.countryName.localeCompare(b.countryName) || a.level - b.level,
  );
}

/**
 * Yukselme/dusme kontenjani -- ITHAL EDILEN piramide gore.
 *
 * En ust seviyeden yukselen, en alt seviyeden dusen YOKTUR. Sadece 1-2
 * seviyesini ithal ettigimiz icin 2. ligden dusenin gidecegi yer yok; bunu
 * veriden degil kapsamdan bilmek zorundayiz.
 */
function applyPromotionQuotas(drafts: readonly CompetitionDraft[]): void {
  const byCountry = new Map<string, CompetitionDraft[]>();
  for (const d of drafts) {
    const list = byCountry.get(d.countryName);
    if (list) list.push(d);
    else byCountry.set(d.countryName, [d]);
  }

  for (const list of byCountry.values()) {
    const levels = [...new Set(list.map((d) => d.level))].sort((a, b) => a - b);
    const top = levels[0];
    const bottom = levels[levels.length - 1];
    for (const d of list) {
      d.promoted = d.level === top ? 0 : 3;
      d.relegated = d.level === bottom ? 0 : 3;
    }
  }
}

/**
 * Kulup sayisi tuhaf olan ligleri isaretler.
 *
 * Kaynak anligi eksik olabiliyor. En degerli sinyal MAC SAYISI: fikstur
 * uzunlugu kac kulup gerektigini soyler, dolayisiyla kac kulubun eksik
 * oldugunu TAM SAYIYLA veririz. "Bir seyler tuhaf" degil, "2 kulup eksik".
 *
 * Sessizce kabul etmek takvimi eksik bir kadro uzerine kurar; isaretlemek
 * GUI'de elle tamamlamanin onunu acar.
 */
function flagSuspiciousSizes(drafts: readonly CompetitionDraft[], log: IssueLog): void {
  for (const d of drafts) {
    if (d.impliedClubCount !== undefined) {
      const missing = d.impliedClubCount - d.clubCount;
      log.error(
        'competitions',
        `${d.nameReal}: ${d.clubCount} kulup okundu ama ${declaredMatches(d.format)} maclik fikstur ` +
          `${d.impliedClubCount} kulup gerektiriyor -- ${missing} kulup EKSIK`,
        'competition',
        d.externalKey,
      );
      continue;
    }
    if (d.clubCount < 10) {
      log.error(
        'competitions',
        `${d.nameReal}: yalnizca ${d.clubCount} kulup -- kaynak anligi eksik olabilir`,
        'competition',
        d.externalKey,
      );
      continue;
    }
    const expected = declaredMatches(d.format);
    if (expected !== undefined && expected !== 2 * (d.clubCount - 1) && expected !== d.clubCount - 1) {
      log.warn(
        'competitions',
        `${d.nameReal}: ${d.clubCount} kulup ama ${expected} mac (cift devre ${2 * (d.clubCount - 1)} olurdu)`,
        'competition',
        d.externalKey,
      );
    }
  }
}
