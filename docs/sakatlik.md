# Ağır sakatlık — tedavi kararı

## Neden var

Sakatlık zaten vardı ama **karar** yoktu. Motor bir sayı üretiyordu ("6
hafta yoksun"), oyuncu bekliyordu, bitiyordu. Oysa gerçek futbolcu
kariyerlerinin dönüm noktaları tam burada.

Ayrıca `end_broken_body` sonlanması `mem_hid_injury` izini **okuyordu**
ama o izi **yazan hiçbir şey yoktu** — bir kariyer sonu erişilemezdi.

## Üç yol, üç ayrı para birimi

| Yol | Yokluk | Kırılganlık | Bedel |
|---|---|---:|---|
| **Ameliyat** | ×1,9 (en uzun) | **−14** +3 | 250.000 TL |
| **Konservatif** | ×1,0 | +9 | — |
| **Gizle, oyna** | **yok** | +22 | %14/hafta çöküş |

**Ameliyat en uzun yokluğu getirir ve bu kasıtlı**: bedeli *zaman*. Ama
tek başına birikmiş kırılganlığı **düşüren** yol. "Şimdi mi ödeyeyim
sonra mı" sorusu buradan çıkıyor.

**Gizlemenin cazibesi faturanın bugün gelmemesi.** Sözleşme bitiyor,
turnuva var, yerini kaptırırsın — bugün ağrımıyor gibi yaparsan bugün
sorun yok. Çöktüğünde gerçek süre **2,2 katıyla** geliyor.

Karar verilmezse bir hafta sonra **kulüp doktoru karar veriyor**
(konservatif). Oyun kilitlenmiyor ama kararsızlığın da bir sonucu var —
seçmemek de bir seçim.

## Kırılganlık: kariyere yayılan iz

Her tedavi bir miktar bırakıyor, ameliyat düşürüyor. `sakatlik_riski`ne
**ekleniyor, çarpmıyor** — çarpım yüksek yorgunlukla birleşince riski
anında tavana yapıştırır ve yorgunluk yönetimini anlamsızlaştırırdı.

Sağlıklı haftalarda **yavaşça iyileşiyor** (0,25/hafta). Bu şart:
yalnızca tırmanan bir kırılganlık tek yönlü mandaldır ve her kariyer aynı
kırılgan yerde biter. Aynı deseni bu projede dört kez düzeltmiştik
(moral, sponsor, medya, özel hayat gerginliği).

## Ölçümün dayattığı düzeltme: süre dağılımının kuyruğu yoktu

İlk hâlde `seriousWeeks: 6` koydum ve **hiç tetiklenmedi**. Sebebi
ölçüldü:

`injuryWeeks` süreyi **riskten türetiyordu** ve gerçek oyunda
`sakatlik_riski` medyanı **6–15** arasında kalıyor (`tukenmislik` medyanı
**0**, p75 **5** — yorgunluk epizodik). O bantta formül yalnızca **1–3
hafta** üretebiliyor. `Math.min(12, ...)` tavanı hiçbir zaman
yaklaşılmayan bir süslemeydi ve **kariyeri tanımlayan sakatlık hiç
olmuyordu**.

Gerçek futbolda kuyruk yorgunluktan **bağımsızdır**: çapraz bağ en dinç
haftanda da kopar. Bu yüzden ayrı bir çekim eklendi — riske bakmıyor:

| | risk 10 | risk 40 |
|---|---|---|
| 1–3 hafta | %93 | %75 |
| 4–5 hafta | — | %20 |
| **10–30 hafta** | **%12** | **%12** |

## Sıklık kalibrasyonu

26 sezonluk kariyerde **7,3 sakatlık** oluyor (risk medyanı ~12).
Kuyruk %6'yken bu, kariyer başına **0,44** ağır sakatlık demekti — yani
kariyerlerin yarısından çoğunda karar hiç sorulmuyordu ve modül süslemeye
dönüyordu. %12 ile kariyer başına **~0,88**: çoğu kariyerde bir kez,
bazılarında hiç, nadiren iki kez.

**Ayrı bir bulgu, değiştirilmedi:** asıl düşük olan sakatlık
*sıklığının kendisi* — sezonda **0,28**, gerçek futbolcu ortalaması 1–2.
`weeklyInjuryChance` kalibrasyonunun kendi gerekçesi yazılı ve bütün
sistemi (müsaitlik, form, kariyer uzunluğu) etkiler; burada
dokunulmadı.

## İçeriğe bıraktığı izler

| Bayrak | Ne zaman | Kim okuyor |
|---|---|---|
| `mem_ameliyat_oldu` | Ameliyat seçilince | `koda_ameliyat` |
| `mem_hid_injury` | Gizleme seçilince | `end_broken_body`, `koda_gizledi` |
| `sakatlik_kirilganligi` | Her tedavide | `sakatlik_riski` |

## Ölçüm botu

`bot.ts` üç yolu da kullanıyor (%25 ameliyat, %60 konservatif, %15
gizle). Yoksa mekanik ölçülmez ve "kulüp doktoru karar verdi" dalından
başka bir şey hiç sınanmazdı.
