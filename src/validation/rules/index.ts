/**
 * Kural kaydi.
 *
 * OCP: yeni kural = yeni bir nesne + bu listeye bir satir. Mevcut hicbir
 * kural degistirilmez.
 *
 * NOT: kurallar konu bazli dosyalarda gruplanmistir (yapisal / kalite /
 * kapsama). Her kural yine BAGIMSIZ bir nesnedir ve tek basina eklenip
 * cikarilabilir; gruplama yalnizca dosya sayisini makul tutar.
 */

import type { ValidationRule } from '../Rule.js';
import {
  ActorPresenceRule,
  HandwrittenSuffixRule,
  HardcodedNameRule,
  SlotScopeRule,
} from './actors.js';
import { NemesisArcRule } from './nemesis.js';
import {
  CooldownSanityRule,
  DanglingTargetRule,
  EscapeHatchRule,
  MinChoiceCountRule,
  ReadOnlyFlagRule,
  RollWeightRule,
  RootNodeKindRule,
  ScheduledEventRule,
  UndeclaredFlagRule,
  UnreachableNodeRule,
  VariantConsistencyRule,
  VariantDistinctnessRule,
  VariantIncidentRule,
  ShapeVarietyRule,
} from './structure.js';
import {
  ConsequenceHookRule,
  EndingInterpolationRule,
  IncidentLifetimeRule,
  InterpolationRule,
  MomentCoverageRule,
  OrphanMemoryFlagRule,
  RawIdentifierRule,
  TextQualityRule,
  TierComplianceRule,
  TradeoffRule,
  UnusedWaiverRule,
} from './quality.js';
import { SeniorVoiceRule } from './voice.js';

export const ALL_RULES: readonly ValidationRule[] = [
  // yapisal
  DanglingTargetRule,
  UnreachableNodeRule,
  MinChoiceCountRule,
  EscapeHatchRule,
  UndeclaredFlagRule,
  ReadOnlyFlagRule,
  CooldownSanityRule,
  RollWeightRule,
  ScheduledEventRule,
  RootNodeKindRule,
  VariantConsistencyRule,
  VariantDistinctnessRule,
  VariantIncidentRule,
  ShapeVarietyRule,
  // kalite
  ConsequenceHookRule,
  TradeoffRule,
  TextQualityRule,
  RawIdentifierRule,
  TierComplianceRule,
  InterpolationRule,
  EndingInterpolationRule,
  OrphanMemoryFlagRule,
  IncidentLifetimeRule,
  MomentCoverageRule,
  UnusedWaiverRule,
  // ses (sahnenin agzi ile kapilamanin uyusmasi)
  SeniorVoiceRule,
  // kimlik
  ActorPresenceRule,
  HardcodedNameRule,
  HandwrittenSuffixRule,
  SlotScopeRule,
  NemesisArcRule,
];

export * from './structure.js';
export * from './quality.js';
export * from './actors.js';
export * from './nemesis.js';
export * from './voice.js';
