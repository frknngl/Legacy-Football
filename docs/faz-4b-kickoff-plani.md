# Faz 4b Kickoff Plani (Isyan Icerigi)

Date: 2026-09-10
Status: STARTED

## Faz Amaci
Faz 4b, isyan ve tepkisel zincirin icerik tarafini tamamlar.
Motor tarafi hazir oldugu icin odak yazim ve editor kalitesidir.

## Hedefler
1. Isyan zincirinin omurga akisinda kesintisiz calismasi.
2. Ana kilit sahnelerde (major/epic) odeme izlerinin net olmasi.
3. Editor kapisi kriterlerine tam uyum (docs/editor-kapisi.md).
4. Dogrulayici ve test kapilarinda regressionsuz ilerleme.

## Wave-1 Hedef Dosyalari
- content/events/locker/evt_locker_isyan_tohumu.json
- content/events/locker/evt_locker_hoca_gitti_hesap.json
- content/events/media/evt_media_isyanci_etiketi.json
- content/events/media/evt_media_oyun_reyting_isyani.json
- content/events/reaction/evt_react_locker_room_court.json
- content/events/legacy/evt_legacy_forma_muzeye.json

## Kickoff Adimlari (Uygulama Basladi)
1. Baseline kapisi alindi:
   - validate: 237 events | 37 rules | 0 errors | 0 warnings
   - tests: 58/58 files, 804/804 tests
2. Wave-1 dosyalari secildi ve faza sabitlendi.
3. Her dosya icin hedef:
   - sahne sesi/cag uyumu
   - asil secenekte asimetrik bedel
   - en az bir beklenmedik secenek
   - sablon kapanislardan kacis

## Done Criteria
- Wave-1 dosyalarinda editor kontrolu tamam.
- Isyan zinciri olaylari secimde gorunur ve anlamsal akis tutarli.
- validate ve test tekrar yesil.

## Wave-1 Ilerleme (2026-09-10 / ilk tur)
- Durum: basladi ve ilk metin duzeltme turu tamamlandi.
- Temas edilen hedef dosyalar:
   - content/events/locker/evt_locker_isyan_tohumu.json
   - content/events/locker/evt_locker_hoca_gitti_hesap.json
   - content/events/media/evt_media_isyanci_etiketi.json
   - content/events/media/evt_media_oyun_reyting_isyani.json
   - content/events/reaction/evt_react_locker_room_court.json
   - content/events/legacy/evt_legacy_forma_muzeye.json
- Yapilanlar:
   - El yazimi ana zincir dosyalarina `_yazar_notu` eklendi.
   - Legacy v_asil outcome sonlarindaki kirik/sablon kalinti kapanislar temizlendi.
   - Media/Reaction ana metinlerde noktalama artefaktlari duzeltildi.
- Kapi sonucu:
   - `npm run validate -- --warnings` -> 237 olay | 37 kural | 0 hata | 0 uyari
   - `npm test -- tests/Schema.test.ts tests/QualityRules.test.ts tests/MatchContextGate.test.ts` -> 3/3 dosya, 20/20 test gecti
