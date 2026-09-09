/**
 * KUMAR VE BAHIS -- saf matematik.
 *
 * NEDEN VAR: `social` kategorisi kumarı ANLATIYORDU ama mekanik yoktu;
 * sahneler `servet`e sabit bir sayı yazıyordu. "Masaya oturdun ve
 * 150.000 kaybettin" bir karar değil, bir cümledir. Karar, MIKTARI
 * oyuncunun seçmesiyle başlar.
 *
 * Bu modul `ValueRef` ilkelinin (Faz 2) ilk gercek musterisidir: bahis
 * tutari `son_bahis_tutari` bayragina yazilir ve icerik onu okuyabilir --
 * "gecen hafta masada biraktigin para kadar" gibi cumleler artik
 * kurulabilir.
 *
 * TASARIM: oyun matematigi ICERIKTE durur (`content/economy/games.json`).
 * Kasanin avantajini ayarlamak kod degisikligi gerektirmemeli, yoksa
 * denemek pahalilasir ve hic denenmez.
 */

/** Bir bahis secenegi: rulet kirmizi, at 3 numara, blackjack "dur". */
export interface BetOption {
  readonly id: string;
  readonly label: string;
  /** Kazanma olasiligi (0-1). */
  readonly chance: number;
  /** Kazanirsa yatirilanin kac katini ALIR (anapara dahil degil). */
  readonly payout: number;
}

export interface GameDefinition {
  readonly id: string;
  readonly label: string;
  /** Masaya oturmak icin gereken en az servet. */
  readonly minWealth: number;
  readonly minStake: number;
  readonly maxStake: number;
  readonly options: readonly BetOption[];
  /** Sahne metni icin kisa aciklama. */
  readonly note?: string;
}

export interface BetResult {
  readonly won: boolean;
  /** Servetteki NET degisim: kayipta negatif, kazancta pozitif. */
  readonly delta: number;
  readonly option: BetOption;
  readonly stake: number;
}

/**
 * Kasanin avantaji: 1 - (olasilik x odeme).
 *
 * Sifir "adil oyun" demektir; pozitif deger kasanin uzun vadede
 * kazandigini gosterir. `GameCatalogRule` her secenegin makul bir
 * avantaj tasidigini denetler -- yazar yanlislikla oyuncunun lehine bir
 * oyun tanimlarsa ekonomi sonsuz para basar.
 */
export function houseEdge(option: BetOption): number {
  return 1 - option.chance * option.payout;
}

/** Bahsin gecerli olup olmadigi -- host'a gosterilecek sebeple. */
export function betRejection(
  game: GameDefinition,
  option: BetOption | undefined,
  stake: number,
  wealth: number,
): string | undefined {
  if (option === undefined) return 'Boyle bir bahis yok.';
  if (wealth < game.minWealth) return `Bu masaya oturmak icin en az ${game.minWealth} TL gerek.`;
  if (!Number.isFinite(stake) || stake <= 0) return 'Gecerli bir tutar gir.';
  if (stake < game.minStake) return `En az ${game.minStake} TL oynanir.`;
  if (stake > game.maxStake) return `En fazla ${game.maxStake} TL oynanir.`;
  if (stake > wealth) return 'Bu kadar paran yok.';
  return undefined;
}

/**
 * Bahsi cozer. `roll` [0,1) araliginda tohumlu bir sayidir.
 *
 * Determinizm sart: ayni tohum + ayni secimler = ayni kariyer. Bu yuzden
 * `Math.random` DEGIL, motorun kendi RNG'si kullanilir.
 */
export function resolveBet(option: BetOption, stake: number, roll: number): BetResult {
  const won = roll < option.chance;
  // Kazanirsa anapara masada kalmaz; net kazanc `stake * payout - stake`.
  const delta = won ? Math.round(stake * option.payout - stake) : -Math.round(stake);
  return { won, delta, option, stake };
}
