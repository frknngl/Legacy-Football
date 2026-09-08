/**
 * SES KURALLARI -- sahnenin AGZIYLA kapilamasinin uyusmasi.
 *
 * Olculen hata:
 *   16 yasindaki, hicbir sohreti olmayan bir oyuncuya ikinci haftada su
 *   sahneler cikiyordu --
 *     * "takimin en kidemli, en az konusan savunma oyuncusu" olarak tarif
 *       edildigi bir sahne
 *     * kadro disi birakilan bir gence zarf uzatip "eski kaptanlik bandi"ndan
 *       soz edildigi bir sahne
 *     * kaptanin omzuna elini koyup prim teklif ettigi bir sahne
 *
 *   Uygunluk filtresi DOGRU calisiyordu: bu olaylar kendilerini
 *   `eras: [rookie, ...]` ve `stature` kapisi OLMADAN ilan etmisti. Yani hata
 *   motorda degil, icerigin kapilamasindaydi.
 *
 * NEDEN OTOMATIK KURAL:
 *   "Bu sahne kidemli agziyla mi yazilmis" sorusu insan yargisi gerektirir ama
 *   IZLERI makineyle yakalanabilir: yalnizca kidemli birinin yapabilecegi
 *   eylemler (zarf/prim uzatmak, kendi ekipmanini vermek, birini kenara cekip
 *   taktik anlatmak) ve kidemi dogrudan soyleyen tanimlar.
 *
 *   Kural KESIN degil, ISARETLEYICI: bilincli istisnalar `lint.ignore` ile
 *   muaf tutulur ve gerekce yazmak ZORUNLUDUR.
 */

import { allNodes } from '../../domain/story.js';
import { finding, isWaived, type Finding, type RuleContext, type ValidationRule } from '../Rule.js';

/** Bu sohret seviyelerinde oyuncu heniz "kimse" degildir. */
const JUNIOR: readonly string[] = ['nobody', 'local_talent'];

interface Marker {
  readonly pattern: RegExp;
  readonly label: string;
  /**
   * Yalnizca OTORITE oznesi olan olaylarda anlamli.
   *
   * "Omzuna elini koy" kaptana yapilirsa akran muamelesidir; cocukluk
   * arkadasina yapilirsa her yasta mesrudur. Olay kimligi ozneyi zaten
   * tasiyor (`evt_<kategori>_<slot>_<beat>`), bu yuzden ayirt etmek icin
   * baska bir sinyale gerek yok.
   */
  readonly authorityOnly?: boolean;
}

/** Olay kimliginde gecerse sahnenin oznesi bir otorite figurudur. */
const AUTHORITY_SLOTS: readonly string[] = [
  'captain',
  'manager',
  'president',
  'sporting_director',
  'star_teammate',
  'veteran',
  'assistant',
  'national_manager',
  'national_captain',
];

function hasAuthoritySubject(eventId: string): boolean {
  return AUTHORITY_SLOTS.some((slot) => eventId.includes(slot));
}

/**
 * ANLATIDA gecen, HERO'YU kidemli diye tarif eden ifadeler.
 *
 * Bunlar sahnenin oznesi hakkindadir: "takimin en kidemli oyuncusu" ya da
 * "senin eski kaptanlik bandin" 16 yasindaki biri icin yazilamaz.
 */
const NARRATION_MARKERS: readonly Marker[] = [
  { pattern: /en k[ıi]demli|en tecrübeli oyuncu/iu, label: 'kidemli diye tarif edilmek' },
  { pattern: /eski kaptanl[ıi]k band/iu, label: 'eski kaptan oldugu ima ediliyor' },
];

/**
 * SECENEKTE gecen, yalnizca kidemli birinin yapabilecegi EYLEMLER.
 *
 * NEDEN SADECE SECENEK:
 *   Secenek metni Hero'nun EYLEMIDIR; anlati baskasinin eylemi olabilir.
 *   Ilk surumde yalnizca "zarf" kelimesi araniyordu ve 37 isaretin 35'i
 *   yanlis alarmdi: mafya tahsilat yaparken de, baba mektup getirirken de
 *   zarf geciyor. Kidem gostergesi zarfin VARLIGI degil, Hero'nun onu
 *   VERMESI. Kurt masali anlatan bir kural, kuralsizliktan kotudur.
 *
 * NEDEN FIIL SART:
 *   "zarfi eline tutustur" kidemdir; "zarfi al" degildir.
 */
const GIVE = '(uzat|tutuştur|bırak|ver|sun|kaydır|iliştir)';

const CHOICE_MARKERS: readonly Marker[] = [
  // NOT: "zarf uzatmak" / "prim ceki vermek" BILINCLI olarak listede DEGIL.
  // Para vermek kidem gostergesi degil SERVET gostergesidir; caylak da rusvet
  // verebilir. Onu kapilamasi gereken sey `stature` degil, secenek uzerinde
  // `requires: { flag: "servet", op: "gte", ... }`. Ilk surumde bu isaret
  // vardi ve 37 uyarinin 35'i yanlis alarmdi.
  { pattern: /prim pazarl[ıi]ğ[ıi]na dair/iu, label: 'prim pazarligi yurutmek' },
  { pattern: new RegExp(`kramponlar[ıi](m[ıi])?[^.!?]{0,30}${GIVE}`, 'iu'), label: 'kendi ekipmanini vermek' },
  { pattern: /kaptanl[ıi]k band[ıi]n[ıi][^.!?]{0,30}(uzat|ver|devret)/iu, label: 'kaptanlik bandini devretmek' },
  { pattern: /kenara çek[a-zıi]*[^.!?]{0,30}(taktik|plan|konuş)/iu, label: 'kenara cekip taktik vermek' },
  { pattern: /tak[ıi]m[ıi]n eksikler[ıi]n[ıi][^.!?]{0,30}(tart[ıi]ş|anlat|göster)/iu, label: 'taktik dersi vermek' },
  { pattern: /taktik analiz seans[ıi]na başla/iu, label: 'taktik dersi vermek' },
  {
    // "antrenman notlarini ve taktik cizelgelerini ona uzat" -- ayrilan
    // kidemlinin mirasini devretmesi. Caylagin devredecek mirasi yoktur.
    pattern: /(antrenman not|taktik çizelge|kariyer[ıi]n[ıi]n birikim)[^.!?]{0,40}(uzat|ver|devret|b[ıi]rak)/iu,
    label: 'miras devretmek',
  },
  {
    // "yanina git, omzuna elini koy" -- otoriteye AKRAN muamelesi. Ilk 11'de
    // olmak yetmez; bu bir yas/kidem meselesidir.
    pattern: /omz?un[ua] elini koy|omuzuna elini koy/iu,
    label: 'otoriteye akran muamelesi',
    authorityOnly: true,
  },
];

/**
 * Sahnenin agzi ile sohret kapisi uyusmuyor.
 *
 * Kidemli eylem iceren bir sahne `nobody`/`local_talent` seviyesine acik
 * kalmamali. Cozum tek satir: `"stature": ["starter", ...]`.
 */
export const SeniorVoiceRule: ValidationRule = {
  name: 'SeniorVoiceRule',
  defaultSeverity: 'warn',
  description: 'Kidemli agziyla yazilmis sahne caylaga acik kalmamali',

  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = [];

    for (const event of ctx.events) {
      if (isWaived(event, 'SeniorVoiceRule')) continue;

      // Sohret kapisi caylagi disarida birakiyorsa sorun yok.
      const stature = event.stature;
      const openToJunior =
        stature === undefined || stature.some((s) => JUNIOR.includes(s));
      if (!openToJunior) continue;

      // Era kapisi zaten caylagi disarida birakiyorsa da sorun yok.
      const eras = event.eras;
      if (eras !== undefined && !eras.includes('rookie') && !eras.includes('rise')) continue;

      // `allNodes` [nodeId, node] ikilisi doner.
      const hits = new Set<string>();
      for (const [, node] of allNodes(event)) {
        // Anlati: sahnenin Hero'yu nasil tarif ettigi.
        scan(node.text, NARRATION_MARKERS, hits);
        // Secenek: Hero'nun ne YAPABILDIGI.
        const markers = hasAuthoritySubject(event.id)
          ? CHOICE_MARKERS
          : CHOICE_MARKERS.filter((m) => m.authorityOnly !== true);
        for (const choice of node.choices ?? []) scan(choice.text, markers, hits);
      }
      if (hits.size === 0) continue;

      out.push(
        finding(
          SeniorVoiceRule,
          event,
          `Sahne kidemli agziyla yazilmis (${[...hits].join(', ')}) ama sohret kapisi ` +
            `caylaga acik (${stature === undefined ? 'kapi yok' : stature.join(',')}).`,
          {
            fix:
              'Ya "stature": ["starter","star","superstar","icon","legend"] ekleyin, ' +
              'ya da sahneyi caylak agziyla yeniden yazin. Bilincli istisna icin ' +
              '"lint": { "ignore": ["SeniorVoiceRule"], "reason": "..." }.',
          },
        ),
      );
    }

    return out;
  },
};

function scan(
  text: string | undefined,
  markers: readonly Marker[],
  into: Set<string>,
): void {
  if (text === undefined) return;
  for (const marker of markers) {
    if (marker.pattern.test(text)) into.add(marker.label);
  }
}
