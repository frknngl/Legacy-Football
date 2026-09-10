import { describe, expect, it } from 'vitest';
import type { FlagValue } from '../src/domain/flags.js';
import type { MatchContext, MatchResultReport } from '../src/domain/match.js';
import { MatchContextGate } from '../src/runtime/MatchContextGate.js';

function context(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    opponentName: 'Goztepe',
    importance: 'derby',
    isStarter: true,
    ...overrides,
  };
}

function report(overrides: Partial<MatchResultReport> = {}): MatchResultReport {
  return {
    result: 'draw',
    rating: 6.8,
    goals: 1,
    assists: 0,
    minutes: 90,
    cards: 1,
    ...overrides,
  };
}

describe('MatchContextGate', () => {
  it('haftalik secimde fikstur yoksa stale mac baglamini temizler', () => {
    const gate = new MatchContextGate();
    const flags: Record<string, FlagValue> = {
      match_context_phase: 'post_match',
      opponent_name: 'Besiktas',
      match_importance: 'cup_final',
      is_starter: true,
      team_league_position: 18,
      team_relegation_zone: true,
      next_match_exists: true,
    };

    gate.applySelectionContext(flags, undefined);

    expect(flags['match_context_phase']).toBe('free_week');
    expect(flags['next_match_exists']).toBe(false);
    expect(flags['opponent_name']).toBe('');
    expect(flags['match_importance']).toBe('none');
    expect(flags['is_starter']).toBe(false);
    expect(flags['team_league_position']).toBe(10);
    expect(flags['team_relegation_zone']).toBe(false);
  });

  it('haftalik secimde yaklasan fikstur varsa pre-match baglamini yazar', () => {
    const gate = new MatchContextGate();
    const flags: Record<string, FlagValue> = {};

    gate.applySelectionContext(
      flags,
      context({
        teamLeaguePosition: 17,
        teamLeagueSize: 20,
        teamRelegationLine: 18,
        isStarter: false,
      }),
    );

    expect(flags['match_context_phase']).toBe('pre_match');
    expect(flags['next_match_exists']).toBe(true);
    expect(flags['next_match_importance']).toBe('derby');
    expect(flags['next_opponent_name']).toBe('Goztepe');
    expect(flags['next_team_league_position']).toBe(17);
    expect(flags['next_team_league_size']).toBe(20);
    expect(flags['next_team_relegation_line']).toBe(18);
    expect(flags['next_team_relegation_zone']).toBe(false);
    expect(flags['is_starter']).toBe(false);
  });

  it('dusme hatti verilmezse lig boyutundan turetir', () => {
    const gate = new MatchContextGate();
    const flags: Record<string, FlagValue> = {};

    gate.applyContext(
      flags,
      context({
        teamLeaguePosition: 18,
        teamLeagueSize: 20,
      }),
    );

    expect(flags['team_league_position']).toBe(18);
    expect(flags['team_league_size']).toBe(20);
    expect(flags['team_relegation_line']).toBe(18);
    expect(flags['team_relegation_zone']).toBe(true);

    gate.applySelectionContext(
      flags,
      context({
        teamLeaguePosition: 17,
        teamLeagueSize: 20,
      }),
    );

    expect(flags['next_team_relegation_line']).toBe(18);
    expect(flags['next_team_relegation_zone']).toBe(false);
  });

  it('opsiyonel alanlar verilmezse onceki degerleri tasimaz', () => {
    const gate = new MatchContextGate();
    const flags: Record<string, FlagValue> = {
      team_league_position: 3,
      team_league_size: 22,
      team_relegation_line: 19,
      team_relegation_zone: true,
      unbeaten_streak: 7,
      scoreless_streak: 4,
      season_goals: 9,
      season_assists: 6,
      season_apps: 18,
    };

    gate.applyContext(flags, context());

    expect(flags['team_league_position']).toBe(10);
  expect(flags['team_league_size']).toBe(18);
  expect(flags['team_relegation_line']).toBe(16);
  expect(flags['team_relegation_zone']).toBe(false);
    expect(flags['unbeaten_streak']).toBe(0);
    expect(flags['scoreless_streak']).toBe(0);
    expect(flags['season_goals']).toBe(0);
    expect(flags['season_assists']).toBe(0);
    expect(flags['season_apps']).toBe(0);
  });

  it('opsiyonel alanlar varsa gelen degeri yazar', () => {
    const gate = new MatchContextGate();
    const flags: Record<string, FlagValue> = {};

    gate.applyContext(
      flags,
      context({
        teamLeaguePosition: 2,
        teamLeagueSize: 18,
        teamRelegationLine: 17,
        unbeatenStreak: 5,
        scorelessStreak: 1,
        seasonGoals: 12,
        seasonAssists: 8,
        seasonApps: 21,
      }),
    );

    expect(flags['team_league_position']).toBe(2);
  expect(flags['team_league_size']).toBe(18);
  expect(flags['team_relegation_line']).toBe(17);
  expect(flags['team_relegation_zone']).toBe(false);
    expect(flags['unbeaten_streak']).toBe(5);
    expect(flags['scoreless_streak']).toBe(1);
    expect(flags['season_goals']).toBe(12);
    expect(flags['season_assists']).toBe(8);
    expect(flags['season_apps']).toBe(21);
  });

  it('fikstur yoksa (result:none) kisisel sayaclari ve formu degistirmez', () => {
    const gate = new MatchContextGate();
    const flags: Record<string, FlagValue> = {
      kariyer_mac_sayisi: 12,
      sezon_mac_sayisi: 8,
      sezon_gol_sayisi: 5,
      sezon_asist_sayisi: 3,
      kariyer_gol_sayisi: 21,
      kariyer_asist_sayisi: 11,
      form: 74,
    };
    const history = [7.1, 7.4];

    gate.applyResult(flags, report({ result: 'none', rating: 0, goals: 0, assists: 0, minutes: 0, cards: 0 }), history);

    expect(flags['last_match_result']).toBe('none');
    expect(flags['kariyer_mac_sayisi']).toBe(12);
    expect(flags['sezon_mac_sayisi']).toBe(8);
    expect(flags['sezon_gol_sayisi']).toBe(5);
    expect(flags['sezon_asist_sayisi']).toBe(3);
    expect(flags['kariyer_gol_sayisi']).toBe(21);
    expect(flags['kariyer_asist_sayisi']).toBe(11);
    expect(flags['form']).toBe(74);
    expect(history).toEqual([7.1, 7.4]);
  });

  it('dakika 0 ise oyuncu sayacini artirma ve forma sifir reyting ekleme', () => {
    const gate = new MatchContextGate();
    const flags: Record<string, FlagValue> = {
      kariyer_mac_sayisi: 9,
      sezon_mac_sayisi: 4,
      form: 68,
    };
    const history = [6.5, 7.0, 7.4];

    gate.applyResult(flags, report({ result: 'loss', rating: 0, goals: 0, assists: 0, minutes: 0, cards: 0 }), history);

    expect(flags['last_match_result']).toBe('loss');
    expect(flags['kariyer_mac_sayisi']).toBe(9);
    expect(flags['sezon_mac_sayisi']).toBe(4);
    expect(flags['form']).toBe(68);
    expect(history).toEqual([6.5, 7.0, 7.4]);
  });
});
