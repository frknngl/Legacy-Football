import { describe, expect, it } from 'vitest';
import type { FlagValue } from '../src/domain/flags.js';
import type { MatchContext } from '../src/domain/match.js';
import { MatchContextGate } from '../src/runtime/MatchContextGate.js';

function context(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    opponentName: 'Goztepe',
    importance: 'derby',
    isStarter: true,
    ...overrides,
  };
}

describe('MatchContextGate', () => {
  it('opsiyonel alanlar verilmezse onceki degerleri tasimaz', () => {
    const gate = new MatchContextGate();
    const flags: Record<string, FlagValue> = {
      team_league_position: 3,
      unbeaten_streak: 7,
      scoreless_streak: 4,
      season_goals: 9,
      season_assists: 6,
      season_apps: 18,
    };

    gate.applyContext(flags, context());

    expect(flags['team_league_position']).toBe(10);
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
        unbeatenStreak: 5,
        scorelessStreak: 1,
        seasonGoals: 12,
        seasonAssists: 8,
        seasonApps: 21,
      }),
    );

    expect(flags['team_league_position']).toBe(2);
    expect(flags['unbeaten_streak']).toBe(5);
    expect(flags['scoreless_streak']).toBe(1);
    expect(flags['season_goals']).toBe(12);
    expect(flags['season_assists']).toBe(8);
    expect(flags['season_apps']).toBe(21);
  });
});
