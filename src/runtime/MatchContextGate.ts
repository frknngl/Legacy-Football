/**
 * Mac baglami kapisi.
 *
 * Host'un urettigi mac verisini state'e YAZAR. Motor mac SIMULE ETMEZ --
 * skoru, fiksturu, lig tablosunu bilmez. Yalnizca oyuncunun kararini ve
 * anlatiyi yonetir.
 *
 * `form` burada TURETILIR: son bes macin reyting ortalamasi. Icerik "3 macdir
 * gol atamiyorsun" diyebilsin diye.
 */

import type { FlagValue } from '../domain/flags.js';
import type { MatchContext, MatchContextPhase, MatchResultReport } from '../domain/match.js';

const FORM_WINDOW = 5;
const DEFAULT_MATCH_IMPORTANCE = 'none';
const DEFAULT_TEAM_LEAGUE_POSITION = 10;
const DEFAULT_TEAM_LEAGUE_SIZE = 18;
const DEFAULT_RELEGATED_TEAMS = 3;
const DEFAULT_TEAM_RELEGATION_LINE =
  DEFAULT_TEAM_LEAGUE_SIZE - DEFAULT_RELEGATED_TEAMS + 1;
const DEFAULT_TEAM_RELEGATION_ZONE = false;
const DEFAULT_UNBEATEN_STREAK = 0;
const DEFAULT_SCORELESS_STREAK = 0;
const DEFAULT_SEASON_GOALS = 0;
const DEFAULT_SEASON_ASSISTS = 0;
const DEFAULT_SEASON_APPS = 0;

const PHASE_FREE_WEEK: MatchContextPhase = 'free_week';
const PHASE_PRE_MATCH: MatchContextPhase = 'pre_match';
const PHASE_IN_MATCH: MatchContextPhase = 'in_match';
const PHASE_POST_MATCH: MatchContextPhase = 'post_match';

export class MatchContextGate {
  /** Haftalik secimden once: yaklasan fikstur baglamini yazar ya da temizler. */
  applySelectionContext(flags: Record<string, FlagValue>, ctx: MatchContext | undefined): void {
    if (!ctx) {
      this.clearSelectionContext(flags);
      return;
    }
    this.writeSelectionContext(flags, ctx);
    flags['match_context_phase'] = PHASE_PRE_MATCH;
  }

  /** Mac oncesi: host'un sundugu baglami okunabilir flag'lere yazar. */
  applyContext(flags: Record<string, FlagValue>, ctx: MatchContext): void {
    this.writeSelectionContext(flags, ctx);
    flags['unbeaten_streak'] = ctx.unbeatenStreak ?? DEFAULT_UNBEATEN_STREAK;
    flags['scoreless_streak'] = ctx.scorelessStreak ?? DEFAULT_SCORELESS_STREAK;
    flags['season_goals'] = ctx.seasonGoals ?? DEFAULT_SEASON_GOALS;
    flags['season_assists'] = ctx.seasonAssists ?? DEFAULT_SEASON_ASSISTS;
    flags['season_apps'] = ctx.seasonApps ?? DEFAULT_SEASON_APPS;
    flags['match_context_phase'] = PHASE_IN_MATCH;
  }

  /** Mac sonrasi: gercek sonucu yazar ve `form’u gunceller. */
  applyResult(
    flags: Record<string, FlagValue>,
    result: MatchResultReport,
    ratingHistory: number[],
  ): void {
    flags['last_match_result'] = result.result;
    flags['last_match_rating'] = result.rating;
    flags['last_match_goals'] = result.goals;
    flags['last_match_assists'] = result.assists;
    flags['last_match_minutes'] = result.minutes;
    flags['last_match_cards'] = result.cards;

    // Fikstur yoksa (result:none) onceki macin sayaclari oldugu gibi kalir.
    if (result.result === 'none') {
      this.clearSelectionContext(flags);
      return;
    }

    flags['match_context_phase'] = PHASE_POST_MATCH;

    // Takim maci oynanip Hero dakika almadiysa kisinin sayaclari artmaz.
    if (result.minutes <= 0) return;

    // KARIYER SAYACLARI.
    //
    // Motor bugune kadar yalnizca SON maci tutuyordu; kariyer toplami
    // hicbir yerde yoktu. Bu yuzden "100. macin", "50. golun" gibi
    // kilometre tasi sahneleri yazilamiyordu -- kosul yazacak sayi yok.
    //
    // `derived` turunde olduklari icin ICERIK bunlara YAZAMAZ
    // (`ReadOnlyFlagRule`); yalnizca okur. Bir olay dosyasi gol sayisini
    // uyduramamali -- `kupa_sayisi` ile ayni gerekce.
    flags['kariyer_mac_sayisi'] = numberOf(flags['kariyer_mac_sayisi']) + 1;
    // Sezonluk sayac: gelisim "kac mac oynadin"a bakar. Sezon
    // donusunde motor sifirlar.
    flags['sezon_mac_sayisi'] = numberOf(flags['sezon_mac_sayisi']) + 1;
    // Sezonluk gol/asist: bireysel odullerin (gol krali, yilin oyuncusu)
    // tek girdisi. Motor kariyer toplamini tutuyordu ama sezon bazinda
    // siralama yapacak hicbir sey yoktu.
    flags['sezon_gol_sayisi'] = numberOf(flags['sezon_gol_sayisi']) + result.goals;
    flags['sezon_asist_sayisi'] = numberOf(flags['sezon_asist_sayisi']) + result.assists;
    flags['kariyer_gol_sayisi'] = numberOf(flags['kariyer_gol_sayisi']) + result.goals;
    flags['kariyer_asist_sayisi'] = numberOf(flags['kariyer_asist_sayisi']) + result.assists;

    ratingHistory.push(result.rating);
    while (ratingHistory.length > FORM_WINDOW) ratingHistory.shift();

    const avg = ratingHistory.reduce((a, b) => a + b, 0) / ratingHistory.length;
    // Reyting 0-10; form 0-100.
    flags['form'] = Math.round(Math.max(0, Math.min(100, avg * 10)));
  }

  private writeSelectionContext(flags: Record<string, FlagValue>, ctx: MatchContext): void {
    const position = ctx.teamLeaguePosition ?? DEFAULT_TEAM_LEAGUE_POSITION;
    const size = ctx.teamLeagueSize ?? DEFAULT_TEAM_LEAGUE_SIZE;
    const line = this.resolveRelegationLine(size, ctx.teamRelegationLine);
    const inZone = ctx.teamInRelegationZone ?? this.isInRelegationZone(position, line, size);

    flags['opponent_name'] = ctx.opponentName;
    flags['match_importance'] = ctx.importance;
    flags['is_starter'] = ctx.isStarter;
    flags['team_league_position'] = position;
    flags['team_league_size'] = size;
    flags['team_relegation_line'] = line;
    flags['team_relegation_zone'] = inZone;

    // Haftalik secimde eski flag'lere bagli icerik de dogru baglamla calissin.
    flags['next_match_exists'] = true;
    flags['next_opponent_name'] = ctx.opponentName;
    flags['next_match_importance'] = ctx.importance;
    flags['next_team_league_position'] = position;
    flags['next_team_league_size'] = size;
    flags['next_team_relegation_line'] = line;
    flags['next_team_relegation_zone'] = inZone;
  }

  private clearSelectionContext(flags: Record<string, FlagValue>): void {
    const line = this.resolveRelegationLine(DEFAULT_TEAM_LEAGUE_SIZE, undefined);

    flags['match_context_phase'] = PHASE_FREE_WEEK;
    flags['next_match_exists'] = false;
    flags['next_opponent_name'] = '';
    flags['next_match_importance'] = DEFAULT_MATCH_IMPORTANCE;
    flags['next_team_league_position'] = DEFAULT_TEAM_LEAGUE_POSITION;
    flags['next_team_league_size'] = DEFAULT_TEAM_LEAGUE_SIZE;
    flags['next_team_relegation_line'] = line;
    flags['next_team_relegation_zone'] = DEFAULT_TEAM_RELEGATION_ZONE;

    // Legacy trigger'lar da stale deger tasimasin.
    flags['opponent_name'] = '';
    flags['match_importance'] = DEFAULT_MATCH_IMPORTANCE;
    flags['is_starter'] = false;
    flags['team_league_position'] = DEFAULT_TEAM_LEAGUE_POSITION;
    flags['team_league_size'] = DEFAULT_TEAM_LEAGUE_SIZE;
    flags['team_relegation_line'] = line;
    flags['team_relegation_zone'] = DEFAULT_TEAM_RELEGATION_ZONE;
  }

  private resolveRelegationLine(size: number, explicitLine: number | undefined): number {
    if (explicitLine !== undefined && explicitLine > 0) return explicitLine;
    if (size <= 0) return DEFAULT_TEAM_RELEGATION_LINE;
    const computed = size - DEFAULT_RELEGATED_TEAMS + 1;
    return Math.max(1, Math.min(size + 1, computed));
  }

  private isInRelegationZone(position: number, line: number, size: number): boolean {
    if (size <= 0 || line <= 0 || position <= 0) return false;
    if (line > size) return false;
    return position >= line;
  }
}

/** Sayisal flag okumasi -- tanimsizsa 0. */
function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
