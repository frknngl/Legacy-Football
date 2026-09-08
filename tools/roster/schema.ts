/**
 * world.db SEMASI -- iceri aktarilmis dunyanin tek dogruluk kaynagi.
 *
 * SINIR:
 *   world.db  = Tool uretir, oyun SALT OKUR. Kulupler, oyuncular, turnuvalar,
 *               maske baglamalari. Kariyer boyunca DEGISMEZ.
 *   save.db   = Kariyer basina, mutable. Fikstur, puan durumu, transferler,
 *               flag durumu. (Sonraki adim.)
 *   content/  = Yazilmis icerik. DB'ye HIC girmez, dosya kalir.
 *
 * NEDEN node:sqlite:
 *   Node 22.5+ ile geliyor; Node 26'da hazir. `better-sqlite3` native derleme
 *   ister (Windows'ta node-gyp), Drizzle bir bagimlilik daha ekler. Bu proje
 *   tek bagimlilikla (`ajv`) yasiyor ve "sifir build adimi" diyor; o disiplini
 *   bir importer icin bozmak yanlis takas olurdu.
 *
 * NEDEN STRICT TABLE:
 *   SQLite varsayilanda her seye her sey yazdirir ('yirmi' bir INTEGER kolona
 *   girer). STRICT bunu reddeder. Import hattinda tip hatasi sessizce
 *   gecmemeli.
 *
 * DATASET NOTU:
 *   Kaynak Transfermarkt kazimasi. `external_key` alanlari kaynagin kendi
 *   ID'leridir (club_id / player_id / competition_id) -- kalici ve benzersiz
 *   olduklari icin maske kilidinin capasi onlardir. Kendi ID uretmeyiz.
 */

export const WORLD_SCHEMA_VERSION = 4;

export const WORLD_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- koken
-- Hangi CSV anligindan, hangi filtreyle uretildi. Yeniden import ederken
-- "ayni kapsam mi" sorusunun cevabi burada.
CREATE TABLE IF NOT EXISTS source_dataset (
  id            INTEGER PRIMARY KEY,
  repo_url      TEXT    NOT NULL,
  source_season INTEGER NOT NULL,
  scope_json    TEXT    NOT NULL,
  schema_version INTEGER NOT NULL,
  imported_at   TEXT    NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS country (
  id            INTEGER PRIMARY KEY,
  name_real     TEXT    NOT NULL UNIQUE,
  name_masked   TEXT    NOT NULL UNIQUE,
  confederation TEXT
) STRICT;

-- ---------------------------------------------------------------- turnuva
-- format_kind + matches_per_club TAKVIMIN girdisi.
--
-- Mac sayisi kulup sayisindan TURETILMEZ. Gercek veride:
--   Championship  24 kulup -> 46 mac   (cift devre, formul tutuyor)
--   J1 League     20 kulup -> 34 mac   (tutmuyor)
--   MLS           30 kulup -> 33 mac   (konferans)
--   Torneo Apert. 30 kulup -> 16 mac   (grup)
--   USL Champ.    26 kulup -> 27/28/29 (ayni ligde kulupten kulube DEGISIYOR)
-- Bu yuzden sayi veridir; club.matches_per_club explicit formatta kulup
-- bazinda saklanir.
CREATE TABLE IF NOT EXISTS competition (
  id               INTEGER PRIMARY KEY,
  external_key     TEXT    NOT NULL UNIQUE,
  country_id       INTEGER REFERENCES country(id),
  kind             TEXT    NOT NULL CHECK (kind IN ('league','domestic_cup','continental','international')),
  level            INTEGER,
  name_real        TEXT    NOT NULL,
  name_masked      TEXT    NOT NULL,
  format_kind      TEXT    NOT NULL CHECK (format_kind IN ('round_robin','conference','group_phase','explicit')),
  legs             INTEGER,
  matches_per_club INTEGER,
  club_count       INTEGER NOT NULL,
  window_start     INTEGER NOT NULL,
  window_end       INTEGER NOT NULL,
  slot_preference  TEXT    NOT NULL CHECK (slot_preference IN ('weekend','midweek')),
  promoted         INTEGER NOT NULL DEFAULT 0,
  relegated        INTEGER NOT NULL DEFAULT 0,
  reputation       INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS club (
  id               INTEGER PRIMARY KEY,
  external_key     TEXT    NOT NULL UNIQUE,
  name_real        TEXT    NOT NULL,
  name_masked      TEXT    NOT NULL,
  short_masked     TEXT    NOT NULL,
  city             TEXT    NOT NULL DEFAULT '',
  stadium          TEXT    NOT NULL DEFAULT '',
  country_id       INTEGER NOT NULL REFERENCES country(id),
  competition_id   INTEGER REFERENCES competition(id),
  tier             TEXT    NOT NULL CHECK (tier IN ('amateur','lower','mid','contender','elite')),
  reputation       INTEGER NOT NULL,
  -- explicit formatli liglerde bu kulubun kendi mac sayisi; digerlerinde NULL.
  matches_per_club INTEGER,
  budget_transfer  INTEGER NOT NULL DEFAULT 0,
  budget_wage      INTEGER NOT NULL DEFAULT 0,
  foreign_ratio    REAL    NOT NULL DEFAULT 0,
  rival_club_id    INTEGER REFERENCES club(id)
) STRICT;

CREATE INDEX IF NOT EXISTS ix_club_competition ON club(competition_id);
CREATE INDEX IF NOT EXISTS ix_club_country     ON club(country_id);

-- ---------------------------------------------------------------- oyuncu
-- KISISEL VERI POLITIKASI:
--   Kaynakta player_image_url, social_media_url, player_agent_name,
--   name_in_home_country, place_of_birth ve TAM dogum tarihi var. Bunlar
--   maskelenmez, ITHAL EDILMEZ -- oyunun hicbirine ihtiyaci yok ve maskeli
--   bir isim gercek bir dogum tarihiyle birlesince maske islevini yitirir.
--   Bu yuzden yalnizca dogum YILI tutulur.
CREATE TABLE IF NOT EXISTS player (
  id                 INTEGER PRIMARY KEY,
  external_key       TEXT    NOT NULL UNIQUE,
  first_real         TEXT    NOT NULL,
  last_real          TEXT    NOT NULL,
  first_masked       TEXT    NOT NULL,
  last_masked        TEXT    NOT NULL,
  birth_year         INTEGER,
  nationality        TEXT    NOT NULL DEFAULT '',
  -- Cifte vatandaslik: milli takim uygunlugunu bu belirleyecek.
  second_nationality TEXT,
  position           TEXT    NOT NULL CHECK (position IN ('GK','DF','MF','FW')),
  sub_position       TEXT    NOT NULL DEFAULT '',
  foot               TEXT    NOT NULL DEFAULT '',
  height_cm          INTEGER,
  club_id            INTEGER REFERENCES club(id),
  market_value       INTEGER NOT NULL DEFAULT 0,
  contract_expires   TEXT,
  -- 'fallback' = piyasa degeri yoktu, kulup seviyesi + yastan tahmin edildi.
  -- GUI bu satirlari once gosterir; elle duzeltilecek ilk yer burasi.
  value_source       TEXT    NOT NULL CHECK (value_source IN ('market','fallback'))
) STRICT;

CREATE INDEX IF NOT EXISTS ix_player_club ON player(club_id);

-- Nitelikler TURETILIR -- kaynakta yok.
--
-- Motor sozlesmesi (src/domain/actors.ts): quality NITELIKLERDEN turer
-- (overallFor), tersi degil. Bu yuzden once hedef bir overall hesaplanir
-- (piyasa degerinin log'u + yas duzeltmesi), sonra alt mevkinin profili o
-- hedefi TUTTURACAK sekilde olceklenir. Ters yon "kaliteli ama sut atamayan
-- santrfor" uretirdi.
CREATE TABLE IF NOT EXISTS player_attributes (
  player_id   INTEGER PRIMARY KEY REFERENCES player(id),
  pace        INTEGER NOT NULL,
  shooting    INTEGER NOT NULL,
  passing     INTEGER NOT NULL,
  defending   INTEGER NOT NULL,
  physical    INTEGER NOT NULL,
  goalkeeping INTEGER NOT NULL,
  overall     INTEGER NOT NULL,
  potential   INTEGER NOT NULL
) STRICT;

-- ---------------------------------------------------------------- hakem
-- KAYNAKTA HAKEM VERISI YOK.
--   Transfermarkt kazimasi hakem tasimiyor. Kulup ve oyuncudan farkli olarak
--   hakemler TOHUMDAN uretilir: isim havuzu + kokart dagilimi + nitelik
--   cekilisi. Deterministik (ayni tohum ayni hakem kadrosu) ve dunyanin
--   parcasi -- kariyerden bagimsiz, bu yuzden world.db'de.
--
-- KOKART HIYERARSISI:
--   regional < national < elite < fifa
--   Atama algoritmasi "en az su kokart" karsilastirmasini bu sirayla yapar;
--   Sampiyonlar Ligi finaline bolgesel hakem atanmasi yapisal olarak imkansiz.
CREATE TABLE IF NOT EXISTS referee (
  id              INTEGER PRIMARY KEY,
  external_key    TEXT    NOT NULL UNIQUE,
  name_real       TEXT    NOT NULL,
  name_masked     TEXT    NOT NULL,
  country_id      INTEGER REFERENCES country(id),
  badge           TEXT    NOT NULL CHECK (badge IN ('regional','national','elite','fifa')),

  -- 0-100 nitelikler. Hepsi maca SOMUT olarak giriyor.
  strictness      INTEGER NOT NULL,  -- faul calma esigi
  card_tendency   INTEGER NOT NULL,  -- faulu karta cevirme egilimi
  penalty_courage INTEGER NOT NULL,  -- kritik anda nokta gosterebilme
  var_reliance    INTEGER NOT NULL,  -- VAR'a gitme sikligi
  consistency     INTEGER NOT NULL,  -- dusukse mac ici kararlar savrulur
  home_bias       INTEGER NOT NULL,  -- 50 notr

  experience      INTEGER NOT NULL DEFAULT 0,
  reputation      INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS ix_referee_badge   ON referee(badge);
CREATE INDEX IF NOT EXISTS ix_referee_country ON referee(country_id);

-- MENAJER. Kaynakta yok (player_agent_name kasitli olarak DUSURULUYOR --
-- gercek kisi adi tasimamak icin), bu yuzden havuzdan uretilir.
--
-- Neden world.db'de: menajer kadrosu dunyanin bir parcasi, kariyerin degil.
-- Ayni dunyada yirmi kariyer oynanir ve hepsi ayni menajer havuzunu gorur.
-- Hero'nun O menajerle iliskisi (memnuniyet, komisyon, kac sezon) ise
-- GameState'te durur -- bu tablo kariyer boyunca DEGISMEZ.
CREATE TABLE IF NOT EXISTS agent (
  id            INTEGER PRIMARY KEY,
  external_key  TEXT    NOT NULL UNIQUE,
  name_real     TEXT    NOT NULL,
  name_masked   TEXT    NOT NULL,
  archetype     TEXT    NOT NULL CHECK (archetype IN
                  ('super_agent','family','developer','opportunist','journeyman')),

  -- 0-100 nitelikler
  reach         INTEGER NOT NULL,  -- hangi seviyedeki kulup kapisini acabilir
  negotiation   INTEGER NOT NULL,  -- maas/bonservis pazarlik gucu
  loyalty       INTEGER NOT NULL,  -- oyuncuyu satmaya direnci
  patience      INTEGER NOT NULL,  -- reddedilen tekliflere tahammulu

  commission    REAL    NOT NULL,  -- 0.03 - 0.18
  country_id    INTEGER REFERENCES country(id),
  reputation    INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS ix_agent_archetype ON agent(archetype);
CREATE INDEX IF NOT EXISTS ix_agent_reach     ON agent(reach);

-- Hangi turnuva hangi kokarti ZORUNLU kilar. VERI, kod degil:
-- yeni bir turnuva eklendiginde kod degismez, satir eklenir.
CREATE TABLE IF NOT EXISTS referee_eligibility (
  competition_id INTEGER PRIMARY KEY REFERENCES competition(id),
  min_badge      TEXT NOT NULL CHECK (min_badge IN ('regional','national','elite','fifa'))
) STRICT;

-- ---------------------------------------------------------------- maske kilidi
-- GEREKSINIMIN KALBI: bir kere maskelenen isim ve stable_id BIR DAHA DEGISMEZ.
-- Guncel CSV yuklendiginde stat/kulup guncellenir, bu tablo DOKUNULMAZ.
CREATE TABLE IF NOT EXISTS mask_binding (
  entity_kind  TEXT    NOT NULL CHECK (entity_kind IN ('club','player','competition','country')),
  external_key TEXT    NOT NULL,
  stable_id    INTEGER NOT NULL,
  masked_name  TEXT    NOT NULL,
  strategy     TEXT    NOT NULL CHECK (strategy IN ('manual','rule','phonetic','pool')),
  locked_at    TEXT    NOT NULL,
  PRIMARY KEY (entity_kind, external_key)
) STRICT;

-- Iki farkli varlik ayni maskeye dusemez.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mask_name ON mask_binding(entity_kind, masked_name);

-- ---------------------------------------------------------------- kalite raporu
-- Import "temiz veri" varsaymaz. Eksik lig, tuhaf kulup sayisi, sifir piyasa
-- degeri buraya yazilir; GUI bu tabloyu listeler ve elle duzeltme burada
-- baslar. Sessizce duzeltmek, yanlis veriyi gorunmez yapar.
CREATE TABLE IF NOT EXISTS import_issue (
  id           INTEGER PRIMARY KEY,
  severity     TEXT NOT NULL CHECK (severity IN ('error','warn','info')),
  stage        TEXT NOT NULL,
  entity_kind  TEXT,
  external_key TEXT,
  message      TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS ix_issue_severity ON import_issue(severity);
`;
