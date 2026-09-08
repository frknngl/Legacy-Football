# Genişleme Denetimi — Ekonomi, İsyan, Telefon

Kod okunarak yapıldı (2026-09-08). Okunur rapor:
https://claude.ai/code/artifact/8b92bd03-1312-4975-ae12-ed405f91ea3f

Bu dosya **ölçümleri** saklar; gerekçe ve plan raporda.

---

## Hüküm

| Modül | Durum | Kilit |
|---|---|---|
| İnteraktif senaryolar / isyan | **Hazır** | Yalnızca `WorldEvent` türü eksik |
| Ekonomi / bahis / yatırım | **Kısmen** | Oyuncu-seçimli miktar ifade edilemiyor |
| 3D telefon arayüzü | **Yok** | Projede UI katmanı hiç yok |

---

## Ölçülen bulgular

### Taşıyan kolonlar

| Bulgu | Kaynak |
|---|---|
| `domain` hiçbir üst katmandan import etmiyor; `simulation` yalnızca `domain` + `selection/Rng` | grep, 0 ihlal |
| Tohumlu RNG imleç kaydediyor (mulberry32 + cursor) | `selection/Rng.ts` |
| Ağırlıklı olasılık çözücü kurulu | `runtime/RollResolver.ts` + `WeightExpressionEvaluator.ts` |
| Efekt sistemi **kapalı birleşim**, 6 işlem: `flag` `schedule` `lifeState` `suspend` `clubTier` `match` | `domain/effects.ts:112` |
| Bayrak başına yazma izni (`writableBy`: content/engine/host) | `domain/flags.ts:51` |
| Aktörlerde `relation` + `trust` + `chemistry` + `minutesTogether` | `domain/actors.ts:206` |
| Eski kayıt backfill'i tek noktada, `??=` deseni, 94 satır | `runtime/SaveGame.ts` |
| Host'ta etkileşimli masa emsali | `cli/play.ts:657` (`agentDesk`) |

### Açıklar

| Bulgu | Ölçüm | Kaynak |
|---|---|---|
| Katman kuralının otomatik denetimi yok | eslint yapılandırması bulunamadı | — |
| Oyuncu-seçimli miktar ifade edilemiyor | `ScalableValue.scaleBy` ∈ {stature, clubTier, season} | `domain/effects.ts:16` |
| Moral maç gücüne en fazla **%6** etki ediyor | `hero.morale/100*0.06` | `simulation/TeamModel.ts:103` |
| `isCaptain` simülasyonda **hiç** okunmuyor | 0 kullanım | `src/simulation/` |
| Borç temalı 10 bayrak: **58 yazım / 0 okuma** | yetim | `content/events/` |
| `mem_gambling_debt` okunuyor ama hiç yazılmıyor | 0 yazım | — |
| Kaynak bayrağı yalnızca 5 tane | `servet` `borc` `haftalik_gelir` `sosyal_medya_takipci` `piyasa_carpani` | `core.json` |
| Romantik ilişki ekseni yok | relation: takım/aile/sponsor/basın | `core.json` |
| Cüzdan için işlem defteri yok | `servet` tek sayı | — |
| Arayüz katmanı yok | tek host 751 satır terminal REPL | `cli/play.ts` |

### Bayrak bütçesi (323 toplam)

```
memory   216   incident 29   derived 17   system 16   match 15
stat      11   pressure  6   resource  5   relation 4   persona 4
```

216'sı hafıza izi, 5'i kaynak. Oyun hatırlamayı iyi, saymayı az yapıyor.

---

## Uygulama sırası (bağlayıcı)

0. Katman korkuluğu (`tests/Layering.test.ts`) — modüllerden **önce**
1. Moral→performans bağını onar — Modül C'nin tüm ödülü buna bağlı
2. `ValueRef` ilkeli (`domain/effects.ts`) — sonraki her şeyin önkoşulu
3. Cüzdan omurgası + kredi — 58 yetim izi canlandırır
4. İsyan + tepkisel senaryolar — en az kod, en çok getiri
5. Kumar ve piyasalar
6. `PhoneModel` (veri) — grafik yazmadan terminalde oynanabilir
7. Görsel arayüz — motorda değişiklik gerektirmemeli

---

## Riskler

- **Proje git deposu değil.** Üç büyük modül eklenirken geri alma yok.
  Genişlemeden önce sürüm kontrolü kurulmalı.
- Telefonu modelden önce görselden başlatmak, motora UI varsayımı sızdırır.
- Moral bağı onarılmazsa sosyal yaşam ve finansal risk sahada hissedilmez.
- Yürürlükteki karar: tekrarsız senaryo bitene kadar yeni geliştirme yok.
  Bu dosya **plandır, başlama emri değil.** Faz 0-1 küçük olduğu için
  paralel yürüyebilir; gerisi sıraya girer.
