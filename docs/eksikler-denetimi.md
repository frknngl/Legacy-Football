# Eksikler Denetimi

Ölçülerek çıkarıldı (spekülasyon değil). Tarih: 2026-09-08.

---

## A. Kurulmuş ama kablosu çekilmemiş — **TAMAMLANDI (2026-09-08)**

> Üçü bugün erken saatlerde bağlandı (`trophy`, `finishSeason`,
> `national_call`), kalan üçü de bu turda. `GameEngine`in 32 public
> metodundan host'larda çağrılmayan **4 → 2** düştü; kalan ikisi
> (`momentResolution`, `opponentPool`) gözlem amaçlı, oynanışa ait
> değil.

### A1. Menajer sisteminin yarısı erişilemez — ÇÖZÜLDÜ

Ölçülen sorun: `GameEngine`'in 32 public metodundan 4'ü hiçbir host
tarafından çağrılmıyordu ve dördü de menajer sistemine aitti:

| Metot | Kaybedilen |
|---|---|
| `negotiateCommission` | Komisyon pazarlığı — A1-A3'te kuruldu, oynanamıyordu |
| `releaseAgent` | Menajeri kovamıyordun |
| `terminationFeeNow` | Fesih bedeli hesaplanıyor, gösterilmiyordu |
| `closeAgentSeason` | `seasonsTogether` hep 0 → pazarlıktaki sadakat primi hiç devreye girmiyordu |

`play.ts` yalnızca **imza** ve **teklif kabul/ret** akışını bağlıyordu.

**Yapıldı:** `:menajer` komutu eklendi — memnuniyet, komisyon, birlikte
geçen sezon, erişim/sadakat/sabır, fesih bedeli gösteriliyor; komisyon
pazarlığı ve fesih oynanabiliyor. `closeAgentSeason` üç host'ta da sezon
dönüşünde çağrılıyor, yani `seasonsTogether` artık artıyor ve
pazarlıktaki sadakat primi devreye giriyor.

Ölçüm botu da düzeltildi: eskiden **her tur** %50 red bildiriyordu ve
600 turda 108 imza/102 bırakma gibi anlamsız bir tablo çıkıyordu. Artık
motorun kendi olasılığı (`rollAgentOffer`) soruluyor → **15 sezonda 3
menajer, 1 bırakma.** İnandırıcı bir kariyer eğrisi.

### A2. Haftalık gelir hiç ödenmiyor — ÇÖZÜLDÜ

Ölçülen sorun: `haftalik_gelir` bayrağı vardı, 4 içerik olayı yazıyordu
ama motor hiçbir zaman `servet`e eklemiyordu. Hero'nun kişisel
ekonomisinde döngü yoktu.

**Yapıldı:** `GameEngine.tickEconomy()` haftalık tik'e eklendi. Maaş
yoksa kulüp itibarı + şöhretten türetiliyor (alt lig çırak ~2.500, elit
yıldız ~250.000 bandı), her tur `servet`e ekleniyor. İçeriğin yazdığı
sözleşme ezilmiyor — motor yalnızca boşsa dolduruyor.

Ölçüldü: maaş 20.900/hafta, servet 500 turda 2.500 → 10,5M.

### A3. Piyasa değeri motordan türetilmiyor — ÇÖZÜLDÜ

**Yapıldı:** `tickEconomy()` artık NPC'lerle **aynı** matematiği
(`valuePlayer()`) Hero'ya da uyguluyor. Ölçüldü: 3,0M → 6,1M.

**Not:** `piyasa_degeri` hâlâ `resource` türünde, yani içerik de
yazabiliyor ve 7 olay yazıyor — motor her tur üzerine yazdığı için o
efektler artık sessizce etkisiz. Türü `derived` yapmak ve o 7 efekti
başka bir bayrağa çevirmek gerekiyor; üretim partisi bitince.

---

## A4. Eski kayıtlar menajer imzasında çöküyordu — ÇÖZÜLDÜ

Bu oturumda `GameState`e dört alan eklendi (`formerAgents`,
`categoryCooldowns`, `ratingHistory`, `availability`) ama
`SaveGame.load()` içindeki backfill listesine eklenmediler.

Kanıtlandı: eski bir kaydı yükleyip menajer imzalamak
`Cannot read properties of undefined (reading 'length')` ile oyunu
çökertiyordu (`newAgentSatisfaction(formerAgents.length)`).

**Yapıldı:** dördü de backfill'e eklendi.
`tests/SaveBackfill.test.ts` her alanı **tek tek** eksik bırakarak
deniyor — toplu silme, bir alanın eksikliğini diğerinin maskelemesine
izin verirdi. Backfill kaldırılınca test düşüyor, geri gelince geçiyor.

**Ders:** `GameState`e alan eklemek iki yerli bir iştir — tip ve
backfill. İkincisi unutulunca hata derleme zamanında değil, oyuncunun
kaydını açtığında ortaya çıkar.

---

## B. Hiç olmayan sistemler

### B1. Gelişim / antrenman — ÇÖZÜLDÜ

Motorda **düşüş var, büyüme yok**:

- `TurnScheduler.physicalDecline(age)` — 31 yaşından sonra her sezon
  `fizik` ve `kondisyon` üzerinde negatif drift
- Karşılığında hiçbir büyüme fonksiyonu yok

`teknik` ölçümde 58 → 90.7 çıkıyor ama bu **12 içerik olayının** eseri.
Yani gelişim var ama **sistem yok**: hangi sahneleri gördüğüne bağlı,
oyuncunun etkileyemediği bir tesadüf.

**Yapıldı:** `TurnScheduler.learningRate(age)` + `GameEngine.develop()`
(sezon dönüşünde). Üç girdi:

1. **Yaş** — 16-20 tam hız, 25'te 0.72, 27'de 0.51, 31'de sıfır
2. **Oynamak** — `sezon_mac_sayisi`; yedek kalan gelişmez. Bu, forma
   şansını gerçek bir kariyer kararı yapar (B5 ile birleşiyor)
3. **Tavan** — gizli `potansiyel` bayrağı; yaklaştıkça kazanım küçülür

`profesyonellik` de çarpan: iyi çalışan daha çok kazanır, yani
içerikteki "disiplinli ol" seçimleri sahada karşılık buluyor.

Ölçüldü: `potansiyel` 88, `teknik` 58 → 96.5, `fizik` 52.8 → 89.5 → 62.4.
Fizik'in yükselip düşmesi tam olarak istenen kariyer eğrisi.

### B2. Ödüller yok — ÇÖZÜLDÜ

**Yapıldı:** `sezon_gol_sayisi` / `sezon_asist_sayisi` sayaçları +
`awardSeason()` (sezon dönüşünde). Gol kralı ve yılın oyuncusu.

Eşikler **ölçerek** seçildi: ilk denemede 20 gol / 25 katkı verildi ve
üç kariyerde **hiçbir ödül kazanılmadı** — ölçülen zirve sezon 19 gol
ve 6 asistti, yani eşik kıl payı ulaşılamazdı. 17 ve 20'ye çekildi.

Ödül `kupa_sayisi`na yazılmaz (o takım başarısı); ayrı `odul_sayisi`
sayacında durur ve `legacy` içeriği okuyabilir.

Ölçüldü: `odul_sayisi` 0 → 1. Nadir ama ulaşılabilir.

### B3. Uluslararası turnuva yok — ÇÖZÜLDÜ

**Yapıldı:** `WorldEvent` kind `tournament`. İki yılda bir, sezonun 39.
haftasında; Dünya Kupası ve Avrupa Şampiyonası dönüşümlü. Davet koşulu
millî maçınkiyle aynı (`calledUp`) — kadroda olmayan çağrılmaz.

Turnuva millî maçın büyük hâli: 4-7 maç, ağır yorgunluk, kazanılırsa
**kupa sayılır** — ve `kupa_sayisi` stature formülünün en ağır girdisi,
yani büyük turnuva kazanmak kariyeri gerçekten değiştiriyor.

Ölçüldü: `milli_mac_sayisi` 156 → 259, `kupa_sayisi` 4 → 7.

### B4. Sözleşme yenileme / maaş pazarlığı yok — ÇÖZÜLDÜ

**Yapıldı:** `sozlesme_sezon` sayacı (`tickContract`), `contractOffer()`
ve `renewContract()`. Son yıla girilince bildirim düşüyor; `:menajer`
masasından teklif görülüp kabul/ret edilebiliyor.

**Menajerin somut karşılığı burada:** teklifi menajerin `negotiation`
gücü büyütüyor (%45'e kadar), komisyon imzada kesiliyor. Menajersiz
oyuncu tabanı alıyor — yani komisyon ödediğin şey burada geri geliyor
ya da gelmiyor.

Süre yaşa bağlı: ≤23 için 5 sezon, ≤29 için 4, ≤33 için 2, sonrası 1.

Ölçüldü: `sozlesme_sezon` 0 → 5, yenileme işliyor.

### B5. Kadro rekabeti / yedek kalma yok — ÇÖZÜLDÜ

Ölçülen sorun: `MatchSimulator`'da `isStarter: true` **sabit** yazılıydı.

**Yapıldı:** `decideStarter(hero)` — form (%45), tazelik (%25), itibar
(%30). Eşik 0.48, ölçerek seçildi: ilk denemede 0.35 verildi ve matris
`nobody` dışında herkesin her maç oynadığını gösterdi, yani mekanik
yoktu.

Ölçüldü: **yedek oranı %11** (3 kariyer × 900 tur). Yıldız olmak seni
koruyor, çırak olmak korumuyor.

Ölüm sarmalı riski yok: oynamayan oyuncunun `form`u düşmez, sabit kalır.

### B6. Ameliyat / ciddi sakatlık kararı yok

Sakatlık var (`injured`, `rehab_clinic`) ama "ameliyat ol, altı ay kaç"
vs "iğneyle oyna, riski al" gibi bir karar yok.

---

## B7. Emeklilik oynanmıyordu — ÇÖZÜLDÜ (2026-09-08)

`GameEngine.checkEnding()` `retired` hayat durumunu **bitiş ekranıyla aynı
turda** set ediyordu. Host döngüleri bitiş dönünce kariyeri kapattığı için
`retired` durumu **sıfır tur** sürüyordu.

Ölçüldü: yalnızca `lifeStates: ["retired"]` isteyen 4 olay **1400 turluk**
simülasyonda bile "kuyruğa hiç girmedi" diye raporlanıyordu. Bu bir içerik
hatası sanılmıştı; değildi — motor o duruma hiç girmiyordu.

`TurnScheduler.retirementStage()` zaten `window`/`choice`/`forced` diye
aşamalı tasarlanmıştı; yalnızca `forced` bağlıydı ve o da doğrudan oyunu
bitiriyordu. **Eksik olan kabloydu, yeni bir sistem değil.**

**Yapıldı:** `turn.retirementEpilogueTurns` (varsayılan 12) eklendi. Zorunlu
yaş gelince önce `retired` durumuna geçilir, veda dönemi oynanır, bitiş o
süre dolunca çözülür. `GameState.retiredAtTurn` optional — eksik olması
"emekli değil" demek, yani eski kayıtlar backfill istemiyor.

`tests/RetirementEpilogue.test.ts` kabloyu söküp doğrulandı: epilog
kaldırılınca iki test düşüyor.

Ölçüldü: ölü olay **30 → 28**, kapsama **%82 → %83**.

---

## B8. Başarısızlık yolu yok — ÇÖZÜLDÜ (2026-09-08)

28 ölü olayın **17'si aynı imzayı taşıyor:**

```
stature : nobody, local_talent, starter   (alt üç kademe)
era     : prime / veteran / twilight      (orta-geç kariyer)
clubTier: amateur, lower                  (alt iki lig)
```

Bu "yükselememiş oyuncu" arketipi — alt ligde yaşlanan adam. İçerik
yazılmış ama **matematiksel olarak ulaşılamaz.**

Kök sebep `GameEngine.develop()` (`GameEngine.ts:684`):

```ts
f['potansiyel'] = Math.min(99, Math.round(base + 12 + this.rng.int(19)));
```

Taban **her zaman `+12`**. Yani hiçbir oyuncu başladığı yerde kalamaz;
herkes gelişir → `calledUp` kalite kapısını geçer → şöhret puanının %50'si
olan `milli_mac_sayisi` birikir → herkes ikon olur.

Ölçülen şöhret puanı bileşimi (kariyer sonu, 3 tohum ortalaması):

| Girdi | Değer | Puan | Pay |
|---|---|---|---|
| `milli_mac_sayisi` | 158 | 237 | **%50** |
| `kupa_sayisi` | 4 | 100 | %21 |
| `taraftar_destegi` | 97 | 97 | %21 |
| `sosyal_medya_takipci` | 3.664.667 | 18 | %4 |
| `medya_itibari` | 17 | 17 | %4 |
| `piyasa_degeri` | 878.232 | 4 | %1 |
| **TOPLAM** | | **473** | |

İlk iki girdi **sınırsız biriken** sayaçlar ve birlikte puanın %71'i. Yani
şöhret "şu an ne kadar iyisin"i değil "kaç sezondur oynuyorsun"u ölçüyor.

**Bu bir eşik ayarı sorunu değildi.** Eşikleri yükseltmek merdiveni
yalnızca geciktirir; alt kademede yaşlanan oyuncuyu üretmez. Bu yüzden
`progression.json`'a dokunulmadı.

**Yapıldı:** tavan dağılımı `base+12 … base+30` yerine
`base-6 … base+24` oldu. Dağılımın yaklaşık beşte birinde tavan mevcut
seviyenin altında kalıyor; `room` sıfır olduğu için oyuncu hiç gelişmiyor
— alt ligde yaşlanan adam. `calledUp` gerçek bir kapı (millî kadronun
23. oyuncusunun kalitesi), yani gelişmeyen oyuncu çağrılmıyor ve
`milli_mac_sayisi` birikmiyor.

Ölçüldü:

| | Önce | Sonra |
|---|---|---|
| Ölü olay | 28 | **15** |
| Kapsama | %83 | **%91** |
| `milli_mac_sayisi` (kariyer sonu) | 158 | 107 |
| Şöhret puanı toplamı | 473 | 384 |
| İlk millî çağrı | tur 201 | tur 324 |
| `icon`'a ulaşan kariyer | 2/3 | 3/6 |
| `legend`'a ulaşan kariyer | 1/3 | 1/6 |

Kalan 15 ölü olay artık **tek bir desende kümelenmiyor** — sebepler
dağıldı (4 stature, 3 lifeState, 3 trigger, 4 kuyruğa girmeyen, 1
clubTier).

`tests/FailurePath.test.ts` tabanı `+12`ye geri çekerek doğrulandı:
o hâlde "bazı kariyerlerde tavan başlangıcın altında" testi düşüyor.

Ölçüm sondası kalıcı: `npm run playtest` artık "SOHRET PUANI" bölümünde
hangi bileşenin merdiveni sürüklediğini gösteriyor.

---

## C. İnce kalan içerik

| Hayat durumu | Olay sayısı |
|---|---|
| `incarcerated` | **2** |
| `rehab_clinic` | 8 |
| `retired` | 10 |
| `suspended` | 19 |

Ayrıca **180 yetim iz** (yazılıyor, okunmuyor) — kararların çoğu geri
dönmüyor.

---

## D. Orijinal kapsamdan hiç başlanmamış

| | Durum |
|---|---|
| **GUI roster aracı** | Modül 2'nin yarısı. CLI (`npm run roster`) var, görsel arayüz yok |
| **UI / oyun arayüzü** | Faz I. Şu an yalnızca terminal |
| **Kumar/bahis mekaniği** | `social` kategorisi anlatıyor, mekanik yok (Faz G) |

---

## Öncelik önerisi

**A tamamlandı.** Kalan sıralama:

1. **B1 gelişim sistemi** — bir kariyer oyununun omurgası. Bu olmadan
   30 sezon boyunca "daha iyi olmak" hissi sistemik olarak yok.
2. **B4 sözleşme yenileme** — menajer sistemini tamamlar; `:menajer`
   masası zaten açık, pazarlık oraya doğal olarak oturur.
3. **B5 kadro rekabeti** — `tactics` içeriği yazıldı ama mekanik
   karşılığı yok; ikisi birleşince tema gerçekten çalışır.
4. **B3 turnuvalar** — milli takım içeriğine zemin.
5. **B2 ödüller** — `legacy` kilometre taşlarına zemin.
6. **B6 ameliyat kararı** — sakatlık koluna derinlik.

Not: `piyasa_degeri` türünün `derived` yapılması ve 7 içerik efektinin
çevrilmesi küçük bir temizlik borcu olarak duruyor (A3).
