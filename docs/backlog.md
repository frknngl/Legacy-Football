# BACKLOG -- bilerek ertelenenler

Bu dosya "yapilmadi" listesi degil, **karar kaydi**dir. Her madde bir
sebeple ertelendi; sebep yazili olmazsa altı ay sonra kimse neden
yapilmadigini bilemez ve yanlis sirayla acilir.

## 1. Kaleci ve defans mevkileri (ilk surumde KILITLI)

Karar: `content/orchestrator/release.json` -> `lockedPositions`.

Neden kilitli: mevcut 21 mac ani orta saha/forvet dilinde yazilmis.
"Penalti kullan", "gol sevinci", "asist karari" -- bunlar kaleciye
sorulamaz. Acmak, yanlis mevkiye yanlis soru sormak demekti.

Acilmasi icin gereken (kod degil ICERIK):
- **GK**: kurtaris, cikis karari, penalti kurtarma, defansi yonetme
  anlari + kaleci reyting modeli (kurtaris yuzdesi, gol yemeden bitirme).
- **DF**: mudahale, ikili mucadele, ofsayt tuzagi, temiz kale anlari +
  savunma reyting modeli.

Bu ikisi yazildiginda kilit kalkar: `playablePositions` dizisine
eklenir, TypeScript'e dokunulmaz.

Ara cozum bugun calisiyor: `immigrant` ve `latebloom` arketipleri DF
olarak tasarlanmisti; `positionFallback` onlari MF'e dusuruyor.
Arketipin hikayesi korunuyor, sahadaki rolu degisiyor.

## 2. Kaleci transferlerinin fazlaligi (~%39)

Olculdu, kok neden bulundu, **kismen** duzeltildi.

Kok neden motorun kendi `POSITION_WEIGHTS` tablosu: kaleci `overall`
degeri 87'de tavan yaparken forvet 94'e cikiyor. Kiyaslama esigi
mevki-ici yapildiginda kaleciler surekli "kadronun en iyisinden daha
iyi" gorunuyor.

%100 -> %61 -> %39 (kiyaslama esigi mevki basina kulup-en-iyisi
ortalamasina cevrildi). Kalan %39 hala gercekci degil (gercek piyasada
~%8-10 olmali) ama duzeltmek `POSITION_WEIGHTS`'i degistirmeyi, o da
tum reyting modelini yeniden kalibre etmeyi gerektiriyor. Mevki kilidi
(madde 1) zaten kaleciyi oynanamaz yaptigi icin bu, oynanisi bugun
etkilemiyor -- once GK moment seti yazilmali, sonra bu.

## 3. Rakibe transfer -- yapilan ve yapilmayan

**Yapildi:**
- `club.rival_club_id` ithalat sirasinda turetiliyor
  (`tools/roster/pipeline/rivalries.ts`): once sehir derbisi, sonra lig
  ici itibar yakinligi. 300/303 kulup eslesti.
- `RIVAL_PREMIUM = 2.2` -- rakibe satis fiyati iki kattan fazla.
  Imkansiz degil, olaganustu.
- `Transfer.toRival` bayragi; NPC piyasasi bunu isaretliyor.
- `WorldEvent { kind: 'transfer', toRival }` -- motor tarafi. Rakibe
  gecis `mem_rakibe_transfer` iznini kaliciya yaziyor, taraftar
  destegini -35, medya baskisini +30 vuruyor.
- `evt_transfer_rakibe_gecis_hesaplasma` -- tesis cikisinda taraftar
  lideriyle yuzlesme.

**Yapilmadi (ve nedeni):**
- **Hero'nun transferi henuz motor tarafindan SURULMUYOR.** Hero
  `protectedPlayerIds` icinde; kulup degisikligi ancak host
  `reportWorldEvent({kind:'transfer'})` cagirdiginda oluyor. Yani
  yukaridaki zincirin tetigi su an CLI'da degil. Menajer sistemi
  (A1-A3) bunu baglayacak -- dogru sira bu, cunku Hero'nun transferini
  konusan taraf menajerdir.
- **Rakibe gecis sonrasi ILK DERBI sahnesi** yazilmadi. En degerli an
  bu ama `mem_rakibe_transfer` + "eski kulubune karsi mac" kesisimini
  gerektiriyor; ikincisi icin takvimin fikstur bilgisini icerige
  acmasi lazim. Ayri bir is.
- Rakiplik turetmesi **tarihsel degil yapisal**: Arsenal'in gercek
  rakibi Tottenham, bizim turetmede Manchester City (itibarca en
  yakin). Kaynakta sehir alani bos oldugu icin sehir derbisi kurali
  neredeyse hic calismiyor. Duzeltmesi: `mask-rules.json` gibi elle
  yazilmis bir `rivalry-overrides.json`. Veri isi, kod isi degil.

## 4. Menajer sistemi (A1-A3) -- yapilan ve yapilmayan

**Yapildi:**
- `world.db.agent` tablosu (sema v4), `tools/roster/agent-pool.json`,
  `tools/roster/pipeline/agents.ts`. 96 menajer uretildi. Yeni arketip
  eklemek TypeScript degil JSON degistirmeyi gerektirir (hakem hattinin
  ayni deseni).
- `src/domain/agent.ts`: erisim uyumu, arketip egilimi, memnuniyet
  dongusu, komisyon pazarligi, fesih bedeli.
- `GameState.agent` + `formerAgents`; motor API'si: `agentOptions`,
  `signAgent`, `releaseAgent`, `negotiateCommission`, `rollAgentOffer`,
  `reportAgentOutcome`, `closeAgentSeason`.
- `play.ts` haftalik dongusune bagli: pencerede menajer listesi, teklif
  zari, kabul/ret ve rakip tespiti.
- 23 test. En kritigi: hicbir arketip her eksende iyi degil.

**Yapilmadi (ve nedeni):**
- **Menajer icerigi YOK.** Sistem calisiyor ama tek bir menajer sahnesi
  yazilmadi: memnuniyet 30'un altina dustugunde uyari sahnesi cikmiyor,
  yalnizca bir satir bildirim dusuyor. `agent` slotu bagli, yani
  `{actor.agent.name}` calisiyor -- icerik yazilmayi bekliyor.
- **Sezon sonu dongusu bagli degil.** `closeAgentSeason` var ama
  `play.ts` sezon gecisinde cagirmiyor; `seasonsTogether` bu yuzden
  hep 0 kaliyor ve pazarlikta sadakat primi hic devreye girmiyor.
- **Memnuniyet kalibrasyonu tam sezon boyunca olculmedi.** Olculen:
  developer arketipi bir basarisiz pazarlik + iki redde birakiyor.
  Tasarim dokumanindaki formul bu; ama `transfer_done` (+25) ve
  `season_in_form` (+8) telafileri gercek bir kariyerde yeterli mi
  bilinmiyor. Ilk uzun playtestte olculmeli.
- **Fesih bedelini kimse ODEMIYOR.** `terminationFeeNow` tutari
  soyluyor, `releaseAgent` durumu temizliyor, ama parayi hangi
  bayraktan dusecegine karar veren taraf yok. Ekonomi modulu (Faz G)
  baglayacak.
- **NPC oyuncularin menajeri yok.** Tablo dunyanin parcasi, yani teknik
  olarak mumkun; ama `TransferMarket` menajer okumuyor. NPC transferi
  su an komisyonsuz.

## 4b. VERI KAYBI -- 175 varyant silindi (2026-09-08)

**Ne oldu:** `npm run author -- unvariant --dry-run` calistirildi. Komuta
`--dry-run` bayragi eklenmisti ama kodun YAZMA yolu degistirilmemisti --
yama docstring'e uygulandi, govdeye uygulanmadi ve sessizce basarisiz
oldu. Eski yikici kod calisti ve 88 olayda `v_asil` disindaki TUM
varyantlari sildi. Proje git deposu degil; yedek yok.

**Kayip:** 344 -> 169 varyant. Kullanicinin kalite standardi olarak
onayladigi `v_cenaze` dahil.

**Kaybedilmeyen:** 165 olayin hepsi ayakta (her biri `v_asil` sahnesiyle),
0 dogrulayici hatasi, 382/382 test.

**Kurtarilan:** `v_cenaze` tam metni konusma kaydinda oldugu icin birebir
geri yazildi. Diger 174'un metni hicbir yerde yok.

**Kok neden:** yikici bir komut, yamanin uygulandigi DOGRULANMADAN
calistirildi.

**Alinan onlem:** `cmd_unvariant` artik varsayilan olarak HICBIR SEY
yazmiyor; yikici yol `--force` istiyor, silinecek varyantlari tek tek
yazdiriyor, `--keep` ile secici koruma var ve silme sonrasi dogrulayici
calisiyor. Bayraksiz cagriyla test edildi: 0 yazma.

**Ders:** bir dosyaya yapilan degisikligin uygulandigini varsayma --
ozellikle degisiklik bir GUVENLIK onlemiyse ve komut geri alinamazsa.
`replace` sessizce basarisiz olur; `grep` ile dogrula.

## 4c. STATURE MERDIVENININ UC KADEMESI OLUYDU -- duzeltildi

Milli takim olaylarim olu cikinca sebebini kazdim ve kok neden icerikte
degil MOTOR KABLOLARINDA cikti.

**Stature formulu** (`progression.json`): `taraftar_destegi` (1) +
`medya_itibari` (1) + `kupa_sayisi` (**25**) + `milli_mac_sayisi` (1.5)
+ piyasa degeri ve takipci (kucuk katsayilar).

Ilk iki bayrak 100'de tavan yapar -> **200 puan**. Esikler: `star` 220,
`superstar` 330, `icon` 460, `legend` 620. Yani kupa ve milli mac
olmadan `star` bile zor, ustu IMKANSIZ.

**Bulunan uc kopuk kablo:**

1. **`kind: 'trophy'` motorda tanimliydi ama HICBIR host bildirmiyordu.**
   `kupa_sayisi` her kariyerde 0 kaliyordu -- formulun en agir girdisi.
2. **Hicbir host `finishSeason()` cagirmiyordu.** Lig sampiyonu hic
   hesaplanmadi, kume dusme/cikma hic olmadi, dunya otuz sezon DONUK
   kaldi. `SeasonRunner` sampiyonlari yalnizca kupa ve Avrupa icin
   yaziyordu; lig sampiyonu `LeagueModel.finishSeason()`ta duruyor ve
   kimse okumuyordu.
3. **Milli davet kapisi hic cagrilmiyordu.** `demo.ts` disinda hicbir
   yerde `national_call` yok; `milli_mac_sayisi` 0, `national_duty`
   hayat durumu hic acilmiyor -- o duruma kapili icerik de olu.

**Yapilan:** `advanceWeek` artik hero'nun o hafta kazandigi kupalari
donduruyor (veri zaten uretiliyordu, atiliyordu). `play.ts`,
`simulate.ts` ve `playtest.ts` sezon donusunde `finishSeason()`
cagirip lig sampiyonlugunu, milli ara haftalarinda (5,11,17,26,33)
`calledUp()` ile daveti bildiriyor.

**Olculen etki (3 tohum x 900 tur):**

| | Once | Sonra |
|---|---|---|
| `kupa_sayisi` | 0 (hep) | 0 -> 4 |
| `milli_mac_sayisi` | 0 (hep) | 0 -> 156 |
| `national_duty` durumuna ulasan | 1/6 | 2/3 |
| `star` seviyesine ulasan | 1/6 (tur 677) | **3/3** |
| `superstar` seviyesine ulasan | **hicbiri** | 1/3 |

Ders: "icerik olu" tanisi cogu zaman yanlis yerde arattirir. Uc kademe
olu iceriginin sebebi tek bir olay dosyasi degil, uc cekilmemis kabloydu.

## 4d. Test kosusu ile uretim CAKISIR

`npx vitest run` arka planda varyant uretimi calisirken kosuldu ve
`Fatigue.test.ts` patladi; uretim durunca ayni test gecti. Sebep:
uretim `content/events/` altina yaziyor ve testler o icerigi yukluyor.
Test kosusu ile uretim ayni anda yapilmamali.

## 4e. TEK BIR SAYI UC OLAYI OLDURUYORDU

`evt_legal_betting_investigation` tetigi soyleydi:

    {"flag": "mem_accepted_fixing", "op": "turnsSince", "value": 999999}

`turnsSince` = `currentTurn - setTurn >= n`. 1000 turluk bir kariyerde
999999 **matematiksel olarak imkansiz** -- bir yer tutucu unutulmus.

Zincir su sekilde kopuyordu:

    sike kabul -> [sorusturma HIC ACILMAZ] -> hapis HIC OLMAZ

Ve bu olay `incarcerated` durumuna geciren TEK kapi. Dolayisiyla
`evt_life_prison_cell` ve `evt_life_prison_release` de asla cikmadi.
Uc olay, tek bir sayi yuzunden olu.

Duzeltildi: `value: 14` (yaklasik uc bucuk ay). `mem_accepted_fixing`
zaten `evt_dark_betting_offer` tarafindan yaziliyor, yani zincir artik
tam.

**Kalan kopuk:** `mem_gambling_debt` iki olay tarafindan OKUNUYOR
(`op: isSet`) ama hicbir olay YAZMIYOR. En dogal yer yazdigim kumar
sahneleri (`evt_social_kumarhane` -- sabaha kadar kalma dali). Uretim
o dosyalara dokunabilecegi icin parti bitince yapilacak.

**Ders:** "olu icerik" tanisi bir olayin kendi kapilamasinda aranir ama
sebep cogu zaman ZINCIRIN BASINDA olur. Uc olayin hicbirinde sorun
yoktu; sorun onlari tetikleyen olayin tek bir sayisindaydi.

## 4f. VARYANT URETIMI ZINCIRLERI SESSIZCE KIRIYORDU

Uretimi mac kategorisine acmak icin `momentType` elemesini kaldirdim
(sahne butcesinin %21'i erisim disindaydi). Eksik bir hamleymis.

**Sorun:** mac anlari incident'lerin KAYNAGIDIR (`inc_var_against`,
`inc_scored_penalty`, `inc_injured_in_match`...). Tepki sahneleri ve
uzun zincirler bunlarla tetiklenir. Uretilen varyantlar bu efektleri
HIC tasimadi -- brief yalnizca `mem_*` izlerini kopyaliyordu.

**Sonuc:** motor o varyanti sectiginde mac SONUCSUZ kaliyor. VAR ->
roportaj -> PFDK -> ceza zinciri sessizce oluyor. Hicbir kural
bakmadigi icin 30 varyant **0 hatayla** korpusa girdi; yalnizca zincir
testi patladigi icin fark edildi.

**Olculdu:** 15 mac olayinda 30 varyant incident kaybetmis.

**Yapilan:**
1. Zarar veren 30 varyant silindi (kuru kosuyla dogrulanarak).
2. Python kapisina `expects_incidents` sozlesmesi eklendi -- varyant,
   olayin actigi incident'leri acmak ZORUNDA.
3. `VariantIncidentRule` (severity: error, 31. kural) yazildi. Python
   kapisi yalnizca URETIM yolunu korur; elle yazilan bir varyant da
   ayni hatayi yapabilirdi. Sentetik ihlalle test edildi: yakaliyor.

**Ders:** bir kapiyi acmadan once o kapinin ARKASINDAKI sozlesmeyi
sor. `momentType` elemesi keyfi degildi -- mac anlarinin tasidigi
sozlesme `mem_*`ten ibaret degildi ve brief onu bilmiyordu.

## 4g. GEMINI KOTASI -- proje basina, anahtar basina DEGIL

Uretim gunluk kotayi doldurdu:

    Quota exceeded for metric:
    generativelanguage.googleapis.com/generate_content_free_tier_requests
    limit: 500

Kullanici yeni bir anahtar ekledi ama 429 devam etti. Sebep mesajin
kendisinde: bu limit **proje basina** gunluk 500 istek. Ayni Google
Cloud projesinde acilan ikinci anahtar AYNI kotayi paylasir; taze kota
icin anahtar FARKLI bir projede acilmali.

**Yapilan:** `GeminiProvider` cok anahtarli hale getirildi.
`GEMINI_API_KEY`, `_2`, `_3`, `_4` sirayla okunur; biri 429 verince
BEKLEMEDEN digerine gecilir (kota gunluk oldugu icin beklemek ise
yaramaz). `doctor` kac anahtar bulundugunu yazar -- "yeni anahtar
ekledim ama hala 429" durumu boylece tanilanabilir.
`.env.example` bunu ve proje-basina kota uyarisini belgeliyor.

Dogrulandi: sahte ikinci anahtarla `doctor` "2 anahtar" diyor.

## 5. Olcum: ne biliyoruz

`npm run simulate -- --seeds=6 --turns=900 --world=data/world.db`
(tam kariyer, 6 tohum) ile OLCULDU:

- Kapsama **%91** (132/145 olay), 13 olu olay. Saglikli.
- Dagilim tam kariyerde dengeli: match %21, reaction %12, kalan %67
  hikaye kategorilerinde.
- **Kisa kosular yaniltici**: 120 turluk bir kosuda kapsama %25'e
  duser ve neredeyse her olay "era" ile elenir. Sebep: `rookie` cagi
  16-19 yas, yani 3 sezon boyunca hero cagdan hic cikmaz. Olcum en az
  bir tam kariyer (900 tur) uzerinden yapilmali.

Statik olarak OLCULDU (`content/events` taranarak):

- Icerik **211 bayrak yaziyor, 33 bayrak okuyor**.
- 280 kosul kullaniminin **219'u tek bir bayrak: `liderlik`**. Yani
  kilitli secenek kaliti neredeyse tamamen tek eksene bagli.
- `tukenmislik`, `kondisyon`, `sakatlik_riski`, `form`: dordu de
  yaziliyor, **hicbiri kosul degil**. Yorgunluk sisteminin sesi yok.
- 31 olay `{actor.agent.name}` kullaniyor ama menajer bayraklarini
  (memnuniyet, komisyon) hicbiri okumuyor.

Sonuc: sistemler saglam, **icerik onlari dinlemiyor**. Sonraki her
yeni sistem bu farki buyutur.

### `npm run playtest` -- calisiyor

`src/cli/playtest.ts`. `simulate`den farkli bir soruya cevap verir:
kapsama degil, OYNANIS. Ritim, kilitli secim orani, bayrak yorungesi,
ilerleme hizi, kategori araligi, menajer dongusu.

Yazarken IKI GERCEK HATA cikardi:

**1. Mac ortasinda cokme (`src/cli/runMatch.ts`).**
`ui.onChoiceMade?.(engine.choose(id))` yaziliydi. JavaScript'te
`a?.(b())` ifadesi `a` tanimsizsa `b()`yi HIC calistirmaz -- opsiyonel
cagri argumanlariyla birlikte kisa devre yapar. Yani `onChoiceMade`
vermeyen bir host'ta mac ani secimi sessizce yutuluyordu: dugum
ilerlemiyor, ic dongu 20 kez bosa donuyor, dugum ACIK kaliyor ve bir
sonraki `presentMoment` "onceki mac ani hala acik" diye patliyordu.

`simulate` bu hatayi hic gormedi cunku tesadufen `onChoiceMade`
veriyor. Iki yerde vardi; ikisi de duzeltildi (once cagir, sonra
bildir) ve `tests/MatchMomentDrive.test.ts` ile sabitlendi -- test,
hata geri konuldugunda 2/2 dusuyor.

**2. Hayalet bayrak `sohret` (`GameEngine.heroStanding`).**
Menajer havuzu filtresi `sohret` adli bir bayrak okuyordu. Oyle bir
bayrak projede YOK: `core.json`da kayitli degil, hicbir icerik
yazmiyor. `numberFlag` yoksa 0 dondugu icin hata da vermiyordu; durus
sessizce `clubRep * 0.4`e dusuyor, 89 itibarli kulupteki yildiz 36
puanlik cirak gibi gorunuyordu. Sohret ekseni artik `stature`
(nobody -> legend, 0-100'e olcekli).

### Olcum sonucu (6 tohum x 900 tur, gercek dunya)

| Olcum | Deger | Yorum |
|---|---|---|
| Sessiz hafta | **%35** | Her uc haftadan biri hikayesiz |
| Kilitli secenek | **%1** (177/19531) | Kapi neredeyse hic kapanmiyor |
| `liderlik` | 68 -> **100, sabit** | En cok kullanilan kapi ISLEVSIZ |
| `taraftar_destegi` | -> **100, sabit** | |
| `medya_baskisi` | -> **100, sabit** | |
| `moral` | -> **14** | Tabana suruklenip kaliyor |
| `starter` | tur 19 | Cok erken |
| `star` | tur 677, 1/6 kariyer | Cok gec, cok nadir |

**En onemli iki bulgu:**

1. **`liderlik` 100'e yapisiyor.** Icerikteki 219 kilitli secim
   kosulunun neredeyse tamami bu bayraga bagli (`[Liderlik 65]`).
   Bayrak tavana yapisinca hepsi acilir -- yani oyunun tek gercek
   kapi sistemi kariyerin ortasinda tamamen kayboluyor. Olculen
   kilit orani %1 olmasinin sebebi bu.

2. ~~Kategori araligi ortanca 0 -- sahneler patlamalar halinde
   geliyor.~~ **BU BULGU YANLISTI, GERI CEKILDI.**

   Sebep olcum aracinin kendi kusuruydu: sahneler DUGUM basina
   sayiliyordu, olay basina degil. Tipik bir olay bir `branch` + bir
   `outcome` dugumunden olusur, yani her olay "2 sahne" gorunuyor ve
   ikisi ayni turda oldugu icin aralik 0 cikiyordu. Sayim olay
   bazina cevrildikten sonra gercek tablo:

   | | |
   |---|---|
   | Hikayeli haftada sahne sayisi | **1 sahne: %100** (patlama yok) |
   | `locker` en kisa aralik | 5 hafta (`cadence.json`: 5) |
   | `mind` en kisa aralik | 5 hafta (`cadence.json`: 5) |
   | `dark` en kisa aralik | 6 hafta (`cadence.json`: 6) |

   Kategori sogumasi TAM yapilandirildigi gibi calisiyor; hicbir
   kategori kendi soguma suresinden once tekrar etmiyor. Ritim
   duzeltmesi C1 listesinden CIKARILDI.

   Ders: olcum aracinin kendi kusuru, icerik kusuru gibi raporlanir.
   Bir sayi sasirtici derecede duzenliyse (burada "%94 tam 2 sahne")
   once araci sorgula.

Menajer dongusu icin olculen 152 imza / 151 birakma sayisi **botun
eseri**: bot her tur %50 olasilikla teklif reddediyor, gercek bir
oyuncu boyle sik teklif almaz. Yine de memnuniyet dongusunun
TELAFISININ zayif oldugunu gosteriyor (`season_in_form` +8, buna
karsilik her red -14 ile -26 arasi). Gercek bir oyuncu ritmiyle
yeniden olculmeli.

### C1 / madde 1: `liderlik` doygunlugu -- kismen cozuldu

**Olculen sebep:** icerikte `liderlik` bayragina 237 etki dokunuyor,
**233'u ARTI** (+1113'e karsilik yalnizca -23; toplam dort adet negatif
etki var). Bayrak 50'den basliyor. Icerikteki 219 kilitli secim
kosulunun esikleri ise **55-70 bandinda sikisik**.

**Yapildi -- azalan getiri (`softCap`):** `FlagDefinition.softCap`,
`FlagRegistry.dampen()`, `EffectApplier`'da tek noktada uygulama.
Dizin ustundeki ARTISLAR kalan bosluga gore sonumlenir, azalislar
sonumlenmez ("kazanmak zorlasir, kaybetmek kolay kalir"). Dokuz
doygun bayraga uygulandi. Kod degil veri: `core.json`da bir satir.
`tests/SoftCap.test.ts` (7 test).

**AMA SORUNU COZMUYOR -- durust sayi:**

| softCap | 70 esigini gecmek icin kac "+5" sahnesi |
|---|---|
| yok | 4 |
| 70 | 4 |
| 55 | 5 |

Sebep basit: **kapi bandi tam olarak sonumun basladigi yerde bitiyor.**
En yuksek esik 70; sonum 70'in ustunde devreye giriyor. Yani sonum
yalnizca 70 -> 100 tirmanisini yavaslatiyor, oysa o araligi gateleyen
tek bir kosul bile yok. 900 turluk olcumde bayrak yine 99.8'e cikti.

`softCap` yine de KALSIN: dogru bir kural ve ileride 85-95 bandinda
esik yazilabilmesinin onunu aciyor. Ama tek basina yeterli degil.

**Gercek cozum ICERIK tarafinda ve C1'e ait:**
1. Esikleri 55-70 bandindan cikarip 55-95'e yaymak.
2. `liderlik`e BEDEL eklemek -- su an dort negatif etki var, olmali ki
   yuksek liderligi korumak da bir secim olsun.
3. Alternatif: esikleri mutlak degil `era`ya gore olcekli yapmak
   (cirakta 60, zirvede 85 gibi). Bu motor isi olurdu.

Uc secenek de icerik pasi gerektiriyor; sirali onay kurallarina tabi.

## 6. Icerik uretimi -- PARTI usulu

Kurallar: format cesitliligi, ozgunluk, KARIYER SEVIYESINE uygunluk.
Her olay icin oyun dosyasi + okunabilir metin.

**Haftalik tek sahne BIRAKILDI** (2026-09-08): 30 sezonluk bir oyun icin
anlamsiz bir hiz. Yerine parti usulu -- planlayici cakismasiz hucre
tahsis eder, olaylar toplu yazilir.

### Neden cirak icerigi inceydi -- KOK NEDEN BULUNDU

`tools/authoring/planner.py` icindeki `PROFILES` tablosu, `rookie` cagini
yalnizca `locker` ve `personal` kategorilerinde mumkun sayiyordu. Yani
`dark`, `fandom`, `mind`, `money`, `transfer`de sifir cirak olayi
olmasinin sebebi icerik degil URETICIYDI: planlayici o hucreleri hic
uretmedi, dolayisiyla kimse yazmadi.

Tabloya kanita dayali `rookie` eklendi: `media` (yerel gazete roportaji
-- yazildi, oyunda cikiyor), `fandom` (ilk imza isteyen cocuk), `mind`
(altyapi psikologu), `money` (ilk maas), `transfer` (16 yasinda kiralik),
`business` (ilk sozlesme; slot listesine `sporting_director` ve `mother`
eklendi -- o masada avukat degil VELI oturur).

EKLENMEDI: `dark`/`legal` (bahis, savcilik -- on alti yasinda ucuz olur),
`life` (cag degil SLOT listesi engel: cellmate/guard/prison_mentor cirak
icin anlamsiz; once slot listesi ikiye ayrilmali).

`plan` komutuna `--era` eklendi: belirli bir cagin bosluguna nisan
alinabiliyor. Oncesinde rastgele secim o bosluga nadiren dokunuyordu.

### Planlayicinin SINIRI

Imza cakismasini engelliyor, TUTARLILIGI denetlemiyor. Uretilen
briefler arasinda `evt_personal_child_borc` (16 yasinda cocuk sahibi) ve
`era=rookie` + `life_state=retired` (16 yasinda emekli) vardi. Brief
hucre tahsisi icin kullanilmali, korukorune degil.

### Yazilanlar

| # | Olay | Kategori | Format (oyun / metin) | Konu |
|---|---|---|---|---|
| 1 | `evt_business_ilk_sozlesme_veli` | business | sahne / bilgi metni | Veli imzasi |
| 2 | `evt_media_ilk_roportaj` | media | roportaj / diyalog | Sozlesmeyi okudun mu |
| 3 | `evt_money_ilk_maas` | money | rakam-fis / - | Brut ve net |
| 4 | `evt_mind_doctor_olcum` | mind | rapor / - | Kemik yasi on bes bucuk |
| 5 | `evt_locker_star_teammate_isim` | locker | kisa an / - | Yanlis isimle cagrilmak |
| 6 | `evt_personal_cousin_istek` | personal | istek / - | Kuzen ve tek forma |

Hepsi `npm run author -- ingest` kapisindan gecti; alti da 120 turluk
cirak kariyerinde sahneye cikiyor (olu listesinde yok).

**Kelebek zinciri:** #2, #1'in izini okuyor (`soru_sordu` / `acele_etti`).
#3, #1'in `bekledi` izini okuyor. Yani ilk sozlesmedeki karar iki ayri
sahnede geri donuyor.

### MILLI TAKIM kategorisi acildi

`national` diye bir kategori HIC YOKTU (onceki notumda "0 olay" yaziyordu,
yanlisti -- kategori yoktu). Motor destekliyordu: `national_duty` hayat
durumu, `national_manager` ve `national_captain` slotlari, milli davet
dunya olayi. Yalnizca icerik tarafi bostu.

Acilan: `vocab.py` kategori listesi, `cadence.json` sogumasi (6 --
sezonda bes milli ara var, arada ortalama sekiz hafta; daha kisa soguma
ayni kampta uc sahne cikarirdi), `planner.py` profili (cirak YOK: on
alti yasinda A milli takim gercekci degil), `content/events/national/`.

Yazilan uc olay, uc ayri cagda ve uc ayri soruyla:

| Olay | Cag | Soru |
|---|---|---|
| `evt_national_ilk_forma` | rise/prime | Marsta ne yaparsan bir daha her mac onu yapacaksin |
| `evt_national_kadro_disi` | prime/veteran | Yirmi alti isim, yirmi uc kisilik kagit |
| `evt_national_veda` | veteran/twilight | Veda metnini kim yazacak |

`national_captain` slotu ILK KEZ sahneye cikti (43 slottan hic
kullanilmayan sekizden biriydi).

### STATURE ILERLEMESI icerigi engelliyor -- teyit edildi

Milli olaylardan ikisi ilk yazimda OLU cikti. Sebep cag degil ITIBARDI:
olcum `star` seviyesine 6 kariyerden yalnizca 1'inin ulastigini
gosteriyor (tur 677). Yani `stature: [star, ...]` yazan her olay pratikte
kariyerlerin altida besinde hic cikmiyor.

`author -- widen` araci cagi gevsetmeyi onerdi (`prime,veteran` ->
`rise,...`) ama bu ANLATIYI bozardi: yirmi yasindaki oyuncuya kadro
karari sorulmaz. Bunun yerine itibar esigi `starter`a indirildi --
anlati korunuyor, olay cikiyor.

Asil duzeltme `progression.json` esiklerinde. Bu, madde 8'deki
"stature hizi" sorununun icerige yansiyan yuzu.

### BES YENI KATEGORI

`tactics` `social` `sponsor` `ritual` `legacy` acildi (toplam 20).
Gerekce ve sahne fikirleri: `docs/yeni-kategoriler.md`.

- **`tactics`** -- futbolun en yaygin catismasi oyunda HIC yoktu: hoca
  seni mevkinden aliyor. `evt_tactics_manager_mevki` (taktik tahtasinda
  miknatisin otuz metre geriye konmasi).
- **`social`** -- ilk kapsamdaki Faz G'nin (kumar, bahis, parti) icerik
  yuzu. `evt_social_kumarhane`: kazanmak kaybetmekten tehlikeli.
- **`sponsor`** -- komedi tonu; oyunun geri kalani agir.
  `evt_sponsor_reklam_cekimi`: otuz dokuzuncu tekrar.
- **`ritual`** -- sogumasi kasitli KISA (4). Batil inanc tekrar edince
  kusur degil rituel; tekrar sorununu 1060 varyant yazmadan hafifletmenin
  tek durust yolu. `evt_ritual_keeper_corap`.
- **`legacy`** -- kilometre taslari. `evt_legacy_yuzuncu_mac`.

### KARIYER SAYACLARI eklendi

`legacy` yazilirken cikti: motor yalnizca SON maci tutuyordu
(`last_match_goals` vb.), kariyer toplami HICBIR YERDE yoktu. Yani
"100. macin" gibi bir kosul yazilamiyordu.

`kariyer_mac_sayisi`, `kariyer_gol_sayisi`, `kariyer_asist_sayisi`
eklendi (`MatchContextGate.applyResult`). Turu `derived`: motor yazar,
ICERIK YAZAMAZ -- `kupa_sayisi` ile ayni gerekce (bir olay dosyasi gol
sayisini uyduramamali). `evt_legacy_yuzuncu_mac` bunlari OKUYAN ilk
icerik.

### ACIK OLAY ONCELIGI -- yapisal duzeltme

Zincir testi IKI KEZ, yalnizca yeni olay eklendigi icin patladi.
`evt_react_var_controversy` bir `inc_*` izine bagli ama siradan havuzda
yarisiyordu; havuz her yeni icerikle buyudugu icin payi kacinilmaz
olarak eriyordu. VAR tartismasi roportaji on iki hafta sonra cikarsa
sacma olur.

Agirliklari tek tek kismak bunu COZMEZ -- icerik buyudukce yine kirilir.
`WeightedPicker`a tek kural eklendi: acik bir incident'e bagli olay
havuzda oncelikli (x12). Bu bir "onemlilik" primi degil ZAMANLAMA
primi; kalici `mem_` izlerine bagli olaylar prim ALMAZ.
`tests/IncidentPriority.test.ts` (5 test) kurali koruyor.

### ELLE YAZILMIS TURKCE EKI -- proje geneli hata

Kendi olayimda `{actor.mother.name}'e` yazip duzeltmistim; tarayinca
sorunun PROJE GENELI oldugu cikti: **48 elle yazilmis ek, 32 dosyada**
(41 tane `'in`, 7 tane `'e`).

Neden hata: isimler tohumdan uretiliyor. Ayni sablon "Ocak'in" (yanlis)
ya da "Demir'in" (dogru) uretebilir; hangisi olacagini yazar bilemez.
Projede bunun icin `TurkishSuffix` motoru var ve unlu uyumunu kendisi
cozuyor: `{actor.x.first:gen}` -> "Baris'in | Oktay'in | Vinicius'un".

48'i de duzeltildi (`'in` -> `:gen`, `'e` -> `:dat`). Geri gelmemesi
icin **`HandwrittenSuffixRule`** yazildi (severity: error, 28. kural).
Sentetik ihlalle test edildi: yakaliyor.

### AGIRLIK OLCEGI -- yapilan hata

Ilk yazimda agirliklar 260-400 verildi. Projenin gercek olcegi:
**minor ortanca 10, major 50, epic 100** (maks 220). Alti olay havuzu
ele gecirdi ve `evt_react_var_controversy` zincir testi patladi --
VAR tartismasi roportaji sekiz tur icinde cikamadi.

Duzeltildi (16-70 araligina cekildi), 377/377 test yesil. Ders: yeni
olayin agirligi, AYNI TIER'daki mevcut olaylarin ortancasina bakilarak
verilmeli. Yuksek agirlik "onemli olay" demek degil, "digerlerini bastir"
demek.

## 7. Icerik bosluklari

- **MILLI TAKIM.** Onceki notta "`national` kategorisinde 0 olay"
  yaziyordu; bu YANLISTI, oyle bir kategori hic yoktu. Dogru olcum:
  `national_duty` hayat durumunda 36 olay acik ama **hicbiri milli
  takim hikayesi degil** -- hepsi mac/tepki ambiyansi ya da
  `evt_media_era_*`. Kamp yok, ilk forma yok, istiklal marsi yok,
  kadro disi kalma yok. `national_captain` slotu 43 slot icinde hic
  sahneye cikmamis sekizden biri.
- **Yorgunluk bayraklarini hicbir icerik OKUMUYOR.** `tukenmislik` ve
  `kondisyon` yaziliyor, mac performansini etkiliyor, ama "cok
  yorgunsun, bu maci pas gec" diye bir sahne yok. Sistem var, sesi yok.
- **Cirak havuzu ince**: `locker` 2, `personal` 3, `legal` 3 olay.
  Kariyerin ilk sezonu en cok tekrar eden sezon.
- Kupa finali sahneleri yok.

## 8. Itibar / stature hizi

Hero 6. haftada `starter` seviyesine ulasiyor. Cok hizli: bir sezonun
ilk ceyreginde "takimin adami" olmak, yukselisin kendisini anlamsiz
kiliyor. `progression.json` esikleri gozden gecirilmeli.

## 9. Hukuki

Ithalat hattı kisisel veriyi maskelemiyor, **DUSURUYOR**:
`player_image_url`, `social_media_url`, `player_agent_name`,
`name_in_home_country`, `place_of_birth` ve tam dogum tarihi (yalnizca
`birth_year` saklaniyor).

Maskeleme riski azaltir, sifirlamaz. Arac veri setini **paketlememeli**;
kullanici kendi klonundan ithal etmeli. `player_performances.csv`
(157MB) ve `transfer_history.csv` (81MB) Git LFS altinda -- `git lfs
install` sart.
