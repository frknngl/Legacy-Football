/**
 * TELEFON -- veri modeli.
 *
 * TASARIM KARARI (denetimden): telefon once VERI olarak insa edilir,
 * gorsel sonra. Motorun kurucu ilkesi UI-bagimsizlik; 3D bir telefon ise
 * bir render problemidir. Model kurulunca terminal onu liste olarak
 * basar, bir web arayuzu kart olarak cizer, 3D bir sahne ekrana doku
 * olarak yansitir -- ucu de AYNI modeli okur ve motor hicbirini bilmez.
 *
 * Sira tersine cevrilirse (once 3D) motorun icine gorsel varsayimlar
 * sizar ve proje geri donulemez sekilde bir UI projesine doner.
 *
 * TURETILMIS, DEPOLANMIS DEGIL: besleme kariyerin kendi verisinden
 * (mac reytingleri, cuzdan hareketleri, bayraklar, aktorler) hesaplanir.
 * Bunun iki faydasi var:
 *   1. `GameState`e yeni alan girmez -- kayit gocu gerekmez
 *   2. Besleme kariyerle KENDILIGINDEN tutarli kalir; ayrica beslenen
 *      bir kutu olsaydi gunun birinde gercekle celisirdi
 */

/** Besleme akisindaki tek bir gonderi. */
export interface FeedItem {
  readonly id: string;
  /** Kim yazdi: taraftar, gazeteci, kulup, marka. */
  readonly source: FeedSource;
  readonly text: string;
  /** Kac tur once. 0 = bu hafta. */
  readonly turnsAgo: number;
  /**
   * Tonu: oyuncunun kendini nasil hissettirdigi.
   * UI bunu renk/ikon olarak gosterebilir ama zorunda degil.
   */
  readonly tone: FeedTone;
}

export type FeedSource = 'taraftar' | 'basin' | 'kulup' | 'marka' | 'yakin';
export type FeedTone = 'olumlu' | 'notr' | 'olumsuz';

/** Bir kisiyle yazisma basligi. */
export interface Thread {
  readonly slotId: string;
  readonly name: string;
  /** Son mesajin ozeti -- liste gorunumu icin. */
  readonly preview: string;
  /** 0-100. Iliskinin durumu; UI bunu renk olarak gosterebilir. */
  readonly relation: number;
  /** Kac tur once konusuldu. Uzun sessizlik bir sinyaldir. */
  readonly silentTurns: number;
  readonly unread: boolean;
}

/** Ust bardaki bildirim. */
export interface Notice {
  readonly id: string;
  readonly text: string;
  readonly urgent: boolean;
}

export interface PhoneModel {
  readonly feed: readonly FeedItem[];
  readonly threads: readonly Thread[];
  readonly notifications: readonly Notice[];
  readonly unread: number;
  /** Takipci sayisi -- profil basligi. */
  readonly followers: number;
}

/**
 * TAKIPCI HEDEFI -- sohret ve medya gorunurlugunun sonucu.
 *
 * Takipci sayisi kendiliginden buyuyen bir sayac olmamali; oyuncunun
 * kariyerinin bir YANSIMASI olmali. Bilinmeyen bir cirakla efsanenin
 * arasinda uc buyukluk mertebesi var.
 */
export function followerTarget(fameIndex: number, mediaStanding: number, fans: number): number {
  const fame = Math.max(0, Math.min(1, fameIndex));
  const media = Math.max(0, Math.min(100, mediaStanding)) / 100;
  const support = Math.max(0, Math.min(100, fans)) / 100;
  // 5.000 (kimse tanimiyor) -> ~12.000.000 (efsane, temiz, sevilen)
  const scale = 0.25 + fame * 0.55 + media * 0.1 + support * 0.1;
  return Math.round(5_000 * Math.pow(2_400, scale));
}

/** Haftalik takipci kaymasi -- boslugun yuzde besi, ani ziplama yok. */
export function followerDrift(current: number, target: number): number {
  const gap = target - current;
  if (Math.abs(gap) < 100) return 0;
  return Math.round(gap * 0.05);
}
