# Özel hayat

## Yeni bir zincir kurmuyor

Motorda zaten kurulu ve ölçülmüş bir yol var:

```
iliski_aile → moraleTarget → moral → heroDayFactor → nitelikler
            → maç reytingi → form → (geri) moraleTarget
```

Özel hayat bu yolun **girişine** yazıyor. Ayrı bir "form bonusu" eklemek
aynı sonucu verirdi ama iki ayrı gerçek üretirdi: biri `iliski_aile`
üzerinden, öteki doğrudan. Tek kapı, tek gerçek.

## Asıl kıtlık: zaman

Bir futbolcunun haftası dolu. Asıl karar bir akşamı neye harcadığın —
bu yüzden her temasın bedeli `kondisyon` ve `tukenmislik` üzerinden
ödeniyor.

| Temas | kondisyon | tükenmişlik | yakınlık | tavan |
|---|---:|---:|---:|---:|
| Mesaj | 0 | 0 | +2 | **52** |
| Ara | 0 | −1 | +5 | **76** |
| Akşamı birlikte geçir | −5 | −4 | +11 | 100 |
| Maç gecesi kaç | −12 | +3 | +16 | 100 |
| Sezon arası tatil | +8 | −18 | +22 | 100 |

**Arama bacakları yormaz** — bedeli zaman, kondisyon değil. **Akşam
tükenmişliği düşürür ama kondisyonu yer**: dinlenmek ile geç yatmak aynı
gecede olur.

## Tavan merdiveni — ölçümün dayattığı düzeltme

İlk sürümde tavan yoktu ve şu çıktı: **dört haftada bir atılan bedava bir
mesaj** yakınlığı 100'e çıkarıyor, evliliğe götürüyor ve hiçbir bedel
ödetmiyordu — üstelik sonucu her hafta buluşan oyuncudan **daha iyiydi**
(moral 37,7'ye 31,7), çünkü pahalı eylemler kondisyonu yiyor.

Yani en ucuz strateji en iyisiydi ve geri kalan her şey ölü seçenekti.

Her temasın tek başına çıkarabileceği bir yakınlık tavanı kondu.
Evlilik eşiği (85) ucuz temasların tavanının üstünde: **mesajla ilişki
yürümez, sesle bir yere kadar gider, gerisi için orada olmak gerekir.**

## Dört asimetri

1. **İhmal şimdi bedava, sonra pahalı.** Mesafe sessizce birikir.
2. **Buluşma tükenmişliği düşürür ama kondisyonu yer.**
3. **Uzaktayken sesin gider, sen gidemezsin.** Kamp ve kiralık dönemde
   yıpranma iki kat.
4. **Sakatken evdesin.** Yıpranma yarıya iner: kariyerin en kötü dönemi
   özel hayatın en iyi dönemi olabilir.

## Ölçüm: optimum ortada

Altı tohum, dört politika, 400 tur:

| Politika | Yakınlık | `iliski_aile` | Moral | Kondisyon | Aşama |
|---|---:|---:|---:|---:|---|
| İhmal (hiç dokunma) | 0 | 45 | **15,0** | 92 | **ayrılık** |
| Sadece mesaj (4 haftada bir) | 52 | 52 | 29,7 | 92 | tanışma |
| **Dengeli** (haftada arama, 3 haftada akşam) | 100 | 100 | **37,7** | 90 | evli |
| Her hafta buluş | 100 | 100 | 28,2 | **73** | evli |

**Takıntılı ilgi dengeliden kötü** — kendini tüketiyorsun. İhmal en kötü.
İç bir optimum var ve modülü bir karar yapan tam olarak bu; tek yönlü bir
sayaç olsaydı en yüksek değer her zaman en iyi olurdu.

## Gerginlik tek yönlü mandal değil

Yakınlıktan **ayrı** bir gerginlik var: birine çok yakın olup aynı anda
çok gergin olabilirsin — ilişkilerin bittiği yer zaten tam orası.
`familyScore` gerginliği yakınlıktan düşüyor, yani **yakın ama gergin,
uzak ve sakinden kötü**.

Temas varsa gerginlik kendiliğinden çöküyor (−1,4/hafta). Bu şart:
yalnızca tırmanan bir gerginlik tek yönlü bir mandaldır ve kariyerin
sonunda herkes ayrılır. Aynı deseni bu projede üç kez düzeltmiştik
(moral, sponsor, medya).

## Haftalar birbirine benzemez

İlk sürümde çekim yoktu ve **altı tohumun altısında da ayrılık tam olarak
25. turda** oluyordu. Aynı sayı, aynı hafta, her kariyerde — bu bir hayat
değil geri sayım sayacı.

Artık tohumlu bir çekim yıpranmayı ölçekliyor (iyi bir hafta yarısı
kadar, kötü bir hafta bir buçuk katı). **Toparlanmaya dokunmuyor** — iyi
niyet şansa bırakılmamalı.

## Evlilik: zemin ve bedel

Evlilik **zemin sağlar** (aynı ihmal daha yavaş yıpratır) ama bedava
değil: bitmesi hâlinde mal paylaşımı **servetin %35'i**. Böylece
"evlenelim mi" duygusal olduğu kadar ekonomik bir karar da oluyor ve iki
sistem birbirine değiyor.

Aşama ilerlemesi zaman **ve** yakınlık istiyor, gerginlik yüksekken
kimse bir sonraki adımı atmıyor.

## İçeriğe bıraktığı izler

| Bayrak | Ne zaman |
|---|---|
| `mem_evlendi` | Evlilik aşamasına geçince |
| `mem_ayrilik` | İlişki bitince |
| `mem_mac_gecesi_kacti` | Maç gecesi kamptan kaçınca |

## Kısıtlama bir hikâyedir

`contactOptions()` yapılamayanları **sebebiyle** döndürüyor. "Uzaktasın.
Sesin gidebilir, sen gidemezsin" bir hata mesajı değil; oyuncunun
görmesi gereken şeyin kendisi.
