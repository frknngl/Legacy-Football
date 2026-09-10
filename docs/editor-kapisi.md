# Editör Kapısı — Otomatik Kriterlerin Üstündeki Kabul İlkeleri

Validator (`npm run validate`), bir olayın sentaksını, bayrak tanımlarını ve hedef düğümlerini kontrol eder.
**Editör Kapısı** ise bir sahnenin *okunmaya değer olup olmadığını*, *tekrara düşüp düşmediğini* ve *oyuncuyu güldürüp/burkup burkmadığını* denetler.

Bir sahne `authored: "hand"` olarak korpusa girmeden önce aşağıdaki 9 editörlük süzgecinden geçmek zorundadır.

---

## 9 Editörlük Süzgeci

### 1. Hücre Sorusu (Çağ Uyumu)
*Bu tema bu çağda hangi soruyu soruyor?*
- `docs/senaryo-matrisi.md` tablosuna bakın. Aynı tema her çağda başkalaşmalıdır.
- 16 yaşındaki çocuğa rüşvet teklif edilmez (ucuz olur).
- 34 yaşındaki efsaneye "dolabın nerede" diye sorulmaz.
- Sahne, bulunduğu kariyer hücresinin (yaş, kulüp seviyesi, itibar) gerçeklerine tam oturmalıdır.

### 2. İmza Kontrolü (Defter Çakışması)
*Bu sahnenin aynısı veya benzeri korpusta var mı?*
- `npm run author -- report` çalıştırın.
- `(kategori + slot + beat + çağ + itibar)` imzası defterde zaten doluysa, o sahneye ikinci bir dosya açmayın; farklı bir slota ya da beate yönelin.

### 3. Şablon Olmayan Özgün Kimlik (Anti-Template ID)
*Olay kimliği mekanik bir model kombinasyonu mu?*
- **YASAK:** `evt_<kategori>_<slot>_<beat>` (örneğin `evt_dark_lawyer_ayartma`). Bu isimler Gemini model hattının kombinatorik üretimleridir.
- **ZORUNLU:** Olayın ruhunu anlatan özgün kimlikler:
  - `evt_business_ilk_sozlesme_veli`
  - `evt_personal_cousin_istek`
  - `evt_ritual_keeper_corap`
  - `evt_dark_tefeci_kapida`
  - `evt_media_isyanci_etiketi`

### 4. En Az Bir Beklenmedik Seçenek
*Seçenekler "iyi huylu / kötü huylu / profesyonel" şablonuna mı sıkıştı?*
- Her sahnede en az bir seçenek oyuncuyu şaşırtmalı, güldürmeli ya da absürt bir gerçeği yüzüne vurmalıdır.
- Örnek: Formayı isteyen kuzene "Formayı ver ama fotoğraf çekilme" demek ya da "Çocuğun adını ver, hastaneye ben kendim götüreceğim" resti çekmek.

### 5. "Anlatma, Göster" Kuralı (Outcome Tasarımı)
*Sonuç metni durumu özetliyor mu, yoksa bir anı mı resmediyor?*
- **Kötü (Özetçi):** "Kuzenin sana çok kızdı ve aranız bozuldu. Moralin bozuldu ve profesyonelliğin arttı."
- **İyi (Gösteren):** "Doğruydu. Doğru olması yetmedi. {actor.cousin.name} bir daha aramadı. Yıllar sonra bir düğünde karşılaştınız; sana 'Şampiyon' dedi ve geçti. O kelimeyi o tonda söylemeyi ailede sadece o bilir."

### 6. Çağın Sesi (SeniorVoice Kriteri)
*Sahnedeki karakter yaşının gerektirdiği ağırlıkta mı konuşuyor?*
- **Çırak (16-19):** Odaya sessizce girer, kapıda bekler, büyüklerin gözünün içine bakar, tam anlayamaz, velisine bakar. Kimseye akıl veremez, racon kesemez.
- **Zirve (24-29):** Gücünün farkındadır, pazarlık eder, soyunma odasında sesini yükseltebilir.
- **Alacakaranlık (35+):** Gençlerin telaşına uzaktan bakar, tek bir kelimeyle ortamı sakinleştirir.

### 7. Format Rotasyonu
*Son üç sahnede aynı anlatı formatı mı kullanıldı?*
- Sahneler ardışık olarak hep aynı standart sahne formatında olmamalıdır:
  - *Belge / Tutanak* (TFF sevk yazısı, kemik ölçüm raporu, Form 12-A)
  - *Mesajlaşma / WhatsApp* (Bilinmeyen numaradan gelen maç sabahı mesajı, kuzenin dekontu)
  - *Diyalog* (Tesis koridoru, kamp odası iki yatak)
  - *Röportaj* (Canlı yayın, stüdyo, gazete arşivi)
  - *Durum Senaryosu* (Dört yol, dört bedel)

### 8. Asimetrik Bedel (Kolay Doğru Cevap Yok)
*Bir seçenek "açıkça en mantıklısı" gibi mi duruyor?*
- Her seçeneğin bir maliyeti olmalı: para kazanan saygı kaybetmeli; doğruyu söyleyen yalnız kalmalı; hocayı savunan soyunma odasını karşısına almalı.
- Oyuncuya ahlaki zafer bedelsiz verilmez.

### 9. Kelebek Sözleşmesi (İz & Ödeme)
*Bu sahnenin bıraktığı iz (`mem_*`) yıllar sonra konuşacak mı?*
- Elle yazılan her `epic` ve `major` kilit taşı, `docs/omurga.md` içindeki bir ödeme sahnesine bağlanmalıdır.
- Arkasında ödemesi olmayan öksüz izler bırakmayın; eğer bir iz bırakıyorsanız omurgadaki karşılığını planlayın.

---

## JSON İçi `_yazar_notu` Standardı

Her elle yazılan olayın en başına (schema'nın yoksaydığı `_` deseniyle) yazarın gerekçesi eklenmelidir:

```json
{
  "id": "evt_ritual_keeper_corap",
  "_yazar_notu": {
    "neden_bu_cag": "Çırak çağında soyunma odasının en tuhaf hiyerarşisi üçüncü kalecinin ritüelleridir.",
    "hangi_soru": "Takımdaki yerini korumak için absürt bir batıl inanca ortak olur musun?",
    "odeme_plani": "Zirve çağındaki derbi öncesi uğur arayışında (evt_ritual_derbi_uguru) tekrar yüzleşilir."
  },
  "authored": "hand",
  ...
}
```
