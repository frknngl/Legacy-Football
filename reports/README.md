# Ölçüm raporları

## Bir ölçümü geri getirmek için ne gerekiyor

Manifest **dört** şeyi birlikte sabitler. Dördü de gerekli:

| Alan | Ne sabitler |
|---|---|
| `contentHash` | `content/` altındaki her şey |
| `sourceHash` | `src/` altındaki her şey |
| `commit` + `dirty` | Depo durumu (`dirty: true` ise commit tek başına yetmez) |
| `seeds`, `world`, `archetype`, `botVersion` | Koşunun parametreleri |

### Neden `sourceHash` sonradan eklendi

`phase-b-rhythm3` ve `phase-b-rhythm5` manifestleri **zaman damgası
dışında birebir aynıdır** — aynı içerik hash'i, aynı tohumlar, aynı
dünya, aynı `engineVersion`. Ama sonuçları farklıdır:

| | Hikâye | Ambiyans |
|---|---:|---:|
| rhythm3 | 7,0× | 12,5× |
| rhythm5 | 6,7× | **8,8×** |

Koşular belirlenimcidir (aynı komut iki kez koşuldu, çıktı birebir aynı),
yani fark yalnızca **kodda** olabilir. Manifest kodu yakalamadığı için
rhythm5'i (ve daha iyi olan rhythm1'i) üreten durum **geri
getirilemedi**.

`engineVersion` yetmiyor: o `package.json` sürümü ve kod değişince
değişmiyor.

## Klasörler

`phase-a` … `phase-b-rhythm5` — 9 Eylül 2026 sabahı yapılan faz ve ritim
denemeleri. **`phase-b-final` kronolojik olarak final değildir** (11:19'da
koşmuş; ritim denemeleri 11:22–11:32 arasında, yani ondan sonra).
Bunların manifestlerinde `sourceHash` yok, dolayısıyla yalnızca *gösterge*
niteliğindedir; birebir tekrar üretilemezler.

`baseline` — `sourceHash` ile damgalanmış ilk taban ölçüm. Bundan
sonraki karşılaştırmaların referansı budur.

## Kodlama

Çıktılar **UTF-8**. Daha önce UTF-16 kaydedilmişlerdi; git onları ikili
sayıyor ve rapor değişimleri commit'lerde okunamıyordu.

## Yeniden üretmek

```bash
npm run playtest -- --seeds=6 --turns=1200 --world=data/world.db --manifest=reports/<ad>/playtest-6x1200-worlddb.manifest.json
```
