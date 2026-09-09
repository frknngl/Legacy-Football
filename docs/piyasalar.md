# Borsa ve kripto

## Kumardan farkı yapısal, kozmetik değil

Kumar **tek atıştır**: masaya oturursun, `resolveBet` çalışır, sonuç
anında bellidir ve iş biter. Piyasa bir **pozisyondur**: her hafta değer
değiştirir ve asıl karar *ne zaman çıkacağındır*.

Bu yüzden `market.ts` içinde `resolveBet` benzeri tek bir çözüm
fonksiyonu yok; onun yerine her hafta yürüyen bir **fiyat** var. Aynı
parayla aynı enstrümana giren iki oyuncu, sattıkları haftaya göre
bambaşka yerlere varır — kumarda böyle bir ayrım mümkün değildir.

Sonucu şu: kumar bir **an**, piyasa bir **alışkanlık** üretir.

## Fiyat üç bileşenden yürüyor

```
yeni fiyat = fiyat × (1 + reel sürükleme + enflasyon + gürültü)
```

| Bileşen | Ne | Nereden |
|---|---|---|
| Reel sürükleme | Uzun vadeli beklenen getiri | `drift / 52` |
| Enflasyon | Nominal fiyatlar parayla birlikte şişer | `yillik_enflasyon`, bileşik kök |
| Gürültü | Haftalık oynaklık | İki çekimin toplamı × `volatility` |

**Enflasyon bileşeni şart.** Yoksa Anadolu'da (%27,5) hisse de nakitle
birlikte erir ve "enflasyondan hisseye kaçmak" diye bir strateji
kalmazdı. Ölçüldü: enflasyonsuz bir sezonda endeks 100 → ~105, %27,5
enflasyonla 100 → ~135. Ülke seçimi burada da anlam kazanıyor —
[enflasyon.md](enflasyon.md) ile aynı ekonomiye oturuyor.

Gürültü tek çekimle değil **iki çekimin toplamıyla** üretiliyor; tek
çekim dağılımın ucunu düzler ve "her hafta ya tavan ya taban" gibi
gerçek dışı bir ritim çıkarır.

## Getiri oynaklıkla alınır — bedava getiri yok

Katalog (`content/economy/markets.json`) bu tek kurala göre dizildi ve
test onu sınıyor: en düşük getirili enstrüman en az oynak, en yüksek
getirili en oynak olmak zorunda.

| Enstrüman | Tür | Reel getiri | Haftalık oynaklık | Temettü |
|---|---|---:|---:|---:|
| Ulusal endeks fonu | endeks | %5 | %1,8 | %2,5 |
| Büyük banka | hisse | %6 | %3,2 | %4,5 |
| İnşaat şirketi | hisse | %9 | %5,5 | %2,0 |
| Kulüp hissesi | hisse | %2 | %7,5 | — |
| Büyük kripto | kripto | %22 | %11 | — |
| Küçük kripto | kripto | %35 | %22 | — |

**Kripto temettü ödemez.** Kasıtlı: hisseyi tutarken de para alırsın,
kriptoyu tutmak bedavaya beklemek değildir. "Bekle ve gör"ün maliyeti
böyle doğuyor.

**Kulüp hissesi** düşük getirili ve yüksek oynak — kötü bir yatırım, ve
öyle olması gerekiyor. Oraya para koymak finansal bir karar değil,
kimliksel bir karardır.

## Çöküş — piyasa tek yönlü bir para makinesi olmasın diye

| Olay | Haftalık olasılık | Şiddet | Vurduğu |
|---|---:|---:|---|
| Genel çöküş | %0,4 | −%35 | hepsi |
| Kripto çöküşü | %1,2 | −%45 | yalnızca kripto |

On beş sezonda (≈780 hafta) genel çöküş ortalama **2–3 kez** görülür.
Çöküş olmadan "ne zaman çıkacağın" sorusu anlamını yitirir — tutan
kazanır, karar kalmaz.

Fiyat sıfıra düşmez (taban 0,01). Kâğıt üzerinde değer biter ama pozisyon
"sıfır birim" olarak değil "çok düşük fiyat" olarak yaşar; böylece
dipten dönüş mümkün kalır.

## Piyasa oyuncuyu beklemiyor

`tickMarkets` **her hafta**, pozisyonun olmasa da yürür. Girmediğinde de
fiyatlar hareket eder; girdiğinde onları bulmuş olursun. Aksi halde "ne
zaman girsem" diye bir soru kalmazdı, çünkü piyasa hep senin girdiğin
noktadan başlardı.

Tablo bu yüzden `sinceStart` gösteriyor: girmediğin halde neyi
kaçırdığın da bir bilgidir.

## Ortalama maliyet ve dikkat bedeli

Aynı enstrümana ikinci kez girmek ortalama maliyetini aşağı ya da yukarı
çeker — böylece **düşüşte ekleme yapmak** ("maliyet düşürme") gerçek bir
hamle olur.

Portföyün servetinin **%40'ını** geçerse `tukenmislik` artıyor: her hafta
ekrana bakmak sahadan çalar. Küçük ama gerçek, ve büyük pozisyon daha
çok çalar.

## Cüzdanda ayrı kategori: `yatirim`

Kumar `bahis`, piyasa `yatirim`. İkisi aynı satırda görünseydi rulette
kaybettiğin para hisseden aldığın temettüyü götürürdü ve **"hangisi bana
kazandırıyor"** sorusu cevapsız kalırdı. Ayrımın bütün amacı bu soruyu
cevaplanabilir tutmak.

`:cuzdan` masası artık **net değer** de gösteriyor — nakit, portföy ve
varlık ayrı ayrı, çünkü likiditeleri farklı: nakit bugün, hisse bu hafta,
arsa aylar.

## İçeriğe bıraktığı izler

| Bayrak | Ne zaman | Ne için |
|---|---|---|
| `mem_borsa_vurgunu` | Tek satışta ≥ 250 bin kâr | "O parayı nereden buldun" |
| `mem_borsa_yandi` | Tek satışta ≤ −250 bin zarar | "Borsada yandığın haftayı hatırlıyor musun" |

İkisi de şu an motor tarafından yazılıyor, henüz okuyan sahne yok —
içerik üretiminde okuyacak sahneler yazılacak.

## Determinizm

Fiyatlar durumda (`state.market.prices`) tutuluyor, türetilmiyor:
pozisyonun anlamı "girdiğinden beri ne oldu"dur ve bunu ancak kaydedilen,
yürüyen bir fiyat taşıyabilir. Adımlar tohumlu RNG'den çekiliyor ve
`rngCursor` her tikte güncelleniyor — kaydet/yükle fiyatı değiştirmiyor,
test bunu sınıyor.

## Ölçülen bir yan etki

Piyasa her tur RNG çekiyor ve bu, tüm akışın tohum dizisini kaydırdı.
`MediaEra` testi bundan düştü — ama sebep piyasa değildi: test **tek
tohumla** "dört çağın dördü de gelir" diye iddia ediyordu ve iddia
şanstı. On iki tohumun onunda dördü de geliyor, ikisinde bir çağ
kaçırılıyor.

Kök neden ölçüldü ve piyasayla ilgisi yok: **200 turluk bir çağ
penceresinde `media` kategorisinden sahneye gelen olay sayısı 1 ila 4.**
Ağırlığı dört katına çıkarmak sonucu değiştirmedi (10/12 → 10/12), yani
darboğaz olayın ağırlığı değil kategorinin havuz payı. Bu, içerik
programının konusu; test artık sözleşmeyi sınıyor (her geçiş olayı
ulaşılabilir, ve geldiği her seferde kendi çağında geliyor).
