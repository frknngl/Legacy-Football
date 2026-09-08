import { FlagRegistry, type FlagDefinition } from '../src/domain/flags.js';
import type { MutableFlagState, EffectSource } from '../src/evaluation/EffectApplier.js';
import type { ScaleContext } from '../src/domain/effects.js';

export const TEST_FLAGS: FlagDefinition[] = [
  { key: 'servet', kind: 'resource', type: 'number', default: 0, label: 'Servet', shortfallTo: 'borc' },
  { key: 'borc', kind: 'resource', type: 'number', default: 0, label: 'Borc' },
  { key: 'teknik', kind: 'stat', type: 'number', default: 50, label: 'Teknik' },
  { key: 'liderlik', kind: 'stat', type: 'number', default: 50, label: 'Liderlik' },
  { key: 'taraftar_destegi', kind: 'stat', type: 'number', default: 50, label: 'Taraftar' },
  { key: 'medya_itibari', kind: 'stat', type: 'number', default: 50, label: 'Medya' },
  { key: 'piyasa_degeri', kind: 'resource', type: 'number', default: 0, label: 'Piyasa' },
  { key: 'kupa_sayisi', kind: 'derived', type: 'number', default: 0, label: 'Kupa' },
  { key: 'persona_durus', kind: 'persona', type: 'number', default: 50, label: 'Durus' },
  { key: 'mem_accepted_fixing', kind: 'memory', type: 'boolean', default: false, label: 'Sike kabul' },
  { key: 'mem_bribed_police', kind: 'memory', type: 'boolean', default: false, label: 'Rusvet' },
  { key: 'inc_missed_penalty', kind: 'incident', type: 'boolean', default: false, label: 'Penalti kacti' },
  { key: 'currentTurn', kind: 'system', type: 'number', default: 1, label: 'Tur' },
];

export function testRegistry(extra: FlagDefinition[] = []): FlagRegistry {
  return FlagRegistry.from([...TEST_FLAGS, ...extra]);
}

export function testState(overrides: Partial<MutableFlagState> = {}): MutableFlagState {
  const registry = testRegistry();
  return {
    flags: registry.defaults(),
    flagSetTurn: {},
    flagSource: {},
    turn: 1,
    ...overrides,
  };
}

export const CONTENT_SOURCE: EffectSource = {
  origin: 'content',
  eventId: 'evt_test',
  choiceId: 'c1',
  choiceText: 'Test secimi',
};

export const SCALE: ScaleContext = { stature: 'nobody', clubTier: 'lower', season: 1 };
