/**
 * KULUP EKONOMISI -- gelir, gider, kasa ve transfer butcesi.
 *
 * NEDEN VAR:
 *   Denetimde nedensellik zincirinin iki halkasi NOT IMPLEMENTED cikti:
 *     Lig sirasi -> gelir        (yoktu)
 *     Gelir -> gelecek butce     (yoktu)
 *   `club.budget_transfer` veritabaninda SABIT bir sayiydi ve kariyer
 *   boyunca hic degismiyordu. Sportif basari ekonomiye, ekonomi de gelecek
 *   transferlere hic donmuyordu -- dunyanin en buyuk eksik dongusu buydu.
 *
 * NEDEN KARIYER DURUMU, world.db DEGIL:
 *   world.db SALT OKUNUR ve kariyer boyunca degismez; ayni dunyada yirmi
 *   kariyer oynanir ve her birinde ekonomi FARKLI gelismelidir. Bu yuzden
 *   finans `TransferOverlay` ile ayni yerde durur: veritabanindan
 *   TOHUMLANIR, bellekte yasar, kariyerle birlikte olur.
 *
 * NEDENSELLIK YAPISI (kasitli):
 *
 *   ticari gelir  <- KADRO DEGERI, ama ALTDOGRUSAL (^0.85)
 *   prim          <- LIG ITIBARI + SEZON SONU SIRASI + kupalar
 *   maas faturasi <- KADRO DEGERI, DOGRUSAL
 *
 *   Altdogrusal gelir + dogrusal maas = KENDILIGINDEN FRENLI bir sistem.
 *   Kadro degerini iki katina cikaran kulubun maasi iki katina cikar ama
 *   geliri yalnizca ~%80 artar. Bu, denetimin acikca sordugu "economic
 *   snowball" sorusunun yapisal cevabidir: buyume kendi maliyetini uretir.
 *
 *   Degisken kismi PRIM tasir -- yani "basari -> gelir" baglantisi.
 *   Kucuk bir kulup icin lig sampiyonlugu donusturucudur; dev bir kulup
 *   icin gelirinin kucuk bir yuzdesidir. Gercek futbolda da oyledir.
 */

/** Bir kulubun o andaki mali durumu. */
export interface ClubBooks {
  /** Kasa. Negatif olabilir -- borclu kulup gercek bir durumdur. */
  cash: number;
  /** Gecen sezonun toplam geliri. Butce bunun uzerinden hesaplanir. */
  revenue: number;
  /** Gecen sezonun maas faturasi. */
  wages: number;
  /** Bu sezon harcanabilecek transfer butcesi. */
  budget: number;
  /** Sezon ici net transfer hareketi -- rapor icin. */
  netTransfers: number;
}

export interface ClubFinanceDeps {
  /** Kuluplerin baslangic durumu -- world.db'den. */
  readonly clubs: readonly {
    readonly id: string;
    readonly budgetTransfer: number;
    readonly reputation: number;
  }[];
  /** Kulubun GUNCEL kadro degeri. Transferden sonra degisir. */
  readonly squadValueOf: (clubId: string) => number;
  /** Kulubun oynadigi ligin itibari (0-100). */
  readonly leagueReputationOf: (clubId: string) => number;
}

/**
 * TICARI GELIR OLCEGI.
 *
 * `kadroDegeri^0.85 * k` seklinde. Us 1'den kucuk oldugu icin buyume
 * getirisi azalir; katsayi gercek futbolun maas/gelir oranlarina gore
 * secildi:
 *
 *   kadro 1.42 milyar -> gelir ~700M · maas 570M -> maas/gelir %81
 *   kadro   59 milyon -> gelir ~47M  · maas  24M -> maas/gelir %50
 *   kadro   12 milyon -> gelir ~12M  · maas   5M -> maas/gelir %40
 *
 * Gercek futbolda da devler dar marjla, kucukler genis marjla calisir.
 */
const COMMERCIAL_EXPONENT = 0.85;
const COMMERCIAL_SCALE = 11.6;

/** Maas faturasi kadro degerinin sabit orani -- `pipeline/budgets.ts` ile ayni. */
const WAGE_RATE = 0.4;

/**
 * MAAS DISI ISLETME GIDERI -- gelirin orani.
 *
 * OLCULEN SORUN: ilk surumde yalnizca maas gideri vardi. 50 sezonluk
 * olcumde kasa ortancasi 2 MILYARA cikti (en fakir kulup bile 530M) --
 * her kulup her sezon buyuk kar ediyordu. Gercek futbolda kulupler
 * basabasa yakin calisir: gelirin ~%90-95'i gider.
 *
 * Stadyum, teknik heyet, akademi, seyahat, amortisman -- hepsi burada.
 * Gelirin orani olarak modellenir cunku buyuyen kulubun isletmesi de
 * buyur.
 *
 * Marj DEVLERDE DAR, kucuklerde genis kalir: gelir altdogrusal, maas
 * dogrusal oldugu icin buyuk kulubun maas/gelir orani zaten yuksektir.
 * Gercek futbolda da oyledir -- ve bu, buyumenin kendi frenidir.
 */
const OPERATING_RATE = 0.34;

/**
 * LIG PRIMI.
 *
 * Sampiyon tabanin iki kati, sonuncu yarisi alir. Lig itibari KARESIYLE
 * girer: zayif bir ligin sampiyonlugu guclu bir ligin sampiyonlugu kadar
 * para etmemeli, yoksa kucuk liglerde kalmak ekonomik olarak avantajli
 * hale gelir.
 */
const PRIZE_BASE = 45_000_000;

/** Kupa / kita turnuvasi sampiyonlugu primi -- lig itibariyla olcekli. */
const TROPHY_BONUS = 25_000_000;

/**
 * BUTCE TAVANI ve TABANI.
 *
 *   tavan: gelirin %80'i. Kasa biriktirmek sonsuz butce URETMEMELI --
 *          denetimin "runaway growth" sorusunun ikinci freni.
 *   taban: 2M. Hicbir kulup transfer yapamayacak kadar fakir kalmamali;
 *          "dead club" olusmasini engelleyen kapi budur.
 */
const BUDGET_FROM_CASH = 0.25;
const BUDGET_FROM_REVENUE = 0.2;
const BUDGET_CAP_RATIO = 0.8;
const MIN_BUDGET = 2_000_000;

/**
 * KASA TAVANI -- yillik gelirin kati.
 *
 * OLCULEN SORUN: isletme gideri eklendikten sonra bile kasa 50 sezonda
 * ortanca 810M'e cikiyordu (yillik marj ~%5 -- gercekci, ama 50 sezon
 * boyunca birikiyor). Sonucu daha ince bir kusurdu: kasa o kadar
 * buyuyordu ki butce HER ZAMAN tavana (gelirin %80'i) carpiyor ve
 * `cash` hicbir seyi etkilemiyordu. Yani hesaplanan ama hicbir sonucu
 * olmayan bir durum -- denetimin "COSMETIC / DEAD SYSTEM" dedigi sey.
 *
 * Gercek kulupler kari dagitir ya da modellenmedigimiz altyapiya yatirir.
 * Tavan bunu temsil eder ve kasayi butcenin GERCEKTEN duyarli oldugu
 * araliga geri ceker: kasasi dusuk kulup gelirinin ~%25'ini, kasasi dolu
 * kulup ~%58'ini transfere ayirabilir.
 */
const CASH_CAP_RATIO = 1.5;

export interface SeasonFinanceInput {
  /** Lig -> sezon sonu sirasi (1'den baslayarak kulup kimlikleri). */
  readonly standings: ReadonlyMap<string, readonly string[]>;
  /** Bu sezon kupa/kita sampiyonu olan kulupler. */
  readonly trophyWinners: readonly string[];
}

export class ClubFinance {
  private readonly books = new Map<string, ClubBooks>();

  constructor(private readonly deps: ClubFinanceDeps) {
    for (const club of deps.clubs) {
      // BASLANGIC: veritabanindaki butce kariyerin ilk sezonunu besler.
      // Kasa o butcenin bir katiyla baslar -- sifirdan baslamak butun
      // kulupleri ilk sezon transfer yapamaz hale getirirdi.
      this.books.set(club.id, {
        cash: club.budgetTransfer,
        revenue: 0,
        wages: 0,
        budget: club.budgetTransfer,
        netTransfers: 0,
      });
    }
  }

  /** Bir kulubun defteri. Bilinmeyen kulup icin bos defter doner. */
  booksOf(clubId: string): ClubBooks {
    return (
      this.books.get(clubId) ?? {
        cash: 0,
        revenue: 0,
        wages: 0,
        budget: MIN_BUDGET,
        netTransfers: 0,
      }
    );
  }

  budgetOf(clubId: string): number {
    return this.books.get(clubId)?.budget ?? MIN_BUDGET;
  }

  /**
   * Transfer parasini tasir.
   *
   * Alan oder, satan kazanir -- ve satan parayi AYNI pencerede kullanabilir.
   * Butce hemen guncellenir; kasa sezon sonunda mutabakata girer.
   */
  recordTransfer(fromClubId: string, toClubId: string, fee: number): void {
    const buyer = this.books.get(toClubId);
    if (buyer) {
      buyer.budget -= fee;
      buyer.netTransfers -= fee;
    }
    const seller = this.books.get(fromClubId);
    if (seller) {
      seller.budget += fee;
      seller.netTransfers += fee;
    }
  }

  /** Bir kulubun yillik ticari geliri -- kadro degerinden ALTDOGRUSAL. */
  commercialRevenue(clubId: string): number {
    const squad = Math.max(1, this.deps.squadValueOf(clubId));
    return Math.round(COMMERCIAL_SCALE * squad ** COMMERCIAL_EXPONENT);
  }

  /** Maas faturasi -- kadro degerinden DOGRUSAL. */
  wageBill(clubId: string): number {
    return Math.round(this.deps.squadValueOf(clubId) * WAGE_RATE);
  }

  /**
   * Sezonu kapatir: gelir yazilir, maas odenir, gelecek sezonun butcesi
   * belirlenir.
   *
   * SIRA ONEMLI: prim sezon sonu SIRASINDAN gelir, yani `LeagueModel`
   * tablosu sifirlanmadan ONCE cagrilmali.
   */
  closeSeason(input: SeasonFinanceInput): void {
    // Kulup -> sirasi ve lig buyuklugu.
    const placement = new Map<string, { position: number; size: number }>();
    for (const order of input.standings.values()) {
      order.forEach((clubId, i) => {
        placement.set(clubId, { position: i + 1, size: order.length });
      });
    }
    const trophies = new Set(input.trophyWinners);

    for (const [clubId, books] of this.books) {
      const leagueRep = this.deps.leagueReputationOf(clubId) / 100;

      const commercial = this.commercialRevenue(clubId);
      const prize = this.prizeFor(clubId, placement, leagueRep);
      const trophyBonus = trophies.has(clubId)
        ? Math.round(TROPHY_BONUS * leagueRep * leagueRep)
        : 0;

      const revenue = commercial + prize + trophyBonus;
      const wages = this.wageBill(clubId);
      const operating = Math.round(revenue * OPERATING_RATE);

      books.revenue = revenue;
      books.wages = wages;
      books.cash += revenue - wages - operating + books.netTransfers;
      books.netTransfers = 0;
      // Kar dagitimi / modellenmeyen altyapi yatirimi.
      books.cash = Math.min(books.cash, Math.round(revenue * CASH_CAP_RATIO));

      // GELECEK SEZONUN BUTCESI: kasanin bir kismi + gelirin bir kismi,
      // gelirin %80'i ile TAVANLI. Tavan olmasa kasa biriktiren bir kulup
      // birkac sezonda dunyayi satin alirdi.
      const raw = books.cash * BUDGET_FROM_CASH + revenue * BUDGET_FROM_REVENUE;
      books.budget = Math.max(
        MIN_BUDGET,
        Math.min(Math.round(raw), Math.round(revenue * BUDGET_CAP_RATIO)),
      );
    }
  }

  /**
   * LIG PRIMI -- sezon sonu sirasindan.
   *
   * Sampiyon tabanin iki katini, sonuncu yarisini alir. Bu, denetimin
   * "Lig sirasi -> gelir" olarak NOT IMPLEMENTED isaretledigi halkadir.
   */
  private prizeFor(
    clubId: string,
    placement: ReadonlyMap<string, { position: number; size: number }>,
    leagueRep: number,
  ): number {
    const spot = placement.get(clubId);
    if (!spot || spot.size <= 1) return 0;
    const share = 2 - 1.5 * ((spot.position - 1) / (spot.size - 1));
    return Math.round(PRIZE_BASE * leagueRep * leagueRep * share);
  }

  /** Denetim ve rapor icin: butun defterler. */
  all(): ReadonlyMap<string, ClubBooks> {
    return this.books;
  }
}
