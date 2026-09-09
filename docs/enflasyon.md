# Enflasyon Verisi

Oyundaki sekiz ülkenin **2015-2024 gerçek yıllık TÜFE** ortalamaları.
Araştırılarak konuldu, tahmin edilmedi.

## Ölçülen ortalamalar

| Oyundaki ad | Gerçek ülke | 10 yıl ort. | Std. sapma | En düşük | En yüksek |
|---|---|---:|---:|---:|---:|
| Anadolu | Türkiye | **%27,5** | 23,0 | 7,7 | 72,3 |
| Albion | İngiltere | %3,2 | 2,3 | 0,4 | 7,9 |
| Lagelanden | Hollanda | %2,8 | 2,6 | 0,3 | 10,0 |
| Rheinland | Almanya | %2,5 | 2,1 | 0,5 | 6,9 |
| Iberia | İspanya | %2,1 | 2,5 | −0,5 | 8,4 |
| Peninsula | İtalya | %2,0 | 2,6 | −0,1 | 8,2 |
| Lusitania | Portekiz | %2,0 | 2,3 | 0,0 | 7,8 |
| Gallia | Fransa | %1,8 | 1,7 | 0,0 | 5,2 |

**On beş kat fark** var. Türkiye 2022'de %72,3, 2023'te %53,9, 2024'te
%58,5 gördü; Fransa'nın en kötü yılı %5,2 idi.

## Kaynaklar

- [Eurostat — euro bölgesi yıllık enflasyon göstergeleri](https://ec.europa.eu/eurostat/web/products-euro-indicators/w/2-17012025-ap)
- [Statista — G7 enflasyon serisi](https://statista.com/statistics/1370909/inflation-g7)
- [Statista — Türkiye ortalama enflasyon 1980-2031](https://www.statista.com/statistics/277044/inflation-rate-in-turkey/)
- [Trading Economics — Türkiye TÜFE](https://tradingeconomics.com/turkey/inflation-cpi)
- [Macrotrends — İspanya enflasyon 1960-2025](https://www.macrotrends.net/global-metrics/countries/esp/spain/inflation-rate-cpi)
- [Macrotrends — Portekiz enflasyon 1960-2025](https://www.macrotrends.net/global-metrics/countries/prt/portugal/inflation-rate-cpi)
- [Macrotrends — Hollanda enflasyon 1960-2025](https://www.macrotrends.net/global-metrics/countries/nld/netherlands/inflation-rate-cpi)
- [Wikipedia — Türkiye ekonomisi](https://en.wikipedia.org/wiki/Economy_of_Turkey)

Bazı yıllar için tek bir kaynak tam seri vermedi; boşluklar diğer
kaynaklardan tamamlandı ve ortalama sekiz kaynağın uyuştuğu değerlerle
hesaplandı. Portekiz'in 2015-2021 aralığı en zayıf desteklenen kısım.

## Oyundaki karşılığı

Enflasyon yalnızca büyük sayılar üretirse **görünmez** olur — her şey
aynı oranda artarsa hiçbir şey değişmez. Karar üretmesi için
**asimetrik** kuruldu:

| | Etki |
|---|---|
| **Nakit** | Erir. 15 sezonda 1M TL → Anadolu'da ~20 bin, Gallia'da ~746 bin |
| **Varlık** | Korur. Ev/arsa nominal olarak enflasyonla yükselir |
| **Maaş** | Geride kalır. Sözleşme **nominal ve sabit**; beş yıllık sözleşme Anadolu'da felaket |
| **Borç** | Erir. Yüksek enflasyonda borçlanmak **kazandırır** |

Böylece *"Anadolu'da kredi çekip arsa al, nakit tutma"* gerçek bir
strateji; Gallia'da aynı hamle anlamsız. **Ülke seçimi para kazanmanın
biçimini değiştiriyor.**

15 sezonluk fiyat endeksi (başlangıç 100, tek tohum):

| Ülke | Sezon 1 | Sezon 5 | Sezon 10 | Sezon 15 |
|---|---:|---:|---:|---:|
| Anadolu | 135 | 490 | 1.527 | **4.924** |
| Albion | 104 | 123 | 142 | 165 |
| Rheinland | 103 | 118 | 132 | 149 |
| Gallia | 102 | 113 | 123 | **134** |

## Modelin şekli

- **Ortalamaya dönüş:** geçen yılın oranı bu yılı %45 ağırlıkla etkiler.
  Enflasyon yapışkan bir büyüklüktür — bir yıl %70'ken ertesi yıl %3
  olmaz. Ama kalıcı olarak zirvede de kalmaz.
- **Deflasyon mümkün ama dar:** İspanya ve İtalya gerçekten negatif
  yıllar gördü; alt sınır −%2.
- **Haftalık çarpan bileşik kök**, 52'ye bölme değil: %72'lik bir yıl
  haftalık %1,38 değil ~%1,05'tir ve fark on yılda katlanır.
