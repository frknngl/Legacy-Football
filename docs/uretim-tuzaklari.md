# Üretim Tuzakları

Model hattıyla içerik üretirken **ölçülerek** bulunan bozulmalar. Hepsinin
ortak deseni var, ve o desen bu dosyanın asıl konusu:

> Üretilen sahne **tek başına geçerlidir**. Kural yazmadıkça hiçbir şey
> onu yakalamaz — çünkü bozuk olan sahne değil, sahnenin *kardeşiyle
> taşıması gereken sözleşme*.

Tarih: 9 Eylül 2026. Külliyat 165 → 215 olay, 220 → 255 varyant.

---

## 1. Sessiz zincir kırmaları

### 1.1 Maç anı sonuçsuz kalıyor

`VariantIncidentRule` varyant **düzeyinde** bakıyordu: *"bu varyant o
incident'i bir yerde açıyor mu"*. Dört sonuçtan yalnızca biri açıyorsa
kural geçiyordu.

**Ölçüldü:** `evt_match_var_against` varyantı `v_kirilma`nın **hiçbir
yolu** `inc_var_against` açmıyordu; iki sonucu hiçbir şey açmıyordu.
Motor o varyantı seçtiğinde VAR kararı hiç olmamış gibi davranıyor,
röportaj penceresi sessizce kapanıyor ve `VAR → PFDK → ceza` zinciri
kopuyordu. Orijinal gövde (`v_asil`) **beş sonucunun beşinde de**
açıyordu.

**Kural:** `MomentOutcomeIncidentRule` — bir maç anının **her** `outcome`
düğümü en az bir incident açmalı. Maç anı sonuçsuz kalamaz.

**Onarım:** 40 sonuç düğümüne tanımlayıcı incident eklendi. Tanımlayıcı
iz **uydurulmadı, `v_asil`'den türetildi**: "orijinalin her sonucunun
açtığı olay" bu olayın tanımlayıcı izidir.

### 1.2 Sevk sonsuza dek erteleniyor

Bazı olaylar **yalnızca kuyruktan** gelir ve kendiliğinden çıkmasın diye
tetikleri bilerek sağlanamaz yapılır (`evt_legal_pfdk_hearing`:
`turnsSince 999999`). Böyle bir olayı `onIneligible: "defer"` ile sevk
etmek onu **sonsuza dek** erteler; uygunluk kapısı hiç açılmaz.

**Ölçüldü:** üretilen varyant `onIneligible` alanını atladı (varsayılan
`defer`). PFDK kuyruğa girdi, `forced` önceliği taşıdı, vadesi geldi — ve
**sekiz tur boyunca hiç çalışmadı**. Fark yalnızca bir alandı: sevk
vardı, öncelik doğruydu, hedef olay vardı.

**Kural:** `ScheduleReachabilityRule` — tetiği sağlanamayan bir olaya
sevk `onIneligible: fire` (ya da `cancel` + `replaceWith`) istemeli.

**Onarım:** 12 sevke `onIneligible: fire` eklendi.

---

## 2. Aracın kendi kilitlenmeleri

Bunların hiçbiri modelin hatası değildi; **araç imkânsız şeyler
istiyordu** ve üç denemeyi de yakıyordu.

| Tuzak | Belirti | Kök sebep |
|---|---|---|
| Zincir tohumu geçemiyor | `arc` **hiç** çalışmıyor | Tohum iz yazmak zorunda, okuyucusu henüz üretilmemiş → yetim sayılıyor. Kapı kendi kendini kilitliyor |
| İzsiz olayda varyant | 3 denemenin 3'ü düşüyor | *"izlerinden birini seç: **hiçbiri**"* — olayın `mem_*` izi yoksa imkânsız istek |
| `reaction` üretilemiyor | 3 partide 0/6 | `_incidents` **okumayı açma sayıyordu**; tepki sahneleri tanımı gereği incident *okur* |
| Fazladan incident | Orijinal gövde reddediliyor | Varyant ek olay açınca `v_asil` kardeşlerine uymuyor — model doğru yazıyor, kural **başka** sahneyi düşürüyor |
| İngilizce bayrak adı | Her partide 1 deneme boşa | Şema bayrak adlarını taşımıyor; model `professionalism`, `media_pressure` uyduruyordu |

Çözümler sırasıyla: `pending_traces` toleransı + sonda toleranssız tam
doğrulama · kuralı yalnızca gerçekten iz varsa çalıştırmak · yazma/okuma
ayrımı · fazlalık yasağı · prompt'ta geçerli adları saymak.

**Ölçülen etki:** varyant başarı oranı **3/12 → 6/10**.

---

## 3. Ölçüm politikası yanılgıları

İki kez aynı hatayı yaptım: **sondam "hep ilk seçeneği" seçiyordu.** O bir
oyuncu değil, kötümser bir robot.

| İddia | "İlk seçenek" | Rastgele seçim | Gerçek |
|---|---|---|---|
| "İçerik maaştan çok para veriyor" | 2,7× | **1,09×** | Denge sağlıklı |
| "Kariyerlerin %43'ü duraklıyor" | %43 | **%23** | Tasarım hedefi tutuyor |

**Kural:** denge ölçümü rastgele seçimle yapılmalı. Tek bir politika tüm
dağılımı temsil etmez.

Bir üçüncüsü de tohum sayısıyla ilgiliydi: **ölü olay sayısı 6 tohumda 32,
20 tohumda 11.** Altı tohumluk sayılar birbiriyle karşılaştırılamaz.

---

## 4. Çağın sesi

Prompt çağı yalnızca **listeliyordu** ("Kariyer evresi: rookie, rise").
Model bunu bir kapı olarak okuyup sahneyi yine kıdemli ağzıyla yazıyordu.

**Ölçüldü:** `evt_national_star_teammate_sadakat_sinavi` çırak çağına
açıkken hero millî takım soyunma odasına hükmediyordu. `SeniorVoiceRule`
yakaladı.

`_ERA_VOICE` eklendi — **çağ bir kapı değil bir ses**:

> ÇIRAK (16-19). Hero burada çocuk. Odaya giremez, kapıda bekler. Kimseye
> emir veremez, kimse ona danışmaz; izler, dinler, yanlış anlar.

Çok çağlı sahnede talimat açık: **en genç olanına göre yaz**, yoksa
çocuğa kıdemli replik verirsin.

---

## 5. Sonraki üretimde dikkat

- Varyant üretiminden sonra **her zaman** `npm run validate` + tam test
  koşusu. İki sessiz kırılma da yalnızca testle görüldü.
- Ölü olay ölçümü **≥20 tohum**.
- Denge ölçümü **rastgele seçim** politikasıyla.
- Yeni bir sözleşme türü eklerken sor: *"kardeş varyant bunu taşımazsa ne
  kırılır?"* — cevap "hiçbir kural yakalamaz" ise kural yazılmalı.

---

## Kapı, eş zamanlı `core.json` düzenlemelerini sessizce siliyordu

**Belirti:** `content/orchestrator/core.json`'a elle eklenen iki bayrak
beyanı kayboldu. Kayıp hiçbir yerde görünmedi: dosya geçerli JSON kaldı,
test kırılmadı, `git status` "değişiklik yok" dedi, `git log` dosyayı hiç
değişmemiş gösterdi. Değişikliğin yapıldığı da silindiği de görünmüyordu.

**Kök neden** — `QualityGate.check()`:

```python
core_backup = core.read_text(...)        # 1. anlık kopya
ensure_declared(core, ...)               # 2. geçici iz beyanı
try:    self._run_validator(...)         # 3. doğrula
finally: core.write_text(core_backup)    # 4. TAMAMINI geri yaz
```

4. adım dosyanın **tamamını** 1. adımdaki hâline döndürüyor. Kapı
çalışırken (bir doğrulama turu saniyeler sürüyor) dosyaya başka biri
dokunduysa, o düzenleme geri yazmayla yok oluyor. Model hattı arka planda
koşarken paralel iş yapmak tam olarak bu durumu üretiyor.

**Düzeltme:** anlık kopya-geri yazma yerine **hedefli silme**.
`ensure_declared` zaten eklediklerini döndürüyordu; `finally` artık
dosyayı yeniden okuyup yalnızca o anahtarları düşürüyor
(`flags.remove_declared`). Eş zamanlı düzenleme korunuyor, geçici beyan
yine temizleniyor.

**Ders:** bir aracın "geri al" adımı, aracın kendi yaptığını geri almalı
— dosyanın o anki hâlini değil. Anlık kopya-geri yazma tek süreçli bir
dünyanın varsayımıdır ve o varsayım burada doğru değil.
