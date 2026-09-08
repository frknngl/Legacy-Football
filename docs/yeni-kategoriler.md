# Yeni kategoriler ve oyunu renklendirme

## Önce dürüst sayı

Ölçüldü (4 tohum × 1200 tur, gerçek dünya):

| | |
|---|---|
| Bir kariyerde gösterilen hikâye sahnesi | ~1364 |
| Mevcut hikâye varyantı | 304 |
| **Ortalama tekrar** | **4.5×** |

"Asla tekrara düşmemek" = 1364 varyant = **1060 eksik**. Bu, elle
yazılabilecek bir sayı değil. Gerçekçi hedefler:

- **3× tekrar** → 454 varyant (eksik 150) — hissedilir iyileşme
- **2× tekrar** → 682 varyant (eksik 378) — çok iyi

**Kaldıraç varyant, yeni olay değil.** `author -- variant` dokümantasyonu:
*"Yeni olay yazmaya göre üç kat ucuz: kapılama, aile, cooldown ve iz
zaten kurulmuş. Aynı iz yeniden yazıldığı için varyant YENİ YETİM
ÜRETMEZ."* Bu komut Gemini sağlayıcısı istiyor — API anahtarının asıl
işi bu.

**Bölüşüm önerisi:** yeni topraklar (aşağıdaki kategoriler) elle yazılır;
hacim (varyant doldurma) modele verilir, `ingest` kapısı denetler.

---

## Eksik olan ne?

Mevcut 15 kategori futbolun *dramını* iyi kaplıyor: soyunma odası, aile,
para, medya, karanlık işler, milli takım. Kaplamadığı şey **futbolun
kendisi ve gündelik rengi.**

### 1. `tactics` — en büyük boşluk

Futbol kariyerinin en yaygın çatışması oyunda **hiç yok**: hoca seni
mevkinden alıyor.

- "Bu sezon sağ bek oynuyorsun." (kariyerini değiştiren tek cümle)
- Sistem değişikliği: senin oynadığın mevki kadrodan kalkıyor
- Yeni transfer senin yerine alındı, henüz kimse söylemedi
- Devre arası taktik tahtası: hoca seni işaret ediyor
- "Sen savunmaya yardım etmiyorsun" — istatistik seni destekliyor, hoca dinlemiyor

**Neden fun:** her maç öncesi kadro sayfasına bakma gerilimi. Ve
mevkiden memnuniyetsizlik, transfer isteğinin *sebebi* olur — sistemler
birbirine bağlanır.

### 2. `social` — Faz G'nin içerik yüzü

İlk kapsamda vardı (kumar, bahis, parti), hiç yapılmadı.

- İlk kez kulübe gitmek; ertesi gün antrenman 09:00
- Kumarhane: kazanmak kaybetmekten tehlikeli
- Takım arkadaşının bahis uygulaması: "sadece basket oynuyorum"
- Sezon sonu tatili ve paparazzi
- Yeni yıl gecesi, sakatlık dönemi, boş ev

**Neden fun:** risk/ödül döngüsü. `kondisyon`, `moral`, `servet` ve
`disiplin_sicili` zaten var — okuyan içerik yoktu.

### 3. `sponsor` — kolay eğlence

- İlk krampon sözleşmesi: markanın rengi kulübün rakibinin rengi
- Reklam çekimi: on iki saat, tek cümle, kötü replik
- Marka seni bırakıyor (kötü sezon sonrası)
- Rakip markayı giyerken yakalanmak
- "Bu ürünü gerçekten kullanıyor musunuz?" sorusu canlı yayında

**Neden fun:** komedi tonu. Oyunun geri kalanı ağır; bu kategori nefes
aldırır.

### 4. `ritual` — bedava renk

Futbolun en insani tarafı ve sıfır maliyeti var.

- Aynı çorabı yıkatmamak
- Sahaya hangi ayakla çıkılır
- Kaptanın maç günü sabahı sessizlik kuralı
- Otobüste herkesin sabit koltuğu; senin koltuğun yok
- Gol sevinci: birinden miras almak

**Neden fun:** düşük bahisli, yüksek karakter. Ve `once: true` olmayan,
tekrar edebilen sahneler — tekrar sorununu *azaltmıyor* ama tekrarı
zararsız kılıyor: aynı batıl inanç her sezon geri gelebilir.

### 5. `legacy` — kilometre taşları

- 100. maç, 50. gol, 200. maç
- Formanın müzeye asılması
- Rekor kırma gecesi ve rekoru elinden aldığın adamın telefonu
- Kulüp seni bir tribüne isim yapmak istiyor
- Çocuğun ilk kez seni tribünde izliyor

**Neden fun:** eşik geçildiğinde tetiklenen sahneler, ölçülen "211
bayrak yazılıyor 33 okunuyor" sorununun en tatlı çözümü.

> **Düzeltme:** ilk yazımda "motor `mac_sayisi`, `gol_sayisi` zaten
> tutuyor" yazmıştım — **yanlıştı.** Motor yalnızca SON maçı tutuyordu
> (`last_match_goals` vb.); kariyer toplamı hiçbir yerde yoktu.
> `kariyer_mac_sayisi`, `kariyer_gol_sayisi`, `kariyer_asist_sayisi`
> eklendi (`derived` — motor yazar, içerik yalnızca okur).

---

## Kategoriden bağımsız eğlence fikirleri

**a) Eşik tetikleyicileri.** `mac_sayisi >= 100` gibi koşullar zaten
mümkün ama hiç kullanılmıyor. Kilometre taşı sahneleri bedava.

**b) Sezon içi konum.** İçerik şu an haftanın *neresi* olduğunu bilmiyor.
Hazırlık kampı, derbi haftası, kupa finali, son hafta — aynı sahne
farklı haftada farklı anlam taşır.

**c) Tekrar eden küçük karakterler.** Malzemeci, otobüs şoförü, kaleci
antrenörü. İsimsiz figüran yasak (validator engelliyor) ama *slot*
açılabilir. On beş sezon aynı malzemeciyle konuşmak, en ucuz süreklilik.

**d) Zararsız tekrar.** `ritual` gibi kategorilerde tekrar bir kusur
değil, bir *ritüel*. Tekrar sorununu 1060 varyant yazmadan hafifletmenin
tek dürüst yolu bu.

**e) Ters sahneler.** Şu an her sahne Hero'ya bir şey soruyor. Bazen
Hero'nun bir şey *sorulmadan* izlediği sahneler olmalı — kararsız,
sadece tanıklık. Ritim kırar.
