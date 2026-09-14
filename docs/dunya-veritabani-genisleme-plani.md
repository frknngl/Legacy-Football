# DUNYA VERITABANI GENISLEME PLANI
## Coach / Team / Referee / Agent / Management Company

> **DURUM: FAZ 1 -- YALNIZCA ANALIZ VE MIMARI.**
> Bu belge uretilirken production veritabanina, semaya veya motor koduna
> HICBIR degisiklik yapilmadi. Tablo eklenmedi, kolon eklenmedi, veri
> yazilmadi. Asagidaki her oneri, uygulanmadan once onay bekler.

---

# 0. YONETICI OZETI -- UC KRITIK BULGU

### 0.1 Bu oyunda COACH ile MANAGER ayri iki varlik DEGIL

Hero bir **futbolcudur**, teknik direktor degil. `content/orchestrator/roles.json`
bunu acikca gosteriyor:

| slot | scope | source | staffRole | label |
|---|---|---|---|---|
| `manager` | club | staff | `manager` | **Teknik direktor** |
| `assistant` | club | staff | `assistant` | Yardimci antrenor |
| `agent` | career | external | -- | **Menajer** |

Turkce/Ingilizce terim carpismasi burada kritik:

```text
Ingilizce "manager"  = Teknik direktor  -> oyunda `manager` STAFF slotu
Turkce  "menajer"    = Player agent     -> oyunda `agent` CAREER slotu
```

Yani promptdaki "COACH" ve "MANAGER" ayrimi bu oyunda **tek bir varliga**
karsilik geliyor: `manager` staff slotu (= teknik direktor = head coach).
Ayri bir `managers` tablosu acmak, motorun tek slotu icin iki kaynak
uretirdi -- `CastingDirector` hangisinden dokecegini bilemezdi.

Promptdaki "MANAGEMENT COMPANY" ise mevcut `agent` sisteminin **ustundeki**
katmandir ve gercekten yeni bir varliktir (bkz. 0.3).

**Karar:** `coaches` + `managers` ikilisi yerine tek `staff` tablosu.
Gerekce ve alternatifler icin bkz. Bolum 3.

### 0.2 world.db semasi zaten olgun; degisecek olan KAYNAK

`tools/roster/schema.ts` (WORLD_SCHEMA_VERSION = 4) su tablolari tasiyor:

```text
source_dataset  country  competition  club  player  player_attributes
referee  agent  referee_eligibility  mask_binding  import_issue
```

`referee` ve `agent` zaten var, deterministik uretiliyor, maske kilidine
bagli ve **simulation tarafindan gercekten okunuyor**. Promptun 22-27 ve
34-37. maddelerinin buyuk bolumu halihazirda uygulanmis durumda.

Eksik olan varliklar: **staff (teknik heyet)**, **agency (menajerlik
sirketi)**, **staff gecmisi** ve **hakem atama/performans gecmisi**.

`football_db_engine/fm_database.db` ise semasi degil **verisi** degerli olan
bir kaynak: 18.405 oyuncu, 662 kulup, 1.369 teknik direktor kimligi, gercek
overall/potential/attribute setleri. Ama semasi world.db'nin gerisinde
(lig tablosu yok, mevki yok, FK'ler zayif, `clubs.country` aslinda lig adi
tasiyor -- veri hatasi).

**Karar:** world.db SEMASI korunur ve genisletilir; `fm_database.db`'nin
**kaynak CSV'leri** yeni besleme hatti olur. Tersi (fm_database.db'yi motora
baglamak) motoru, 59 testi ve butun senaryolari kirardi.

### 0.3 Menajerlik sirketleri KAYNAKTA GERCEKTEN VAR

`player_profiles.csv` iki kolon tasiyor ve ithalat bunlari su an bilincli
olarak dusuruyor:

```text
player_agent_id    player_agent_name
```

Olculdu: **4.842 ayri sirket**, gercek musteri sayilariyla.

```text
966 oyuncu  Wasserman
671 oyuncu  CAA Stellar
468 oyuncu  Unique Sports Group
449 oyuncu  CAA Base Ltd
...
133 oyuncu  Gestifute
```

Bunlar kisi adi degil **sirket adi** -- yani "gercek kisi adi tasimama"
gerekcesi burada gecerli degil. Maskelenmis haliyle ithal edilebilirler ve
`client_count` **uydurulmaz, sayilir**.

---

# 1. CURRENT DATABASE AUDIT

## 1.1 Iki ayri veritabani var

| | `data/world.db` | `football_db_engine/fm_database.db` |
|---|---|---|
| Uretici | `tools/roster/import.ts` (TS) | `setup_sqlite_db.py` (Python) |
| Kaynak | Transfermarkt CSV | EA FC26 (sofifa) + coaches CSV |
| Motor okuyor mu | **EVET** (`src/adapters/dbWorld.ts`) | **HAYIR** -- hicbir TS dosyasi referans vermiyor |
| Repo'da mi | Hayir (`.gitignore: data/`) | Evet, 48 MB commitli |
| Sema surumu | v4, `STRICT TABLE`, FK on | Serbest tip, FK yok |
| Kimlik | INTEGER + `mask_binding` kilidi | UUIDv4 (her import'ta **DEGISIR**) |

`football_db_engine/schema/*.sql` dosyalari PostgreSQL icin yazilmis ve
**calistirilmiyor**; `setup_sqlite_db.py` icindeki gomulu DDL ile
ortusmuyorlar (ornek: sql dosyasinda `game_name`, sqlite'ta `fake_name`).
Olu sema dosyalari -- bkz. Bolum 20.4.

## 1.2 world.db -- tablolar, anahtarlar, iliskiler

```text
source_dataset(id PK, repo_url, source_season, scope_json, schema_version, imported_at)

country(id PK, name_real UNIQUE, name_masked UNIQUE, confederation)

competition(id PK, external_key UNIQUE, country_id FK->country,
            kind CHECK(league|domestic_cup|continental|international),
            level, name_real, name_masked,
            format_kind CHECK(round_robin|conference|group_phase|explicit),
            legs, matches_per_club, club_count,
            window_start, window_end, slot_preference CHECK(weekend|midweek),
            promoted, relegated, reputation)

club(id PK, external_key UNIQUE, name_real, name_masked, short_masked,
     city, stadium, country_id FK->country NOT NULL,
     competition_id FK->competition,
     tier CHECK(amateur|lower|mid|contender|elite),
     reputation, matches_per_club,
     budget_transfer, budget_wage, foreign_ratio,
     rival_club_id FK->club)
  ix_club_competition, ix_club_country

player(id PK, external_key UNIQUE, first_real, last_real,
       first_masked, last_masked, birth_year, nationality,
       second_nationality, position CHECK(GK|DF|MF|FW), sub_position,
       foot, height_cm, club_id FK->club, market_value,
       contract_expires, value_source CHECK(market|fallback))
  ix_player_club

player_attributes(player_id PK FK->player, pace, shooting, passing,
                  defending, physical, goalkeeping, overall, potential)

referee(id PK, external_key UNIQUE, name_real, name_masked,
        country_id FK->country, badge CHECK(regional|national|elite|fifa),
        strictness, card_tendency, penalty_courage, var_reliance,
        consistency, home_bias, experience, reputation)
  ix_referee_badge, ix_referee_country

agent(id PK, external_key UNIQUE, name_real, name_masked,
      archetype CHECK(super_agent|family|developer|opportunist|journeyman),
      reach, negotiation, loyalty, patience, commission,
      country_id FK->country, reputation)
  ix_agent_archetype, ix_agent_reach

referee_eligibility(competition_id PK FK->competition, min_badge)

mask_binding(entity_kind CHECK(club|player|competition|country),
             external_key, stable_id, masked_name, strategy, locked_at,
             PK(entity_kind, external_key))
  ux_mask_name UNIQUE(entity_kind, masked_name)

import_issue(id PK, severity, stage, entity_kind, external_key, message)
  ix_issue_severity
```

**Iliski haritasi (mevcut):**

```text
country --< competition --< club --< player --1:1-- player_attributes
   |                         |
   |                         +-- rival_club_id --> club   (kendine FK)
   +--< referee
   +--< agent

competition --1:1-- referee_eligibility      [BOS -- hic satir yazilmiyor]
```

## 1.3 Aranan ama BULUNMAYAN yapilar

| Aranan | Durum |
|---|---|
| `coaches` / teknik heyet tablosu | **YOK.** `DbRosterProvider.staff()` her cagride tohumdan uretiyor (bellekte, kalici degil). |
| `managers` | **YOK** ve gerekmiyor (bkz. 0.1). |
| `matches` | **YOK.** Fikstur `buildSeasonSchedule` ile RUNTIME uretiliyor, tohumdan. |
| `referee_assignments` | **YOK.** Atama `dbWorld.ts:281` icinde `Map` olarak bellekte. |
| `management_companies` | **YOK.** Kaynakta var, ithalat dusuruyor. |
| Staff/coach gecmisi | **YOK.** |
| Kulup finans tablosu | Yalnizca `club.budget_transfer` + `club.budget_wage`. Gelir/borc/sponsorluk yok. |
| Takim gucu alani (`club.overall` vb.) | **YOK -- ve olmamali.** Guc kadrodan turetiliyor (bkz. Bolum 5). |
| `player_club_history` | **YOK.** Kariyer ici transfer `TransferOverlay` ile bellekte ortuluyor. |

## 1.4 fm_database.db -- veri kalitesi denetimi

| Bulgu | Etki |
|---|---|
| `clubs.country` aslinda **lig adi** tutuyor ("La Liga", "Bundesliga") | Ulke boyutu kayip. `setup_sqlite_db.py:150` -- `'country': league_name # Use league as proxy` |
| `clubs.manager_id` **662/662 NULL** | Teknik direktor -> kulup baglantisi hic kurulmamis |
| `coaches` tablosu yalnizca kimlik | Nitelik yok, kulup yok, `fake_name` yok |
| `players` tablosunda **mevki yok** | Kaynak CSV'de `player_positions` var ama ithal edilmemis |
| `player_state.attributes` JSON: `pace, shooting, passing, dribbling, defending, physic` | `goalkeeping` **yok**; kaleciler icin bu alti kolon zaten NULL |
| Lig / competition tablosu yok | Takvim kurulamaz |
| `transfers` **0 satir** | Bos tablo |
| `id` = her calistirmada yeni `uuid4()` | **Kimlik kararliligi SIFIR** -- promptun 8/53/73/74. maddelerini ihlal ediyor |
| `generate_fake_name`: ilk `a`->`o`, `e`->`a`, `i`->`e` | Cakisma kontrolu yok, kilit yok, kalicilik yok |
| 89 `player_state` satiri `club_id IS NULL` | Kulupsuz oyuncular |

**Sonuc:** `fm_database.db` bir **veri anligi**, bir dunya veritabani degil.
Degeri semasinda degil, arkasindaki CSV'de.

## 1.5 Kaynak CSV envanteri (`C:\Users\Mirac\Downloads\archive`)

**A. EA FC26 (sofifa) -- `FC26_20250921.csv`, 110 kolon**

Motorun bugun UYDURDUGU ama burada GERCEK olan alanlar:

| world.db alani | Bugun nasil uretiliyor | FC26 karsiligi |
|---|---|---|
| `player_attributes.*` | Piyasa degerinin log'undan tahmin (`attributes.ts`) | `pace, shooting, passing, dribbling, defending, physic` -- **gercek** |
| `overall` / `potential` | Piyasa degeri + yas duzeltmesi | `overall`, `potential` -- **gercek** |
| `RosterPerson.aggression` | `aggressionFor()`: mevki + fizikten tahmin | `mentality_aggression` -- **gercek** |
| `goalkeeping` | Mevki profilinden olcek | `goalkeeping_diving/handling/reflexes/positioning` -- **gercek** |
| `position` / `sub_position` | `main_position` metninden | `player_positions`, `club_position` |
| `competition.level` | Kaynaktan cikarim | `league_level` -- **dogrudan** |
| `contract_expires` | Metin cozumleme | `club_contract_valid_until_year` |

Ek olarak: `preferred_foot`, `weak_foot`, `skill_moves`,
`international_reputation` (1-5), `work_rate`, `player_traits`,
`mentality_composure`, `power_stamina`, `release_clause_eur`,
`club_jersey_number`, `club_loaned_from`.

**B. `male_coaches.csv` -- 8 kolon**

```text
coach_id, coach_url, short_name, long_name, dob, nationality_name,
coach_face_url, nation_flag_url
```

**Kritik:** nitelik YOK, kulup baglantisi YOK. Yani teknik direktorlerin
**kimligi gercek, nitelikleri uretilmek zorunda** -- tipki hakemler ve
menajerler gibi. Bu, mevcut deterministik uretim desenini aynen kullanmak
demek.

**C. Transfermarkt -- mevcut hattin kaynagi**

```text
team_details.csv               club_id, club_name, country_name,
                               competition_id, club_division
team_competitions_seasons.csv  kulup-turnuva-sezon
player_profiles.csv            34 kolon -- player_agent_id/name DAHIL
player_latest_market_value.csv piyasa degeri
transfer_history.csv           player_id, transfer_date, from/to, fee, type
player_performances.csv        sezon bazli gol/asist/kart/dakika
player_injuries.csv            sakatlik gecmisi
player_national_performances   milli takim + coach_id
```

**D. Hakem verisi: HICBIR KAYNAKTA YOK.** Iki dataset de tasimiyor.
Mevcut tohumdan uretme yaklasimi tek dogru cozum ve korunmali.

---

# 2. CURRENT CODE AUDIT

## 2.1 Katman haritasi

```text
tools/roster/*          -> world.db URETIR. src'yi gormez (tek istisna:
                           attributes.ts, POSITION_WEIGHTS icin domain okur)
src/domain/*            -> sifir bagimlilikli sozlesme katmani
src/simulation/*        -> runtime'i bilmez
src/runtime/*           -> simulation'i bilmez
src/adapters/dbWorld.ts -> ikisini birlestiren TEK yer (kompozisyon koku)
src/cli/world.ts        -> mock <-> db secimi
```

## 2.2 Varlik bazli kullanim noktalari

### COACH / MANAGER (= teknik direktor)

| Katman | Dosya:satir | Ne yapiyor |
|---|---|---|
| domain | `actors.ts:25` | `STAFF_ROLES = [manager, assistant, president, sporting_director, doctor, physio]` |
| domain | `actors.ts:191` | `StaffPerson { sourceId, first, last, displayName, age, role, origin, gender, clubId }` -- **nitelik alani YOK** |
| port | `roster.ts:71` | `staff(clubId): readonly StaffPerson[]` |
| adapter | `DbRosterProvider.ts:47-54` | `STAFF_SHAPE` -- 6 rol, yas araliklariyla, **tohumdan uretim** |
| adapter | `DbRosterProvider.ts:230-259` | `staff()` -- `NameForge` ile isim, `clubId:staff` tohumu |
| runtime | `CastingDirector.ts:263` | `.find(s => s.role === slot.staffRole)` -- slotu doldurur |
| runtime | `GameEngine.ts:1907-1958` | `tickManager()` -- kovulma + yeniden dokum |
| icerik | `roles.json` | `manager` / `assistant` / `president` / `sporting_director` / `doctor` / `physio` slotlari |
| dogrulama | `validation/rules/voice.ts:50-55` | Ses profili rol bazli |
| test | `tests/ManagerSacking.test.ts` | Kovulma dongusu |

**Kritik bulgu:** Teknik direktorun hicbir **nitelik**i yok. Oyunda yalnizca
bir isim, bir yas ve bir iliski sayisidir. `tickManager()` kovulma karari
verirken bile hocanin kendisine degil, `yonetim_baskisi` + `form` +
soyunma odasi uyumuna bakiyor.

Promptta orneklenen `coach.skill`, `coach.rating`, `coach.tactical_style`
alanlarinin **hicbiri kodda yok**. Yani coach nitelikleri sifirdan
tasarlanacak, mevcut bir kullanimi yeniden sekillendirmeyecek.

### TEAM / CLUB

| Katman | Dosya:satir | Ne |
|---|---|---|
| domain | `roster.ts:28-50` | `ClubInfo { id, name, city, stadium, tier, league, rivalId?, reputation, countryName?, foreignRatio }` |
| domain | `axes.ts` | `CLUB_TIERS = amateur\|lower\|mid\|contender\|elite` |
| adapter | `DbRosterProvider.ts:152-166` | `club` + `country` JOIN |
| adapter | `DbRosterProvider.ts:440-470` | `toClubInfo()` -- `foreignRatio: 0` **sabit** |
| simulation | `TeamModel.ts` | `pickEleven` / `computeLines` / `buildTeam` |
| simulation | `LeagueModel.ts` | Puan durumu, yukselme/dusme |
| simulation | `TransferMarket.ts` | `budget_transfer` + `reputation` + `rivalId` |
| pipeline | `reputation.ts` | Itibar = kadro piyasa degerinin yuzdeligi |
| pipeline | `budgets.ts` | `budget_transfer = kadro degeri x transferRatio()` |
| pipeline | `rivalries.ts` | `rival_club_id` itibar yakinligindan |

### REFEREE

| Katman | Dosya:satir | Ne |
|---|---|---|
| domain | `referee.ts` (5.9 KB) | `RefereeBadge`, `RefereeAttributes`, `requiredBadge()`, `cardFactor()`, `penaltyChance()`, `varChance()`, `varCorrects()`, `consistencyJitter()`, `RefereeMemory`, `grudgeCardFactor()` |
| simulation | `RefereeAssigner.ts` | Kokart esigi + tazelik korumasi (ayni hakem ust uste ayni kulube atanmaz) |
| simulation | `MatchSimulator.ts:415,620-670,728` | VAR momenti, sertlik esigi, kart carpani |
| adapter | `dbWorld.ts:190-245` | `referee` tablosunu okur, `RefereeAssigner` kurar |
| adapter | `dbWorld.ts:281-287` | Fikstur bazli atama **onbellegi (bellekte)** |
| pipeline | `referees.ts` (287 satir) | Deterministik uretim, `referee-pool.json`dan |
| icerik | `roles.json` | `referee` match-scope slotu |

**Hakem sistemi promptun istediginin cogunu zaten karsiliyor.** Eksikler:
atama gecmisi kalici degil, `referee_eligibility` bos, hakem performansi
kaydedilmiyor.

### AGENT (menajer)

| Katman | Dosya:satir | Ne |
|---|---|---|
| domain | `agent.ts` (9.8 KB) | `AgentArchetype`, `AgentProfile`, `AgentState`, `offerChance()`, `reachFit()`, `archetypeBias()`, `satisfactionDelta()`, `negotiationChance()`, `terminationFee()` |
| port | `roster.ts:82` | `agents?(countryId?): readonly AgentProfile[]` |
| adapter | `DbRosterProvider.ts:289-320` | `agent` tablosu, onbellekli |
| runtime | `GameEngine.ts:1416,1433,1571,1598` | Secim, mevcut menajer, aktor dokumu |
| pipeline | `agents.ts` (322 satir) | `agent-pool.json`dan deterministik uretim |
| test | `tests/Agent.test.ts` | |

**Sirket katmani yok.** `AgentProfile` bir kisidir; `reach`/`negotiation`
niteliklerinin arkasinda bir kurum yok.

### MATCH

`matches` tablosu yok ve **olmamali**:

```text
buildSeasonSchedule(input, Rng(seed))   -> src/simulation/SeasonCalendar.ts
  competitions: CompetitionShape[]  <- competition.matches_per_club (VERI)
  cups:        ulke basina bir kupa <- club.country_id'den turetilir
  continental: qualify(topFlight,4,32)
```

Fikstur **tohumdan deterministik uretiliyor**. Sonuclar `LeagueModel`
icinde bellekte; kariyer kaydi `SaveGame.ts`e yaziliyor. Yani bir mac,
dunyanin degil **kariyerin** verisi.

## 2.3 Takim gucu -- mevcut formul (TAM)

```text
DbRosterProvider.squad(clubId)
  -> player JOIN player_attributes WHERE club_id=? ORDER BY overall DESC
  -> TransferOverlay uygulanir (giden cikarilir, gelen eklenir)
  -> kadro < 18 ise tohumdan tamamlanir ('gen:' onekli)
  -> her satir icin:
       quality     = overallFor(position, attributes)      [TURETILIR]
       leadership  = 20 + (age-17)*2.2 + (overall-60)*0.35 + U(-10,10)
       aggression  = aggressionFor(position, attributes) + spread*0.5

TeamModel.pickEleven(squad, hero?, chemistryOf?)
  4-4-2 sabit: GK 1, DF 4, MF 4, FW 2
  her mevkide quality'ye gore sirala, ustten al
  Hero kendi mevkisinde GARANTILI

TeamModel.computeLines(eleven)
  keeper   = avg(GK.goalkeeping)
  defence  = avg(DF.defending)*0.75 + avg(MF.defending)*0.25
  midfield = avg(MF.passing)
  attack   = avg(FW.shooting)*0.7  + avg(MF.passing)*0.3
  overall  = keeper*0.15 + defence*0.30 + midfield*0.30 + attack*0.25
  aggression = avg(eleven.aggression)
```

**Yani takim gucu %100 DERIVED.** Veritabaninda hicbir `team_overall`
kolonu yok ve bu dogru bir tasarim -- iki kaynak olsaydi transfer sonrasi
sessizce ayrisirlardi.

Kadro DISI tek girdi Hero'nun gunluk formu:

```text
heroDayFactor(hero) = 0.86 + (form/100)*0.16 + (morale/100)*0.12
                      + (isCaptain ? 0.02 : 0)      -> 0.86 .. 1.16
```

**Teknik direktorun takim gucune etkisi: SIFIR.** Kadro kalitesi disinda
hicbir carpan yok.

---

# 3. ENTITY DESIGN -- MODEL KARARI

## 3.1 Uc modelin karsilastirmasi

### MODEL A -- `coaches` + `managers` + `referees` ayri

| | |
|---|---|
| Arti | Her varligin kendi kolon seti; okurken JOIN yok |
| Eksi | **Bu oyunda `manager` = `coach`.** Iki tablo tek slotu besleyecek -- `CastingDirector` hangisinden dokecek? |
| Eksi | `president`, `sporting_director`, `doctor`, `physio` nereye? Dort tablo daha mi? |
| Eksi | `DbRosterProvider.staff()` UNION yazmak zorunda; her yeni rol motor kodu degistirir |
| Eksi | `mask_binding` uzayi parcalanir, cakisma kontrolu rol icinde kalir |

### MODEL B -- tek `staff` tablosu, `role` kolonu

| | |
|---|---|
| Arti | `StaffPerson.role` ile **birebir** ortusuyor; adapter tek `WHERE club_id=?` sorgusu |
| Arti | Yeni rol = **satir**, kod degil (projenin kendi ilkesi) |
| Arti | `staff_assignments` tek tabloyla butun rolleri tasir |
| Arti | Tek maske uzayi -> cakisma kontrolu dogal |
| Eksi | Rol bazli nitelikler tek tabloda seyrek kolon uretir (doktorun `attacking_coaching`i anlamsiz) |

### MODEL C -- `people` + `staff_roles` + rol tablolari

| | |
|---|---|
| Arti | En normalize; bir kisi hem oyuncu hem sonra hoca olabilir |
| Eksi | Her kadro okumasi 3 JOIN; `GameEngine.present()` **senkron** ve sicak yolda |
| Eksi | Oyunda kimse rol degistirmiyor -- cozdugu problem YOK |
| Eksi | Sema karmasikligi, mevcut `mask_binding` desenine uymuyor |

## 3.2 KARAR: MODEL B + nitelikleri ayri tabloda (B')

```text
staff              -> kimlik, rol, kulup, yas, uyruk        (tek tablo)
staff_attributes   -> nitelikler, 1:1                        (seyreklik burada)
staff_assignments  -> kulup gecmisi, rol bazli               (tarihsel)
```

**Neden:** `player` / `player_attributes` ayriminin **birebir aynisi**.
Proje bu deseni zaten kullaniyor, motor bunu zaten okuyor, import hatti
bunu zaten yaziyor. Yeni bir desen ogretmiyoruz.

**Hakem NEDEN ayri kaliyor:** Hakem kulup personeli degil. `staff()`
yuzeyinden hic gecmiyor, `StaffRole` icinde yok, nitelik seti tamamen
farkli (`strictness`, `badge`, `home_bias`), kendi atama algoritmasi var.
Zorla `staff`a sokmak ikisini de bozardi. **`referee` tablosu aynen kalir.**

**Menajer (agent) NEDEN ayri kaliyor:** Menajer kulup personeli degil,
Hero'nun kariyer varligi. `AgentProfile` motorda ayri bir sozlesme ve
`archetype`/`commission`/`loyalty` alanlari staff ile ortusmuyor.
**`agent` tablosu aynen kalir**, ustune `agency` eklenir.

## 3.3 Final varlik listesi

| Varlik | Durum | Gerekce |
|---|---|---|
| `country` | **KORU** | Degisiklik yok |
| `competition` | **KORU + 1 kolon** | FC26 `league_level` daha guvenilir |
| `club` | **KORU + 4 kolon** | Bkz. 4.7 |
| `player` | **KORU + 4 kolon** | `aggression`, `composure`, `intl_reputation`, `shirt_number` |
| `player_attributes` | **KORU** | FC26 gercek degerleri doldurur |
| `referee` | **KORU** | Zaten tam |
| `agent` | **KORU + `agency_id`** | Sirkete baglanir |
| `mask_binding` | **KORU + 2 entity_kind** | `staff`, `agency` eklenir |
| `import_issue` | **KORU** | |
| `source_dataset` | **KORU + `source_kind`** | Iki kaynak ayirt edilmeli |
| **`staff`** | **YENI** | Teknik heyet -- kimlik + rol |
| **`staff_attributes`** | **YENI** | Teknik nitelikler |
| **`staff_assignments`** | **YENI** | Kulup gecmisi |
| **`agency`** | **YENI** | Menajerlik sirketi (gercek veri) |
| **`player_agency`** | **YENI** | Oyuncu <-> sirket, tarihli |
| **`identity_link`** | **YENI** | Iki kaynak arasi kopru + confidence |
| `referee_eligibility` | **DOLDUR** | Tablo var, satir yok |
| ~~`managers`~~ | **ACMA** | `staff.role='manager'` |
| ~~`matches`~~ | **world.db'ye ACMA** | Kariyer verisi -> save.db |
| ~~`club.overall`~~ | **ACMA** | Ikinci dogruluk kaynagi olurdu |
