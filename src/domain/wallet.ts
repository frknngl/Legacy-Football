/**
 * CUZDAN -- para hareketlerinin veri sekli.
 *
 * OLCULEN SORUN: `servet` tek bir sayiydi. Kariyer boyunca 2,5 binden
 * 10,5 milyona cikiyordu ama "para nereye gitti" sorusu HIC
 * cevaplanamiyordu -- ne oyuncu icin, ne dengeyi olcen icin.
 *
 * Bu, kumar/kredi/varlik mekaniklerinin ONKOSULU: kaybin gorunmedigi bir
 * ekonomide risk almak bir karar degil, gurultudur.
 *
 * Saf veri burada, durum yonetimi `runtime/WalletLedger.ts`te --
 * `domain/chemistry.ts` + `runtime/ChemistryTracker.ts` ile ayni ayrim.
 * `GameState` bir domain tipidir ve alanlarinin tipleri de domain'de
 * durmalidir; aksi halde katman kurali kirilir.
 */

/**
 * Bir hareketin turu.
 *
 * Kategori sayisi bilerek az: her tur `:cuzdan` masasinda ayri bir satir
 * olarak ozetlenir ve yirmi kategori okunmaz hale gelir.
 */
export const WALLET_KINDS = [
  /** Haftalik maas -- `tickEconomy`. */
  'maas',
  /** Menajer komisyonu. */
  'komisyon',
  /** Sozlesme imza bonusu, transfer geliri. */
  'sozlesme',
  /** Kumar, bahis, borsa. */
  'bahis',
  /** Kredi cekimi (+) ve taksit (-). */
  'kredi',
  /** Ev, araba, arsa: alis (-) ve haftalik gider (-). */
  'varlik',
  /** Icerigin yazdigi her sey -- rusvet, hediye, ceza, aile. */
  'olay',
] as const;

export type WalletKind = (typeof WALLET_KINDS)[number];

/** Insan okunur kategori etiketleri -- host'lar bunu gosterir. */
export const WALLET_LABELS: Readonly<Record<WalletKind, string>> = {
  maas: 'Maas',
  komisyon: 'Menajer komisyonu',
  sozlesme: 'Sozlesme ve transfer',
  bahis: 'Kumar ve bahis',
  kredi: 'Kredi',
  varlik: 'Varlik',
  olay: 'Olaylar',
};

export interface WalletEntry {
  readonly turn: number;
  /** Pozitif = gelir, negatif = gider. */
  readonly amount: number;
  readonly kind: WalletKind;
  /** Insan okunur aciklama: "Haftalik maas", "Bahis kaybi". */
  readonly label: string;
  /** Hareketten SONRAKI bakiye -- geriye donuk denetim icin. */
  readonly balance: number;
}

/** Tur bazinda kariyer toplamlari -- defter sinirindan bagimsiz. */
export type WalletTotals = Partial<Record<WalletKind, { inflow: number; outflow: number }>>;

export function isWalletKind(v: unknown): v is WalletKind {
  return typeof v === 'string' && (WALLET_KINDS as readonly string[]).includes(v);
}

/**
 * Defterin GERCEKTEN ihtiyac duydugu durum dilimi.
 *
 * `GameState` bunu yapisal olarak saglar. Daraltmanin sebebi
 * `MutableFlagState` ile ayni: defteri sinamak icin 30 alanlik bir
 * kariyer durumu kurmak gerekmemeli -- ve defter, ihtiyaci olmayan
 * alanlara bagimli olmamali.
 */
export interface WalletState {
  turn: number;
  flags: Readonly<Record<string, number | boolean | string>>;
  wallet: WalletEntry[];
  walletTotals: WalletTotals;
}
