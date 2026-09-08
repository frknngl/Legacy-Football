# Yarına Notlar — 8 Eylül 2026 kapanışı

Bugün yapılanlar `docs/genisleme-denetimi.md`'de. Bu dosya **açık kalanlar**
ve **bilerek ertelenenler**.

Durum: **479 test · 32 kural · 0 hata · 630 uyarı · 8 commit**

---

## 0. ÖNCE BUNU OKU — bir ölçüm düzeltmesi

Gün içinde ölü olay sayısını "30 → 28 → 15" diye raporladım. **Bu seri
kısmen gürültüydü.** Sayı tohum sayısına çok duyarlı ve benim
değişikliklerim RNG akışını kaydırdığı için her ölçüm farklı bir rastgele
yürüyüşü ölçüyordu:

| Tohum | Ölü olay | Kapsama |
|---|---|---|
| 6 | 32 | %81 |
| 12 | 18 | %89 |
| **20** | **11** | **%93** |

**Bundan sonra ölü olay ölçümü en az 20 tohumla yapılmalı.** 6 tohumluk
sayılar karşılaştırılamaz.

Düzeltme neyi değiştirmiyor: başarısızlık yolu (`potansiyel` tabanı) fixi
**bağımsız** olarak doğrulandı — şöhret merdiveni ölçümüyle
(`milli_mac_sayisi` 158 → 107, `legend` 1/3 → 1/6). O bulgu sağlam;
yalnızca "ölü olay 15'e indi" cümlesi fazla iyimserdi.

---

## 1. Kota bekleyenler (model/içerik işi)

| İş | Ölçüm | Not |
|---|---|---|
| Kısa outcome'lar | **439** TierCompliance uyarısı (522'den düştü) | Karar verildi: yeniden yazılacak |
| Moral yazımları | 93 pozitif (+850) / **503 negatif (−5329)** | Motor artık doğru; içerik *toparlanmasız* bir oyun için ölçeklenmiş. Moral medyanı 23, hedefi ~47 |
| Tekrar — ambiyans | 198.7× (45 metin, 8942 gösterim) | `match`/`reaction` sahne bütçesinin ~%38'i. En yüksek etki burada |
| Tekrar — hikâye | 20.4× (193 metin, 3934 gösterim) | |
| Tek metinli kategoriler | `ritual`, `sponsor` | Her ikisi de 1 metin |
| Yetim `mem_*` | **182** | Yazılıyor, okunmuyor |

En çok tekrar eden 3: `evt_match_ref_dispute` 736× · `evt_match_free_kick`
622× · `evt_match_one_on_one` 586×.

---

## 2. Kod açıkları — **KAPATILDI (9 Eylül 2026)**

> Bu bölümde yedi açık yazmıştım. Taze ölçünce **üçü geçersiz çıktı** —
> notları hafızadan yazmışım, ölçerek değil:
>
> - `piyasa_degeri` **zaten** `derived` ve onu yazan içerik kalmamış
> - `is_captain`'ı `evt_match_captain_armband` **veriyor** (ölü listesinde yok)
> - "İçerik maaştan çok para veriyor" — o sonda **hep ilk seçeneği**
>   seçiyordu. Rastgele seçimle oran **1,09×**, yani denge sağlıklı
>
> Kalan dördü gerçekti ve kapatıldı:

| Açık | Ne yapıldı |
|---|---|
| `iliski_aile` (4 sahne, okuyan yok) | Moral hedefinin üçüncü girdisi oldu |
| `iliski_sponsor` (12 sahne, okuyan yok) | Sponsorluk geliri + hedefe kayma |
| Ölçüm botu transfer/kredi yapmıyordu | `cli/bot.ts` — simulate + playtest paylaşıyor |
| `rakip_kulup_gecmisi` adı | → `mem_rakip_kulup_gecmisi` |

**Bonus — sessiz ve büyük bir hata bulundu.** `DbRosterProvider` `rivalId`
alanını **hiç doldurmuyordu** ve `rival_club_id` sorguya bile
alınmıyordu; oysa veritabanında 300/303 kulüpte doluydu. Sonuç: `play.ts`
transferde `club?.rivalId === target.id` diye bakıyor ve bu **her zaman
false** dönüyordu — yani ezeli rakibe transfer **oyuncu için de
imkânsızdı.**

Ölçüldü: ölü olay **11 → 9**, kapsama **%93 → %95**. Playtest artık
transfer / ezeli rakibe / kredi sayaçlarını basıyor: **28 / 4 / 12**.

İki tuzak da aynı desendi ve ikisi de yorumlandı: *bir bayrağı sonuca
bağlamak tek başına yetmiyor — bayrak tek yönlü bir mandalsa (içerik
sürekli negatif yazıyor, toparlanma yok) sonuç yine ölü kalıyor.*

### Hâlâ açık

- `medya_itibari` tek yönlü: içerik net **−851** yazıyor, medyanı **15**.
  Moral ve sponsor ilişkisiyle aynı tuzak, henüz kapatılmadı.
- `mem_hoca_kovuldu` — motor yazıyor, okuyan içerik yok (Faz 4b bekliyor).

---

## 2b. Eski liste (referans)

### 2.1 Yazılıyor ama kimse okumuyor (bugün ikisini kapattım, ikisi kaldı)

Bugün bu desenden **iki** tane kapattım: `borc` (kredi sistemi) ve
`yonetim_baskisi` (hoca kovulması). Kalanlar:

| Bayrak | Yazan sahne | Durum |
|---|---|---|
| `iliski_sponsor` | 12 | Ne içerik ne motor okuyor |
| `iliski_aile` | 4 | Ne içerik ne motor okuyor |

Bunlar `relation` türünde — sponsor ve aile ilişkisinin hiçbir sonucu yok.

### 2.2 Ters yetimler — okunuyor ama yazılmıyor

- `mem_rakibe_transfer` — motor (`reportWorldEvent`) yazabiliyor ama
  simülasyon o kapıyı hiç çağırmıyor. `evt_transfer_rakibe_gecis_hesaplasma`
  bu yüzden ölü (`clubTier` reddi olarak görünüyor).
- `mem_hoca_kovuldu` — **bugün ben ekledim**, motor yazıyor, okuyan içerik
  yok. Bilinçli: Faz 4b'de yazılacak sahnelerin girdisi.

### 2.3 `isCaptain` bağlandı ama kimse vermiyor

Bugün `isCaptain` simülasyona bağlandı (önceden **hiç** okunmuyordu). Ama
`is_captain` bayrağını **set eden içerik yok** — yani pazuband hiç
takılmıyor. Kaptanlık sahnesi yazılmalı (denetim raporundaki senaryo
listesinde var).

### 2.4 `piyasa_degeri` tür borcu (A3'ten kalma)

Hâlâ `resource` türünde, yani içerik de yazabiliyor ve **7 olay yazıyor**.
Motor her tur üzerine yazdığı için o efektler sessizce etkisiz. Türü
`derived` yapmak ve 7 efekti başka bir bayrağa çevirmek gerekiyor.

### 2.5 İçerik maaştan çok para veriyor

901 turluk ölçüm: maaş 3,3M giriş · olaylar **8,8M** giriş / 1,9M çıkış.
Ekonominin ağırlık merkezi içerikte. Cüzdan defteri artık bunu görünür
kılıyor; denge kararı ayrı.

### 2.6 İsimlendirme

`rakip_kulup_gecmisi` — `mem_` öneki taşımayan tek memory bayrağı.

### 2.7 Simülasyon botu kredi çekmiyor

Kredi ve temerrüt sistemi çalışıyor ve iki ölü kapıyı açıyor
(`evt_dark_betting_offer`, `evt_legal_mafia_collects`) — ama `npm run
simulate` botu `takeLoan` çağırmıyor, dolayısıyla o iki sahne simülasyon
çıktısında **hâlâ ölü görünecek**. Oyuncu için erişilebilirler.

Yapılabilir: bota olasılıklı kredi davranışı eklemek.

---

## 3. Kurallar — sıkılaştırılmayı bekliyor

| Kural | Şu an | Hedef | Engel |
|---|---|---|---|
| `VariantDistinctnessRule` | `warn` (1 bulgu) | `error` | Neredeyse hazır — 1 bulgu kaldı |
| `ShapeVarietyRule` | `warn` (8 bulgu) | `error` | Şekil çeşitliliği üretimi |
| `OrphanMemoryFlagRule` | `warn` (182) | `error` | 182 yetim temizlenmeli |
| `TierComplianceRule` | `warn` (439) | — | 439 kısa outcome |

`VariantDistinctnessRule` 55 → **1** bulguya düşmüş; sıkılaştırmaya en
yakın olan bu.

---

## 4. Gerçekten ölü 11 olay (20 tohum)

| Olay | Red sebebi |
|---|---|
| `evt_business_childhood_friend_kayip` | lifeState (`retired`, ağırlık 1) |
| `evt_business_lawyer_ayartma` | era |
| `evt_dark_fixer_suc_ortakligi` | era |
| `evt_dark_lawyer_suc_ortakligi` | stature |
| `evt_fandom_fan_leader_maske_dusmesi_suspended` | trigger |
| `evt_fandom_fan_leader_taninma` | stature |
| `evt_match_handball_on_line` | kuyruğa hiç girmedi |
| `evt_match_penalty_against` | kuyruğa hiç girmedi |
| `evt_mind_physio_itiraf_injured` | era |
| `evt_mind_psychologist_ayartma_injured` | era |
| `evt_transfer_rakibe_gecis_hesaplasma` | clubTier |

İki `match` olayı "kuyruğa hiç girmedi" diyor — bunlar moment-güdümlü
olabilir, ayrı bakılmalı.

---

## 5. Sıradaki fazlar

| Faz | Durum | Kota gerekir mi |
|---|---|---|
| 4a — hoca kovulması | ✅ bugün | — |
| **4b — isyan içeriği** | sırada | **evet** (yazım işi) |
| 5 — kumar ve piyasalar | bekliyor | hayır (motor) |
| 6 — `PhoneModel` (veri) | bekliyor | hayır (motor) |
| 7 — görsel arayüz | bekliyor | ayrı proje |

Faz 4b'nin motor tarafı hazır: `liderlik` kapısı, `trust`, negatif
`rating`, `yonetim_baskisi` → kovulma, `mem_hoca_kovuldu` izi. Eksik olan
yalnızca **sahneler**.

---

## 6. Ortam notları

- **Git kuruldu**, uzak sunucu **yok**, kimlik `frknngl@gmail.com`.
  Sızıntı kancası kurulu: `git config core.hooksPath tools/githooks`
  (klon sonrası bir kez).
- **Gemini kotası** proje başına 500/gün. Yeni anahtar **farklı bir Google
  Cloud projesinde** açılmalı, yoksa aynı kotayı paylaşır.
  `.env` sonuna: `GEMINI_API_KEY_2=AIza...` (hat 4 anahtara kadar destekler).
  Sohbete yapıştırılan `AQ.` ile başlayan değer Gemini formatında değildi.
- `npm run playtest` artık p25/medyan/p75 ve "SOHRET PUANI" bileşenlerini
  basıyor — denge ayarı yaparken önce buraya bak.
