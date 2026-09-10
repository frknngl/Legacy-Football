# Kariyer Omurgası — 30 Sezonluk Hikaye Haritası

Bu belge, oyunun 30 sezonluk (16-41 yaş, ~1000 tur) kariyer boyu **tekrarsız, özgün ve eğlenceli** akışının omurgasını tanımlar.

Kural:
1. **Kombinatorik Rastlantısallık Değil, Kurgusal Omurga:** Her çağda oyuncuyu bekleyen 5-6 sabit kilit taşı (`once: true`, `epic` veya `major`) vardır.
2. **Kelebek Sözleşmesi:** Yazılan her kilit taşı tohumunun (`mem_*`), ileriki bir çağda en az bir **ödeme sahnesi** (`turnsSince` veya `op: isSet`) olmak zorundadır.
3. **Ton Dengesi:** Her çağda en az 2 hafif / mizahi / ritüel sahne yer alır. Futbol sadece mahkeme ve tefeci draması değildir; krampon rengi, uğurlu çorap ve otobüs koltuğu da futbolun özüdür.
4. **Çağ Sesi İlkesi:** 16 yaşındaki çırak odaya sessizce girer, karar ona ait değildir; 36 yaşındaki efsane ise son sözü söyler.

---

## 1. Çırak Çağı (Rookie: 16-19 Yaş, Sezon 1-4)
*Tema: Kapıdan içeri ilk adım. Para az, akraba çok, otorite mutlak.*

| ID | Başlık / Konu | Format | Tier & Ton | Slot | Tohum (`mem_*`) | Ödeme Sahnesi | Durum |
|---|---|---|---|---|---|---|---|
| `evt_business_ilk_sozlesme_veli` | İki İmza Yeri (Veli İmzası) | Bilgi Metni + Sahne | major / drama | sporting_director | `mem_ilk_sozlesme_veli` | `evt_business_ikinci_sozlesme_masasi` (Rise) | written |
| `evt_money_ilk_maas` | İlk Maaş & Brüt-Net Şoku | Mesajlaşma + Sahne | minor / hafif | agent | `mem_ilk_maas_harcandi` | `evt_money_ilk_buyuk_harcama` (Rise) | written |
| `evt_personal_cousin_istek` | Kapının Önünde Bir Araba (Forma İsteği) | Durum Senaryosu | major / drama | cousin | `mem_ilk_istek_*` | `evt_personal_akraba_ikinci_dalga` (Rise/Prime) | written |
| `evt_media_ilk_roportaj` | On Dakika (Depoda İlk Röportaj) | Röportaj | major / drama | journalist | `mem_ilk_roportaj_tonu` | `evt_media_gazeteci_arsiv_yuzlesmesi` (Veteran) | written |
| `evt_mind_doctor_olcum` | Kemik Yaşı & Röntgen Odası | Tutanak + Sahne | minor / drama | doctor | `mem_kemik_yasi_suphesi` | `evt_mind_fizik_siniri_yuzlesme` (Prime) | written |
| `evt_ritual_keeper_corap` | Üçüncü Kalecinin Yıkanmayan Çorabı | Diyalog | minor / hafif | keeper | `mem_batil_inanc_baslangic` | `evt_ritual_derbi_uguru` (Prime) | written |
| `evt_locker_star_teammate_isim` | Yanlış İsimle Çağrılmak | Diyalog | minor / hafif | star_teammate | `mem_soyunma_odasi_ilk_gun` | `evt_locker_genclere_isim_ogretme` (Veteran) | written |
| `evt_national_umit_milli_sinav` | Ümit Milli Daveti vs Lise Sınavı | Belge + Sahne | major / hafif-drama | national_manager | `mem_umit_milli_kampa_yetisti` | `evt_national_ilk_forma` (Rise) | written |

---

## 2. Yükseliş Çağı (Rise: 20-23 Yaş, Sezon 5-8)
*Tema: Vitrine çıkış. İlk şöhret, ilk ezeli rekabet, ilk küçük rüşvet teklifi, menajer oyunları.*

| ID | Başlık / Konu | Format | Tier & Ton | Slot | Tohum (`mem_*`) | Ödeme Sahnesi | Durum |
|---|---|---|---|---|---|---|---|
| `evt_national_ilk_forma` | İlk A Millî Forma & Marş | Sahne | epic / drama | national_manager | `mem_ilk_milli_mac` | `evt_national_kaptanlik_pazubandi` (Prime) | written |
| `evt_dark_kucuk_teklif_sari_kart` | "Sarı Kart Gör, Kimse Ölmez" | Durum Senaryosu | major / drama | fixer | `mem_accepted_fixing` | `evt_legal_eski_dosya_sorusturma` (Veteran) | written |
| `evt_sponsor_ilk_krampon_catismasi` | Rakip Renkte Krampon Sözleşmesi | Diyalog | major / hafif | agent | `mem_krampon_anlasmasi` | `evt_sponsor_reklam_cekimi` (Prime) | written |
| `evt_business_ikinci_sozlesme_masasi` | Velisiz İlk Masa | Sahne | major / drama | sporting_director | `mem_ikinci_sozlesme_serbest_kalma` | `evt_business_avrupa_cikisi` (Prime) | written |
| `evt_tactics_sistem_degisimi` | "Artık Bek Oynuyorsun" | Sahne | major / drama | manager | `mem_mevki_kaymasi` | `evt_tactics_yerine_transfer` (Prime) | written |
| `evt_tactics_gol_orucu` | Gol Orucu (5 Maçtır Gol Yok) | Sahne | major / drama | manager | — | — | written |
| `evt_life_hazirlik_kampi_tartisi` | Hazırlık Kampı Kilo Tartısı | Diyalog | minor / hafif | doctor | — | — | written |
| `evt_media_oyun_reyting_isyani` | Futbol Oyununda 69 Hız Puanı | Diyalog | minor / hafif | star_teammate | — | — | written |
| `evt_tactics_hakem_kokart_hafizasi` | Tüneldeki Hakem Kokart Uyarısı | Diyalog | minor / drama | referee | `mem_hakemle_anlasti` | (Kariyer Sonu) | written |
| `evt_life_havalimani_pasaport_krizi` | Havalimanında Kayıp Pasaport | Olay Senaryosu | minor / hafif | assistant | `mem_pasaport_krizi_yasandi` | (Kariyer Sonu) | written |
| `evt_life_gece_kulubu_ilk_paparazzi` | Arka Kapıdan Kaçış | Olay Senaryosu | minor / hafif | childhood_friend | `mem_mac_gecesi_kacti` | `evt_media_deepfake_krizi` (Prime) | written |
| `evt_rival_first_derby` | İlk Derbi & Tüneldeki Bakış | Sahne | epic / drama | opponent_star | `mem_rival_derby_history` | `evt_rival_transfer_race` (Prime) | written |

---

## 3. Zirve Çağı (Prime: 24-29 Yaş, Sezon 9-14)
*Tema: Gücün zirvesi. Kaptanlık, büyük transferler, sponsor baskısı, isyan ve liderlik.*

| ID | Başlık / Konu | Format | Tier & Ton | Slot | Tohum (`mem_*`) | Ödeme Sahnesi | Durum |
|---|---|---|---|---|---|---|---|
| `evt_locker_isyan_tohumu` | Hocaya Karşı Soyunma Odası İsyanı | Sahne | epic / drama | captain | `mem_hoca_isyanina_katildi` | `evt_locker_hoca_gitti_hesap` (Prime) | written |
| `evt_locker_hoca_gitti_hesap` | Yeni Hocanın İlk Sorusu ("Kimin Yüzünden?") | Sahne | major / drama | manager | `mem_hoca_kovuldu` | `evt_media_isyanci_etiketi` (Prime/Veteran) | written |
| `evt_media_isyanci_etiketi` | Manşetteki İsyancı Damgası | Röportaj | major / drama | journalist | `mem_isyanci_damgasi` | `evt_legacy_forma_muzeye` (Twilight) | written |
| `evt_national_kaptanlik_pazubandi` | Pazubandı Takmak & Genç Kesme | Sahne | epic / drama | national_manager | `mem_milli_kaptanlik` | `evt_national_veda` (Veteran) | written |
| `evt_dark_tefeci_kapida` | Kapıdaki Siyah Araba (Tefeci) | Sahne | major / drama | fixer | `mem_tefeci_gordu` | `evt_personal_borcun_golgesi` (Veteran) | written |
| `evt_sponsor_reklam_cekimi` | 14 Saatlik Şampuan Reklamı | Diyalog / Günlük | minor / hafif | sponsor | `mem_sacma_reklam_yuzu` | `evt_media_viral_caps_dalgasi` (Prime) | written |
| `evt_social_kumarhane` | Sabaha Karşı Rulet Masası | Sahne | major / drama | fixer | `mem_kumarhane_gecesi` | `evt_legal_mafia_collects` (Prime/Veteran) | written |
| `evt_tactics_yerine_transfer` | 20 Yaşındaki Brezilyalı Geldi | Sahne | major / drama | manager | `mem_yerine_adam_alindi` | `evt_transfer_rakibe_gecis_hesaplasma` (Prime) | written |
| `evt_personal_kupa_finali_biletleri` | Kupa Finali On Bilet ve Kırk Akraba | Durum Senaryosu | major / hafif | cousin | — | — | written |
| `evt_ritual_yenilmezlik_serisi` | Yenilmezlik Serisi ve Sakal Totemi | Diyalog | minor / hafif | captain | — | — | written |
| `evt_fandom_dusme_hatti_baskini` | Düşme Hattı ve Gece Tesis Baskını | Sahne | major / drama | fan_leader | — | — | written |
| `evt_locker_forma_numarasi_kavgasi` | Askıdaki On Numara | Sahne | major / hafif | star_teammate | `mem_forma_numarasini_vermedi` | (Kariyer Sonu) | written |
| `evt_personal_cousin_ikinci_istek` | Mutfak Masasındaki Fizibilite (İkinci İstek) | Durum Senaryosu | major / drama | cousin | `mem_kuzene_sermaye_verdi` | (Kariyer Sonu) | written |
| `evt_rival_forma_degisimi_tuneli` | Tüneldeki İki Terli Forma (Rakip Yıldız) | Sahne | minor / hafif | opponent_star | `mem_rakip_yildiz_forma_degisti` | (Kariyer Sonu) | written |

---

## 4. Tecrübeli Çağı (Veteran: 30-34 Yaş, Sezon 15-19)
*Tema: Beden yavaşlar, hafıza hızlanır. Gençlere yer açmak, eski hesaplar, milli takıma veda.*

| ID | Başlık / Konu | Format | Tier & Ton | Slot | Tohum (`mem_*`) | Ödeme Sahnesi | Durum |
|---|---|---|---|---|---|---|---|
| `evt_national_veda` | Son Kamp & Ay-Yıldızlı Formayı Bırakmak | Sahne | epic / drama | national_manager | `mem_milli_takim_birakti` | `evt_legacy_milli_efsane_plaketi` (Twilight) | written |
| `evt_national_kadro_disi` | TV Başında Açıklanan Liste | Sahne | major / drama | national_manager | `mem_milli_kadro_disi` | `evt_national_veda` (Veteran) | written |
| `evt_personal_borcun_golgesi` | Mutfak Masasındaki Eski Dekont | Sahne | major / drama | partner | `mem_borc_kapatildi` | `evt_legacy_ellinci_gol` (Veteran) | written |
| `evt_legal_eski_dosya_sorusturma` | Sekiz Yıl Önceki Maç İçin Tebligat | Belge + Tutanak | epic / drama | prosecutor | `mem_eski_dosya_aklandi` | (Kariyer Sonu) | written |
| `evt_locker_genc_oyuncu_dolabi` | Yanına Oturan 17 Yaşındaki Çocuk | Diyalog | minor / hafif | youngster | `mem_genclere_kol_kanat` | `evt_legacy_forma_muzeye` (Twilight) | written |
| `evt_ritual_otobus_koltugu_savasi` | 10 Yıllık Sabit Koltuğa Oturan Yeni Transfer | Diyalog | minor / hafif | rival_teammate | `mem_otobus_koltugu_cozuldu` | (Kariyer Sonu) | written |
| `evt_locker_yedek_kulubesi_gunlugu` | Battaniyenin Altındaki Dünya (Yedeklik) | Diyalog | minor / hafif | veteran | — | — | written |
| `evt_legacy_yuzuncu_mac` | 100. Maç Plaketi & Boş Tribün | Sahne | minor / drama | president | `mem_yuzuncu_mac_toreni` | `evt_legacy_forma_muzeye` (Twilight) | written |

---

## 5. Alacakaranlık Çağı (Twilight: 35-41 Yaş, Sezon 20-25)
*Tema: Son maç, müzeye asılan forma, ağrıyan dizler, son sözleşme ya da jubile.*

| ID | Başlık / Konu | Format | Tier & Ton | Slot | Tohum (`mem_*`) | Ödeme Sahnesi | Durum |
|---|---|---|---|---|---|---|---|
| `evt_legacy_forma_muzeye` | Çerçeve İçindeki 10 Numara | Sahne | epic / drama | president | `mem_forma_muzeye_asildi` | (Kariyer Sonu) | written |
| `evt_legacy_ellinci_gol` | Son Derbideki 50. Gol | Sahne | major / drama | captain | `mem_ellinci_gol_rekoru` | (Kariyer Sonu) | written |
| `evt_life_son_sezon_diz_karari` | İğneyle Çıkılan Son Isınma | Sahne | major / drama | doctor | `mem_son_sezon_fedakarligi` | `evt_life_jubile_teklifi` (Twilight) | written |
| `evt_life_jubile_teklifi` | Veda Maçı: Kendi Seyircin mi, Katar Parası mı? | Sahne | epic / drama | president | `mem_jubile_secimi` | (Kariyer Sonu) | written |
| `evt_media_son_roportaj_pismanlik` | "Geriye Baksan Neyi Değiştirirdin?" | Röportaj | major / drama | journalist | `mem_son_roportaj_mirasi` | (Kariyer Sonu) | written |
| `evt_locker_son_dolap_bosaltma` | Yıpranmış Kramponlar ve Malzemeci | Diyalog | minor / hafif | assistant | `mem_dolap_bosaltildi` | (Kariyer Sonu) | written |

---

## 6. Haftalık Yazım Dağılım Formülü

Haftalık 3-5 sahne yazım kapasitesi için önerilen ritim:
1. **3 Omurga Sahnesi** (sırayla: Çırak → Yükseliş → Zirve)
2. **1 Renk Sahnesi** (hafif/mizahi: krampon rengi, otobüs koltuğu, saç modeli, reklam)
3. **1 Ödeme Sahnesi** (daha önce atılmış bir `mem_*` tohumunun faturası ya da ödülü)
