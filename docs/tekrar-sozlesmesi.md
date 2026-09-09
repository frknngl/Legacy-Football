# Tekrar sözleşmesi (`repeatPolicy`)

## Ne yapıyor

Her olay artık `story` (arc / beat / signature) ve `repeatPolicy`
taşıyor. Politika **tier'a göre** yazıldı — aracın kendi yorumunu
mekaniğe çevirerek:

> "`epic` bir sahnenin kariyerde ikinci kez aynı metinle çıkması, `beat`
> bir sahnenin tekrarından çok daha fazla batar."

| tier | arc | beat | signature | kariyer kapağı |
|---|---:|---:|---:|---:|
| `epic` | 40 | 120 | 80 | **1** |
| `major` | 16 | 45 | 30 | 6 |
| `minor` | 10 | 24 | 16 | — |
| `beat` | 6 | 14 | 10 | — |

**Ambiyans (`match` / `reaction`) hiç kariyer kapağı almıyor** — bir
penaltı anının tekrar etmesi normaldir, bir aile sahnesinin tekrarlaması
değil. Onlara yalnızca dar boşluklar verildi (yukarıdakinin ~%40'ı).

Elle yazılmış altı orijinal politika korundu.

## Ölçülen eğri — ve içinde yatan gerçek

Altı yapılandırma ölçüldü (6 tohum × 1200 tur, `data/world.db`):

| Politika | Sessiz hafta | Hikâye tekrar | Ambiyans tekrar | İlk tekrar |
|---|---:|---:|---:|---:|
| Taban (6 elle yazılmış) | 65% | 2,4× | 2,5× | 157 |
| Yalnızca `epic` kapak | 64% | 2,8× | 2,9× | 157 |
| `epic`+`major` kapak | 70% | 2,0× | 3,3× | 157 |
| **Seçilen: tam sözleşme** | **78%** | **1,8×** | **2,0×** | **183** |
| Tam sözleşme (sıkı) | 81% | 1,4× | 2,2× | 230 |

**Tekrar ile sessizlik aynı kıtlığın iki yüzü.** 388 benzersiz metinle
1013 turu doldurmanın tek yolu tekrar etmek; tekrarı yasaklarsanız
boşluk kalır. Plandaki hedefleri (hikâye ≤1,5× ve ilk tekrar ≥120)
tutturan tek yapılandırma en sıkı olanı ve bedeli %81 sessiz hafta.

Seçilen orta yol **her iki tekrar ekseninde de tabandan iyi** (2,4→1,8
ve 2,5→2,0) ve ilk tekrarı 157'den 183'e taşıyor.

## Neden şimdi uygulandı, ayarı sonra değiştirmek gerekmeyecek

Kapaklar **içerik hacminden bağımsız**. İçerik büyüdükçe aynı kapaklar
altında sessiz hafta kendiliğinden düşer, çünkü havuzda daha çok
görülmemiş sahne olur. Kapaksız bırakmak ise tekrarı kalıcı olarak
yüksek tutar.

Yani bu politika, bu geceki içerik üretiminin **doğrudan sessizliği
sahneye çevirmesini** sağlıyor.

## İki uyarı

**Kapak koymak ambiyansa iter.** Hikâye olayları kapatılınca seçici
daha sık maç/tepki sahnesine düşüyor; `epic`+`major` denemesinde
ambiyans tekrarı 2,5×'ten 3,3×'e çıktı. Seçilen yapılandırmada bu
görülmüyor (2,0×) çünkü ambiyansın da kendi boşlukları var.

**Boşluklar soğutmaları tekrarlıyor olabilir.** `cooldown.self` ve
`cooldown.family` zaten ayarlıydı; `beatGapTurns` ve `arcGapTurns`
onların üstüne biniyor. Yalnızca kapak bırakan bir deneme yapıldı (2,0×
/ %70) ve seçilenden daha kötü çıktı, yani boşlukların katkısı gerçek —
ama üç frenin birlikte nasıl çalıştığı ayrıca incelenmeye değer.
