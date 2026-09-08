# Legacy Football V3

UI-bağımsız, veri-güdümlü futbol kariyeri anlatı motoru. Saf TypeScript, sıfır build adımı.

```bash
npm install
npm run validate      # içerik denetimi (29 kural)
npm test              # birim + entegrasyon
npm run demo          # otomatik kariyer — sahneleri okuyun
npm run play          # terminalde kendiniz oynayın
```

## Neden bu mimari

Eski sistemde 401 içerik dosyası vardı ve bunlar 4 gerçek senaryodan ibaretti: aynı metin, farklı isim. Cooldown olay bazlıydı, aile bazlı değildi — üst üste 100 hafta gece kulübüne gidilebiliyordu. `has_bribed_police` gibi flag'ler hiçbir yerde tanımlı değildi. Her seçenek `hub_calendar`a gidiyordu, yani olaylar zincirlenemiyordu.

V3'te bunların her biri **yapısal olarak imkânsız**: validator build'de reddeder.

## Katmanlar

```
domain/      saf tipler, sıfır bağımlılık
evaluation/  koşul/efekt/ağırlık hesabı — durum tutmaz
loading/     JSON -> tipli nesne, indeksli registry
selection/   uygunluk + ağırlıklı seçim + zamanlanmış kuyruk
runtime/     tur, hayat durumu, ilerleme, kelebek günlüğü, GameEngine
validation/  21 kural (severity'si veriden yönetilir)
cli/         validate | demo | play
testing/     FakeMatchHost — gerçek host gelene kadar
```

Bağımlılık yönü tek yönlüdür: `cli -> runtime -> selection -> loading -> evaluation -> domain`.

## Yeni olay eklemek

`content/events/<kategori>/evt_<kategori>_<konu>.json` dosyası açın. **Build adımı yok** — bir sonraki çalıştırmada tanınır.

```json
{
  "id": "evt_legal_doping_test",
  "family": "fam_legal_doping",
  "category": "legal",
  "tier": "major",
  "weight": 20,
  "cooldown": { "self": 20, "family": 10 },

  "eras": ["prime", "veteran"],
  "stature": ["star", "superstar", "icon"],
  "clubTiers": ["contender", "elite"],
  "lifeStates": ["playing"],
  "trigger": { "allOf": [
    { "flag": "mem_took_injection", "op": "isSet" },
    { "flag": "season", "op": "gte", "value": 3 }
  ]},

  "rootNode": "n_root",
  "nodes": {
    "n_root": {
      "title": "Numune",
      "kind": "branch",
      "text": "…en az 60 kelimelik sinematik sahne…",
      "choices": [
        { "id": "c_a", "text": "…", "effects": [
          { "flag": "moral", "op": "add", "value": -8 },
          { "flag": "profesyonellik", "op": "add", "value": 5 },
          { "flag": "mem_hid_injury", "op": "set", "value": true }
        ]}
      ]
    }
  }
}
```

### Zorunlu kurallar (ihlali = build hatası)

| Kural | Ne ister |
|---|---|
| `MinChoiceCountRule` | Her `branch` node ≥3 seçenek |
| `EscapeHatchRule` | Her `branch` node'da ≥1 **koşulsuz** seçenek |
| `UndeclaredFlagRule` | Her flag `core.json`da tanımlı |
| `ConsequenceHookRule` | Her olay kalıcı iz bırakır: `mem_*` ∨ `schedule` ∨ `npc_*_arc` ∨ `lifeState` |
| `DanglingTargetRule` | Her `target` var olan bir node |
| `CooldownSanityRule` | `family > 0` ve `self >= family` |
| `TextQualityRule` | Klon metin yok (hash ile yakalanır) |
| `ReadOnlyFlagRule` | İçerik `derived`/`match` yazamaz, `persona`yı `set` edemez |

Uyarı seviyesindekiler (`TradeoffRule`, `CastPresenceRule`, `TierComplianceRule`…) `validation.config.json` ile dalga dalga `error`a çekilir.

### Muafiyet

```json
"lint": { "ignore": ["TextQualityRule"], "reason": "Bilinçli tekrar: aynı sahne iki medya çağında farklı okunuyor." }
```

`reason` **zorunludur**; gerekçesiz muafiyet ayrıştırmada reddedilir.

## Kapılama: üç bağımsız eksen

2. Lig'deki 24 yaşındaki oyuncu ile Şampiyonlar Ligi'ndeki 24 yaşındaki oyuncu **aynı era**dadır ama aynı hayatı yaşamaz.

| Eksen | Değerler | Kim belirler |
|---|---|---|
| `eras` | rookie · rise · prime · veteran · twilight | yaş |
| `stature` | nobody → legend (7) | **motor türetir** (`StatureCalculator`) |
| `clubTiers` | amateur → elite (5) | bağlam |

Eksen yazılmazsa "hepsi" demektir.

### Ölçeklenen efektler

Tek dosya, yedi seviye:

```json
{ "flag": "servet", "op": "add",
  "value": { "scaleBy": "stature", "base": -10000, "perTier": -120000 } }
```

2. Lig'de 10.000 ₺, ikon seviyesinde 730.000 ₺. Aynı senaryonun beş kopyasını yazmaya gerek yok.

**Yetersizlik politikası:** `servet` asla eksiye düşmez; açık `borc`a yazılır (`core.json` → `shortfallTo`).

## Maç sözleşmesi (çift yönlü)

Motor maç **simüle etmez**. Host fizik/skor/lig tablosundan, motor oyuncunun kararından sorumludur.

```
host  -> playMatch({ context, pendingMoments })
motor -> karar kuyruğu (UI oyuncuya sorar) -> roll ile stat-ağırlıklı sonuç
motor -> MatchOutcomeDelta { goalsDelta, redCard, injuryWeeks, incidents }
host  -> skora uygular -> finalizeMatch(result)
motor -> inc_* açar -> röportaj olayları tetiklenir
```

`pendingMoments: []` gönderilirse moment fazı atlanır — **zarif bozulma**, hata olmaz.

İçerik skoru `{ "op": "match", "goals": 1, "incident": "inc_scored_penalty" }` ile etkiler.

## İki katmanlı hafıza

| Katman | Ömür | Kullanım |
|---|---|---|
| `inc_*` | Sonraki maça kadar | Maç sonu röportajı, soyunma odası |
| `mem_*` | Kalıcı + zaman damgalı | Yıllar sonra belgesel, şantaj, mentörlük |

`turnsSince` operatörü damgayı okur:

```json
{ "flag": "mem_missed_final_penalty", "op": "turnsSince", "value": 240 }
```

Altı sezon sonra Sinan Erdoğan'ın "kariyerinin gölgesi" dosyası.

## Kelebek günlüğü

```ts
engine.explain('evt_react_var_controversy');
// -> ['Sezon 1, Hafta 17 - "Halka" (evt_match_var_against)']
```

Tetiğin okuduğu flag, onu yazan karara kadar geriye izlenir.

## Yazım hattı (`tools/authoring/`)

Build-time bir araç; **motora hiç girmez** ve motorun sıfır-bağımlılık disiplinini bozmaz. Yapıyı prosedürel üretir, prozayı bir modele yazdırır, üretileni yayımlamadan önce projenin kendi 26 kuralından geçirir. Kapıyı geçmeyen sahne **diske yazılmaz**.

```bash
npm run author -- doctor            # kurulum, sızıntı taraması, ölü flag beyanı
npm run author -- selftest          # hattın kendi 4 testi
npm run author -- report            # sahne defteri: hangi kombinasyon dolu, hangisi boş
npm run author -- write --category=dark --count=5
npm run author -- arc --category=mind          # zincir: tohum + ödemeler, tek parça
npm run author -- variant --category=locker    # mevcut olaya ikinci sahne
npm run author -- widen             # ölü içeriğin kapılamasını ölçüme göre gevşetir
```

Anahtar yalnızca `.env` içindeki `GEMINI_API_KEY`de yaşar; `.env` gitignore'dadır ve `doctor` her çalıştığında repoda sızıntı arar.

**Tekrarsızlığın kaynağı kelime karıştırmak değil, kombinasyon muhasebesi.** Sahne Defteri her sahnenin `(kategori, slot, duygusal beat, era, şöhret, kulüp, hayat durumu)` imzasını tutar; planlayıcı bu imzayı tekrar eden bir brief **üretmez**. "Aynı sahnenin farklı ismi" böylece yapısal olarak imkânsızlaşır.

Windows'ta `python` yoksa `package.json`daki `author` script'inde `py -3` kullanın.

## Sürüm kontrolü ve sızıntı koruması

Depo klonlandıktan sonra **bir kez** çalıştırılmalı:

```
git config core.hooksPath tools/githooks
```

Bu, `tools/githooks/pre-commit` kancasını devreye alır. Kanca iki şeyi
engeller:

1. Gerçek bir `.env` dosyasının index'e girmesi (`.env.example` serbesttir)
2. Eklenen satırlarda API anahtarı deseni bulunması

**Neden gerekli:** anahtar bir kez commit'lenirse geçmişten silmek tüm
commit'leri yeniden yazmak demektir. `.gitignore` yeterli değil — tek bir
`git add -f` ya da yanlış bir kopyala-yapıştır onu aşar.

`data/` (üretilen dünya veritabanı, 41 MB) ve `node_modules/` depoya
girmez; ikisi de araçlar tarafından yeniden üretilir.

## Zaman

`age = startAge + floor((turn - 1) / 40)`. Emeklilik **yaşa** bağlıdır, tura değil: pencere 33'te açılır, 38-41 oyuncu kararı, 41 zorunlu. Arketipler farklı yaşlarda başladığı için kariyer uzunlukları da farklıdır (16 → ~1040 tur, 19 → ~920 tur).

## Durum

Dikey dilim: motor + şema + validator + senaryo ağaçları. Doğrulanmış zincirler:

- **Penaltı**: moment → 4 seçenek → `roll` → `goalsDelta` → röportaj
- **VAR → PFDK**: moment → röportaj → `schedule(+2, forced)` → **garantili** duruşma → 3 maç ceza → `PlayerAvailability.available === false` → 3 maç sonra otomatik dönüş
- **Kelebek arkı**: `mind` tohumu bir iz bırakır → +21 tur aile sahnesi → +48 tur medya → +123 tur hukuk. Üçü de aynı izi `turnsSince` ile okur; `engine.explain()` sebebi ilk karara kadar takip eder.

113 olay | 726 sahne | 14 kategori | `npm run validate` → 0 hata. Uyarılar yazılmamış içeriğin dürüst listesidir.
