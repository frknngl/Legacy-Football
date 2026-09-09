# Sosyal finansman — arkadaştan borç

## Neden üçüncü bir kol

Banka ve tefeci zaten vardı, ama ikisi de **parayla** ödetiyor — biri
faizle, öteki daha yüksek faizle. Aralarındaki fark bir *derece* farkı,
bu yüzden seçim aslında tek boyutlu: "ne kadar acelem var".

Üçüncü bir kol ancak **para birimi farklıysa** gerçek bir seçim üretir:

| Kimden | Bedeli | Ödenmezse |
|---|---|---|
| Banka | ucuz, gelir belgesi ister | itibar ve basın |
| Tefeci | pahalı, hiçbir şey sormaz | insanlar gelir |
| **Arkadaş** | **faizsiz, vadesiz** | **arkadaşını kaybedersin** |

Üç kolun bedeli üç ayrı kaynaktan çıkıyor: **para, güvenlik, ilişki.**
Böylece "kimden alayım" bir hesap değil bir **karakter** sorusu oluyor —
ve kariyerin sonunda geriye kimin kaldığını bu belirliyor.

## Kim ne kadar verebilir

İki çarpan, ikisi de gerekli:

- **Güven** (`trust`, eşik **55**). Altında kimse vermez. `relation`
  değil `trust` okunuyor — kaptan seni sevebilir ama cebine el atmak
  bedel ister; bu ayrım aktör modelinde zaten kuruluydu.
- **Kazanç.** Sana güvenen ama kendisi de yeni başlayan bir genç çok az
  verebilir; seni orta derecede seven bir yıldız çok. Yalnızca güvene
  bakmak kadroyu bankaya çevirirdi.

```
tavan = (verenin haftalık kazancı × 8) × (güven − 55) / 45
```

Verenin haftalığı kadroda yazmıyor, **türetiliyor** — ve `tickEconomy`nin
kendi maaş tahminiyle aynı omurgayı kullanıyor (kulüp itibarı × kalite).
Farklı bir formül, aynı ligdeki iki futbolcunun bambaşka dünyalarda
yaşaması demek olurdu.

Senin haftalığından küçük kalan tavanlar masaya **hiç gelmiyor**: karar
değil gürültü olurlar.

## Faiz yok, vade yok — ama beklemek bedava değil

Arkadaş taksit istemez; ne zaman verirsen o zaman. Yaptırım tek ve
yeterli:

| Süre | Ne oluyor |
|---|---|
| 0–8 hafta | Hiçbir şey. Kimse ertesi hafta parasını istemez. |
| 8+ hafta | Güven haftada hızlanarak eriyor (tavan 1,2/hafta) |
| **60. hafta** | **Arkadaşlık biter.** Güven −25, ilişki −20. |

Kırılma anında borç **silinmez, defterden düşer**: kişi vazgeçmiştir,
artık para meselesi değildir. İcra yok, tehdit yok — tefeci kolunun işi
o, bu kolun değil.

## İlişkinin yönü

| Ne zaman | Güven | Yakınlık |
|---|---:|---:|
| Borç alırken | −4 | +2 |
| Borcu kapatırken | **+9** | +4 |

Kapatmak, aldığından **fazlasını** geri veriyor: sözünü tutmak, hiç borç
istememekten daha güçlü bir sinyaldir. Bir kere borç alıp ödemek,
ilişkiyi hiç dokunmamaktan daha ileri götürüyor — ve mekanik bunu
söylüyor, metin değil.

## İçeriğe bıraktığı izler

| Bayrak | Ne zaman |
|---|---|
| `mem_arkadastan_borc` | İlk kez arkadaştan borç alındığında |
| `mem_arkadasligi_yakti` | Sabır dolup ilişki koptuğunda |

## Bir tasarım kusuru, testin yakaladığı

İlk halde "hepsini kapatayım" diye büyük bir sayı yazmak
**reddediliyordu**: ret kontrolü ödenebilir tutarı değil ham sayıyı
bakiyeyle kıyaslıyordu. 30 bin borcu olan birinin 999.999 yazması "paran
yok" ile karşılanıyordu. Düzeltildi — bakiye artık `min(tutar, kalan
borç)` ile karşılaştırılıyor.

## İsim kayıtta değil

`Favor` içinde ad saklanmıyor, yalnızca aktör ve slot kimliği.
Saklansaydı transferde, lakap değişiminde ya da evlilikte bayatlardı.
Host `engine.personName(slotId)` ile kadroya soruyor — kaynak tek.
