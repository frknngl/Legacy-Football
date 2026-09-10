import { beforeAll, describe, expect, it } from 'vitest';
import type { StoryEvent, StoryNode } from '../src/domain/story.js';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { TailTemplateRule } from '../src/validation/rules/quality.js';

let registry: ContentRegistry;

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
});

function outcome(text: string): StoryNode {
  return {
    id: 'n_root',
    title: 'Son',
    kind: 'outcome',
    text,
  };
}

function sampleEvent(
  id: string,
  text: string,
  opts?: { waived?: boolean; category?: string },
): StoryEvent {
  return {
    id,
    family: `fam_${id}`,
    category: opts?.category ?? 'match',
    tier: 'minor',
    weight: 10,
    cooldown: { self: 1, family: 1 },
    rootNode: 'n_root',
    nodes: { n_root: outcome(text) },
    ...(opts?.waived
      ? { lint: { ignore: ['TailTemplateRule'], reason: 'sentetik test muafiyeti' } }
      : {}),
  };
}

describe('TailTemplateRule', () => {
  it('sablon kapanis kuyrugunu yakalar', () => {
    const event = sampleEvent(
      'evt_test_tail_template',
      'Kapiyi kapatip ciktin. Sahne kapanirken verdigin karar gunun ritmini degistiren sessiz bir kirilmaya donustu.',
    );

    const findings = TailTemplateRule.check({ registry, events: [event] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.path).toBe('nodes.n_root.text');
    expect(findings[0]!.message).toContain('sablon kapanis');
  });

  it('kuyruktaki tekrar eden parcacigi yakalar', () => {
    const event = sampleEvent(
      'evt_test_tail_repeat',
      'Kapidan ciktin. Tribunun ugultusu uzaktan. Tribunun ugultusu uzaktan.',
    );

    const findings = TailTemplateRule.check({ registry, events: [event] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('tekrar eden parcacik');
  });

  it('kuyruktaki kirik parcacigi yakalar', () => {
    const event = sampleEvent('evt_test_tail_fragment', 'Dosyayi masaya biraktin. Icindeki gerilim.');

    const findings = TailTemplateRule.check({ registry, events: [event] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('kirik parcacik');
  });

  it('dogal kapanis metnini ihlal saymaz', () => {
    const event = sampleEvent(
      'evt_test_tail_clean',
      'Koridora ciktiginda kimse bunu yuksek sesle konusmuyor, ama herkes ne oldugunu biliyor. Arabaya binerken bu hikayeyi burada birakmaya karar veriyorsun.',
    );

    const findings = TailTemplateRule.check({ registry, events: [event] });
    expect(findings).toHaveLength(0);
  });

  it('tum kategorilerde kuyruk denetimini uygular', () => {
    const event = sampleEvent(
      'evt_test_tail_out_of_scope',
      'Kapiyi kapatip ciktin. Sahne kapanirken verdigin karar gunun ritmini degistiren sessiz bir kirilmaya donustu.',
      { category: 'legal' },
    );

    const findings = TailTemplateRule.check({ registry, events: [event] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('sablon kapanis');
  });

  it('muafiyet varsa bulgu uretmez', () => {
    const event = sampleEvent(
      'evt_test_tail_waived',
      'Kapiyi kapatip ciktin. Kisa bir duraksamadan sonra bu adimin yarina tasinacak bir iz biraktigi netlesti.',
      { waived: true },
    );

    const findings = TailTemplateRule.check({ registry, events: [event] });
    expect(findings).toHaveLength(0);
  });
});
