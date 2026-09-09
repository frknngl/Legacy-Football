/**
 * EPILOG KODALARI -- kariyerin biraktigi izin sondaki karsiligi.
 *
 * OLCULEN SORUN: motor yirmi kadar `mem_*` izi yaziyordu -- evlilik,
 * ayrilik, borsa vurgunu, kumar, turnuva sampiyonlugu, gol kralligi,
 * rakibe transfer -- ve HICBIRI hicbir yerde okunmuyordu. Yani otuz
 * sezonda verdigin kararlarin cogu, kariyerin son ekraninda hic
 * gorunmuyordu.
 *
 * On sekiz sonlanma x her iz icin ayri metin yazmak yerine kodalar
 * SONLANMADAN BAGIMSIZ durur: hangisiyle bitilirse bitilsin, kosulu
 * tutan cumleler epiloga eklenir.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ContentLoader } from '../src/loading/ContentLoader.js';
import { FileSystemContentSource } from '../src/loading/FileSystemContentSource.js';
import type { ContentRegistry } from '../src/loading/ContentRegistry.js';
import { EndingResolver } from '../src/runtime/EndingResolver.js';
import type { GameState } from '../src/domain/state.js';

let registry: ContentRegistry;

/** Sonlanma cozucunun okudugu asgari durum dilimi. */
function stateWith(flags: Record<string, unknown>): GameState {
  return {
    turn: 900,
    flags: { mem_was_incarcerated: true, ...flags },
    flagSetTurn: {},
  } as unknown as GameState;
}

beforeAll(async () => {
  const loaded = await new ContentLoader(new FileSystemContentSource('content')).load();
  expect(loaded.issues).toEqual([]);
  registry = loaded.registry!;
});

describe('Katalog', () => {
  it('kodalar icerikten yukleniyor', () => {
    expect(registry.config.epilogueCodas.length).toBeGreaterThanOrEqual(10);
  });

  it('her koda bir IZ okuyor -- yoksa kodanin anlami yok', () => {
    for (const coda of registry.config.epilogueCodas) {
      expect(JSON.stringify(coda.requires), coda.id).toContain('mem_');
    }
  });

  it('koda metinleri BOS degil ve cumle kuruyor', () => {
    for (const coda of registry.config.epilogueCodas) {
      expect(coda.text.trim().length, coda.id).toBeGreaterThan(40);
    }
  });
});

describe('Cozum', () => {
  function resolve(flags: Record<string, unknown>): string {
    const resolver = new EndingResolver(
      registry.config.endings,
      undefined,
      undefined,
      registry.config.epilogueCodas,
    );
    const ending = resolver.resolve(stateWith(flags), { flags: stateWith(flags).flags } as never);
    expect(ending).toBeDefined();
    return ending!.epilogue;
  }

  it('IZ YOKSA epilog degismiyor', () => {
    const plain = resolve({});
    const married = resolve({ mem_evlendi: true });
    expect(married.length).toBeGreaterThan(plain.length);
    expect(married.startsWith(plain)).toBe(true);
  });

  it('EVLILIK sonda goruluyor', () => {
    expect(resolve({ mem_evlendi: true })).toMatch(/kapiyi acan biri/i);
  });

  it('AYRILIK sonda goruluyor', () => {
    expect(resolve({ mem_ayrilik: true })).toMatch(/o numara duruyor/i);
  });

  it('EVLENIP AYRILMAK ucuncu bir cumle uretiyor -- ikisinin toplami degil', () => {
    const both = resolve({ mem_evlendi: true, mem_ayrilik: true });
    // Bosanma kodasi tutar; "hala evli" kodasi TUTMAZ.
    expect(both).toMatch(/Avukatlar bittikten sonra/i);
    expect(both).not.toMatch(/kapiyi acan biri/i);
  });

  it('BIRDEN COK iz birden cok cumle ekliyor', () => {
    const rich = resolve({
      mem_evlendi: true,
      mem_turnuva_sampiyonu: true,
      mem_borsa_vurgunu: true,
    });
    expect(rich).toMatch(/kapiyi acan biri/i);
    expect(rich).toMatch(/turnuva kazandin/i);
    expect(rich).toMatch(/hayatinin en buyuk transfer/i);
  });

  it('ONCELIK siralamayi belirliyor -- buyuk olan once', () => {
    const text = resolve({ mem_turnuva_sampiyonu: true, mem_mac_gecesi_kacti: true });
    // Turnuva sampiyonlugu (95) kacamaktan (45) once yazilmali.
    expect(text.indexOf('turnuva kazandin')).toBeLessThan(text.indexOf('kamptan kactigini'));
  });

  it('SAYISAL kosul da calisiyor -- iki kez rakibe gecmek baska bir sey', () => {
    expect(resolve({ mem_rakip_kulup_gecmisi: 1 })).not.toMatch(/iki kere karsi tarafa/i);
    expect(resolve({ mem_rakip_kulup_gecmisi: 2 })).toMatch(/iki kere karsi tarafa/i);
  });

  it('kodalar SONLANMADAN BAGIMSIZ -- hangi sonla bitilirse bitilsin gelir', () => {
    const resolver = new EndingResolver(
      registry.config.endings,
      undefined,
      undefined,
      registry.config.epilogueCodas,
    );

    // UC AYRI SON, ayni koda. Kodalarin sonlanmadan bagimsiz oldugu
    // iddiasi ancak farkli sonlarla sinanabilir.
    const cases: { label: string; flags: Record<string, unknown> }[] = [
      { label: 'end_incarcerated', flags: { mem_was_incarcerated: true } },
      { label: 'end_informant_exile', flags: { mem_turned_informant: true } },
      { label: 'end_quiet_goodbye', flags: { retired: true } },
    ];

    const resolvedIds = new Set<string>();
    for (const c of cases) {
      const flags = { ...c.flags, mem_evlendi: true };
      const out = resolver.resolve(
        { turn: 900, flags, flagSetTurn: {} } as unknown as GameState,
        { flags } as never,
      );
      expect(out, c.label).toBeDefined();
      resolvedIds.add(out!.id);
      expect(out!.epilogue, c.label).toMatch(/kapiyi acan biri/i);
    }

    // Gercekten farkli sonlar cozuldu -- yoksa test tek sonu uc kez
    // sinamis olurdu.
    expect(resolvedIds.size).toBe(3);
  });
});
