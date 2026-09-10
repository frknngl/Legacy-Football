import { beforeAll, describe, expect, it } from 'vitest';
import type { StoryEvent } from '../src/domain/story.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { HandContractRule, HandTemplateIdRule } from '../src/validation/rules/hand.js';

let registry: ContentRegistry;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
});

function mockHandEvent(overrides: Record<string, unknown> = {}): StoryEvent {
  const base: Record<string, unknown> = {
    id: 'evt_business_ilk_imza',
    family: 'fam_business_test',
    category: 'business',
    tier: 'major',
    authored: 'hand',
    weight: 10,
    cooldown: { self: 10, family: 5 },
    story: {
      signature: 'business:sporting_director:ilk_imza',
      beat: 'ilk_imza',
    },
    repeatPolicy: {
      arcGapTurns: 16,
      beatGapTurns: 45,
      signatureGapTurns: 30,
      maxBeatUses: 6,
    },
    rootNode: 'n_root',
    nodes: {
      n_root: {
        id: 'n_root',
        title: 'Kök',
        text: 'Metin',
        kind: 'outcome',
      },
    },
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete base[k];
    } else {
      base[k] = v;
    }
  }
  return base as unknown as StoryEvent;
}

describe('HandTemplateIdRule', () => {
  it('ozgun isme sahip elle yazilmis olayi onaylar', () => {
    const event = mockHandEvent({ id: 'evt_business_ilk_sozlesme_veli' });
    const findings = HandTemplateIdRule.check({ registry, events: [event] });
    expect(findings).toEqual([]);
  });

  it('mekanik kombinasyon semasi (evt_<cat>_<slot>_<beat>) tasiyan elle yazilmis olayi yakalar', () => {
    const event = mockHandEvent({ id: 'evt_business_lawyer_ayartma' });
    const findings = HandTemplateIdRule.check({ registry, events: [event] });
    expect(findings.length).toBe(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('mekanik model sablonu');
  });

  it('model uretimi (generated) olayi sablon isim tasisada kural harici tutar', () => {
    const event = mockHandEvent({ id: 'evt_business_lawyer_ayartma', authored: 'generated' });
    const findings = HandTemplateIdRule.check({ registry, events: [event] });
    expect(findings).toEqual([]);
  });
});

describe('HandContractRule', () => {
  it('tam sozlesmeye sahip elle yazilmis olayi onaylar', () => {
    const event = mockHandEvent({});
    const findings = HandContractRule.check({ registry, events: [event] });
    expect(findings).toEqual([]);
  });

  it('repeatPolicy eksikse error verir', () => {
    const event = mockHandEvent({ repeatPolicy: undefined });
    const findings = HandContractRule.check({ registry, events: [event] });
    expect(findings.some((f) => f.path === 'repeatPolicy' && f.severity === 'error')).toBe(true);
  });

  it('story.signature eksikse error verir', () => {
    const event = mockHandEvent({ story: undefined });
    const findings = HandContractRule.check({ registry, events: [event] });
    expect(findings.some((f) => f.path === 'story.signature' && f.severity === 'error')).toBe(true);
  });

  it('epic olay once: true veya maxBeatUses: 1 tasimiyorsa error verir', () => {
    const event = mockHandEvent({
      tier: 'epic',
      once: false,
      repeatPolicy: {
        arcGapTurns: 40,
        beatGapTurns: 120,
        signatureGapTurns: 80,
        maxBeatUses: 5,
      },
    });
    const findings = HandContractRule.check({ registry, events: [event] });
    expect(findings.some((f) => f.path === 'once' && f.severity === 'error')).toBe(true);
  });
});
