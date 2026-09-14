# MASTER QA / REGRESSION / WORLD SIMULATION AUDIT

**Tarih:** 2026-09-14
**Kapsam:** 100 bagimsiz random kariyer + 100 sezonluk dunya simulasyonu + kontrollu nedensellik testleri + world.db entegrasyon denetimi
**Dunya:** `data/world.db` (FC26 kaynakli, 27 tablo, 252 kulup, 7.080 oyuncu, 21 turnuva)

> **DEGISIKLIK YAPILMADI.** Bu denetim boyunca hicbir kod dosyasi, icerik dosyasi
> veya veritabani satiri degistirilmedi. Olcum araclari `tmp/audit/` altina
> yazildi; proje kaynaklarina dokunulmadi.

---

## 0. EXECUTIVE SUMMARY

```text
WORLD SIMULATION AUDIT

Careers Simulated              : 100
World Seasons Simulated        : 100  (ayrica 12 sezonluk piramit izleme)
Total Events Observed          : 96.912
Unique Events Observed         : 506 / 545
Events Never Triggered         : 39  (21'i olcum bosluğu, 14'u erisilemez, 4'u golgede)
Matches Recorded               : 98.386  (Hero dakika aldigi: 36.060)
Transfers Recorded             : 1.718 (kariyer) + 802 (dunya)

Confirmed Bugs                 : 6
Highly Suspicious              : 4
Balance Issues                 : 5
Design Decisions               : 3

Critical                       : 3
High                           : 3
Medium                         : 7
Low                            : 5

Database Tables                : 27
Database Columns               : 227
Motorun okudugu tablo          : 8 / 27
Motorun hic dokunmadigi tablo  : 19
Yazilan ama motorca okunmayan kolon : 79

OVERALL WORLD SIMULATION HEALTH: 48/100
```

### EN ONEMLI 10 PROBLEM

| # | Onem | Problem | Kanit |
|---|---|---|---|
| 1 | 🔴 CRITICAL | Terfi/dusme ULKEYI GORMUYOR -- dunya 9 sezonda 2 lige coküyor | 21 ligin 19'u bosaliyor |
| 2 | 🔴 CRITICAL | Transfer piyasasi kalici olarak oluyor | 79.5/sezon -> 0.0/sezon |
| 3 | 🔴 CRITICAL | Kupa sayimi tekrarli -- sohret merdiveni cokuyor | 1 kupa 10x sayiliyor, 85/100 kariyer `legend` |
| 4 | 🟠 HIGH | Emekli oyuncu mac oynuyor | 27 mac, hepsi emeklilik turunda |
| 5 | 🟠 HIGH | Emeklilik sonrasi olu donem 12 yerine 116 tur | 82/100 kariyer, maks 728 tur |
| 6 | 🟠 HIGH | FC26 nitelikleri yaziliyor ama motor okumuyor | `aggression`, `composure`, `intl_reputation`, `shirt_number` |
| 7 | 🟡 MEDIUM | `loaned` hayat durumu hic olusmuyor | 24.253 tur anliginda 0 kez |
| 8 | 🟡 MEDIUM | Kariyerin %36'si `transfer_listed` -- sahaya cikilamiyor | 62.326 fikstur kacirildi |
| 9 | 🟡 MEDIUM | 19 tablo / 79 kolon motor tarafindan hic okunmuyor | `staff_assignment`, `player_agency`, `city`... |
| 10 | 🟡 MEDIUM | Ev sahibi avantaji neredeyse yok (2.4 puan) | 34.6% vs 32.2% |

---

## 1. YONTEM VE OLCUM DURUSTLUGU

### Kosum
`tmp/audit/careers.ts` motoru yalnizca genel yuzeyinden surer
(`advanceTurn` / `choose` / `availability` / `snapshot`) ve her tur, olay, mac
ve transferi JSONL olarak yazar. Host sorumluluklari `src/cli/playtest.ts`
ile BIREBIR hizalandi.

### Kendi olcum hatalarim (duzeltildi, raporlanmadan once)
Denetimin ilk turunda uc YANLIS bulgu uretildi ve hepsi kaynaga inilerek
curutuldu. Seffaflik icin kayda geciyorum:

| Ilk (yanlis) bulgu | Gercek sebep |
|---|---|
| "100/100 kariyerde `ending` yok" | `ending` bir STRING; kosum `ending?.id` okuyordu |
| "`kupa_sayisi` her kariyerde 0" | Kosum `finishSeason()`/`advanceWeek()` cagirmiyordu (host gorevi) |
| "`icon`/`legend` sohretine hic ulasilmiyor" | Ayni sebep -- kupa girdisi hic gelmiyordu |
| "En iyi hoca takimi zayiflatiyor" | Sentetik kadromun hatlari 99'u asiyordu; **gercek veride 0/252 kulup asiyor** |

Bu dort madde final raporda **bulgu degildir**. Duzeltilmis kosumla yeniden
olculdu.

### Test edilemeyenler
- **Iki NPC takimini dogrudan oynatan API yok.** `MatchSimulator` yalnizca
  Hero maci icin duraklamali akis sunar. Kadro gucu -> sonuc baglantisi bu
  yuzden 98.386 gercek mac uzerinden itibar farki bantlariyla olculdu,
  izole kontrollu testle degil. → **NOT TESTABLE WITH CURRENT ARCHITECTURE**
- **Save/load**: `.saves/` yok, kariyer icinde persist adimi yok. → kapsam disi.

---

## 2. CONFIRMED BUGS

### 🔴 #1 TERFI/DUSME ULKEYI GORMUYOR -- DUNYA COKUYOR

**Konum:** `src/simulation/LeagueModel.ts:182-183`

```ts
const above = byLevel.find((l) => l.level === league.level - 1);
const below = byLevel.find((l) => l.level === league.level + 1);
```

`byLevel.find()` o seviyedeki **ilk** ligi dondurur -- ulkeden bagimsiz.
Sonuc: butun 2. ligler ayni tek 1. lige terfi eder, butun 1. ligler ayni tek
2. lige duser.

**Kanit (12 sezonluk piramit izleme, `tmp/audit/pyramid.ts`):**

```text
sezon  Dutch D1  English D1  French D1  German D1  ...  English D2
   1        30          17         15         15             45
   2        42          14         12         12             66
   3        54          11          9          9             87
   4        66           8          6          6            108
   5        78           5          3          3            129
   6        90           2          0          0            150
   9        96           0          0          0            156     <- 19/21 lig BOS
  12        96           0          0          0            156
```

1. sezon atamalari:
```text
TERFI  English Division 2  ->  Dutch Division 1
TERFI  French Division 2   ->  Dutch Division 1
DUSME  Dutch Division 1    ->  English Division 2
DUSME  English Division 1  ->  English Division 2
```

**Downstream etki:** 100 sezonluk simulasyonda "Dutch Division 1 sampiyonu:
Madrid Blanco (92x)". Transfer piyasasi, sampiyonluk dagilimi ve kadro gucu
olculeri 9. sezondan sonra ANLAMSIZ hale gelir. 100 kariyerin her biri ~25
sezon surdugu icin **kariyerlerin buyuk bolumu cokmus bir dunyada gecti.**

**Neden simdiye dek yakalanmadi:** mock dunyada (`content/mock/clubs.json`)
her seviyede TEK lig var (`tr_1`/`tr_2`/`tr_amateur`), yani `find()` daima
dogru ligi bulur. 58 testin ve butun playtest baseline'larinin tamami mock
kullaniyor. Hata yalnizca cok-ulkeli veride ortaya cikiyor.

**Siniflandirma:** CONFIRMED BUG · **Severity:** 🔴 CRITICAL

---

### 🔴 #2 TRANSFER PIYASASI KALICI OLARAK OLUYOR

**Konum:** `src/simulation/TransferMarket.ts:136-140` + `src/adapters/dbWorld.ts:470-473`

```ts
/** Sezon donusunde cagrilir: transfer kilidi ve butceler tazelenir. */
resetSeason(): void {
  this.movedThisSeason.clear();
  for (const club of this.deps.clubs) this.budget.set(club.id, club.budget);
}
```

Dokumantasyon "sezon donusunde cagrilir" diyor. **Cagiran yok.** Repo genelinde
`resetSeason()` cagrilari yalnizca `simulator.resetSeason()` ve
`LeagueModel`in kendi ic cagrisi.

`dbWorld.finishSeason()`:
```ts
finishSeason: () => {
  simulator.resetSeason();      // <- market.resetSeason() YOK
  return league.finishSeason();
},
```

**Sonuc:**
- `movedThisSeason` hicbir zaman temizlenmez -> bir oyuncu dunya omru boyunca
  YALNIZCA BIR KEZ transfer olabilir
- Butceler hicbir zaman tazelenmez -> harcanan para geri gelmez

**Kanit (100 sezon):**
```text
toplam transfer   : 802
ilk 10 sezon ort  : 79.5 / sezon
son 10 sezon ort  :  0.0 / sezon
```

**Siniflandirma:** CONFIRMED BUG · **Severity:** 🔴 CRITICAL

---

### 🔴 #3 KUPA SAYIMI TEKRARLI -- SOHRET MERDIVENI COKUYOR

**Konum:** `src/simulation/SeasonRunner.ts:85-87`

```ts
champions: [...this.champions.entries()]        // KUMULATIF map'in TAMAMI
  .filter(([, clubId]) => clubId !== '')
  .map(([competitionId, clubId]) => ({ competitionId, clubId })),
```

Alanin kendi dokumantasyonu: *"Bu hafta belli olan sampiyonlar."* Ama donen sey
sezon basindan beri BIRIKEN haritanin tamami. Bir kupa kazanildiktan sonra
sezonun kalan her haftasi ayni sampiyonlugu yeniden bildirir; host her
bildirimde `reportWorldEvent({kind:'trophy'})` cagirir.

**Kanit:**
```text
seed=90000, sezon 5:  cup_3 ... 10 KEZ ust uste
kupa_sayisi (100 kariyer): ortanca 82, maks 618      <- gercekci tavan ~40
```

**Downstream etki (olculdu):** `kupa_sayisi` sohret formulunun en agir girdisi
(agirlik 25). Sisme sonucu:

```text
kariyer basina zirve sohret:  legend 85 · icon 6 · superstar 4 · star 2 · starter 3
tur payi: legend %46.3
```

Yedi kademeli sohret merdiveninin ust ucu **varsayilan** hale geliyor; alt
kademelere kapili icerik golgede kaliyor.

**Siniflandirma:** CONFIRMED BUG · **Severity:** 🔴 CRITICAL

---

### 🟠 #4 EMEKLI OYUNCU MAC OYNUYOR

**Konum:** `src/runtime/GameEngine.ts` — `advanceTurn()` sirasi

```text
satir 1052   syncDerived()   -> state.availability YENIDEN HESAPLANIR
satir 1057   checkEnding()   -> setLifeState('retired')       <-- SONRA
```

`availability` onbelleklenmis bir alan (`GameEngine.ts:1275` yalnizca
`this.state.availability` doner). Emeklilik gecisi hesaplamadan SONRA
gerceklestigi icin o tur bayat `available: true` kalir.
`suspensionAvailability()` dogru calisiyor (`canPlay('retired') === false`) --
sorun sirada.

**Kanit:** 27 mac. Dagilim kesin:
```text
turn - retiredAtTurn == 0  ->  27 / 27   (istisnasiz emeklilik turunda)
ornek: seed=90000 tur=881 dk=90 avail=True lifeState=retired
emeklilik sonrasi gol atilan mac: 2
```

**Not:** Bu bir kosum artefakti DEGIL. Resmi host `src/cli/playtest.ts:608-612`
maclari tam olarak ayni sekilde, lifeState kontrolu olmadan surer; kapinin
`availability()` olmasi tasarim geregi.

**Siniflandirma:** CONFIRMED BUG · **Severity:** 🟠 HIGH

---

### 🟠 #5 EMEKLILIK SONRASI OLU DONEM 12 YERINE 116 TUR

**Konum:** `src/runtime/GameEngine.ts:3404-3406` (`checkEnding`)

```ts
const stage = this.scheduler.retirementStage(this.state.age);
if (stage !== 'forced') return undefined;        // <-- yas < 41 ise HEP CIKAR
```

Ikinci bir emeklilik yolu var: `beginRetirement()` (`GameEngine.ts:3002`),
gonullu/olay kaynakli, `retirementChoiceMinAge = 38`den itibaren. Bu yol
`retiredAtTurn` ve `retired=true` yazar -- ama `checkEnding` yas 41 olana
kadar ilk satirda cikar, veda donemi kontroluna HIC ulasmaz.

**Kanit (100 kariyer):**
```text
41 yasindan ONCE emekli olan      : 82 / 100
emeklilikten kariyer sonuna kadar : ortanca 116 tur (~3 sezon), maks 728 tur (~18 sezon)
yapilandirma (retirementEpilogueTurns) : 12
ilk "retired" gorulen yas: 23(1) 24(5) 25(2) 28(1) 35(25) 36(4) 37(1) 38(27) 39(16) 40(10) 41(8)
```

En uc vaka: `seed=92664` yas 23'te emekli (tur 306), kariyer tur 1010'da
kapandi -- **704 tur / 17 sezon** olu donem. Tetikleyici olay zinciri
dogrulandi: `evt_life_prison_release` -> secim `c_quit`.

Bu donemde `retired` hayat durumu `match`/`reaction`/`pitch`/`locker`/
`transfer`/`national` kategorilerini kapatir; oyuncu ne oynar ne transfer olur.

**Siniflandirma:** CONFIRMED BUG · **Severity:** 🟠 HIGH

---

### 🟠 #6 FC26 NITELIKLERI YAZILIYOR AMA MOTOR OKUMUYOR

**Konum:** `src/adapters/DbRosterProvider.ts:170-176` (kadro sorgusu), satir 473

world.db `player` tablosu su dort kolonu GERCEK FC26 verisiyle tasiyor:
`aggression`, `composure`, `intl_reputation`, `shirt_number`.

Kadro sorgusu bu kolonlari **secmiyor**. Motor hala tahmin kullaniyor:

```ts
// DbRosterProvider.ts:473
aggression: clamp(aggressionFor(position, attributes) + spread * 0.5, 5, 95),
```

`aggressionFor()` mevkiden tahmin uretir (DF 62 / MF 52 / FW 44 / GK 36 tabani).
`MatchSimulator.ts:727` faul esigini `offender.aggression / 220` ile hesaplar --
yani gercek veri varken uydurulmus deger maca giriyor.

**Siniflandirma:** BROKEN INTEGRATION · **Severity:** 🟠 HIGH

---

## 3. HIGHLY SUSPICIOUS / DEAD SYSTEMS

### 🟡 #7 `loaned` HAYAT DURUMU HIC OLUSMUYOR

24.253 tur anliginda **0 kez**. `axes.json` gecis tablosunda tanimli, ama
hicbir sey bu duruma gecirmiyor. Iki olay yalnizca bu duruma kapili
(`evt_fandom_pundit_reddedilis_yakin`, `evt_media_veteran_kayip_orta`) ve bu
yuzden **yapisal olarak erisilemez**.

Olculen hayat durumu dagilimi:
```text
playing          36.0%      rehab_clinic      2.7%
transfer_listed  36.0%      incarcerated      2.1%
retired          18.1%      suspended         1.4%
injured           2.7%      national_duty     0.9%
loaned            0.0%  <-- OLU
```

**Siniflandirma:** DEAD STATE · **Severity:** 🟡 MEDIUM

### 🟡 #8 KARIYERIN %36'SI `transfer_listed`

`transfer_listed` durumunda `canPlay = false`. Olculen: 62.326 fikstur
kacirildi, bunun 34.087'si (%55) bu sebeple.

Gercek futbolda transfer listesine konan oyuncu oynamaya devam eder. Bunun
bilincli bir tasarim karari mi yoksa `axes.json`da bir gozden kacma mi
oldugunu kod kanitlayamiyor -- ama etkisi buyuk: kariyerin ucte biri sahasiz
geciyor.

**Siniflandirma:** HIGHLY SUSPICIOUS (tasarim karari olabilir) · **Severity:** 🟡 MEDIUM

### 🟡 #9 14 OLAY 100 KARIYERDE HIC UYGUN OLMADI

39 olay hic gorulmedi. Dogru siniflandirma:

| Sinif | Adet | Aciklama |
|---|---|---|
| **OLCUM BOSLUGU** | 21 | `evt_match_*` -- mac ani olaylari; kosumum `report.presented` dinliyor, mac anlari oradan gecmiyor. **Olu degil.** |
| **ERISILEMEZ** | 14 | 100 kariyer x 1040 turda bir kez bile uygunluk kapisini gecemedi |
| **GOLGEDE** | 4 | Uygun oldu (5-63 tur) ama hicbir zaman secilmedi |

Erisilemez 14'un ornek gerekceleri:
```text
evt_ritual_armband            eras: ["veteran","icon","legend"]  <- icon/legend SOHRET degeri,
                                                                   eras alanina yazilmis
evt_tactics_player_manager    ayni desen
evt_fandom_pundit_..._yakin   lifeStates: ["loaned"]             <- olu durum (#7)
evt_media_veteran_kayip_orta  lifeStates: ["loaned","playing"] + clubTiers: [amateur,lower]
                              + iki mem_* bayraginda turnsSince 41
evt_transfer_sozlesme_isyani  stature: [superstar,icon] + clubTiers: [contender,elite]
```

**Siniflandirma:** DEAD EVENT (14) / SHADOWED (4) · **Severity:** 🟡 MEDIUM

### Uygunluk kapilarinin eleme payi

```text
era                  43.6%
stature              19.7%
lifeState            18.2%     <- transfer_listed + retired agirligi
cooldown_self         6.9%
clubTier              6.1%
trigger               2.0%
```

---

## 4. GECEN SISTEMLER (PASS)

Bunlar **kanitlanarak** dogru calistigi gorulen sistemlerdir.

| Sistem | Kanit | Sonuc |
|---|---|---|
| Sakatlik kapisi | 3.329 fikstur sakatken, **0 dakika** | ✅ PASS |
| Ceza kapisi | 2.353 fikstur cezaliyken, **0 dakika** | ✅ PASS |
| Genel uygunluk | 62.326 uygunsuz fikstur, **0 dakika** | ✅ PASS |
| Istatistik butunlugu | Mac toplami vs kariyer bayragi: **0/100 uyusmazlik** | ✅ PASS |
| Sayisal sinirlar | 8 bayrak x 24.253 anlik: **0 ihlal** (0-100 korunuyor) | ✅ PASS |
| Zaman tutarliligi | Tur/sezon/yas geriye gitme: **0** | ✅ PASS |
| Negatif servet | **0** anlik | ✅ PASS |
| Oynamadan gol/asist | **0** vaka | ✅ PASS |
| Olay etkisi uygulanmasi | Gosterimlerin %73'u izlenen bir alani degistiriyor | ✅ PASS |
| Kariyer cesitliligi | 100 kariyerde **birebir ayni olay kumesi: 0** | ✅ PASS |

---

## 5. NEDENSELLIK ZINCIRI DENETIMI

### 5.1 Kontrollu testler (`tmp/audit/controlled.ts`, `tmp/audit/lines.ts`)

**Oyuncu kalitesi -> hat gucu** ✅ PASS
```text
kadro seviyesi 60 -> GENEL 75      80 -> GENEL 100
kadro seviyesi 70 -> GENEL 88      90 -> GENEL 112
```

**Teknik direktor -> hat gucu** ✅ PASS (gercek veriyle)
```text
Madrid Blanco        hocasiz 83 -> hocali 87   carpan 1.0485  (+4)
Paris Bleu           hocasiz 82 -> hocali 85   carpan 1.0400  (+3)
Merseyside Red       hocasiz 83 -> hocali 86   carpan 1.0360  (+3)
formasyon uyumu: 4-4-2 1.0675 · 4-3-3/3-5-2 1.0495
```
Not: 252 kulubun **0'inda** hat degeri 99'u asiyor (maks bant 81-90), yani
`scaleLines` kirpmasi gercek veride devreye girmiyor.

**Hakem -> disiplin** ✅ PASS
```text
cardTendency 10 -> 0.68        homeBias 30: ev 1.400 / dep 0.600 (0.43x)
cardTendency 90 -> 1.32        homeBias 70: ev 0.600 / dep 1.400 (2.33x)
penaltyCourage 10 -> 0.390 (lig) / 0.310 (kupa finali)
penaltyCourage 90 -> 0.710 (lig) / 0.630 (kupa finali)
varReliance 0..100 -> 0.000 .. 0.250
consistency 40 -> jitter 0.760..1.240   100 -> 1.000..1.000
```
Hakem nitelikleri skoru DEGISTIRMEZ, yalnizca olay olasiligini kaydirir --
istenen davranis.

### 5.2 Kulup gucu -> mac sonucu (98.386 gercek mac)

```text
itibar farki     mac      G%     B%     M%     AG     YG   PPM
<-20            2219    26.0   30.2   43.8   0.76   1.10  1.08
-10..-3        11118    30.9   31.2   37.8   0.90   1.02  1.24
-2..2          15074    33.1   32.1   34.7   0.94   0.97  1.32
3..10          21634    36.2   31.2   32.5   0.98   0.92  1.40
11..20         21567    38.5   31.8   29.7   1.03   0.86  1.47
20+            22252    42.5   32.7   24.8   1.07   0.74  1.60
```

✅ **Yon dogru** (monoton), ⚠️ **band dar**: 40+ puanlik itibar farki galibiyet
oranini yalnizca %26 -> %42.5 tasiyor. Gercek futbolda bu fark cok daha
keskindir. Beraberlik orani her bantta ~%31 sabit -- guc farki beraberligi
hic azaltmiyor.

### 5.3 Nedensellik zinciri karnesi

| Baglanti | Durum | Kanit |
|---|---|---|
| Oyuncu niteligi -> kadro gucu | ✅ PASS | Test A |
| Kadro gucu -> hat gucu | ✅ PASS | `computeLines` |
| Hoca -> hat gucu | ✅ PASS | +3/+4 gercek veriyle |
| Hakem -> kart/penalti | ✅ PASS | Saf fonksiyon testleri |
| Kulup gucu -> mac sonucu | ⚠️ WARNING | Monoton ama dar (5.2) |
| Mac sonucu -> lig sirasi | ❌ FAIL | Piramit 9 sezonda coküyor (#1) |
| Lig sirasi -> gelir | ❌ NOT IMPLEMENTED | Kulup geliri modellenmiyor |
| Gelir -> gelecek butce | ❌ NOT IMPLEMENTED | Butce yalnizca DB'den okunur, guncellenmez |
| Butce -> transfer | ⚠️ WARNING | Ilk 10 sezon calisir, sonra oluyor (#2) |
| Transfer -> kadro gucu | ✅ PASS | 218/252 kulup degisti (-5..+5) |
| Kupa -> sohret | ❌ FAIL | Tekrarli sayim (#3) |
| Olay -> durum -> gelecek olay | ✅ PASS | `mem_*` zincirleri calisiyor |

**EKONOMIK GERI BESLEME DONGUSU YOKTUR.** Kulup geliri, sportif basari ->
gelir -> butce zinciri hic modellenmemis. `club.budget_transfer` veritabaninda
sabit bir sayidir ve kariyer boyunca degismez.

---

## 6. WORLD.DB ENTEGRASYON DENETIMI

### 6.1 Ozet

```text
DATABASE INTEGRATION SUMMARY

Total Tables                 : 27
Total Columns                : 227
Motorun SQL ile dokundugu tablo   : 8
Motorun hic dokunmadigi tablo     : 19
Motorun okudugu kolon             : ~70
Yazilan ama motorca okunmayan     : 79
```

### 6.2 Motorun okudugu tablolar (gercek SQL'den cikarildi)

| Tablo | Kolon | Okunan | Okunmayan |
|---|---:|---:|---|
| `player` | 21 | 11 | `aggression`, `composure`, `intl_reputation`, `shirt_number`, `sub_position`, `foot`, `value_source`, `external_key`, `first_real`, `last_real` |
| `player_attributes` | 9 | 8 | `player_id` (JOIN anahtari) |
| `club` | 21 | 11 | `budget_wage`, `city_id`, `current_manager_id`, `financial_power`, `foreign_ratio`, `matches_per_club`, `squad_value`, `stadium_capacity`, `external_key`, `name_real` |
| `competition` | 18 | 6 | `club_count`, `country_id`, `format_kind`, `kind`, `legs`, `reputation`, `slot_preference`, `source_league_id`, `window_start`, `window_end` |
| `staff` | 15 | 8 + `club_id` (WHERE) | `active`, `country_id`, `experience`, `nationality`, `external_key`, `name_real` |
| `staff_attributes` | 10 | 7 | `overall`, `preferred_style` |
| `referee` | 14 | 11 | `experience`, `external_key`, `name_real` |
| `agent` | 13 | 9 + `agency_id` (JOIN) | `country_id`, `external_key`, `name_real` |
| `agency` | 11 | 2 (`influence`, `negotiation_power`) | `client_count`, `reputation`, `specialization`, `name_masked`, `country_id`, `active` |
| `country` | 5 | 3 | `adjective`, `confederation` |
| `referee_eligibility` | 2 | 2 | — |

### 6.3 Motorun HIC DOKUNMADIGI tablolar

| Tablo | Satir | Siniflandirma |
|---|---:|---|
| `staff_assignment` | 1.512 | **UNUSED** -- gorev gecmisi hicbir yerde okunmuyor |
| `player_agency` | 2.697 | **UNUSED** -- oyuncu<->sirket iliskisi gameplay'e girmiyor |
| `city` | 121 | **REDUNDANT** -- `club.city` metin onbellegi okunuyor |
| `identity_link` | 2.697 | **HISTORICAL ONLY** -- kaynak koprusu |
| `mask_binding` | 9.950 | **PIPELINE ONLY** -- kimlik kilidi, motor gormez (dogru) |
| `import_issue` | — | **PIPELINE ONLY** (dogru) |
| `source_dataset` | — | **HISTORICAL ONLY** (dogru) |
| `ref_*` (8 tablo) | — | **PIPELINE ONLY** -- kurulum verisi (dogru) |

**Onemli ayrim:** `mask_binding`, `import_issue`, `source_dataset` ve `ref_*`
tablolarinin motor tarafindan okunmamasi **DOGRU TASARIMDIR** -- bunlar hat
verisidir. `staff_assignment`, `player_agency` ve `city` ise **gameplay
verisidir ve okunmamalari eksikliktir.**

### 6.4 Onemli entegrasyon bulgulari

| Entity | Kolon | DB | Motor okuyor | Gameplay etkisi | Sinif |
|---|---|---|---|---|---|
| Player | `overall` | ✅ | ✅ | Siralama | **PARTIALLY USED** — `quality` yine `overallFor()`den turer (bilincli) |
| Player | `aggression` | ✅ gercek | ❌ | Faul esigi tahminle besleniyor | **BROKEN INTEGRATION** |
| Player | `composure` | ✅ gercek | ❌ | `quality` vekil kullaniliyor | **BROKEN INTEGRATION** |
| Player | `shirt_number` | ✅ gercek | ❌ | Tohumdan cekiliyor | **UNUSED** |
| Coach | `tactical` | ✅ | ✅ | Hat carpani ±%5 | **USED** ✅ |
| Coach | `motivation` | ✅ | ✅ | Hat carpani ±%2.5 | **USED** ✅ |
| Coach | `training` / `development` / `man_management` / `discipline` | ✅ | ✅ (okunuyor) | **Hicbiri downstream'e girmiyor** | **READ BUT NO EFFECT** |
| Coach | `preferred_style` | ✅ | ❌ | — | **UNUSED** |
| Coach | `overall` | ✅ turetilmis | ❌ | — | **REDUNDANT** |
| Referee | 6 nitelik | ✅ | ✅ | Kart/penalti/VAR | **USED** ✅ |
| Referee | `experience` | ✅ | ❌ | — | **UNUSED** (onceden de oyleydi) |
| Agency | `influence`, `negotiation_power` | ✅ | ✅ | Menajer erisimi ±7.5 | **USED** ✅ |
| Agency | `specialization`, `client_count`, `reputation` | ✅ | ❌ | — | **UNUSED** |
| Club | `financial_power`, `squad_value` | ✅ | ❌ | — | **UNUSED** |
| Club | `current_manager_id` | ✅ | ❌ | `staff.club_id` kullaniliyor | **REDUNDANT** |
| Club | `budget_wage`, `foreign_ratio` | ✅ | ❌ | — | **UNUSED** (onceden de oyleydi) |
| Competition | `reputation`, `kind`, `country_id` | ✅ | ❌ | — | **UNUSED** |

**COACH DATA UNDER-INTEGRATION:** Alti nitelikten yalnizca ikisi
(`tactical`, `motivation`) gameplay'e giriyor. `training`, `development`,
`man_management`, `discipline` okunuyor (`DbRosterProvider` `StaffPerson`e
tasiyor) ama hicbir sistem tuketmiyor.

**REFEREE SYSTEM: DEAD DEGIL.** Alti nitelik de match engine'e giriyor ve
kontrollu testte etkisi olculdu. Yalnizca `experience` olu.

### 6.5 Veri kalitesi (world.db ic tutarliligi)

```text
FK ihlali (PRAGMA foreign_key_check) : 0
Kulupsuz oyuncu                       : 0   (7.080/7.080 kulube bagli)
Ligsiz kulup                          : 0
Duplicate player external_key         : 0   (UNIQUE kisit)
Duplicate mask (entity_kind, ad)      : 0   (ux_mask_name)
Ayni kulupte iki manager              : 0   (ux_assign_current kismi index)
potential < overall                    : denetlenmedi (kaynak FC26 garantisi)
```

Sema `STRICT TABLE` + FK ON ile korunuyor; tip ve iliski hatalari yapisal
olarak engelleniyor.

---

## 7. ISTATISTIK DENETIMI

### 7.1 Kariyer dagilimlari (100 kariyer)

| Olcu | min | ortanca | ort | maks |
|---|---:|---:|---:|---:|
| Mac | 30 | 627 | 571 | 950 |
| Gol | 2 | 85.5 | 89.6 | 190 |
| Asist | 3 | 60 | 59.7 | 116 |
| Transfer | 2 | 33 | — | 71 |
| Kupa | 0 | **82** | 109 | **618** |
| Milli mac | 0 | 30 | 74.7 | 249 |
| Odul | 0 | 0 | 0.0 | 2 |
| Servet | 9.8K | 3.37M | — | 22.7M |

**Anomali:** Kupa (bkz. #3). **Anomali:** `odul_sayisi` 97/100 kariyerde 0 --
odul sistemi neredeyse hic tetiklenmiyor.
**Anomali:** transfer ortanca 33 -- 25 sezonluk kariyerde sezon basina 1.3
transfer, gercekci degil.

### 7.2 Pozisyon istatistikleri

```text
poz  kariyer  ort mac  ort gol  ort ast  gol/90  ast/90
FW        33    310.1     71.4     19.9    0.23    0.06
MF        67    385.5     47.5     43.9    0.12    0.11
```

⚠️ **GK ve DF kariyeri hic uretilmedi.** Arketip dagilimi dengeli
(her arketip 16-17 kariyer) ama pozisyon yalnizca FW/MF cikiyor. Kaleci ve
defans oyuncusu kariyeri **yapisal olarak uretilmiyor** -- GK'ye ozel icerik
(varsa) hic sahneye cikamaz.

**Siniflandirma:** HIGHLY SUSPICIOUS · **Severity:** 🟡 MEDIUM

### 7.3 Mac ve skor dagilimi

```text
mac basi ortalama gol : 1.88        (gercek futbol ~2.7)
0-0                   : 15.17%      (gercek ~8%)
1-0 / 0-1             : 14.62% / 14.16%
1-1                   : 13.28%
3+ gollu skor toplami : ~%8
```

⚠️ **Gol uretimi dusuk, beraberlik ve golsuzluk yuksek.**

### 7.4 Ev sahibi avantaji

```text
benzer guclu takimlar (|itibar farki| <= 5), 28.371 mac
ev sahibi : galibiyet 34.6%   beraberlik 31.6%
deplasman : galibiyet 32.2%   beraberlik 31.5%
```

⚠️ Ev sahibi avantaji **2.4 puan**. Gercek futbolda ~%46 / ~%28.
`LeagueModel.HOME_EDGE = 0.25` yorumu *"gercek liglerde ~%55 puan payi
uretir"* diyor -- olculen deger bu hedefin cok altinda.

**Siniflandirma:** BALANCE ISSUE · **Severity:** 🟡 MEDIUM

---

## 8. UZUN VADELI DUNYA SIMULASYONU (100 SEZON)

```text
kulup 252 · lig 21 · oynatilan hafta 4.000

TRANSFER PIYASASI
  toplam 802 · ilk 10 sezon 79.5/sezon · son 10 sezon 0.0/sezon     ❌ OLU

SAMPIYONLUK YOGUNLASMASI
  Dutch Division 1      6 farkli sampiyon / 100 sezon · Madrid Blanco 92x (%92)
  English Division 1    2 farkli sampiyon /   7 sezon  (lig 7. sezonda bosaldi)
  English Division 2   33 farkli sampiyon / 100 sezon · Levante Gold 35x (%35)
  French/German D1      2 farkli sampiyon /   6 sezon  (bosaldi)

KADRO GUCU KAYMASI
  degisen kulup 218/252 · aralik -5..+5 · ortalama +1.68
  10. sezon ve 100. sezon olculeri BIREBIR AYNI  -> dunya 10. sezonda DONUYOR
```

**Yorum:** Dunya kendi basina yasamiyor. Ilk ~9 sezon sonrasinda piramit
coküyor (#1), transfer piyasasi oluyor (#2) ve kadro guclerinde hicbir
degisim olmuyor. Ekonomik snowball YOK -- cunku ekonomi hic modellenmemis.
Permanent collapse VAR: piramidin kendisi cokuyor.

---

## 9. HEALTH SCORES

Her skor olculen gozlemden turetildi; keyfi degil.

| Sistem | Skor | Gerekce |
|---|---:|---|
| **EVENT SYSTEM** | 72/100 | 506/545 olay gorulda (+). 14 erisilemez olay, `loaned` olu durum, 4 golge olay (−). Etki uygulanmasi %73 (+). Uygunluk kapilari calisiyor (+). |
| **PLAYER SIMULATION** | 68/100 | Sakatlik/ceza kapilari kusursuz (+). Istatistik butunlugu 0 hata (+). Sinir ihlali 0 (+). GK/DF kariyeri uretilmiyor (−). Emekli oyuncu oynuyor (−). |
| **SPORTING SIMULATION** | 55/100 | Guc -> sonuc monoton (+). Hakem etkisi canli (+). Hoca etkisi canli (+). Band dar, ev avantaji 2.4 puan, gol/mac 1.88 (−). |
| **CLUB SIMULATION** | 30/100 | Kadro gucu transferle degisiyor (+). Piramit coküyor (−−). Gelir/butce dongusu yok (−−). Lig dengesi 9 sezonda yok oluyor (−). |
| **TRANSFER MARKET** | 25/100 | Ilk 10 sezon islevsel (+). Sonra kalici olarak oluyor (−−). Butce tazelenmesi hic cagrilmiyor (−−). |
| **FOOTBALL ECONOMY** | 20/100 | Oyuncu cuzdani tutarli, negatif servet 0 (+). Kulup ekonomisi (gelir/gider/sponsorluk/prim) HIC MODELLENMEMIS (−−). |
| **CAREER PROGRESSION** | 52/100 | Yas/zaman tutarli, cesitlilik yuksek (+). Sohret merdiveni kupa sismesiyle cokuyor (−−). Emeklilik sonrasi olu donem (−−). |
| **STATISTICAL INTEGRITY** | 92/100 | Mac toplami = kariyer bayragi, 0/100 uyusmazlik. Sinir/zaman ihlali 0. Tek eksi: kupa sayimi. |
| **DATABASE DATA QUALITY** | 88/100 | FK 0 ihlal, duplicate 0, orphan 0, STRICT + kismi unique index. Eksik: `potential<overall` denetlenmedi. |
| **DATABASE INTEGRATION** | 45/100 | Hoca/hakem/ajans zincirleri canli (+). 79 kolon, 3 gameplay tablosu okunmuyor; FC26 nitelikleri bagli degil (−−). |
| **DATABASE GAME CONSISTENCY** | 80/100 | Okunan alanlarda DB degeri ile oyun degeri ortusuyor; `quality` bilincli olarak turetiliyor (DESIGN DECISION). |
| **OVERALL WORLD SIMULATION HEALTH** | **48/100** | Kariyer katmani saglam, dunya katmani cokuyor. |

---

## 10. FINAL VERDICT

> **"Bu sistem gercekten kendi kendine yasayan bir futbol dunyasi gibi
> davraniyor mu?"**

**Kismen -- ve yalnizca ilk dokuz sezon.**

**Guclu yanlar:**
1. **Kariyer katmani saglam.** Sakatlik, ceza, zaman, istatistik ve sayisal
   sinirlarda 100 kariyer boyunca **tek bir ihlal yok**. 220.000 satirlik ham
   veride 0 negatif deger, 0 zaman geri gitmesi, 0 imkansiz istatistik.
2. **Anlati motoru zengin ve cesitli.** 545 olayin 506'si sahneye cikti;
   100 kariyerin hicbiri birebir ayni olay kumesine sahip degil.
3. **Yeni veritabani zincirleri canli.** Teknik direktor (+3/+4 hat gucu),
   hakem (kart/penalti/VAR carpanlari) ve menajerlik sirketi (erisim ±7.5)
   kontrollu testlerde kanitlandi.

**Zayif yanlar:**
1. **Dunya piramidi 9 sezonda coküyor.** Terfi/dusme ulkeyi gormuyor;
   21 ligin 19'u bosaliyor. Bu tek hata butun dunya katmanini gecersiz kiliyor.
2. **Transfer piyasasi kalici olarak oluyor.** Bir fonksiyon hic cagrilmiyor.
3. **Kulup ekonomisi yok.** Gelir, gider, prim, sponsorluk modellenmemis;
   "basari -> gelir -> butce -> transfer" dongusunun iki halkasi hic yok.

**Kritik problemler:** #1 piramit cokusu · #2 transfer olumu · #3 kupa sismesi

**En onemli duzeltmeler (oncelik sirasi):**
1. `LeagueModel.finishSeason` — terfi/dusme hedefini ULKE icinde ara
2. `dbWorld.finishSeason` — `market.resetSeason()` cagir
3. `SeasonRunner.playWeek` — yalnizca O HAFTA belli olan sampiyonlari dondur
4. `GameEngine.advanceTurn` — `checkEnding()` sonrasi `availability` tazele
5. `GameEngine.checkEnding` — `retiredAtTurn` doluysa `stage !== 'forced'` erken cikisini atla
6. `DbRosterProvider` — `player.aggression` / `composure` / `shirt_number` kolonlarini oku

---

## 11. ONERILER (uygulanmadi)

| Problem | Olasi neden | Onerilen yon | Beklenen etki | Oncelik |
|---|---|---|---|---|
| Piramit cokusu | `byLevel.find()` ulke filtresi yok | Terfi/dusme hedefini `country_id` esleyerek sec | Dunya katmani kullanilabilir hale gelir | P0 |
| Transfer olumu | `resetSeason()` cagrilmiyor | `dbWorld.finishSeason`a ekle | Piyasa surekli likit kalir | P0 |
| Kupa sismesi | Kumulatif map donuyor | O hafta belli olanlari ayri tut | Sohret merdiveni islevine doner | P0 |
| Emekli oynuyor | `availability` bayat | `checkEnding` sonrasi yeniden hesapla | 27/100 vakada duzelir | P1 |
| Olu emeklilik | `checkEnding` erken cikis | `retiredAtTurn` doluysa devam et | 82/100 kariyerde ~3 sezon geri kazanilir | P1 |
| FC26 nitelikleri bagli degil | Sorguya eklenmemis | Kadro sorgusuna 4 kolon ekle | Faul/kart dagilimi gercek veriye oturur | P1 |
| GK/DF kariyeri yok | Pozisyon uretimi | Arketip->pozisyon esleme incelenmeli | Iki pozisyonun icerigi acilir | P2 |
| Ev avantaji zayif | `HOME_EDGE` kalibrasyonu | Olcum hedefi ~%46/%28'e gore ayarlanmali | Gercekcilik | P2 |
| Kulup ekonomisi yok | Modellenmemis | Gelir/gider katmani (ayri calisma) | Geri besleme dongusu kapanir | P3 |
| `loaned` olu | Gecis yok | Kiralik mekanigi ya da durumun kaldirilmasi | 2 olay acilir | P3 |

---

## EK: OLCUM ARACLARI

```text
tmp/audit/careers.ts     100 kariyer kosumu -> JSONL ham veri
tmp/audit/endings.ts     kariyer sonu / veda donemi / hayat durumu payi
tmp/audit/epilogue.ts    emeklilik -> bitis turu izleme
tmp/audit/controlled.ts  kontrollu nedensellik testleri (hoca/hakem/kadro)
tmp/audit/lines.ts       gercek world.db ile hat gucu + hoca etkisi
tmp/audit/world.ts       100 sezonluk dunya simulasyonu
tmp/audit/pyramid.ts     lig uyelik kaymasi izleme
tmp/audit/dbcolumns.py   kolon kullanim taramasi
tmp/audit/out/*.jsonl    220.000+ satir ham gozlem
```

---

# EK: P0 DUZELTMELERI VE DOGRULAMA (2026-09-14)

Denetimden sonra uc CRITICAL bulgu duzeltildi. Her duzeltme ayni olcum
araciyla yeniden dogrulandi.

## Degisen dosyalar

```text
src/domain/roster.ts              LeagueInfo.country alani (opsiyonel)
src/adapters/DbRosterProvider.ts  leagues() sorgusu country_id okuyor
src/simulation/LeagueModel.ts     neighbour() -- terfi/dusme ulke icinde
src/adapters/dbWorld.ts           finishSeason() -> market.resetSeason()
src/simulation/SeasonRunner.ts    crown() -- sampiyon YALNIZCA bir kez raporlanir
tests/DbRoster.test.ts            fikstur semasi country_id ile hizalandi
```

## #1 PIRAMIT COKUSU -> COZULDU

`LeagueModel.neighbour()` komsu basamagi ayni ulkede arar. Ulke tanimsizsa
(mock dunya) eski davranis korunur.

```text
12 sezonluk lig uyeligi izlemesi (tmp/audit/pyramid.ts)

           Dutch D1  English D1  French D1  German D1  English D2
ONCE  s1          30          17         15         15          45
ONCE  s9          96           0          0          0         156   <- 19/21 lig BOS
SONRA s1          18          20         18         18          24
SONRA s12         18          20         18         18          24   <- DEGISMEDI
```

1. sezon atamalari artik ulke icinde:
```text
TERFI  English Division 2 -> English Division 1
TERFI  French Division 2  -> French Division 1
DUSME  English Division 1 -> English Division 2
```

## #2 TRANSFER PIYASASI OLUMU -> COZULDU

`dbWorld.finishSeason()` artik `market.resetSeason()` cagiriyor.

```text
100 sezonluk simulasyon
                    ONCE        SONRA
ilk 10 sezon ort    79.5        84.0
son 10 sezon ort     0.0        84.0      <- kalici likidite
```

## #3 KUPA TEKRARLI SAYIMI -> COZULDU

`SeasonRunner.crown()` bir turnuvaya sampiyonu YALNIZCA ilk kez yazar ve
hafta raporu yalnizca o hafta tac giyenleri tasir.

```text
                                   ONCE      SONRA
ayni sezon/ayni turnuva tekrari      10          1
kupa_sayisi ortanca                  82       20.5
kupa_sayisi maks                    618         25
sohret zirvesi (legend orani)    85/100      18/20
```

## Yan etki: butun ligler yeniden sampiyon uretiyor

```text
                       ONCE (100 sezon)        SONRA (100 sezon)
Dutch Division 1       6 sampiyon / 100        1 sampiyon / 100
English Division 1     2 sampiyon /   7  <-boş  2 sampiyon / 100
French Division 1      2 sampiyon /   6  <-boş  2 sampiyon / 100
German Division 1      2 sampiyon /   6  <-boş  2 sampiyon / 100
```

## Regresyon kontrolu

```text
npx tsc --noEmit    temiz
npm test            804 / 804 gecti
world.db            dokunulmadi (7.080 oyuncu, 252 kulup, 0 FK ihlali)
```

---

## DUZELTMELERIN ACIGA CIKARDIGI IKI YENI BULGU

Bunlar duzeltmelerin YARATTIGI sorunlar degil; piramit cokusu ve kupa
sismesi tarafindan GIZLENEN, artik olculebilir hale gelen sorunlardir.

### 🟠 YENI-1 Sampiyonluk yogunlasmasi asiri

```text
Dutch Division 1      Eindhoven Rood   100 / 100 sezon  (%100)
English Division 1    Merseyside Red    99 / 100 sezon  (%99)
French Division 1     Paris Bleu        99 / 100 sezon  (%99)
German Division 1     München Rot       99 / 100 sezon  (%99)
```

**Sebep:** `LeagueModel.resolveCheap()` tek eksen kullanir --
`strength(clubId) = club.reputation`. Itibar kariyer boyunca yalnizca
terfi/dusmede (±8) degisir; kadro degisimleri, transferler ve hoca etkisi
lig macina HIC girmez. En itibarli kulup her sezon kazanir.

Onceki olcumde bu gorunmuyordu cunku ligler dokuz sezonda bosaliyordu.

**Siniflandirma:** BALANCE ISSUE · **Severity:** 🟠 HIGH

### 🟡 YENI-2 Kupalar kariyer basina yalnizca BIR KEZ oynanabiliyor

`SeasonRunner` ve `BuiltSeason` kariyer basina BIR KEZ kurulur; sezon devri
yoktur. `CupCompetition` bracket'i bitince bir daha kurulmaz. Onceki kod bunu
ayni sampiyonlugu her hafta yeniden bildirerek GIZLIYORDU.

```text
20 kariyerde kupa kaynagi:  league 389 · cup 0
```

Duzeltme `SeasonRunner.resetSeason()` + kupa bracket'inin yeniden
tohumlanmasini ve takvimin rezerve turlarinin yeniden doldurulmasini
gerektirir -- P0 kapsaminin disinda, ayri bir calisma.

**Siniflandirma:** CONFIRMED BUG (onceden maskeliydi) · **Severity:** 🟡 MEDIUM

---

# EK-2: IKINCI TUR DUZELTMELER (2026-09-14)

P0 ucllusunden sonra "sampiyonluk yogunlasmasi" incelenirken **daha buyuk bir
CRITICAL hata** bulundu. Once yanlis teshis konuldu, sonra olcumle duzeltildi.

## Yanlis teshis ve duzeltilmesi

Ilk hipotez: *"`LeagueModel.strength()` statik `reputation` okuyor, kadro
degisimi maca girmiyor; bu yuzden en itibarli kulup hep kazaniyor."*

Hipotez dogrulanmak icin gercek tablo basildi ve teshis **curudu**:

```text
English Division 1 -- sezon sonu tablolari

Sezon 1  West London Blue       O38 G19 B 9 M10 P66   <- saglikli, rekabetci
         Brighton & Hove Black  O38 G19 B 9 M10 P66      (guc 86 olan kulup
         Manchester Blue        O38 G18 B10 M10 P64       guc 94'u yakaliyor)
Sezon 2  butun kulupler         O 0 G 0 B 0 M 0 P 0   <- HIC MAC YOK
Sezon 3  ayni                   O 0 ...
```

Birinci sezon zaten dengeliydi. Sorun denge degil, **ikinci sezondan
itibaren hic mac oynanmamasiydi**. Bos bir tabloda `standings()` butun
kulupleri 0 puanla doner ve listedeki ilk kulup her sezon "sampiyon"
sayilir -- "%99 yogunlasma" bunun belirtisiydi.

## 🔴 #11 IKINCI SEZONDAN ITIBAREN HIC MAC OYNANMIYOR

**Konum:** `src/simulation/SeasonRunner.ts` — `playWeek()`

```ts
for (const fixture of fixtures) {
  if (this.results.has(keyOf(fixture))) continue;   // <- results HIC temizlenmiyor
  ...
}
```

`results` haritasi bir fiksturun ikinci kez cozulmesini engeller. Sezonlar
arasi temizlenmedigi icin birinci sezonun sonunda butun fikstur anahtarlari
haritadadir ve sonraki her sezon her fiksturu atlar.

**Downstream etki:** Bu tek hata, denetimin "dunya katmani" bolumundeki
neredeyse butun anormalliklerin ortak kaynagiydi -- sampiyonluk
yogunlasmasi, kadro gucunun 10. sezondan sonra donmasi ve kupa sisme
etkisinin buyuklugu.

**Duzeltme:** `SeasonRunner.resetSeason()` eklendi (`results` + haftalik tac
listesi temizlenir); `dbWorld.finishSeason()` cagiriyor.

**Siniflandirma:** CONFIRMED BUG · **Severity:** 🔴 CRITICAL

## Ek duzeltme: lig maci artik kadroyu goruyor

Ilk hipotez curusa da altindaki gozlem dogruydu: `strength()` gercekten
yalnizca statik `reputation` okuyordu ve transferler lig sonucuna hic
girmiyordu. `LeagueModel` artik opsiyonel bir kadro gucu cozucusu aliyor:

```text
strength = clamp(reputation + (kadroGucuSimdi - kadroGucuBaslangic) * 2.5)   |kayma| <= 20
```

Itibar CIPA olarak kalir (18-96 bandina kalibre edilmis), kadro degisimi
uzerine binder. Dogrudan kadro gucu kullanmak guc farkini ezerdi: kadro
gucu 66-90 bandinda, cok daha dar. `dbWorld` cozucuyu onbellekli saglar ve
onbellek transferde temizlenir.

Mock dunya ve testler cozucu VERMEZ -> eski davranis aynen korunur.

## Olculen sonuc

### Rekabet dengesi (100 sezon)

| Lig | ONCE | SONRA |
|---|---|---|
| English Division 1 | 2 sampiyon · tek kulup **%99** | **16 sampiyon** · en cok %24 |
| German Division 1 | 1 sampiyon · **%100** | **9 sampiyon** · en cok %23 |
| English Division 2 | 3 sampiyon · %50 | **18 sampiyon** · en cok %17 |
| French Division 1 | 2 sampiyon · %99 | 10 sampiyon · %50 |
| Dutch Division 1 | 1 sampiyon · %100 | 6 sampiyon · %52 |

### Kariyer katmani (20 kariyer)

```text
                    ILK OLCUM      P0 SONRASI      SIMDI
kupa_sayisi         ortanca 82     ortanca 20.5    ortanca 2  (max 4)
sohret zirvesi      legend 85/100  legend 18/20    star 6 · superstar 7 · icon 3 · legend 4
sohret tur payi     legend %46     legend %38      starter %33 · star %32 · superstar %15
                                                   · icon %7 · legend %7
```

Yedi kademeli sohret merdiveni **ilk kez gercekten kullaniliyor**.

### Regresyon

```text
npx tsc --noEmit    temiz
npm test            804 / 804  (58 dosya)
ihlal taramasi      sakatken 0 · cezaliyken 0
world.db            dokunulmadi
```

## KALAN BILINEN SINIRLAR

| # | Sinir | Sebep | Severity |
|---|---|---|---|
| A | Kupalar kariyer basina bir kez oynanir | `materializeRound` takvime fikstur EKLER; yeniden tohumlamak kopya mac yazar | 🟡 MEDIUM |
| B | Fikstur listesi 1. sezon uyeliklerine sabit | Terfi/dusme sonrasi kulup baska ligde ama fikstur eski ligi tasiyor; oynanan mac 38 -> 32'ye duser | 🟡 MEDIUM |
| C | Emekli oyuncu mac oynuyor (#4) | `availability` onbellegi emeklilik turunda bayat | 🟠 HIGH |
| D | Emeklilik sonrasi olu donem (#5) | `checkEnding` erken cikisi | 🟠 HIGH |
| E | FC26 nitelikleri motorca okunmuyor (#6) | Kadro sorgusuna eklenmemis | 🟠 HIGH |

A ve B ayni koke bagli: **takvim kariyer basina bir kez kuruluyor, sezon
basina yeniden kurulmuyor.** Ikisini birlikte cozmek `SeasonCalendar`
seviyesinde ayri bir calisma.

---

# EK-3: KALAN UC BULGU DA DUZELTILDI (2026-09-14)

## #4 EMEKLI OYUNCU MAC OYNUYOR -> COZULDU

**Ilk deneme yanlisti ve olcumle yakalandi.** `advanceTurn()` icinde
`checkEnding()` sonrasina uygunluk tazelemesi konuldu -- vakia sayisi
degismedi (5/20). Sebep: emeklilik `advanceTurn` sirasinda degil, oyuncu
bir olayda "birak" sectiginde gerceklesiyor.

**Dogru kapi:** `beginRetirement()` -- emekliligin TEK girisi.

```ts
if (!this.setLifeState('retired')) { ... }
this.state.availability = this.suspensionAvailability();   // <- eklendi
```

`suspensionAvailability()` zaten dogru sonucu uretiyordu
(`canPlay('retired') === false`); eksik olan NE ZAMAN cagrildigiydi.

```text
100 kariyer:  27 vakia  ->  0 vakia
```

## #5 EMEKLILIK SONRASI OLU DONEM -> COZULDU

Burada da ilk teshis eksikti. `checkEnding()`in yas kapisi gevsetildi ama
olcum degismedi (ortanca 108 tur). Gercek sebep daha derindeydi:

**Dort icerik olayi emekligi `beginRetirement()`i ATLAYARAK yaziyordu:**

```text
evt_life_prison_release            "lifeState" -> "retired"
evt_legal_fixer_itiraf_orta        ayni
evt_media_journalist_golge_orta    ayni
evt_media_journalist_itiraf_orta   ayni
```

Bu yolda `retired` bayragi ve `retiredAtTurn` HIC yazilmiyordu; dolayisiyla
`checkEnding()` kariyeri kapatamiyordu ve oyuncu `retired` durumunda --
mac/roportaj/transfer/milli kategorileri kapali halde -- yas 41 olana kadar
asili kaliyordu.

**Duzeltme:** `lifeState` efekti `retired` hedefliyorsa `beginRetirement()`e
yonlendirilir. Emeklilik artik TEK kapidan gecer.

```text
100 kariyer, 41 yasindan once emekli olanlar
                ONCE                    SONRA
olu tur         ortanca 116, max 728    ortanca 8, max 12
yapilandirma    12                      12   <- artik tutuyor
```

## #6 FC26 NITELIKLERI MOTORA BAGLANDI -> COZULDU

Kadro sorgusuna dort kolon eklendi ve tuketicilerine baglandi:

| Kolon | Onceki durum | Simdi |
|---|---|---|
| `aggression` | `aggressionFor()` mevkiden tahmin | DB degeri; `MatchSimulator` faul esigi |
| `composure` | `shooter.quality` vekil | DB degeri; `MathChanceResolver` %30-40 agirlik |
| `intl_reputation` | okunmuyor | `leadership` turetmesinde ucuncu girdi |
| `shirt_number` | tohumdan cekiliyor | gercek forma numarasi |

`composure` icin `RosterPerson` ve `FieldPlayer` sozlesmelerine OPSIYONEL
alan eklendi. `PlayerAttributes` icine KONULMADI: o arayuz motorun mevki
agirliklandirma sozlesmesidir (`POSITION_WEIGHTS` tam olarak o alti alani
agirliklandirir) ve yedinci alan `overallFor()` sonucunu kaydirirdi.

**Dogrulama (Madrid Blanco, 30 oyuncu):**

```text
oyuncu                  DB agg  motor agg   DB comp  motor comp   DB no  motor no
Kylian Mbappé Lotten        61         61        88          88      10        10
Antonio Rüdigor             93         93        80          80      22        22
Thibaut ... Courtoes        23         23        66          66       1         1

tum kadro: aggression 30/30 · composure 30/30 · forma no 30/30
eski mevki tahmininden ortalama sapma: 16.7 puan
```

Sapma bu duzeltmenin neden onemli oldugunu gosteriyor: Rüdiger'in gercek
sertligi 93, mevki tahmini 62 idi; Courtois'nin 23, tahmin 36.

## NIHAI DURUM (100 kariyer, butun duzeltmeler sonrasi)

```text
KRITIK IHLAL TARAMASI
   sakatken oynama       0
   cezaliyken oynama     0
   emekliyken oynama     0        <- ONCE 27
   uygunsuzken oynama    0
   oynamadan gol/asist   0

EMEKLILIK
   41 oncesi emekli      84/100
   olu donem             ortanca 8 tur, max 12     <- ONCE ortanca 116, max 728

SOHRET MERDIVENI (yedi kademe de kullaniliyor)
   zirve   starter 10 · star 18 · superstar 31 · icon 14 · legend 27
   tur payi  starter %38 · star %25 · superstar %17 · icon %8 · legend %7
   ONCE      legend 85/100, tur payi legend %46

KUPA        ortanca 2, max 7        <- ILK OLCUM ortanca 82, max 618
ISTATISTIK  0/100 uyusmazlik
```

## REGRESYON

```text
npx tsc --noEmit    temiz
npm test            804 / 804  (58 dosya)
world.db            dokunulmadi
```

Iki test fiksturu gercek semayla hizalandi (`competition.country_id`,
`player`in dort FC26 kolonu). Fikstur gercek tabloyu taklit ettigi icin
hizalanmasi zorunluydu; beklentiler gevsetilmedi, aksine `country`
okunmasini dogrulayan yeni bir beklenti eklendi.

## KALAN SINIRLAR (degismedi)

| # | Sinir | Kok neden |
|---|---|---|
| A | Kupalar kariyer basina bir kez oynanir | Takvim kariyer basina bir kez kuruluyor |
| B | Fikstur listesi 1. sezon uyeliklerine sabit (38 -> 32 mac) | Ayni kok |
| C | GK/DF kariyeri hic uretilmiyor | Pozisyon uretimi -- ayri inceleme |
| D | Ev sahibi avantaji zayif (2.4 puan) | `HOME_EDGE` kalibrasyonu |
| E | Kulup ekonomisi modellenmemis | Gelir/gider katmani yok |

---

# EK-4: SEZON DEVRI -- SEASONCALENDAR (2026-09-14)

Kalan iki yapisal sinir (A: kupalar kariyer basina bir kez, B: fikstur
listesi 1. sezon uyeliklerine sabit) **ayni koke** bagliydi: takvim kariyer
basina BIR KEZ kuruluyordu. Ikisi birlikte cozuldu.

## Yaklasim

`buildSeasonSchedule()` zaten SAF bir fonksiyon -- sifirdan tam bir sezon
kurar (ligler + kupalar + kita turnuvasi, yeni bir `FixtureIndex` ile).
Dolayisiyla dogru cozum her yere `reset()` serpistirmek degil, **her sezon
takvimi guncel uyeliklerle YENIDEN KURMAKTI.**

### Degisen dosyalar

```text
src/simulation/MatchSimulator.ts   useSchedule() -- gec baglama
                                   (useChemistrySource ile ayni desen)
src/adapters/dbWorld.ts            buildFor(seasonIndex, standings)
                                   schedule / runner artik GETTER
                                   finishSeason() sezonu devrediyor
```

### `buildFor()` ne yapiyor

1. **Lig uyeliklerini `LeagueModel`den okur.** `clubs` dizisindeki `league`
   alani terfi/dusme sonrasi BAYATTIR; `league.leagueFor(clubId)` canli
   esleme tutar.
2. **Sampiyonlar Ligi elemesini gecen sezonun puan durumundan yapar.**
   `qualify()` zaten opsiyonel bir `order` parametresi kabul ediyordu --
   tasarimda vardi, kullanilmiyordu. Ilk sezon itibara duser.
3. **Tohuma sezon numarasini karistirir.** Karismasaydi yirmi sezon boyunca
   ayni haftada ayni eslesme oynanirdi.

## Olculen sonuc

### Lig -- her sezon TAM fikstur

```text
English Division 1, sezon sonu tablolari

           ONCE                          SONRA
Sezon 1    O38  West London Blue   P66   O38  West London Blue   P66
Sezon 2    O32  (eksik fikstur)          O38  Merseyside Red     P72
Sezon 3    O32  (eksik fikstur)          O38  East London Iron   P68  <- guc 83,
                                                                        95'likleri gecti
```

### Kupalar -- artik her sezon oynaniyor

```text
                                ONCE            SONRA
kupa kaynagi (100 kariyer)      league 389      league 130 · cup 154
                                cup 0
ayni sezon/ayni turnuva tekrari  -              max 1
seed=90000 kupa kazandigi sezon  -              7, 10, 14, 17
kupa_sayisi                     ortanca 2       ortanca 3, max 10
```

### Mac cesitliligi geri geldi (100 kariyer, 89.020 mac)

```text
league 79.502 · cup 4.711 · european 4.529 · cup_final 278
```

Kupa ve Avrupa maclari onceden yalnizca birinci sezonda vardi.

### Rekabet dengesi (100 sezon)

```text
                      ILK OLCUM        P0 SONRASI        SIMDI
English Division 1    2 sampiyon %99   16 sampiyon %24   15 sampiyon %27
English Division 2    3 sampiyon %50   18 sampiyon %17   27 sampiyon %9
German Division 1     1 sampiyon %100   9 sampiyon %23   11 sampiyon %22
```

German Division 1'i en cok kazanan kulup `Denbury Northgate` -- terfi etmis
bir kulup. Piramit gercekten dolasiyor.

### Kariyer katmani (100 kariyer)

```text
KRITIK IHLAL
   sakatken / cezaliyken / emekliyken / uygunsuzken oynama : 0 / 0 / 0 / 0
   oynamadan gol-asist                                      : 0
   istatistik uyusmazligi                                   : 0/100

SOHRET MERDIVENI -- yedi kademe de kullaniliyor, dengeli dagilim
   zirve    starter 7 · star 22 · superstar 26 · icon 21 · legend 24
   tur payi starter %34 · star %29 · superstar %17 · icon %8 · legend %7

EMEKLILIK   41 oncesi 80/100 · olu tur ortanca 8, max 12  (yapilandirma 12)
MAC / GOL   hero ortanca 519 mac · 73.5 gol
```

## Regresyon

```text
npx tsc --noEmit    temiz
npm test            804 / 804  (58 dosya)
world.db            dokunulmadi
```

Maliyet: 100 kariyer 243 sn -> 393 sn (sezon basina takvim yeniden
kurulumu). Kabul edilebilir -- karsiliginda dunya gercekten yasiyor.

## KALAN SINIRLAR

| # | Sinir | Severity |
|---|---|---|
| C | GK/DF kariyeri hic uretilmiyor (yalnizca FW/MF) | 🟡 MEDIUM |
| D | Ev sahibi avantaji zayif (2.4 puan; gercekte ~18) | 🟡 MEDIUM |
| E | Kulup ekonomisi modellenmemis (gelir/gider/prim yok) | 🟡 MEDIUM |
| F | Gol uretimi dusuk (1.88/mac; gercekte ~2.7), 0-0 %15 | 🔵 LOW |
| G | `loaned` hayat durumu hic olusmuyor | 🔵 LOW |
| H | 19 tablo / 79 kolon motor tarafindan okunmuyor | 🟡 MEDIUM |

---

# EK-5: MAC MODELI KALIBRASYONU (2026-09-14)

Kalan iki denge sorunu (D: ev sahibi avantaji zayif, F: gol uretimi dusuk)
**ayni modelde** oldugu icin birlikte ele alindi.

> NOT: "GK/DF kariyeri uretilmiyor" maddesi listeden CIKARILDI -- bu bir
> hata degil, bilincli olarak kapatilmis bir kapsam karari.

## Teshis -- nerede kayboluyordu

`Timeline` pozisyon uretir, `MathChanceResolver` onu gole cevirir. Ikisi
AYRI olculdu (`tmp/audit/calib.ts`):

```text
seviye 70, denk takimlar, varsayilan taktik
   pozisyon/mac  24.9      <- HEDEF ~24   DOGRU
   ort xG        0.0787    <- HEDEF ~0.11  DUSUK
   gol/mac       1.96      <- gercek ~2.7
```

Pozisyon uretimi dogruydu; kayip DONUSUMDE. Tur bazinda:

```text
tur          taban xG   gercek xG   carpan
open_play       0.110      0.0681    0.619
header          0.120      0.0798    0.665
long_range      0.040      0.0252    0.631
one_on_one      0.350      0.2332    0.666
free_kick       0.070      0.0474    0.678
```

**Her pozisyon turu ilan ettigi xG'nin ucte ikisine dusuyordu.**

### Kok neden: carpanlar notr degildi

Dort carpan (geometri, sutor, baski, kaleci) tek tek makul gorunuyordu ama
TIPIK girdilerde carpimlari 1.0 degil ~0.63 ediyordu:

```text
shooterFactor(skill 70)   = 0.55 + 0.63  = 1.18
defenceFactor(pressure 60)= 1.15 - 0.33  = 0.82
keeperFactor(keeper 75)   = 1.18 - 0.34  = 0.84
geometryFactor(ortalama)                 ~ 0.75
                                 carpim  = 0.63
```

`BASE_XG` tablosu "open_play = 0.11" diyordu ama hicbir zaman 0.11
uretmiyordu. Tabloyu duzenleyen biri sonucun ne olacagini bilemezdi.

## Duzeltme 1 -- carpanlari notr noktalarina oturt

EGIMLER KORUNDU, yalnizca tabanlar kaydirildi:

```ts
const NEUTRAL_SHOOTER = 0.37;  // skill 70    -> 1.00
const NEUTRAL_PRESSURE = 1.33; // pressure 60 -> 1.00
const NEUTRAL_KEEPER = 1.3375; // keeper 75   -> 1.00
```

```text
gol/mac 1.96 -> 2.39 · ort xG 0.078 -> 0.096
```

## Duzeltme 2 -- acik global kalibrasyon

Notr noktalardan sonra bile geometri ortalamada 1.0 vermiyor: `Timeline`
pozisyonlari referans geometrinin biraz altinda uretiyor (aci U[12,72],
ortalama 42 -- referans 45). Bu bilincli olabilir, ama sonucu tabloyu
sessizce asagi cekmek. Fark artik ACIK bir sabitle kapatiliyor:

```ts
const XG_CALIBRATION = 1.11;   // olculdu: seviye 75'te ~2.7 gol/mac
```

## Duzeltme 3 -- ev sahibi avantaji SIMETRIK ve guc farkindan BAGIMSIZ

Eski hali: `HOME_ADVANTAGE = 4`, yalnizca ev sahibinin hucumuna ekleniyordu.

Analitik tablo (bagimsiz Poisson, denk takimlar, taban 1.33 gol/takim):

```text
tek tarafli (ev +h%)           simetrik (ev +h%, dep -h%)
 h=4   avantaj  2.4  gol 2.71   h=4   avantaj  4.9  gol 2.66
 h=20  avantaj 11.8  gol 2.93   h=14  avantaj 17.2  gol 2.66   <- secildi
 h=24  avantaj 14.0  gol 2.98   h=20  avantaj 24.4  gol 2.66
```

Tek tarafli uygulama avantaji buyutmek icin TOPLAM golu sismek zorunda
birakiyordu. Simetrik uygulama toplami sabit tutup farki aciyor.

### Ilk deneme YANLISTI ve test yakaladi

Avantaj once hucum degerine eklendi (`attack + HOME_ADVANTAGE`), yani guc
farkinin ICINE karisti. `MatchSimulator.test.ts` dusdu:

```text
FAIL  guclu takim zayifi genelde yener AMA her zaman degil
      expected 0 to be greater than 0
```

Elit ev sahibi vs amator deplasman eslesmesinde deplasmanin oranini tabana
yapistiriyor ve surprizi IMKANSIZ kiliyordu -- 60 tohumda sifir deplasman
galibiyeti. Gercek futbolda ev avantaji takim gucuyle olceklenmez.

**Duzeltildi:** avantaj artik orana carpilan bagimsiz bir katsayi.

## Duzeltme 4 -- iki mac cozucusu ayni futbolu oynuyor

`LeagueModel.resolveCheap` NPC maclarini (yani lig tablosunun tamamini)
cozer; `MatchSimulator` yalnizca Hero'nun macini. Ikisi AYRI kalibreydi:

```text
ucuz cozucu : 1.60 / 1.35 -> 2.95 gol/mac · ev payi %54.2
simulator   : 0.94 / 0.90 -> 1.85 gol/mac · ev payi %51
```

Hero'nun takimi tabloya simulator skoruyla, rakipleri ucuz cozucu skoruyla
yaziliyordu -- **ayni ligde iki ayri gol rejimi.** Ikisi de artik takim basi
1.33 gol ve +/-%14 ev avantajina kalibre.

## OLCULEN SONUC (60 kariyer, 52.189 mac)

| Olcu | ONCE | SONRA | Gercek futbol |
|---|---|---|---|
| gol/mac | 1.85 | **2.51** | ~2.7 |
| 0-0 orani | %15.7 | **%8.0** | ~%7-8 |
| ev sahibi gol | 0.94 | **1.43** | ~1.5 |
| deplasman gol | 0.90 | **1.08** | ~1.2 |
| ev avantaji | 3.4 puan | **17.1 puan** | ~18 |
| denk takim ev G% | %34.6 | **%44.1** | ~%46 |
| denk takim ber% | %31.6 | **%26.0** | ~%26 |
| denk takim dep G% | %32.2 | **%27.0** | ~%28 |

Skor dagilimi artik gercekci:

```text
1-1 %12.2 · 1-0 %11.6 · 0-1 %9.0 · 2-1 %8.8 · 2-0 %8.6 · 0-0 %8.0
```

Lig tablolari da saglikli -- 1. sezon English Division 1:

```text
Manchester Red           O38 G18 B12 M 8 AV 16 P66  | guc 92
North London Red         O38 G19 B 8 M11 AV 13 P65  | guc 95
Wolverhampton Northgate  O38 G18 B 9 M11 AV 10 P63  | guc 81   <- surpriz mumkun
```

Rekabet dengesi korundu (60 sezon): English D1 15 sampiyon (%20),
English D2 23 sampiyon (%13), German D1 12 sampiyon (%22).

## REGRESYON

```text
npx tsc --noEmit    temiz
npm test            804 / 804  (58 dosya)
ihlal taramasi      sakatken 0 · cezaliyken 0 · emekliyken 0
world.db            dokunulmadi
```

## KALAN

| # | Sinir | Severity |
|---|---|---|
| E | Kulup ekonomisi modellenmemis (gelir/gider/prim/sponsorluk yok) | 🟡 MEDIUM |
| G | `loaned` hayat durumu hic olusmuyor | 🔵 LOW |
| H | 19 tablo / 79 kolon motor tarafindan okunmuyor | 🟡 MEDIUM |

---

# EK-6: KULUP EKONOMISI (2026-09-14)

Denetimde nedensellik zincirinin iki halkasi **NOT IMPLEMENTED** cikmisti:

```text
Lig sirasi -> gelir        YOKTU
Gelir -> gelecek butce     YOKTU
```

`club.budget_transfer` veritabaninda SABIT bir sayiydi ve kariyer boyunca
hic degismiyordu. Sportif basari ekonomiye, ekonomi de gelecek transferlere
hic donmuyordu.

## Mimari karar: kariyer durumu, world.db degil

world.db SALT OKUNUR ve kariyer boyunca degismez; ayni dunyada yirmi
kariyer oynanir ve her birinde ekonomi FARKLI gelismelidir. Bu yuzden
`ClubFinance` `TransferOverlay` ile ayni yerde durur: veritabanindan
TOHUMLANIR, bellekte yasar, kariyerle birlikte olur. Hicbir tablo
degistirilmedi.

### Degisen dosyalar

```text
src/simulation/ClubFinance.ts      YENI -- defter, gelir, gider, butce
src/simulation/TransferMarket.ts   butce defterden okunur (opsiyonel bagimlilik)
src/adapters/dbWorld.ts            kurulum + sezon sonu mutabakati
```

Bagimlilik OPSIYONEL: mock dunyada ve testlerde defter verilmez, piyasa eski
ic butce haritasini kullanir ve davranis aynen surer.

## Nedensellik yapisi (kasitli)

```text
ticari gelir  <- KADRO DEGERI, ALTDOGRUSAL (^0.85)
prim          <- LIG ITIBARI^2 x SEZON SONU SIRASI  + kupa primi
maas faturasi <- KADRO DEGERI, DOGRUSAL
isletme       <- GELIRIN %34'u
```

**Altdogrusal gelir + dogrusal maas = kendiliginden frenli sistem.** Kadro
degerini iki katina cikaran kulubun maasi iki katina cikar ama geliri
yalnizca ~%80 artar. Denetimin "economic snowball" sorusunun yapisal
cevabi budur: buyume kendi maliyetini uretir. Degisken kismi PRIM tasir --
yani "basari -> gelir" baglantisi.

Lig itibari prime KARESIYLE girer: zayif bir ligin sampiyonlugu guclu bir
ligin sampiyonlugu kadar para etmemeli, yoksa kucuk ligde kalmak ekonomik
olarak avantajli hale gelirdi.

## Iki ara sonuc, iki duzeltme

### 1. Kasa sismesi

Ilk surumde yalnizca maas gideri vardi:

```text
50 sezon sonunda kasa:  min 529.9M · ortanca 1.992M · maks 8.882M
```

Her kulup her sezon buyuk kar ediyordu. Gercek futbolda kulupler basabasa
yakin calisir. `OPERATING_RATE = 0.34` eklendi (stadyum, teknik heyet,
akademi, amortisman).

### 2. Kasa OLU DEGISKEN oldu

Isletme giderinden sonra bile kasa ortancasi 810M'e cikiyordu -- yillik marj
~%5, gercekci, ama 50 sezon birikiyor. Daha ince bir kusur dogurdu: kasa o
kadar buyudu ki butce HER ZAMAN tavana (gelirin %80'i) carpiyor ve `cash`
hicbir seyi etkilemiyordu.

**Denetimin kendi "COSMETIC / DEAD SYSTEM" tanimina giren bir durum.**
`CASH_CAP_RATIO = 1.5` eklendi (kar dagitimi / modellenmeyen altyapi
yatirimi) ve `BUDGET_FROM_CASH` 0.4 -> 0.25 dusuruldu.

Kanit: `gelir -> butce` korelasyonu **0.992 -> 0.940**. Dusus IYI bir
isarettir -- kasa artik butcenin bagimsiz bir etkeni.

## OLCULEN SONUC (50 sezon, 252 kulup)

### Lig sirasi -> gelir ✅ (eski durum: NOT IMPLEMENTED)

```text
English Division 1, sezon sonu sirasina gore ortalama gelir
   ilk 4     369.1M
   5-8       336.6M
   9-14      303.1M
   15-20     200.4M     <- monoton, 1.84x yayilim
```

### Gelir -> gelecek butce ✅ (eski durum: NOT IMPLEMENTED)

```text
r = 0.940   (12.600 gozlem)
```

### Snowball YOK

```text
50 sezonda gelir carpani: min 0.45x · ortanca 1.02x · maks 1.92x
en cok buyuyen  Eastmoor Highbridge  142.3M -> 272.8M  (1.92x)
en cok kuculen  Merseyside Red       543.0M -> 264.8M  (0.49x)
```

Devler kuculuyor, orta kulupler buyuyor -- piyasa kendi kendini dengeliyor.

### Dead club YOK

```text
negatif kasa                 0/252
butcesi tabanda (2M) kalan   0/252
son kasa    min 24.2M · ortanca 95.1M · maks 557.0M
son butce   min  9.3M · ortanca 36.5M · maks 225.6M
```

### Rekabet dengesi korundu (60 sezon)

```text
English Division 1   17 farkli sampiyon · en cok %15
English Division 2   22 farkli sampiyon · en cok %10
German Division 1    11 farkli sampiyon · en cok %23
```

### Kariyer katmani bozulmadi (30 kariyer)

```text
ihlal            sakatken 0 · cezaliyken 0 · emekliyken 0
istatistik       0/30 uyusmazlik
gol/mac          2.49
turnuva          league 22.696 · european 1.439 · cup 1.359 · cup_final 104
```

## NEDENSELLIK ZINCIRI -- GUNCEL KARNE

| Baglanti | Ilk denetim | Simdi |
|---|---|---|
| Oyuncu niteligi -> kadro gucu | ✅ PASS | ✅ PASS |
| Hoca -> hat gucu | ✅ PASS | ✅ PASS |
| Hakem -> kart/penalti | ✅ PASS | ✅ PASS |
| Kulup gucu -> mac sonucu | ⚠️ WARNING | ✅ PASS |
| Mac sonucu -> lig sirasi | ❌ FAIL | ✅ PASS |
| **Lig sirasi -> gelir** | ❌ NOT IMPLEMENTED | ✅ **PASS** |
| **Gelir -> gelecek butce** | ❌ NOT IMPLEMENTED | ✅ **PASS** |
| Butce -> transfer | ⚠️ WARNING | ✅ PASS |
| Transfer -> kadro gucu | ✅ PASS | ✅ PASS |
| Kupa -> sohret | ❌ FAIL | ✅ PASS |
| Olay -> durum -> gelecek olay | ✅ PASS | ✅ PASS |

**Dongu kapandi.** Transfer -> kadro -> sonuc -> sira -> gelir -> butce ->
transfer zinciri artik uctan uca calisiyor.

## REGRESYON

```text
npx tsc --noEmit    temiz
npm test            804 / 804  (58 dosya)
world.db            dokunulmadi -- tek satir yazilmadi
```

## KALAN

| # | Sinir | Severity |
|---|---|---|
| G | `loaned` hayat durumu hic olusmuyor | 🔵 LOW |
| H | `staff_assignment` · `player_agency` · `city` motorca okunmuyor | 🟡 MEDIUM |

---

# EK-7: TAM REGRESYON DENETIMI (2026-09-14)

Butun duzeltmeler tamamlandiktan SONRA yapilan dogrulama kosumu. Amac kesif
degil: orijinal raporun her bulgusunu tek tek "kapandi mi, geri geldi mi" diye
sinamak ve duzeltmelerin BIRLIKTE calistigini gostermek. Her duzeltme kendi
olcumunde gecmisti; hicbiri bir arada olculmemisti.

**Kod ve veritabani degisikligi YAPILMADI.** Yalnizca olcum araclarinda iki
duzeltme var (asagida "Kendi olcum hatalarim") ve bir hizalama: careers.ts /
endings.ts / epilogue.ts artik gercek host gibi useManagerSource baglantisini
kuruyor -- yoksa olcum, oyunun oynanan halinden baska bir sistemi olcerdi.

## Kosum

| Arac | Kapsam |
|---|---|
| careers.ts | 100 kariyer, 21.035 tur, 88.283 mac, 83.984 olay |
| world.ts + latetable.ts | 100 sezon, 252 kulup, 13 lig, 8.400 transfer |
| economy.ts | 50 sezon, 12.600 defter gozlemi |
| endings.ts | 60 kariyer |
| moments.ts (yeni) | 8 kariyer, 6.937 mac, mac ani sayimi |
| pyramid / calib / controlled / lines / table / fc26wire / sacking / dbcolumns | tam |

## Kendi olcum hatalarim (raporlanmadan once yakalandi)

Bu bolumu ayri tutuyorum cunku alti tanesi de "bulgu" gibi gorunup bulgu
OLMAYAN seylerdi. Hicbiri rapora bulgu olarak girmedi.

| Gorunen | Gercek |
|---|---|
| "21 ligin 8'i hic mac oynamiyor" | O 8'i KUPA (seviye 9, eleme usulu). Gercek lig 13, hepsi oynuyor. |
| "100 kariyerin 100'unde ending yok" | careers.ts:285 `final.ending?.id` yaziyordu; ending bir STRING. Harness hatasi, duzeltildi. |
| "Emekli oyuncu 1.491 mac oynuyor" (#4 geri geldi) | 1.491 kaydin HEPSINDE minutes=0, availReason=retired. Kulubun maci devam ediyor, Hero oynamiyor. |
| "21 mac ani olayi hic cikmadi" | careers.ts:126 moment olaylarini deftere bilerek almiyor. Dogrudan olculdu: 6.937 macta 2.916 mac ani, 21 olayin 19'u. |
| "transfer_listed %36 -> %49, kotulesme" | 20 kariyerlik endings.ts ornegi yanli. 100 kariyerlik tam olcum: %25.0 -- iyilesme. |
| "52 olay hic uygun olmadi" (eskiden 14) | Moment + scheduledOnly olaylari defterin disinda. Izlenen kumede sayi 14 -- degismemis. |

## Dogrulama matrisi -- orijinal EN ONEMLI 10

| # | Problem | Eski olcum | Yeni olcum | Durum |
|---|---|---|---|---|
| 1 | Terfi/dusme ulkeyi gormuyor | 21 ligin 19'u bosaliyor | 12 sezon, her ligin boyutu SABIT; terfi/dusme ulke ici | KAPALI |
| 2 | Transfer piyasasi oluyor | 79.5 -> 0.0/sezon | 100 sezon: ilk 10 ort 84.0, son 10 ort 84.0 | KAPALI |
| 3 | Kupa sayimi tekrarli | 1 kupa 10x, 85/100 legend | 362 kupa/100 kariyer, ortanca 4, max 11 | KAPALI |
| 4 | Emekli oyuncu mac oynuyor | 27 mac | 0 mac (1.491 kayit var, hepsi minutes=0) | KAPALI |
| 5 | Veda donemi 116 tur | ort 116, max 728 | min 12, max 12, ort 12.0 | KAPALI |
| 6 | FC26 nitelikleri okunmuyor | 4 kolon olu | 30/30 oyuncu: aggression, composure, forma no motora ULASIYOR | KAPALI |
| 7 | loaned hic olusmuyor | 0 kez | 0 kez (21.035 turda) | ACIK |
| 8 | Kariyerin %36'si transfer_listed | %36 | %25.0 (playing %57.7) | IYILESTI |
| 9 | 19 tablo / 79 kolon okunmuyor | 19 tablo | 6 tablo / 75 kolon -- ve 6'si da MESRU (import/soyagaci) | KAPALI |
| 10 | Ev avantaji yok (2.4 puan) | %34.6 vs %32.2 | %45.0 / %26.2 / %28.8 (gercek futbol 45/25/30) | KAPALI |
| 11 | 2. sezondan sonra hic mac yok | 0 mac | 1., 2., 3., 25., 50., 100. sezonda 9.352 mac-katilimi, birebir ayni | KAPALI |

Orijinal 10 problemden 9'u kapali, 1'i (loaned) acik.

## Nedensellik zinciri -- ucu uca calisiyor

Tek tek degil, BIRLIKTE olculdu:

| Halka | Olcum |
|---|---|
| itibar farki -> mac sonucu | +20 fark %56.9 galibiyet, denk %45.4, -20 fark %32.7 (monoton) |
| lig sirasi -> gelir | ilk 4: 369.0M, 5-8: 345.5M, 9-14: 286.2M, 15-20: 206.3M (monoton) |
| gelir -> gelecek butce | r = 0.936 (12.600 gozlem) |
| kadro -> lig gucu | 100 sezonda 72/252 kulubun gucu degisti (-10 .. +4) |
| hoca -> takim gucu | gercek veriyle +3/+4 OVR; kotu hoca 96.0 -> 83.5 |
| snowball freni | gelir carpani ortanca 1.01x, max 2.12x; tabanda butce 0/252, negatif kasa 0/252 |

## Mac modeli

| Olcu | Deger | Hedef |
|---|---|---|
| pozisyon/mac | 24.5 | ~24 |
| ortalama xG | 0.101 - 0.115 | ~0.11 |
| gol/mac (model) | 2.48 - 2.81 | ~2.7 |
| gol/mac (88.283 gercek mac) | 2.50 | ~2.7 |
| en sik skorlar | 1-1 %12.4, 1-0 %11.6, 0-1 %8.9, 2-1 %8.8, 0-0 %8.2 | gercekci |

Tek sapma: gercek maclarda gol/mac 2.50, hedefin ~%8 altinda. Model kendi
basina 2.7 uretiyor; fark lig maclarindaki resolveCheap yolundan geliyor
olabilir. Dusuk oncelik.

## YENI BULGULAR

### YENI-3 (HIGH) HERO'NUN TRANSFERINDE NE PENCERE NE DE SEZONLUK SINIR VAR

100 kariyerde olculdu:

| Olcu | Deger | Gercek futbol |
|---|---|---|
| kariyer basina kulup degisimi | ortanca 22 (ort 24.2, max 62) | ~4-8 |
| farkli kulup sayisi | ortanca 18 (max 31) | ~4-8 |
| bir sezonda en cok transfer | ortanca 4 (max 10) | en fazla 2-3 |
| birden fazla transfer olan sezon | ortanca 6 sezon | nadir |
| ard arda A->B->A gidip gelme | 109 kez | ~yok |

Kok neden GameEngine.reportWorldEvent icindeki transfer kolu: kulubu KOSULSUZ
degistiriyor. Ne transfer penceresi, ne sezonluk sayi siniri, ne bekleme
suresi var.

Asimetri onemli: NPC piyasasinin penceresi VAR (TransferMarket.windows) ve
haftada kulup basina en fazla bir transfer yapiyor. Hero icin ayni kural yok.
Host tarafindaki windowOpen() yalnizca OLASILIGI ucle carpiyor, kapiyi
KAPATMIYOR -- yani pencere disinda da transfer olabiliyor.

Bot etkisi ayristirildi: bot teklifleri %50 kabul ediyor, yani "her seye evet"
degil. Sinirsizlik motor tarafinda.

### YENI-4 (MEDIUM) HAKEMIN PENALTI EGILIMI HICBIR SEYI ETKILEMIYOR

penaltyChance() (src/domain/referee.ts:122) tanimli ve world.db'den okunan
penalty_courage degerini kullaniyor -- ama hicbir yerden CAGRILMIYOR. Zincir:
DB kolonu -> Referee nesnesi -> olu fonksiyon.

Karsilastirma: ayni dosyadaki cardFactor ve varChance MatchSimulator
tarafindan GERCEKTEN cagriliyor. Yalniz penalti kolu bagsiz.

Ayrica Timeline.OPEN_PLAY_MIX yalnizca bes tur uretiyor (open_play, header,
long_range, one_on_one, free_kick). penalty ve rebound hic uretilmiyor, yani
MathChanceResolver'in penalti kolu (0.76 xG) mac akisinda olu.

Not: Hero'nun ANLATI penaltilari calisiyor (evt_match_penalty_for, 6.937 macta
164 kez) -- ama mevki listesinden seciliyor, hakemden degil.

Bu, orijinal raporun "COSMETIC / DEAD SYSTEM" kategorisinin aynisi: hesaplanan
ama tuketilmeyen sinyal.

### YENI-5 (MEDIUM) SON CESITLILIGI DAR

60 kariyer, 18 tanimli son:

    end_informant_exile  21  (%35)
    end_incarcerated     18  (%30)
    end_mentor           12  (%20)
    end_clean_hands       5
    end_media_war         3
    end_coach             1

18 sondan 12'si 60 kariyerde hic cikmadi, ve iki son kariyerlerin %65'ini
kapliyor. Ikisi de suc/muhbir kolunda; sonlarin agirlik merkezi tek bir anlati
koluna kaymis durumda.

### YENI-6 (LOW, veri) ref_name_pool doygun

Ulke basina 10 ad x 10 soyad = 100 kombinasyon, 1.555 personel. Atanmis
kadronun %29'unun adinda cakisma eki var (Marlowo4 gibi). Motor hatasi degil,
referans veri sinirlamasi -- havuzu genisletmek icerik karari.

## ACIK KALANLAR (degismedi)

| Konu | Not |
|---|---|
| loaned hic olusmuyor | 85 lifeState efektinin hicbiri yazmiyor; motorda da gecis yok. Tam olu tek olay: evt_fandom_pundit_reddedilis_yakin. Digerlerinin alternatif durumu var. |
| 14 olay hic uygun olmadi | Orijinalle AYNI sayi. Cogu _yakin/_orta/_uzak ark asamasina kapili. |
| NPC kuluplerde hoca degismiyor | Kovulma yalnizca Hero'nun kulubunde modelleniyor (bilincli kapsam). |
| GK/DF | Bilincli kapali. Iki mac ani (handball_on_line, penalty_against) bu yuzden cikmiyor. |

## SONUC

Orijinal 10 problemin 9'u kapali; hicbir duzeltme geri gelmemis ve duzeltmeler
birbirini bozmamis. Dunya katmani 100 sezon, kariyer katmani 100 kariyer
boyunca kararli. Nedensellik zinciri transferden bonservise, oradan lig
sirasina, gelire ve bir sonraki sezonun butcesine kadar ucu uca kapali ve her
halkasi monoton.

Uc yeni bulgu var; en agiri Hero transferinin sinirsiz olmasi (YENI-3).

Test durumu: 58/58 dosya, 804/804 test, tsc temiz.
