# Genişleme Denetimi — Ekonomi, İsyan, Telefon

Kod okunarak yapıldı (2026-09-08). Okunur rapor:
https://claude.ai/code/artifact/8b92bd03-1312-4975-ae12-ed405f91ea3f

Bu dosya **ölçümleri** saklar; gerekçe ve plan raporda.

---

## Hüküm

| Modül | Durum | Kilit |
|---|---|---|
| İnteraktif senaryolar / isyan | **Hazır** | Yalnızca `WorldEvent` türü eksik |
| Ekonomi / bahis / yatırım | **Kısmen** | Oyuncu-seçimli miktar ifade edilemiyor |
| 3D telefon arayüzü | **Yok** | Projede UI katmanı hiç yok |

---

## Ölçülen bulgular

### Taşıyan kolonlar

| Bulgu | Kaynak |
|---|---|
| `domain` hiçbir üst katmandan import etmiyor; `simulation` yalnızca `domain` + `selection/Rng` | grep, 0 ihlal |
| Tohumlu RNG imleç kaydediyor (mulberry32 + cursor) | `selection/Rng.ts` |
| Ağırlıklı olasılık çözücü kurulu | `runtime/RollResolver.ts` + `WeightExpressionEvaluator.ts` |
| Efekt sistemi **kapalı birleşim**, 6 işlem: `flag` `schedule` `lifeState` `suspend` `clubTier` `match` | `domain/effects.ts:112` |
| Bayrak başına yazma izni (`writableBy`: content/engine/host) | `domain/flags.ts:51` |
| Aktörlerde `relation` + `trust` + `chemistry` + `minutesTogether` | `domain/actors.ts:206` |
| Eski kayıt backfill'i tek noktada, `??=` deseni, 94 satır | `runtime/SaveGame.ts` |
| Host'ta etkileşimli masa emsali | `cli/play.ts:657` (`agentDesk`) |

### Açıklar

| Bulgu | Ölçüm | Kaynak |
|---|---|---|
| Katman kuralının otomatik denetimi yok | eslint yapılandırması bulunamadı | — |
| Oyuncu-seçimli miktar ifade edilemiyor | `ScalableValue.scaleBy` ∈ {stature, clubTier, season} | `domain/effects.ts:16` |
| Moral maç gücüne en fazla **%6** etki ediyor | `hero.morale/100*0.06` | `simulation/TeamModel.ts:103` |
| `isCaptain` simülasyonda **hiç** okunmuyor | 0 kullanım | `src/simulation/` |
| Borç temalı 10 bayrak: **58 yazım / 0 okuma** | yetim | `content/events/` |
| `mem_gambling_debt` okunuyor ama hiç yazılmıyor | 0 yazım | — |
| Kaynak bayrağı yalnızca 5 tane | `servet` `borc` `haftalik_gelir` `sosyal_medya_takipci` `piyasa_carpani` | `core.json` |
| Romantik ilişki ekseni yok | relation: takım/aile/sponsor/basın | `core.json` |
| Cüzdan için işlem defteri yok | `servet` tek sayı | — |
| Arayüz katmanı yok | tek host 751 satır terminal REPL | `cli/play.ts` |

### Bayrak bütçesi (323 toplam)

```
memory   216   incident 29   derived 17   system 16   match 15
stat      11   pressure  6   resource  5   relation 4   persona 4
```

216'sı hafıza izi, 5'i kaynak. Oyun hatırlamayı iyi, saymayı az yapıyor.

---

## Uygulama sırası (bağlayıcı)

0. Katman korkuluğu (`tests/Layering.test.ts`) — modüllerden **önce**
1. Moral→performans bağını onar — Modül C'nin tüm ödülü buna bağlı
2. `ValueRef` ilkeli (`domain/effects.ts`) — sonraki her şeyin önkoşulu
3. Cüzdan omurgası + kredi — 58 yetim izi canlandırır
4. İsyan + tepkisel senaryolar — en az kod, en çok getiri
5. Kumar ve piyasalar
6. `PhoneModel` (veri) — grafik yazmadan terminalde oynanabilir
7. Görsel arayüz — motorda değişiklik gerektirmemeli

---

## İlerleme

### Faz 0 — katman korkuluğu ✅ (2026-09-08)

`tests/Layering.test.ts`. Rütbe tablosu + üç sert kural (`domain` saf,
`simulation` yalnızca `domain`+`Rng`, `src` asla `tools`). Aynı rütbeli
tek kenar (`adapters → testing`) gerekçesiyle listede. Kanıt: `domain`'e
sahte bir `runtime` import'u eklenince iki test düşüyor.

### Faz 1 — moral/performans bağı ✅ (2026-09-08)

Denetimde "moral %6 etkiliyor" yazmıştım. **Ölçünce sıfır çıktı.**

| Katman | Sorun |
|---|---|
| Çarpan | `dayFactor` yalnızca `quality`ye uygulanıyordu; simülasyon `attributes` okuyor (`computeLines`, `pickShooter`, `pickAssister`). 500 maçta moral 0 ile 100 arası fark: **106/28/6.258 — bire bir aynı** |
| Reyting | Herkes 6.0'dan başlıyor, üstüne sadece olaylar ekleniyordu. "Bugün nasıl oynadığın" oyuncunun gördüğü sayıya hiç yansımıyordu |
| Moralin kendisi | İçerik 93 pozitif (+850) / 503 negatif (−5329) yazıyor, toparlanma yok → **medyan 0** (p25 0, p75 8) |

Yapılanlar: çarpan niteliklere taşındı · `heroBaseRating` eklendi ·
`moraleTarget`/`moraleRecovery` (hedefe kayma) · `softFloor` (softCap'in
aynası — tabana yaklaşınca azalışlar sönümlenir) · `isCaptain` bağlandı.

Ölçüldü (6 tohum × 1000 tur):

| | Önce | Sonra |
|---|---|---|
| moral medyanı | 0 | **23.2** (bant 0.8–90.5) |
| moral → reyting (500 maç) | 0.000 | **0.518** |
| form medyanı | 45 | 48 (ölüm sarmalı yok) |

`playtest` artık her bayrak için p25/medyan/p75 basıyor — min-max ve son
değer yanıltıyordu.

**Kalan iş (içerik tarafı):** moral yazımları 5.4:1 negatif ve
toparlanmasız bir oyun için ölçeklenmiş. Motor artık doğru; 503 negatif
efektin yeniden ölçeklenmesi ayrı bir karar. Bu yapılmadan moral gerçek
bandının (≈14–34) dışına çıkmadığı için sahadaki etkisi de dar kalır.

### Faz 2 — `ValueRef` ilkeli ✅ (2026-09-08)

Efekt değeri artık çalışma zamanında bir bayraktan okunabiliyor:
`flags[ref] * (mul ?? 1) + (add ?? 0)`. Özel bir "kumar" mekaniği yerine
**genel** bir ilkel seçildi — aynı şey kredi taksitini, sponsorluk
yüzdesini ve "borcun yarısını kapat"ı da yazıyor.

`ValueRefRule` severity `error`: ilkel yeni, grandfather edilecek ihlal
yok. Denetlediği üç şey — bayrak tanımlı mı, sayısal mı, çarpan makul mü.
Sessiz sıfır en kötü sonuç olurdu.

### Faz 3 — cüzdan omurgası ✅ (2026-09-08)

**3a — defter.** `domain/wallet.ts` (veri) + `runtime/WalletLedger.ts`
(durum) + `:cuzdan` masası. 200 satır sınırlı, ama kariyer toplamları
sınırdan bağımsız birikir. Kritik test: defterdeki toplam, servetteki
değişimi **tam** açıklamalı — eşleşmezse bir para yolu bağlanmamış
demektir.

> Faz 0'daki katman testi ilk denemede işe yaradı: tipleri `runtime`'a
> koymuştum, `domain → runtime` import'u kural ihlaliydi ve test yakaladı.

Ölçüldü (901 turluk kariyer): maaş 3,3M giriş · olaylar 8,8M giriş /
1,9M çıkış. **Not: içerik maaştan daha çok para veriyor** — ayrı bir
denge sorusu.

**3b — kredi.** İki alacaklı; ayrım faiz değil *bedelin türü*: banka
ucuz ama ödenmezse basın, tefeci pahalı ama ödenmezse insanlar gelir.
Kapasite mevcut borçla düşer; banka bitince geriye tefeci kalır.

**Ölü içeriği canlandırıyor — yeni sahne yazmadan:**

| Ölü kapı | Nasıl açıldı |
|---|---|
| `evt_dark_betting_offer` (`borc >= 40000`) | Borçlanmak eşiği geçiriyor |
| `evt_legal_mafia_collects` (`mem_mafia_favor_owed`) | Tefeciye temerrüt bu izi yazıyor — ölçümde **hiç** dolmuyordu |

Not: simülasyon botu kredi çekmediği için bu iki sahne `npm run simulate`
çıktısında hâlâ ölü görünür; **oyuncu için** erişilebilir oldular.

### Faz 4a — hocanın kovulması ✅ (2026-09-08)

`yonetim_baskisi` bayrağını **17 içerik olayı yazıyor**, motor onu hiç
okumuyordu. İsyan senaryosunun eksik dördüncü ayağı buydu.

`runtime/ManagerTenure.ts`: baskı = `yonetim_baskisi` + soyunma odası
huzuru + hero formu (sonuncusu bilerek zayıf). Sert eşik yerine olasılık
(70 üzeri, tavanda haftalık ~%12). Yalnızca `manager` slotu yeniden
dökülür ve **giden kişi dışlanır** — yoksa mock dünyada (kulüp başına tek
hoca) kovulan aynı hafta geri geliyordu.

Yeni bir mekanik değil: hoca kötü sezonda da gider, isyan yalnızca
süreci hızlandırır. `mem_hoca_kovuldu` izi bırakılır.

### Faz 5 — kumar ve bahis ✅ (9 Eylül 2026)

`social` kategorisi kumarı **anlatıyordu** ama mekanik yoktu; sahneler
`servet`e sabit bir sayı yazıyordu. *"Masaya oturdun ve 150.000
kaybettin"* bir karar değil, bir cümledir. Karar **miktarı oyuncunun
seçmesiyle** başlar — Faz 2'deki `ValueRef` ilkelinin varlık sebebi
buydu, ilk gerçek müşterisi geldi.

Oyun matematiği **içerikte** (`content/economy/games.json`): rulet, at
yarışı, UFC, blackjack. Kasa avantajları gerçekçi — rulet %2,7 (gerçek
hayattaki gibi), at yarışı %7-12. Test her seçenekte kasanın kazandığını
doğruluyor; aksi hâlde ekonomi sonsuz para basar.

Bıraktığı izler `mem_gambling_debt`'i besliyor — o iz **okunuyor ama hiç
yazılmıyordu**.

### Faz 6 — telefon modeli ✅ (9 Eylül 2026)

**Görsel yok, model var.** Denetimdeki tavsiye buydu: motorun kurucu
ilkesi UI-bağımsızlık, 3D telefon ise bir *render* problemi. Sıra tersine
çevrilirse motorun içine görsel varsayımlar sızar.

`domain/phone.ts` + `runtime/PhoneBuilder.ts` + `:telefon` masası.
Model **türetilmiş**: akış maç reytinglerinden, bildirimler kredi/ceza
durumundan, mesajlar aktörlerin `lastInteractionTurn` damgasından gelir.
`GameState`e **yeni alan girmedi** — kayıt göçü yok ve besleme kariyerle
kendiliğinden tutarlı.

İki test bu ilkeyi koruyor: model JSON'a çevrilebiliyor (görsel varsayım
yok) ve `phone()` çağırmak durumu değiştirmiyor (depolanmış olsaydı
değiştirirdi).

Ayrıca `sosyal_medya_takipci` canlandırıldı: artık şöhretin yansıması,
kendiliğinden büyüyen bir sayaç değil (8.728 – 3.448.054 bandı).

### Faz 7 — enflasyon, kira ve piyasalar ✅ (9 Eylül 2026)

**Enflasyon** (2015-2024 gerçek TÜFE): Anadolu %27,5, Gallia %1,8 — **on
beş kat** fark. Asimetrik kurgulandı, yoksa görünmez olurdu: nakit erir,
varlık korur, **maaş geride kalır** (sözleşme nominal), **borç erir**.
Ev/arsa kiraya verilebiliyor. Ayrıntı: **[enflasyon.md](enflasyon.md)**.

**Borsa ve kripto** kumardan *yapısal* olarak ayrıldı: kumar tek atış,
piyasa tutulan pozisyon; asıl karar "ne zaman çıkacağın". Fiyat üç
bileşenden yürüyor — reel sürükleme, **enflasyon** ve gürültü. Enflasyon
bileşeni şart, yoksa Anadolu'da hisse de nakitle birlikte erer ve
"enflasyondan hisseye kaçmak" diye bir strateji kalmaz.

Cüzdanda ayrı kategori (`yatirim`): kumarla aynı satırda görünseydi
rulet kaybı temettüyü götürür ve "hangisi kazandırıyor" cevapsız
kalırdı. Ayrıntı: **[piyasalar.md](piyasalar.md)**.

Yan ürün — bir ölçüm: piyasa her tur RNG çektiği için tohum dizisi
kaydı ve `MediaEra` testi düştü. Test **tek tohumla** "dört çağın dördü
de gelir" diye iddia ediyordu; iddia şanstı (12 tohumun 10'unda geliyor).
Kök neden piyasa değil: **200 turluk bir çağ penceresinde `media`
kategorisinden sahneye gelen olay sayısı 1 ila 4**, ve ağırlığı dört
katına çıkarmak sonucu değiştirmedi (10/12 → 10/12). Darboğaz olayın
ağırlığı değil kategorinin havuz payı — içerik programının konusu.

### Üretim tuzakları — ayrı belgede

Model hattıyla içerik üretirken bulunan sessiz bozulmalar, araç
kilitlenmeleri ve ölçüm politikası yanılgıları:
**[docs/uretim-tuzaklari.md](uretim-tuzaklari.md)**

Özeti: üretilen sahne *tek başına geçerlidir*; bozuk olan sahne değil,
kardeşiyle taşıması gereken sözleşmedir. İki yeni kural yazıldı
(`MomentOutcomeIncidentRule`, `ScheduleReachabilityRule`), 40 sonuç
düğümü ve 12 sevk onarıldı.

### Faz 8 — sosyal finansman ✅ (9 Eylül 2026)

Takım arkadaşından borç. Banka **parayla**, tefeci **güvenlikle**,
arkadaş **ilişkiyle** ödetiyor — üç kolun para birimi farklı olmasa
seçim tek boyutlu kalırdı ("ne kadar acelem var").

Faizsiz ve vadesiz, ama beklemek bedava değil: sekizinci haftadan sonra
güven hızlanarak eriyor ve 60. haftada arkadaşlık bitiyor. Borç
silinmiyor, **defterden düşüyor** — kişi vazgeçmiştir. İcra yok, tehdit
yok; o tefeci kolunun işi.

Kapatmak aldığından **fazlasını** geri veriyor (−4 alırken, +9
kapatırken): sözünü tutmak, hiç istememekten güçlü bir sinyaldir.
Ayrıntı: **[sosyal-finansman.md](sosyal-finansman.md)**.

Yan ürün — araçta bir tuzak bulundu ve kapatıldı: `QualityGate` doğrulama
öncesi `core.json`'un anlık kopyasını alıp `finally` içinde **tamamını**
geri yazıyordu, yani kapı çalışırken dosyaya elle yapılan her düzenlemeyi
sessizce siliyordu. Artık yalnızca kendi eklediğini geri alıyor.
[uretim-tuzaklari.md](uretim-tuzaklari.md)

### Sırada

Faz 4 — isyan ve tepkisel senaryolar (yeni `WorldEvent` turu +
`manager` slotunun yeniden dokunması). Ağırlıklı olarak **yazım** işi.

---

## Riskler

- ~~Proje git deposu değil.~~ ✅ Kuruldu (sızıntı kancasıyla birlikte).
- Telefonu modelden önce görselden başlatmak, motora UI varsayımı sızdırır.
- Moral bağı onarılmazsa sosyal yaşam ve finansal risk sahada hissedilmez.
- Yürürlükteki karar: tekrarsız senaryo bitene kadar yeni geliştirme yok.
  Bu dosya **plandır, başlama emri değil.** Faz 0-1 küçük olduğu için
  paralel yürüyebilir; gerisi sıraya girer.
