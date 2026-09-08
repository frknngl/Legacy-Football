/**
 * Sans cozucu portu ve varsayilan matematiksel model.
 *
 * Kalibrasyon gercek futbol istatistiklerine yaslanir; bu testler modelin
 * zamanla sessizce kaymasini engeller. Bir gun `InteractiveChanceResolver`
 * (Flick Shoot) geldiginde ayni testler onu da olcecek.
 */

import { describe, expect, it } from 'vitest';
import { MathChanceResolver } from '../src/simulation/MathChanceResolver.js';
import { ScriptedChanceResolver } from '../src/testing/ScriptedChanceResolver.js';
import type { ChanceContext } from '../src/domain/chance.js';

const resolver = new MathChanceResolver();

function chance(overrides: Partial<ChanceContext> = {}): ChanceContext {
  return {
    kind: 'open_play',
    minute: 40,
    scoreline: '0-0',
    distance: 12,
    angle: 45,
    pressure: 50,
    keeperQuality: 55,
    shooter: { shooting: 60, composure: 60, isHero: true },
    importance: 'league',
    ...overrides,
  };
}

describe('MathChanceResolver kalibrasyonu', () => {
  it('penalti gercek donusum oranina oturur', () => {
    const xg = resolver.expectedGoals(chance({ kind: 'penalty', distance: 11, angle: 60 }));
    expect(xg).toBeGreaterThan(0.7);
    expect(xg).toBeLessThan(0.82);
  });

  it('penaltida yetenek farki BASTIRILIR -- elit sutor bile garanti degil', () => {
    const elite = resolver.expectedGoals(
      chance({
        kind: 'penalty',
        distance: 11,
        angle: 60,
        shooter: { shooting: 95, composure: 95, isHero: true },
      }),
    );
    // Gercek futbolda en iyi penaltici bile ~%85'te kalir.
    expect(elite).toBeLessThan(0.88);
    expect(elite).toBeGreaterThan(0.78);
  });

  it('30 metrelik sut nadiren gol olur', () => {
    const xg = resolver.expectedGoals(chance({ kind: 'long_range', distance: 30, angle: 25 }));
    expect(xg).toBeLessThan(0.05);
    // Ama imkansiz da degil: taban 0.005'e cakilirsa uzaktan gol hic olmaz.
    expect(xg).toBeGreaterThan(0.01);
  });

  it('1v1 acik oyundan belirgin sekilde daha iyidir', () => {
    const oneOnOne = resolver.expectedGoals(
      chance({ kind: 'one_on_one', distance: 10, angle: 40, pressure: 20 }),
    );
    expect(oneOnOne).toBeGreaterThan(resolver.expectedGoals(chance()) * 2);
  });

  it('mesafe, aci, baski ve kaleci dogru YONDE etkiler', () => {
    const base = resolver.expectedGoals(chance());
    expect(resolver.expectedGoals(chance({ distance: 22 }))).toBeLessThan(base);
    expect(resolver.expectedGoals(chance({ angle: 10 }))).toBeLessThan(base);
    expect(resolver.expectedGoals(chance({ pressure: 100 }))).toBeLessThan(base);
    expect(resolver.expectedGoals(chance({ keeperQuality: 95 }))).toBeLessThan(base);
    expect(
      resolver.expectedGoals(chance({ shooter: { shooting: 92, composure: 88, isHero: true } })),
    ).toBeGreaterThan(base);
  });

  it('roll xG esiginin altindaysa gol, ustundeyse degil', () => {
    const ctx = chance({ kind: 'penalty', distance: 11, angle: 60 });
    const xg = resolver.expectedGoals(ctx);
    expect(resolver.resolve(ctx, xg - 0.01).outcome).toBe('goal');
    expect(resolver.resolve(ctx, xg + 0.01).outcome).not.toBe('goal');
  });

  it('xG hic 0 ya da 1 olmaz -- her sut mumkun, hicbiri garanti degil', () => {
    const impossible = resolver.expectedGoals(
      chance({ kind: 'long_range', distance: 60, angle: 2, pressure: 100, keeperQuality: 99 }),
    );
    const certain = resolver.expectedGoals(
      chance({
        kind: 'one_on_one',
        distance: 2,
        angle: 90,
        pressure: 0,
        keeperQuality: 1,
        shooter: { shooting: 99, composure: 99, isHero: true },
      }),
    );
    expect(impossible).toBeGreaterThan(0);
    expect(certain).toBeLessThan(1);
  });
});

describe('ChanceResolver portu takas edilebilir', () => {
  it('senaryolu cozucu sirayla sonuc verir ve baglami kaydeder', () => {
    const scripted = new ScriptedChanceResolver(['goal', 'saved', 'goal']);
    const ctx = chance();

    expect(scripted.resolve(ctx, 0.9).outcome).toBe('goal');
    expect(scripted.resolve(ctx, 0.1).outcome).toBe('saved');
    expect(scripted.resolve(ctx, 0.5).outcome).toBe('goal');
    // Senaryo bitti: yedek sonuca duser.
    expect(scripted.resolve(ctx, 0.5).outcome).toBe('saved');

    expect(scripted.seen).toHaveLength(4);
    // Roll'u YOK SAYAR: determinizm cagiranin elinde kalir.
    expect(scripted.seen[0]!.kind).toBe('open_play');
  });
});
