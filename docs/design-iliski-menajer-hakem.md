# İlişki · Menajer · Hakem — Tasarım

> Durum: **tasarım**. Kod yok. Faz sırası ve entegrasyon noktaları en sonda.

---

## 0. Denetim — ne var, ne yok

Tasarımdan önce ölçüldü. Üç sistemin de **bir kısmı zaten duruyor**; sıfırdan kurmak mevcut mimariyi ikiye bölerdi.

| Sistem | Var olan | Eksik |
|---|---|---|
| İlişki | `roles.json`'da 43 slot; `ActorState.relation` (0-100); sönümlenme (`positivePerSeason: 2`, `negativeLocked: true`); `relationByStature`; `ActorArchive`; `ReunionDirector`; `iliski_<slot>` flag sentezi | **Mekanik etki hiç yok.** `iliski_*` `src/simulation/` içinde bir kez bile okunmuyor. Kimya ve güven ekseni yok. Oyuncu↔oyuncu ilişkisi yok. |
| Menajer | `agent` slotu (scope `career`, `arcStages: 6`, `defaultRelation: 50`) | Arketip, komisyon, nüfuz, teklif üretimi, memnuniyet, menajer değiştirme — **hiçbiri yok**. `src/` içinde "agent" kelimesi geçmiyor. |
| Hakem | `referee` slotu (scope `match`, `arcStages: 3`, `defaultRelation: 45`) | Nitelik, kokart, atama algoritması, maç motoru etkisi, karşılaşma geçmişi — **hiçbiri yok**. |

**Sonuç:** İlişki sisteminin *kablosu* eksik; menajer ve hakem gerçekten isimden ibaret.

### 0.1 Veri nereye yazılacak — üç ayrı yaşam döngüsü

Mevcut mimari üç depoyu zaten ayırmış; yeni sistemler bu ayrıma uymak zorunda.

```
content/*.json   Yazılmış içerik.        Versiyonlanır, immutable, DB'ye HİÇ girmez.
world.db         Tool üretir.            Kariyer boyunca DEĞİŞMEZ, salt okunur.
GameState (JSON) Kariyer durumu.         Her tur değişir, SaveGame ile serileşir.
```

| Yeni veri | Nerede | Neden |
|---|---|---|
| Hakem kadrosu, nitelikleri, kokartı | `world.db` | Dünyanın parçası, kariyerden bağımsız |
| Menajer kadrosu, arketipi, nüfuzu | `world.db` | Aynı |
| Hero'nun ilişkileri (relation/trust/chemistry) | `GameState` | Kariyere özel, küçük (43 slot) |
| Hero↔hakem geçmişi | `GameState` | Kariyere özel, 25 sezonda ~200 satır |
| Menajer memnuniyeti, komisyon geçmişi | `GameState` | Kariyere özel |
| Sezon içi fikstür/puan durumu | Bellek (`SeasonRunner`) | Zaten öyle |

> **Karar:** `save.db` (SQLite) **kurulmuyor.** Kayıtlar bugün JSON `SaveEnvelope`; kariyer durumu küçük ve şema-esnek. SQLite'a geçmek `SaveGame`'in iki yönlü uyum garantisini (bilinmeyen flag korunur, eksik flag default'lanır) yeniden yazmayı gerektirirdi ve karşılığında bir şey kazandırmazdı.

> **Karar:** Oyuncu↔oyuncu ilişki matrisi **kurulmuyor.** 7.276 oyuncu → 26 milyon çift. Bu bir *futbolcu kariyeri* simülasyonu, menajer simülasyonu değil: derinlemesine modellenen tek düğüm **Hero**. NPC↔NPC kimyası gerektiğinde türetilir (aynı mevki, aynı uyruk, aynı yaş kuşağı), saklanmaz.

---

## 1. Futbolcu İlişki Sistemi

### 1.1 Tek eksen yetmiyor — üç eksen

Bugün tek bir `relation: 0-100` var. Bu, birbirinden bağımsız üç şeyi tek sayıya sıkıştırıyor:

```
relation   0-100   Seni SEVİYOR mu.        Sosyal. Söz, jest, ihanet değiştirir.
trust      0-100   Sana GÜVENİYOR mu.      Bedeli varken arkanda durur mu.
chemistry  0-100   Seni ANLIYOR mu.        Sahada. Sözle değil, DAKİKAYLA kurulur.
```

Neden ayrı olmak zorundalar:

- **Kaptan seni sevmeyebilir ama sahada anlaşabilirsiniz.** İki yıl birlikte oynayan iki oyuncu birbirinden hoşlanmasa da paslaşır. `relation` düşük, `chemistry` yüksek.
- **Güven ayrı kazanılır.** Basına seni savunmak bedel ister; sevmek bedava. `relation 80 / trust 30` = "seni seviyor ama arkanda durmaz" — gerçek bir soyunma odası hali.
- **Kimya sözle kurulmaz.** Bu ayrımın en önemli sonucu: `chemistry` içerik seçimleriyle **yükselmez**, yalnızca birlikte oynanan dakikayla yükselir. Transferde sıfırlanır.

### 1.2 Şema — `GameState` genişlemesi

```ts
/** ActorState'e eklenen üç alan. Mevcut `relation` korunur. */
export interface ActorBond {
  /** 0-100. Mevcut alan; anlamı değişmiyor. */
  relation: number;
  /**
   * 0-100. Bedeli varken arkanda durur mu.
   * `relation`dan YAVAŞ hareket eder ve ihanetle SERT düşer.
   */
  trust: number;
  /**
   * 0-100. Yalnızca `source: 'squad'` slotlarda anlamlı.
   * Birlikte oynanan dakikadan doğar; sözle yükselmez, transferde sıfırlanır.
   */
  chemistry: number;
  /** Birlikte oynanan toplam dakika. `chemistry`nin ham girdisi. */
  minutesTogether: number;
  /** Son etkileşim turu -- soğuma ve "uzun süredir görüşmediniz" sahneleri için. */
  lastInteractionTurn: number;
}
```

Flag sentezi genişler (`roles.json` slotu başına dört yerine altı):

```
iliski_<slot>      relation    (var)
npc_<slot>_arc     arc         (var)
slot_<slot>_bound  bound       (var)
slot_<slot>_seasons seasons    (var)
guven_<slot>       trust       (YENİ)
kimya_<slot>       chemistry   (YENİ)
```

> İçerik bunları **okuyabilir**, `guven_*`'a yazabilir; `kimya_*` **salt okunur** (`ReadOnlyFlagRule`) — kimya sahada kazanılır, bir diyalog seçeneğiyle değil.

### 1.3 Kimya matematiği

```
kimyaKazanci(dakika) = dakika / 90 × 1.8        // tam maç ≈ +1.8
tavan               = 95
sönümlenme          = -0.6 / hafta   (birlikte oynanmayan her hafta)
transferSifirlama   = kulüp değişince squad-scope slotlar 0'a döner
```

**Kalibrasyon gerekçesi:** 38 maçlık bir sezonda birlikte oynayan iki oyuncu ≈ +68 kimya kazanır, haftalık sönümlenme ile net ≈ +45. Yani **bir sezon** birlikte oynamak "iyi anlaşıyorlar"a (≈70) çıkarır, **iki sezon** tavana yaklaştırır. Sakatlık dönemi kimyayı gözle görülür şekilde eritir — istenen davranış.

### 1.4 Saha içi yansıma — motorun neresine bağlanır

Mevcut `MatchSimulator` iki yerde oyuncu seçiyor; ikisi de kimyaya duyarlı hale gelir.

```ts
// src/simulation/MatchSimulator.ts -- pickAssister
// MEVCUT: mevki + pas yeteneği
weight(p) = positional(p) × (0.4 + p.attributes.passing / 100)

// YENİ: Hero'nun golünde asisti kim yapar -- kimya belirleyici
weight(p) = positional(p) × (0.4 + passing/100) × (0.7 + chemistry(p, hero) / 140)
//                                                  └── kimya 0 → ×0.70
//                                                      kimya 50 → ×1.06
//                                                      kimya 95 → ×1.38
```

Ve şansın kendisine küçük bir katkı:

```ts
// src/domain/chance.ts -- ChanceContext'e eklenir
readonly assistChemistry?: number;   // 0-100

// MathChanceResolver: kimya xG'yi HAFİFÇE artırır
xG *= 1 + (assistChemistry - 50) / 500      // ±%10 bant
```

> **Neden ±%10 ile sınırlı:** kimya bir *tercih* sinyali olmalı, bir *güç çarpanı* değil. Büyük katsayı verilirse "iyi anlaşan zayıf ikili, anlaşamayan güçlü ikiliyi geçer" olur; bu futbol değil.

**Soyunma odası huzuru** — squad slotlarının ağırlıklı ortalaması:

```
huzur = Σ(relation × slotAğırlık) / Σ(slotAğırlık)
slotAğırlık: captain 3, star_teammate 2.5, manager 3, rival_teammate 1.5, diğer 1

Etki:
  huzur < 35  → moral -2/hafta,  `mem_locker_kirik` işaretlenir
  huzur > 70  → moral +1/hafta
  huzur, `iliski_takim` flag'ini BESLER (bugün elle yazılıyor)
```

### 1.5 Saha dışı yansıma

| Kanal | Formül | Mevcut bağ |
|---|---|---|
| Medya açıklaması | `trust(basın)` yüksekse olumsuz haber olasılığı ×0.6 | `iliski_basin` var |
| Kaptanlık adaylığı | `liderlik + relation(takım) × 0.4 + trust(manager) × 0.3` | `is_captain` flag'i var, kimse yazmıyor |
| İlk 11 şansı | `trust(manager)` düşükse `isStarter` olasılığı düşer | `MatchContext.isStarter` var, hep `true` |

> `isStarter` bugün **her zaman true**. Güven ekseni bağlandığında ilk gerçek kullanımını bulur.

---

## 2. Menajer Arketip ve Pazar Sistemi

### 2.1 Şema — `world.db`

```sql
CREATE TABLE IF NOT EXISTS agent (
  id            INTEGER PRIMARY KEY,
  external_key  TEXT    NOT NULL UNIQUE,   -- kaynak ID; maske kilidinin çapası
  name_real     TEXT    NOT NULL,
  name_masked   TEXT    NOT NULL,
  archetype     TEXT    NOT NULL CHECK (archetype IN
                  ('super_agent','family','developer','opportunist','journeyman')),

  -- 0-100 nitelikler
  reach         INTEGER NOT NULL,  -- hangi seviyedeki kulüple masaya oturabilir
  negotiation   INTEGER NOT NULL,  -- maaş/bonservis pazarlık gücü
  loyalty       INTEGER NOT NULL,  -- oyuncuyu satmaya ne kadar dirençli
  patience      INTEGER NOT NULL,  -- reddedilen teklife tahammülü

  -- yüzde
  commission    REAL    NOT NULL,  -- 0.03 - 0.18
  country_id    INTEGER REFERENCES country(id),
  reputation    INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS ix_agent_archetype ON agent(archetype);
CREATE INDEX IF NOT EXISTS ix_agent_reach     ON agent(reach);
```

Kariyer durumu `GameState`'te:

```ts
export interface AgentState {
  /** world.db agent.id */
  readonly agentId: number;
  /** 0-100. Düşerse menajer ilgisini keser, sıfırlanırsa bırakır. */
  satisfaction: number;
  /** Pazarlıkla değiştirilebilir; world.db'deki taban değeri EZER. */
  commission: number;
  /** Reddedilen teklif sayısı -- sabrın tüketilme sayacı. */
  rejectedOffers: number;
  /** Bu menajerle kaç sezon çalışıldı. Sadakat primi. */
  seasonsTogether: number;
  /** Menajer değiştirme soğuması -- tur numarası. */
  switchableFromTurn: number;
}
```

### 2.2 Arketipler ve denge

| Arketip | reach | negotiation | loyalty | patience | commission | Karakter |
|---|---|---|---|---|---|---|
| **super_agent** | 85-98 | 80-95 | 15-35 | 20-40 | %12-18 | Dev kulüple masaya oturur, ama seni **sürekli satmak ister**. Reddedersen memnuniyeti hızla düşer. |
| **family** | 20-40 | 30-50 | 90-99 | 85-95 | %3-5 | Seni asla bırakmaz, komisyon yok denecek kadar az. **Elit kapıyı açamaz.** |
| **developer** | 45-65 | 50-70 | 65-80 | 70-85 | %6-9 | Forma şansı olan kulüpleri önceler. Büyük para getirmez, **kariyer getirir**. |
| **opportunist** | 60-80 | 65-85 | 25-45 | 30-50 | %9-14 | Her fırsatı değerlendirir; kulüp kalitesi umurunda değil, **komisyon** umurunda. |
| **journeyman** | 35-55 | 40-60 | 55-70 | 60-75 | %5-8 | Vasat ama güvenilir. Başlangıç menajeri. |

> **Denge ilkesi:** hiçbir arketip baskın değil. `super_agent` seni Şampiyonlar Ligi'ne taşır ama kazancının altıda birini alır ve her sezon transfer baskısı yapar. `family` seni asla üst lige çıkaramaz ama sen 34 yaşında formdan düşünce de yanında kalır — ve o an `loyalty` fiyatını öder.

### 2.3 Teklif getirme olasılığı

```
P(teklif) = taban
          × reachUyum(agent.reach, hedefKulüp.reputation)
          × formÇarpanı(hero.form, hero.season_goals)
          × memnuniyetÇarpanı(agent.satisfaction)
          × arketipEğilimi(agent.archetype, hedefKulüp)

taban              = 0.06 / hafta   (transfer penceresinde ×3)

reachUyum(r, k)    = clamp(1 - max(0, k - r) / 40, 0, 1)
                     // reach 50, kulüp 90 → 0.00  (kapı kapalı)
                     // reach 90, kulüp 90 → 1.00
                     // reach 90, kulüp 60 → 1.00  (aşağı doğru sınır yok)

formÇarpanı        = 0.5 + hero.form / 100 + hero.season_goals × 0.03

memnuniyetÇarpanı  = satisfaction < 25 ? 0.2 : 0.6 + satisfaction / 250

arketipEğilimi:
  super_agent  → kulüp itibarı > 80 ise ×1.6, < 60 ise ×0.3
  developer    → hedefte ilk 11 şansı > %55 ise ×1.8, değilse ×0.4
  family       → mevcut kulüpten daha iyiyse ×1.0, değilse ×0.2
  opportunist  → komisyon tutarı yüksekse ×1.5
  journeyman   → düz ×1.0
```

### 2.4 Memnuniyet ve menajer değiştirme

```
Memnuniyet hareketi:
  teklif reddedildi        → -(30 - patience/5)      // sabırsız menajer sert düşer
  transfer gerçekleşti     → +25
  sezon sonu formda        → +8
  sezon sonu formsuz       → -12
  hero kupa kazandı        → +10

Eşikler:
  satisfaction < 30  → uyarı sahnesi tetiklenir (`schedule` ile)
  satisfaction < 10  → menajer BIRAKIR; hero menajersiz kalır
  menajersiz         → teklif olasılığı ×0.25, komisyon 0

Menajer değiştirme:
  - `switchableFromTurn` geçmiş olmalı (varsayılan: 20 tur soğuma)
  - fesih bedeli = kalan sezon × haftalık gelir × commission × 4
  - yeni menajerin ilk `relation`ı = 50 - (önceki menajerin arkStage × 3)
    // sık menajer değiştiren oyuncuya piyasa soğuk bakar
```

### 2.5 Komisyon pazarlığı

Menajer bulunduğunda ve transferde açılan bir alt-oyun:

```
Hero teklif eder: yeniKomisyon
Menajer kabul olasılığı =
    clamp(0.5
          + (agent.commission - yeniKomisyon) × -8      // ne kadar kırparsan o kadar zor
          + trust(agent) / 200
          + seasonsTogether × 0.04
          - (agent.negotiation - 50) / 300,
          0.02, 0.95)

Reddederse: satisfaction -= 8, bir sonraki deneme 10 tur sonra
```

---

## 3. Hakem Hiyerarşisi ve Maç Motoru Entegrasyonu

### 3.1 Şema — `world.db`

```sql
CREATE TABLE IF NOT EXISTS referee (
  id           INTEGER PRIMARY KEY,
  external_key TEXT    NOT NULL UNIQUE,
  name_real    TEXT    NOT NULL,
  name_masked  TEXT    NOT NULL,
  country_id   INTEGER REFERENCES country(id),

  badge        TEXT    NOT NULL CHECK (badge IN
                 ('regional','national','elite','fifa')),

  -- 0-100 nitelikler
  strictness       INTEGER NOT NULL,  -- faul çalma eşiği (yüksek = çok çalar)
  card_tendency    INTEGER NOT NULL,  -- faulü karta çevirme eğilimi
  penalty_courage  INTEGER NOT NULL,  -- kritik anda nokta gösterebilme
  var_reliance     INTEGER NOT NULL,  -- VAR'a gitme sıklığı
  consistency      INTEGER NOT NULL,  -- düşükse maç içi kararlar savrulur
  home_bias        INTEGER NOT NULL,  -- 50 = nötr; ev sahibine eğilim

  experience   INTEGER NOT NULL DEFAULT 0,   -- yönetilen maç sayısı
  reputation   INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS ix_referee_badge   ON referee(badge);
CREATE INDEX IF NOT EXISTS ix_referee_country ON referee(country_id);

-- Hangi kokart hangi turnuvaya yeter (VERİ, kod değil)
CREATE TABLE IF NOT EXISTS referee_eligibility (
  competition_id INTEGER NOT NULL REFERENCES competition(id),
  min_badge      TEXT    NOT NULL,
  PRIMARY KEY (competition_id)
) STRICT;
```

Kariyer geçmişi `GameState`'te (yalnızca **Hero'nun** karşılaştığı hakemler):

```ts
export interface RefereeMemory {
  readonly refereeId: number;
  matches: number;
  yellows: number;
  reds: number;
  penaltiesFor: number;
  penaltiesAgainst: number;
  /**
   * -100..+100. Hero'nun bu hakeme dair hissi.
   * Haksız kart / verilmeyen penaltı düşürür; lehte karar yükseltir.
   * `mem_*` mantığıyla: NEGATİF sönümlenmez.
   */
  grudge: number;
  lastMetTurn: number;
}
```

### 3.2 Kokart hiyerarşisi

| Kokart | Yönetebildiği | Havuz oranı |
|---|---|---|
| `regional` | Seviye 3+ ligler, kupanın ilk turları | %45 |
| `national` | Seviye 1-2 ligler, kupa orta turlar | %35 |
| `elite` | Seviye 1 derbiler, kupa finali, kıta grup maçları | %15 |
| `fifa` | Kıta eleme turları, kıta finali, milli maçlar | %5 |

### 3.3 Atama algoritması

```
atanacakHakem(fixture, referees, history, rng):

  1. GEREKEN KOKART
     gereken = eligibility[fixture.competitionId] ?? badgeFromImportance(fixture.importance)

     badgeFromImportance:
       'league'     → competition.level == 1 ? 'national' : 'regional'
       'derby'      → 'elite'
       'cup'        → 'national'
       'cup_final'  → 'elite'
       'european'   → 'elite'
       'national'   → 'fifa'

  2. HAVUZ
     havuz = referees.filter(r => badgeRank(r.badge) >= badgeRank(gereken))

  3. TARAFSIZLIK  (yalnızca kıta ve milli maçlarda)
     if fixture.importance in ('european','national'):
        havuz = havuz.filter(r =>
           r.country_id != homeClub.country_id &&
           r.country_id != awayClub.country_id)

  4. TEKRAR ÖNLEME
     havuz = havuz.filter(r => turn - lastAssigned[r.id] >= 4)
     // aynı hakem dört hafta içinde aynı maça iki kez çıkmasın
     if havuz boş: filtreyi kaldır (fikstür hakemsiz kalamaz)

  5. AĞIRLIKLI ÇEKİLİŞ
     ağırlık(r) = 1
                + (r.reputation / 50)                    // itibarlı daha sık
                × (fixture.importance == 'league' ? 1 : 1.5)
     seçilen = rng.weighted(havuz, ağırlık)

  6. KAYIT
     lastAssigned[seçilen.id] = turn
     return seçilen
```

> **Neden ağırlıklı çekiliş, en iyi seçim değil:** deterministik "en itibarlı" seçimi aynı üç hakemi bütün büyük maçlara atardı ve hakem havuzu ölü veri olurdu. Ağırlıklı çekiliş hiyerarşiyi korur ama çeşitlilik bırakır.

### 3.4 Maç motoru entegrasyonu

`Timeline` faul üretir, `MatchSimulator.resolveFoul` kart verir. Hakem üçünü de çarpar:

```ts
// MEVCUT: sabit
if (rng.next() > offender.aggression / 220) return undefined;

// YENİ: hakem eğilimi
const cardChance =
  (offender.aggression / 220)
  × (0.6 + referee.card_tendency / 125)          // 0.60 .. 1.40
  × (isHome ? 2 - referee.home_bias / 50 : referee.home_bias / 50)
  × tutarsizlik(referee.consistency, rng);        // düşük tutarlılık → savrulma

function tutarsizlik(consistency, rng) {
  const band = (100 - consistency) / 250;         // consistency 40 → ±0.24
  return 1 + (rng.next() * 2 - 1) * band;
}
```

Penaltı ve VAR:

```
P(penaltı verilir | pozisyon ceza sahasında faul)
  = 0.35 + penalty_courage / 250 + (importance == 'cup_final' ? -0.08 : 0)
    // büyük maçta hakem nokta göstermekte daha çekingen -- gerçek eğilim

P(VAR incelemesi)  = var_reliance / 400            // 0 .. 0.25
VAR sonrası karar düzeltilir: consistency > 70 ise doğru karara döner
```

**Moment üretimine bağlanma:** `MOMENTS_BY_POSITION`'daki `ref_dispute`, `var_controversial`, `penalty_for`, `penalty_against` momentlerinin çıkma olasılığı hakemin niteliklerinden beslenir. Sert bir hakem `ref_dispute`i, VAR'a düşkün bir hakem `var_controversial`i daha sık üretir. **İçerik değişmez** — yalnızca frekans tablosu hakemi okur.

### 3.5 Kariyer içi hafıza

```
Karşılaşmada grudge hareketi:
  haksız sarı (VAR düzeltmedi)     → -12
  kırmızı kart                     → -25
  verilmeyen net penaltı           → -18
  lehte penaltı                    → +8
  temiz maç                        → +2  (sönümlenme yönünde)

Eşikler:
  grudge < -40  → `mem_hakem_dusmanligi_<id>` işaretlenir
                  → maç öncesi "yine o hakem" sahnesi açılır
                  → o maçta `ref_dispute` momenti olasılığı ×2
  grudge > +30  → hakem Hero'ya karşı daha toleranslı (card_tendency ×0.9)
                  → basında "hakem kayırıyor" anlatısı açılır
```

> `grudge` negatifi **sönümlenmez** — `mem_*` izleriyle aynı ilke: *"Kırdığın adam seni unutmaz"* burada tersine çalışır: seni kıran hakemi sen unutmazsın.

---

## 4. Üç sistemin kesiştiği iki senaryo

### Senaryo A — "Komisyon ve Kırmızı Kart"

**Kurulum:** Hero'nun menajeri `super_agent`, memnuniyet 34 (iki teklif reddedildi). Hakemle `grudge = -46` (geçen sezon iki haksız kart). Bu hafta o hakem derbiye atanmış.

```
1. ATAMA      importance='derby' → gereken kokart 'elite'
              havuzdan çekiliş → hakem X (grudge -46)

2. MAÇ ÖNCESİ grudge < -40 → `evt_match_referee_history` zamanlanır (forced)
              Sahne: menajer arıyor. "Bu hakemle geçmişin var. Federasyon
              dosyanı biliyor. Bugün ağzını açma — ama iyi oynarsan
              Bundesklasse'den bir telefon var."

              Seçenekler:
                a) Sus, oyna            → trust(agent) +5, grudge sabit
                b) Basına konuş         → medya_baskisi +12, grudge -10,
                                          satisfaction(agent) -6
                c) [Liderlik 60] Kaptanı uyar, takım toplu dursun
                                        → trust(captain) +8, chemistry etkisiz

3. MAÇ İÇİ    card_tendency ×(grudge < -40 ? 1.25 : 1.0)
              → sarı kart olasılığı yükselir
              ref_dispute momenti olasılığı ×2

4. KIRMIZI    Hero kırmızı görür → grudge -25 (toplam -71)
              satisfaction(agent) -12  (super_agent cezalıyı satamaz)
              → satisfaction 22 → uyarı eşiği aşıldı

5. SONRASI    `evt_agent_ultimatum` zamanlanır (+2 tur):
              "Üç aydır seni kimseye satamıyorum, şimdi de cezalısın.
               Ya bir sonraki teklifi kabul edersin ya da başkasını bul."
```

**Kesişim:** hakem hafızası → maç motoru frekansı → menajer memnuniyeti → kariyer baskısı. Üçü de aynı zincirde.

### Senaryo B — "Kimya ve Sadakat"

**Kurulum:** Hero, `star_teammate` ile üç sezon birlikte oynadı: `chemistry 88`, `relation 71`, `trust 55`. Menajer `developer`. Yıldız oyuncu için elit kulüpten teklif var.

```
1. TETİK      chemistry > 80 && star_teammate transfer listesinde
              → `evt_locker_kimya_ayriligi` açılır

2. SAHNE      "Üç sezondur gözünü kapatsan nerede olduğunu bilirsin.
               Şimdi gidiyor."

              Seçenekler:
                a) Kalmasını iste       → trust(star) +14, relation +8
                                          kulüp bütçesi baskısı: yonetim_baskisi +6
                b) Uğurla                → relation +4, trust sabit
                c) [Güven 60] "Ben de geliyorum" — menajerini ara
                                        → developer arketipi: forma şansı
                                          düşük olduğu için ×0.4 → teklif
                                          gelme olasılığı DÜŞÜK
                                          satisfaction(agent) -8
                                          (menajer bu hamleyi onaylamıyor)

3. AYRILIK    Yıldız transfer olursa:
              chemistry → 0        (squad-scope slot yeniden atanır)
              relation KORUNUR     (ActorArchive'a taşınır)
              `mem_kimya_kaybi` işaretlenir

4. SAHA İÇİ   Sonraki maç: pickAssister ağırlığı çöker
              → Hero'nun asist sayısı ölçülebilir şekilde düşer
              → form düşer → menajerin teklif olasılığı düşer
              → satisfaction düşer

5. GERİ DÖNÜŞ ReunionDirector: 2 sezon sonra rakip takımda karşılaşma
              → `opponent_is_former_club` tetikleyicisi
              → arşivdeki relation 71 ile sahneye döner
```

**Kesişim:** kimya (saha içi) → asist üretimi → form → menajer olasılığı → kariyer yönü. Ve arşiv, ilişkiyi iki sezon sonra geri getiriyor.

---

## 5. Entegrasyon planı

Sıralama, bağımlılığa göre. Her adım tek başına yeşil bırakır.

| # | İş | Dosyalar | Bağımlılık |
|---|---|---|---|
| **R1** | `ActorBond`: trust + chemistry alanları, flag sentezi 4→6 | `domain/actors.ts`, `domain/state.ts`, `runtime/CastingDirector.ts` | — |
| **R2** | Kimya birikimi: maç sonrası `minutesTogether`, haftalık sönümlenme, transferde sıfırlama | `runtime/GameEngine.ts`, yeni `runtime/ChemistryTracker.ts` | R1 |
| **R3** | Saha içi etki: `pickAssister` ağırlığı, `ChanceContext.assistChemistry` | `simulation/MatchSimulator.ts`, `domain/chance.ts` | R2 |
| **R4** | Soyunma odası huzuru → `iliski_takim` + moral drifti | `runtime/GameEngine.ts` | R1 |
| **A1** | `agent` tablosu + importer aşaması + maskeleme | `tools/roster/schema.ts`, `pipeline/agents.ts` | — |
| **A2** | `AgentState`, arketip parametreleri, memnuniyet döngüsü | `domain/state.ts`, yeni `runtime/AgentModel.ts` | A1, R1 |
| **A3** | Teklif üretimi + transfer piyasasına bağlanma | `runtime/AgentModel.ts`, Faz F | A2 |
| **H1** | `referee` + `referee_eligibility` tabloları + üretici | `tools/roster/schema.ts`, `pipeline/referees.ts` | — |
| **H2** | Atama algoritması, `SeasonRunner`'a bağlanma | yeni `simulation/RefereeAssigner.ts` | H1 |
| **H3** | Maç motoru etkisi: kart/penaltı/VAR çarpanları | `simulation/MatchSimulator.ts`, `MathChanceResolver.ts` | H2 |
| **H4** | `RefereeMemory` + grudge + moment frekansı | `domain/state.ts`, `MatchSimulator.ts` | H3 |
| **C1** | İçerik: 6-8 sahne (menajer ultimatomu, hakem geçmişi, kimya ayrılığı) | `content/events/` | R3, A2, H4 |

**Önerilen sıra:** R1 → R2 → R3 → H1 → H2 → H3 → A1 → A2 → H4 → R4 → A3 → C1

Gerekçe: ilişki sistemi diğer ikisinin de zeminini kuruyor (menajer güven ekseni, hakem grudge). Hakem menajerden önce çünkü maç motoruna bağlanıyor ve o zaten hazır; menajer transfer piyasasını (Faz F) bekliyor.

### Veri üretimi notu

Transfermarkt kaynağında **hakem ve menajer verisi yok** — `player_profiles.csv`'de `player_agent_name` var ama o kişisel veri ve import'ta atılıyor. Yani her ikisi de **tohumdan üretilecek**: `NameForge` + arketip/kokart dağılımı. Bu, kulüp ve oyuncudan farklı bir yol ve `tools/roster/pipeline/` içinde ayrı bir aşama olarak durmalı.
