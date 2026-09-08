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
import type { MatchContext, MatchResultReport } from '../domain/match.js';

const FORM_WINDOW = 5;

export class MatchContextGate {
  /** Mac oncesi: host'un sundugu baglami okunabilir flag'lere yazar. */
  applyContext(flags: Record<string, FlagValue>, ctx: MatchContext): void {
    flags['opponent_name'] = ctx.opponentName;
    flags['match_importance'] = ctx.importance;
    flags['is_starter'] = ctx.isStarter;
    if (ctx.teamLeaguePosition !== undefined) flags['team_league_position'] = ctx.teamLeaguePosition;
    if (ctx.unbeatenStreak !== undefined) flags['unbeaten_streak'] = ctx.unbeatenStreak;
    if (ctx.scorelessStreak !== undefined) flags['scoreless_streak'] = ctx.scorelessStreak;
    if (ctx.seasonGoals !== undefined) flags['season_goals'] = ctx.seasonGoals;
    if (ctx.seasonAssists !== undefined) flags['season_assists'] = ctx.seasonAssists;
    if (ctx.seasonApps !== undefined) flags['season_apps'] = ctx.seasonApps;
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
}

/** Sayisal flag okumasi -- tanimsizsa 0. */
function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
