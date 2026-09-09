# Emeklilik — "bir sezon daha"

## İskele vardı, kablosu yoktu

`TurnScheduler.retirementStage` üç aşama döndürüyordu — `window` (33+),
`choice` (38+), `forced` (41) — ama motorda **yalnızca `forced`**
okunuyordu. Kariyeri hep motor bitiriyordu; oyuncunun "bir sezon daha"
deme hakkı yoktu ve otuz sezonluk bir kariyerin en insani kararı hiç
sorulmuyordu.

`window` aşamasında **soru sorulmuyor** — 33 yaşındaki bir futbolcuya her
sezon "bırakıyor musun" demek kararı değersizleştirir. O aşama içerik
için bir kapı. Gerçek karar `choice` (38+) ile başlıyor.

## İki bedel, iki ayrı para birimi

| | Ne kazanırsın | Ne ödersin |
|---|---|---|
| **Zamanında bırak** | Nasıl hatırlandığını **korursun** | Yaklaştığın kupa, yüzüncü maç, kırılmamış rekor orada kalır |
| **Bir sezon daha** | Kazanabilirsin | Fizik ve kondisyon; kötü oynarsan **itibar** |

Devam etmenin fiziksel bedeli **her tekrarda artıyor**: ilk fazladan
sezon ucuz, dördüncüsü değil.

İtibar bedeli **yalnızca kötü oynayana**. "Bir yıl fazla oynadı" cümlesi
kötü oynayan veteran için kurulur; 39 yaşında 70 formla oynayan biri
cezalandırılmamalı. Bu yüzden bedel forma bağlı, yaşa değil.

Cevapsız kalırsa oyuncu **oynamaya devam eder** — kimse cevap vermeyerek
emekli olmaz.

## Bulunan bug: emeklilik her durumdan erişilebilir değildi

`national_duty` hayat durumu yalnızca `playing` / `injured` / `suspended`
durumlarına geçebiliyordu — **`retired`'a geçemiyordu**. Yani milli
kamptayken emekli olmak sessizce başarısız oluyordu: `retired` bayrağı
`true` olurken hayat durumu eski hâlinde kalıyordu.

Bu yalnızca yeni kararı değil, **mevcut zorunlu emekliliği de**
etkiliyordu (`checkEnding` da `setLifeState`'in dönüşünü yok sayıyordu).

Bir futbolcu sakatken de, cezalıyken de, kamptayken de bırakabilir.
Geçiş tablosu düzeltildi ve motor artık sessiz başarısızlığa izin
vermiyor.

## İçeriğe bıraktığı izler

| Bayrak | Ne zaman | Kodası |
|---|---|---|
| `mem_kendi_birakti` | Kendi kararıyla bıraktı | "Kimse seni bırakmadı; sen bıraktın." |
| `mem_bir_sezon_daha` | En az bir kez devam dedi | — |
| `mem_gecikmis_veda` | Formu düşmüşken devam etti | "Bir yıl fazla oynadın." |

Kodalar birbirini dışlıyor: `mem_bir_sezon_daha` kodası yalnızca
`mem_gecikmis_veda` **yokken** çıkıyor — yani doğru zamanda devam etmiş
olana "iyi ki devam etmişsin" diyor, geç kalmış olana başka bir şey.

## Arayüz

Karar **kendiliğinden açılıyor** (`:emeklilik` yazmayı beklemiyor) —
görünmez bir karar, karar değildir. Ağır sakatlık tedavisi de aynı
şekilde otomatik açılıyor.

Ölçüm botu %35 olasılıkla bırakıyor: hep devam eden bir bot "kendi
kararıyla bırakma" dalını, hep bırakan da "bir sezon daha"nın bedelini
hiç ölçemezdi.
