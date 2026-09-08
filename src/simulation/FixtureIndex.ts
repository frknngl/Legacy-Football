/**
 * FIKSTUR DEFTERI -- cakismayi GORUNUR yapan katman.
 *
 * Eski takvimde fikstuler duz bir diziye atiliyor, `forClub` ise `.find()` ile
 * ilkini donuyordu. Bir kulubun ayni haftadaki ikinci maci hicbir yerde hata
 * uretmeden kayboluyordu: 34 kuluplu mock dunyada olculen kayip 65 fikstur.
 *
 * Bu sinif iki seyi degistirir:
 *   1. Kulup-hafta bazinda sayac tutar -> kapasite SORULABILIR
 *   2. `fixturesFor` HEPSINI doner -> sessiz dusme imkansiz
 *
 * Kapasite asildiginda burasi hata ATMAZ; karar yerlestiricinindir. Bu sinif
 * yalnizca gercegi soyler.
 */

import type { Fixture, SlotKind } from '../domain/calendar.js';
import { SLOT_KINDS } from '../domain/calendar.js';

export class FixtureIndex {
  private readonly all: Fixture[] = [];
  private readonly byWeekIndex = new Map<number, Fixture[]>();
  /** `${clubId}:${week}` -> o haftaki maclari. */
  private readonly byClubWeek = new Map<string, Fixture[]>();

  add(fixture: Fixture): void {
    this.all.push(fixture);

    const week = this.byWeekIndex.get(fixture.week);
    if (week) week.push(fixture);
    else this.byWeekIndex.set(fixture.week, [fixture]);

    for (const clubId of [fixture.homeId, fixture.awayId]) {
      const key = clubKey(clubId, fixture.week);
      const list = this.byClubWeek.get(key);
      if (list) list.push(fixture);
      else this.byClubWeek.set(key, [fixture]);
    }
  }

  /** Bu kulup bu hafta kac mac oynuyor. */
  countFor(clubId: string, week: number): number {
    return this.byClubWeek.get(clubKey(clubId, week))?.length ?? 0;
  }

  /** Bu kulubun bu haftada kullandigi slotlar. */
  usedSlots(clubId: string, week: number): ReadonlySet<SlotKind> {
    const list = this.byClubWeek.get(clubKey(clubId, week)) ?? [];
    return new Set(list.map((f) => f.slot));
  }

  /**
   * Verilen kuluplerin HEPSI bu haftada bir mac daha alabiliyor mu.
   * Katilimci listesi bossa (kupanin ileri turu) kapasite bilinemez -> true.
   */
  hasCapacity(clubIds: readonly string[], week: number, max: number): boolean {
    return clubIds.every((id) => this.countFor(id, week) < max);
  }

  /**
   * Bu kuluplerin hicbirinin kullanmadigi ilk slot.
   * Hepsi doluysa undefined -- cagiran baska bir haftaya bakmali.
   */
  freeSlot(clubIds: readonly string[], week: number, prefer: SlotKind): SlotKind | undefined {
    const taken = new Set<SlotKind>();
    for (const id of clubIds) for (const s of this.usedSlots(id, week)) taken.add(s);

    if (!taken.has(prefer)) return prefer;
    for (const kind of SLOT_KINDS) if (!taken.has(kind)) return kind;
    return undefined;
  }

  fixtures(): readonly Fixture[] {
    return this.all;
  }

  weekOf(week: number): readonly Fixture[] {
    return this.byWeekIndex.get(week) ?? [];
  }

  forClub(clubId: string, week: number): readonly Fixture[] {
    const list = this.byClubWeek.get(clubKey(clubId, week)) ?? [];
    // Slot sirasinda: hafta sonu once. Motor maclari bu sirayla oynatir.
    return [...list].sort((a, b) => SLOT_KINDS.indexOf(a.slot) - SLOT_KINDS.indexOf(b.slot));
  }

  /** Kac kulup-haftasi kapasiteyi asiyor -- denetim icin. */
  overbooked(max: number): { clubId: string; week: number; count: number }[] {
    const out: { clubId: string; week: number; count: number }[] = [];
    for (const [key, list] of this.byClubWeek) {
      if (list.length <= max) continue;
      const split = key.lastIndexOf(':');
      out.push({
        clubId: key.slice(0, split),
        week: Number(key.slice(split + 1)),
        count: list.length,
      });
    }
    return out;
  }
}

function clubKey(clubId: string, week: number): string {
  return `${clubId}:${week}`;
}
