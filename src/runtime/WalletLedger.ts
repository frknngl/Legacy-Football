/**
 * CUZDAN DEFTERI -- durum yonetimi.
 *
 * Veri sekli `domain/wallet.ts`te; burasi onu kariyer durumuna uygular.
 * Ayrim katman kuralindan geliyor: `GameState` bir domain tipidir ve
 * alanlarinin tipleri de domain'de durmalidir.
 *
 * Defter SINIRLI tutulur (`EventHistory` ile ayni desen): kayit dosyasi
 * 30 sezon boyunca sinirsiz buyuyemez. Toplamlar ise sinirdan bagimsiz
 * AYRICA biriktirilir -- son 200 satiri gormek baska sey, "kariyer
 * boyunca kumara ne kadar yatirdim" baska sey.
 */

import type { WalletEntry, WalletKind, WalletState } from '../domain/wallet.js';

export type { WalletEntry, WalletKind, WalletState, WalletTotals } from '../domain/wallet.js';
export { WALLET_KINDS, WALLET_LABELS, isWalletKind } from '../domain/wallet.js';

export class WalletLedger {
  /**
   * Defterde tutulan satir sayisi.
   *
   * 200 satir ~5 sezonluk maas hareketi demek. Daha fazlasi kayit
   * dosyasini sisirir ve kimse okumaz; toplamlar zaten ayri tutuluyor.
   */
  static readonly LIMIT = 200;

  /**
   * Bir hareketi deftere yazar.
   *
   * `amount` 0 ise HICBIR SEY yazilmaz: sifir tutarli satirlar defteri
   * bogar ve gercek hareketleri gizler.
   */
  static record(
    state: WalletState,
    amount: number,
    kind: WalletKind,
    label: string,
  ): void {
    if (!Number.isFinite(amount) || Math.round(amount) === 0) return;

    const rounded = Math.round(amount);
    const balance = Math.round(numberOf(state.flags['servet']));

    state.wallet.push({ turn: state.turn, amount: rounded, kind, label, balance });
    while (state.wallet.length > WalletLedger.LIMIT) state.wallet.shift();

    // Toplamlar defterin sinirindan BAGIMSIZ birikir: son 200 satiri
    // gormek baska sey, "kariyer boyunca kumara ne yatirdim" baska sey.
    const cell = (state.walletTotals[kind] ??= { inflow: 0, outflow: 0 });
    if (rounded > 0) cell.inflow += rounded;
    else cell.outflow += -rounded;
  }

  /** Son `n` hareket, yeniden eskiye. */
  static recent(state: WalletState, n = 15): readonly WalletEntry[] {
    return [...state.wallet].reverse().slice(0, n);
  }

  /** Bir turdeki net akis (gelir - gider). */
  static net(state: WalletState, kind: WalletKind): number {
    const cell = state.walletTotals[kind];
    return cell === undefined ? 0 : cell.inflow - cell.outflow;
  }

  /**
   * Son `turns` turdaki haftalik ortalama net akis.
   *
   * `:cuzdan` masasindaki "bu gidisle ne olur" satirinin girdisi. Defter
   * siniri yuzunden eksik olabilir; o zaman elde olan kadariyla hesaplar
   * -- yanlis bir sayi vermektense dar bir pencere daha durusttur.
   */
  static weeklyNet(state: WalletState, turns = 40): number {
    const since = state.turn - turns;
    const window = state.wallet.filter((e) => e.turn > since);
    if (window.length === 0) return 0;
    const span = Math.max(1, Math.min(turns, state.turn - window[0]!.turn + 1));
    return window.reduce((sum, e) => sum + e.amount, 0) / span;
  }
}

function numberOf(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}
