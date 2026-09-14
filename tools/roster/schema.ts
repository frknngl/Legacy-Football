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

export const WORLD_SCHEMA_VERSION = 5;

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
  imported_at   TEXT    NOT NULL,
  -- IKI KAYNAK AYNI TABLOYA YAZAR: 'transfermarkt' ve 'fc26'. Hangi
  -- anligin nereden geldigi kayitli olmali, yoksa "bu nitelik gercek mi
  -- tahmin mi" sorusunun cevabi kaybolur.
  source_kind   TEXT    NOT NULL DEFAULT 'transfermarkt'
) STRICT;

CREATE TABLE IF NOT EXISTS country (
  id            INTEGER PRIMARY KEY,
  name_real     TEXT    NOT NULL UNIQUE,
  -- ULKE ADI MASKELENMEZ.
  --
  -- Cografya tescilli degil: 'England' bir marka degil, bir yer. Eski surum
  -- burayi da maskeliyordu ve sonuc colpu: 'England' -> 'Ulke 738'. Bu ne
  -- lisans korumasi sagliyordu (korunacak bir sey yoktu) ne de oyunda
  -- anlasilir bir dunya uretiyordu -- milli takim adi 'Ulke 738' oluyordu.
  name_masked   TEXT    NOT NULL UNIQUE,
  -- 'English', 'Spanish'... Lig adlari bundan TURETILIR (PES mantigi:
  -- 'Premier League' yerine 'English Division 1').
  adjective     TEXT    NOT NULL DEFAULT '',
  confederation TEXT
) STRICT;

-- SEHIRLER.
--
-- OLCULEN SORUN: club.city kolonu semada vardi ve DbRosterProvider onu
-- ClubInfo.city olarak motora tasiyordu -- ama HICBIR ZAMAN
-- DOLDURULMUYORDU. Iki kaynagin ikisi de sehir tasimiyor, emit asamasi da
-- kolonu hic yazmiyordu. Yani oyundaki her kulubun sehri bos stringdi ve
-- '{club.city}' tokeni bos basiliyordu.
--
-- Sehir artik kendi tablosu: bir ulkeye bagli, kulupler ona FK ile baglanir.
-- Boylece iki kulup ayni sehri PAYLASABILIR (sehir derbisi bunun uzerine
-- kurulur) ve sehir adi tek yerde duzeltilir.
CREATE TABLE IF NOT EXISTS city (
  id          INTEGER PRIMARY KEY,
  country_id  INTEGER NOT NULL REFERENCES country(id),
  name_real   TEXT    NOT NULL,
  name_masked TEXT    NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_city_name ON city(country_id, name_real);
CREATE INDEX IF NOT EXISTS ix_city_country ON city(country_id);

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
  reputation       INTEGER NOT NULL,
  -- Kaynagin kendi lig kimligi. Iki dataseti eslestirmek icin ham deger
  -- saklanmali; external_key onekli oldugu icin tek basina yetmiyor.
  source_league_id TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS club (
  id               INTEGER PRIMARY KEY,
  external_key     TEXT    NOT NULL UNIQUE,
  name_real        TEXT    NOT NULL,
  name_masked      TEXT    NOT NULL,
  short_masked     TEXT    NOT NULL,
  -- Metin sehir adi -- ONBELLEK. Kaynak city tablosudur; motor tek sorguda
  -- okusun diye burada da duruyor.
  city             TEXT    NOT NULL DEFAULT '',
  city_id          INTEGER REFERENCES city(id),
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
  rival_club_id    INTEGER REFERENCES club(id),

  -- GUNCEL TEKNIK DIREKTOR -- ONBELLEK, dogruluk kaynagi DEGIL.
  --
  -- Kaynak staff_assignment tablosudur. Ama DbRosterProvider.staff()
  -- senkron ve kadro kurulumunun sicak yolunda; her cagride tarihsel tabloyu
  -- taramak kabul edilemez. Import sonunda atamalardan yeniden yazilir ve
  -- validate ikisinin uyumunu denetler.
  current_manager_id INTEGER REFERENCES staff(id),

  -- KADRO DEGERI -- itibar ve butce zaten bundan turetiliyordu ama deger
  -- hicbir yerde SAKLANMIYORDU; her ihtiyacta yeniden toplaniyordu.
  squad_value      INTEGER NOT NULL DEFAULT 0,

  -- FINANSAL GUC, transfer butcesinden AYRI bir kavram.
  --
  --   budget_transfer = BU SEZON harcanabilir para
  --   financial_power = kulubun YAPISAL buyuklugu
  --
  -- Bir kulubun transfer butcesi bir sezon sifir olabilir; finansal gucu
  -- yine yuksektir ve oyuncu hala oraya gitmek ister. Transfer cazibesi
  -- butceyle degil bununla olculmeli.
  financial_power  INTEGER NOT NULL DEFAULT 50,
  stadium_capacity INTEGER NOT NULL DEFAULT 0
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
  value_source       TEXT    NOT NULL CHECK (value_source IN ('market','fallback')),

  -- ---------------------------------------------------------------- FC26
  -- Asagidaki dordu de motorun BUGUN kullandigi ama UYDURDUGU degerler.
  -- Transfermarkt tasimiyordu; FC26 anligi tasiyor. NULL kalabilirler --
  -- o zaman eski tahmin yoluna dusulur (zarif bozulma).
  --
  --   aggression  -> MatchSimulator faul esigi. Eskiden mevkiden tahmin
  --                  ediliyordu (DF 62 / MF 52 / FW 44 / GK 36 tabani).
  --   composure   -> gol anindaki sogukkanlilik. Eskiden quality vekildi.
  --   intl_rep    -> 1-5. leadership turetmesinin girdisi; eskiden
  --                  yalnizca yastan hesaplaniyordu.
  --   shirt_number-> gercek forma numarasi. Eskiden tohumdan cekiliyordu.
  aggression         INTEGER,
  composure          INTEGER,
  intl_reputation    INTEGER,
  shirt_number       INTEGER
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
  reputation    INTEGER NOT NULL,

  -- ARKASINDAKI SIRKET. Menajer bir KISI, sirket bir KURUM.
  -- Sirketin influence'i menajerin erisimini OLCEKLER, ezmez.
  agency_id     INTEGER REFERENCES agency(id)
) STRICT;

CREATE INDEX IF NOT EXISTS ix_agent_archetype ON agent(archetype);
CREATE INDEX IF NOT EXISTS ix_agent_reach     ON agent(reach);

-- Hangi turnuva hangi kokarti ZORUNLU kilar. VERI, kod degil:
-- yeni bir turnuva eklendiginde kod degismez, satir eklenir.
CREATE TABLE IF NOT EXISTS referee_eligibility (
  competition_id INTEGER PRIMARY KEY REFERENCES competition(id),
  min_badge      TEXT NOT NULL CHECK (min_badge IN ('regional','national','elite','fifa'))
) STRICT;

-- ================================================================ REFERANS
-- KURULUM VERISI DE VERITABANINDA DURUR.
--
-- Once bu degerler JSON dosyalarindaydi (lig-ulke haritasi, isim havuzlari,
-- nitelik bantlari, kokart dagilimlari). Yanlisti: ikinci bir dogruluk
-- kaynagi yaratiyordu ve "dunyada ne var" sorusunun cevabi iki yere
-- bolunuyordu. Bir ligin hangi ulkede oldugu GERCEK VERIDIR ve gercek veri
-- veritabaninda durur.
--
-- Bu tablolar import BASINDA tohumlanir (seed/reference.ts) ve sonrasinda
-- tek okuma kaynagi olurlar. Yeni bir lig, yeni bir isim havuzu ya da yeni
-- bir nitelik bandi eklemek = SATIR eklemek.

-- Kaynak ligin hangi ulkeye ait oldugu.
--
-- NEDEN GEREKLI: FC26 anligi lig adi ve seviyesi tasiyor ama ULKE
-- TASIMIYOR. 51 ligin hicbirinde ulke kolonu yok. football_db_engine bu
-- tuzaga dusup lig adini ulke sanmisti (clubs.country = 'La Liga').
--
-- NEDEN OTOMATIK CIKARILAMAZ: lig ADI benzersiz degil ('Super League' dort
-- ulkede, 'Bundesliga' ikide) ve kadronun baskin uyrugu de ligi vermiyor --
-- Premier League'de baskin uyruk %29 Ingiltere, Serie A'da %32 Italya.
-- Ust liglerde yabanci orani cikarimi guvenilmez kiliyor.
CREATE TABLE IF NOT EXISTS ref_league (
  source_kind      TEXT    NOT NULL,   -- 'fc26' | 'transfermarkt'
  source_league_id TEXT    NOT NULL,
  country_name     TEXT    NOT NULL,   -- country.name_real ile BIREBIR
  league_name      TEXT    NOT NULL,
  level            INTEGER NOT NULL,
  promoted         INTEGER NOT NULL DEFAULT 0,
  relegated        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_kind, source_league_id)
) STRICT;

CREATE INDEX IF NOT EXISTS ix_ref_league_country ON ref_league(country_name);

-- ISIM HAVUZLARI -- ulkeye ozel, dogal isimler.
--
-- Rastgele anlamsiz dizi ('Xqzj91') ASLA uretilmez; hakem, teknik heyet ve
-- menajer adlari bu havuzlardan kurulur. Bir ulke icin havuz yoksa
-- country_name = '' satirlari (varsayilan havuz) kullanilir.
CREATE TABLE IF NOT EXISTS ref_name_pool (
  id           INTEGER PRIMARY KEY,
  entity_kind  TEXT NOT NULL CHECK (entity_kind IN ('staff','referee','agent')),
  country_name TEXT NOT NULL DEFAULT '',
  part         TEXT NOT NULL CHECK (part IN ('first','last')),
  value        TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ref_name
  ON ref_name_pool(entity_kind, country_name, part, value);
CREATE INDEX IF NOT EXISTS ix_ref_name_lookup
  ON ref_name_pool(entity_kind, country_name, part);

-- NITELIK BANTLARI -- hangi seviyedeki varlik hangi araliktan cekilir.
--
-- band_key: teknik heyette kulup tier'i ('elite'...'amateur'), hakemde
-- kokart ('fifa'...'regional'), menajerde arketip ('super_agent'...).
--
-- BANTLAR CAKISIR ve bu KASITLIDIR: zayif bir kulupte iyi bir hoca (ya da
-- tersi) mumkun olmali. Cakismayan bantlar dunyayi ongorulebilir yapar ve
-- "dusen takimi kurtaran hoca" anlatisini imkansiz kilardi.
CREATE TABLE IF NOT EXISTS ref_attribute_band (
  entity_kind TEXT    NOT NULL CHECK (entity_kind IN ('staff','referee','agent')),
  band_key    TEXT    NOT NULL,
  attribute   TEXT    NOT NULL,
  min_value   REAL    NOT NULL,
  max_value   REAL    NOT NULL,
  PRIMARY KEY (entity_kind, band_key, attribute)
) STRICT;

-- AGIRLIKLI DAGILIMLAR -- kokart dagilimi, oyun felsefesi, menajer arketipi.
--
-- Toplam 1.0 olmak ZORUNDA DEGIL; okuyan taraf normalize eder. Boylece tek
-- bir satirin agirligini degistirmek digerlerini elle duzeltmeyi
-- gerektirmez.
CREATE TABLE IF NOT EXISTS ref_distribution (
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('staff','referee','agent')),
  bucket      TEXT NOT NULL,   -- 'badge' | 'style' | 'archetype' | 'formation'
  key         TEXT NOT NULL,
  weight      REAL NOT NULL,
  PRIMARY KEY (entity_kind, bucket, key)
) STRICT;

-- ROL TANIMLARI -- kulup basina kac kisi, hangi yas araliginda, nitelikli mi.
--
-- attributed = 0 olan roller (doktor, fizyoterapist, baskan) nitelik
-- tasimaz: bir doktorun taktik bilgisi anlamsizdir ve o satirlar
-- staff_attributes tablosuna hic yazilmaz.
--
-- role degerleri src/domain/actors.ts:STAFF_ROLES ile BIREBIR eslesmeli.
CREATE TABLE IF NOT EXISTS ref_staff_role (
  role       TEXT    PRIMARY KEY CHECK (role IN
               ('manager','assistant','president','sporting_director',
                'doctor','physio')),
  min_age    INTEGER NOT NULL,
  max_age    INTEGER NOT NULL,
  attributed INTEGER NOT NULL DEFAULT 0,
  per_club   INTEGER NOT NULL DEFAULT 1
) STRICT;

-- KELIME HAVUZLARI -- maskeleme sozcukleri.
--
-- Kulup ayirt edicileri ('Northgate', 'Ironside'), yer adlari ve benzeri
-- sozcukler. Once kodda sabit dizilerdi; maskeleme sozlugu de dunyanin
-- kurulum verisidir ve editorden genisletilebilmeli.
CREATE TABLE IF NOT EXISTS ref_word_pool (
  id       INTEGER PRIMARY KEY,
  bucket   TEXT NOT NULL,   -- 'club_distinctive' | 'place' | 'agency_suffix'
  value    TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ref_word ON ref_word_pool(bucket, value);

-- KURATORLU MASKE ESLEMESI -- elle secilmis adlar.
--
-- Algoritmanin urettigi adi EZER. 'Arsenal -> Pendle Eastfield' otomatik
-- sonucu taninabilir degil; kullanici burada 'Arsenal -> Woolwich Reds'
-- diyebilir. Once mask-rules.json dosyasindaydi; gercek veri DB'de yasar.
CREATE TABLE IF NOT EXISTS ref_mask_rule (
  entity_kind TEXT NOT NULL CHECK (entity_kind IN
                ('club','player','competition','country','staff','agency','city')),
  name_real   TEXT NOT NULL,
  name_masked TEXT NOT NULL,
  PRIMARY KEY (entity_kind, name_real)
) STRICT;

-- SAYISAL AYARLAR -- lig basina hakem sayisi, ulke basina menajer sayisi.
--
-- Tek degerlik ayarlar da veritabaninda durur. Kod icinde sabit olsalardi
-- "dunyada kac hakem var" sorusunun cevabi TypeScript'e gomulu olurdu ve
-- editorden degistirilemezdi.
CREATE TABLE IF NOT EXISTS ref_setting (
  entity_kind TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       REAL NOT NULL,
  PRIMARY KEY (entity_kind, key)
) STRICT;

-- ELLE TANIMLI HAKEMLER.
--
-- Cekilisle uretilen kadronun arasinda kaybolmasinlar diye once bunlar
-- yazilir. Nitelik kolonlari NULL birakilabilir -- o zaman kokart bandindan
-- cekilir.
CREATE TABLE IF NOT EXISTS ref_manual_referee (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  country_name    TEXT    NOT NULL,
  badge           TEXT    NOT NULL CHECK (badge IN ('regional','national','elite','fifa')),
  strictness      INTEGER,
  card_tendency   INTEGER,
  penalty_courage INTEGER,
  var_reliance    INTEGER,
  consistency     INTEGER,
  home_bias       INTEGER,
  experience      INTEGER,
  reputation      INTEGER
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_manual_referee ON ref_manual_referee(name, country_name);

-- ---------------------------------------------------------------- teknik heyet
-- TEK TABLO, ROL KOLONU. Ayri coaches + managers tablolari ACILMADI.
--
-- NEDEN: bu oyunda Hero bir FUTBOLCU. roles.jsondaki manager slotu
-- "Teknik direktor" demek -- yani Ingilizce "manager" ile "coach" burada
-- AYNI kisi. Iki tablo acmak CastingDirectorin tek slotunu iki kaynaktan
-- beslemek olurdu ve hangisinin kazanacagi tanimsiz kalirdi.
--
-- Turkce "menajer" ise BASKA bir sey: oyuncunun temsilcisi -- agent
-- tablosu. Terim carpismasi bu semadaki en kolay hata kaynagi, bu yuzden
-- acikca yaziyor.
--
-- ROL LISTESI src/domain/actors.ts:STAFF_ROLES ile BIREBIR. Yeni bir rol
-- eklemek iki yeri birden degistirir; CHECK kisiti ayrismayi yakalar.
--
-- KIMLIK GERCEK, NITELIK URETILMIS:
--   male_coaches.csv 1.369 gercek teknik direktor tasiyor -- ama yalnizca
--   ad, dogum tarihi ve uyruk. Nitelik YOK. Bu yuzden hakem ve menajerde
--   oldugu gibi nitelikler TOHUMDAN uretilir; kimlik kaynaktan gelir.
CREATE TABLE IF NOT EXISTS staff (
  id            INTEGER PRIMARY KEY,
  external_key  TEXT    NOT NULL UNIQUE,
  name_real     TEXT    NOT NULL,
  name_masked   TEXT    NOT NULL,
  first_masked  TEXT    NOT NULL DEFAULT '',
  last_masked   TEXT    NOT NULL DEFAULT '',
  role          TEXT    NOT NULL CHECK (role IN
                  ('manager','assistant','president','sporting_director',
                   'doctor','physio')),
  birth_year    INTEGER,
  nationality   TEXT    NOT NULL DEFAULT '',
  country_id    INTEGER REFERENCES country(id),
  -- Guncel gorev -- ONBELLEK. Kaynak staff_assignment.
  club_id       INTEGER REFERENCES club(id),
  reputation    INTEGER NOT NULL DEFAULT 50,
  experience    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  origin        TEXT    NOT NULL DEFAULT ''
) STRICT;

CREATE INDEX IF NOT EXISTS ix_staff_club ON staff(club_id);
CREATE INDEX IF NOT EXISTS ix_staff_role ON staff(role, club_id);

-- TEKNIK NITELIKLER -- player / player_attributes ayriminin AYNISI.
--
-- ALTI NITELIK, YIRMI DEGIL. Football Manager'da bulundugu icin
-- set_pieces, goalkeeper_coaching, youth_development gibi alanlar
-- EKLENMEDI: hicbirinin bugun bir tuketicisi yok ve tuketicisi olmayan
-- kolon, hicbir sey hesaplamayan bir yalandir. Taktik sistemi yazildiginda
-- bu tabloya eklenirler -- ayri tablo olmasinin sebebi tam da bu.
--
-- HER NITELIGIN BUGUN BIR TUKETICISI VAR:
--   tactical       -> TeamModel hat carpani
--   motivation     -> TeamModel hat carpani + sezon morali
--   training       -> Hero sezon sonu gelisimi
--   development    -> genc Hero'nun potansiyel gerceklestirmesi
--   man_management -> iliski_manager baslangici
--   discipline     -> forma sansi
--
-- SEYREKLIK: doktorun tacticali anlamsiz. Bu yuzden yalnizca
-- manager / assistant / sporting_director icin satir yazilir; kalan uc rol
-- staff tablosunda kimlik olarak yasar. Okuma LEFT JOIN'dir, yokluk
-- zarif bozulmadir.
CREATE TABLE IF NOT EXISTS staff_attributes (
  staff_id       INTEGER PRIMARY KEY REFERENCES staff(id),
  tactical       INTEGER NOT NULL,
  training       INTEGER NOT NULL,
  development    INTEGER NOT NULL,
  motivation     INTEGER NOT NULL,
  man_management INTEGER NOT NULL,
  discipline     INTEGER NOT NULL,
  preferred_formation TEXT NOT NULL DEFAULT '4-4-2',
  preferred_style     TEXT NOT NULL DEFAULT 'balanced'
    CHECK (preferred_style IN
      ('balanced','possession','counter','pressing','defensive','direct')),
  -- TURETILMIS. Dogruluk kaynagi DEGIL -- yukaridaki altisindan hesaplanir.
  -- Saklanmasinin tek sebebi her kadro okumasinda alti carpim yapmamak.
  overall        INTEGER NOT NULL
) STRICT;

-- GOREV GECMISI.
--
-- staff.club_id yalnizca guncel gorevi tasir; gecmis burada durur.
--
-- TARIH NEDEN YIL: kaynakta gorev tarihi HIC yok. Uydurma bir gun/ay
-- yazmak veriyi oldugundan kesin gosterirdi.
--
-- world.db BASLANGIC durumunu tasir. Kariyer boyunca degisen gorevler
-- (kovulma, yeni hoca) save.db'nin isidir -- player.club_id ile
-- TransferOverlay arasindaki ayrimin aynisi.
CREATE TABLE IF NOT EXISTS staff_assignment (
  id          INTEGER PRIMARY KEY,
  staff_id    INTEGER NOT NULL REFERENCES staff(id),
  club_id     INTEGER NOT NULL REFERENCES club(id),
  role        TEXT    NOT NULL CHECK (role IN
                ('manager','assistant','president','sporting_director',
                 'doctor','physio')),
  start_year  INTEGER NOT NULL,
  end_year    INTEGER,
  is_current  INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX IF NOT EXISTS ix_assign_staff ON staff_assignment(staff_id);
CREATE INDEX IF NOT EXISTS ix_assign_club  ON staff_assignment(club_id, role);

-- "Bir kulupte ayni anda IKI teknik direktor olamaz" -- kod degil KISIT.
-- club.current_manager_id onbelleginin sessizce ayrismasini yapisal
-- olarak imkansiz kilar.
CREATE UNIQUE INDEX IF NOT EXISTS ux_assign_current
  ON staff_assignment(club_id, role) WHERE is_current = 1;

-- ---------------------------------------------------------------- menajerlik sirketi
-- GERCEK VERI, uydurma degil.
--
-- player_profiles.csv iki kolon tasiyor: player_agent_id ve
-- player_agent_name. Ithalat bunlari "gercek kisi adi tasimamak icin"
-- dusuruyordu -- ama olculdu: bunlar KISI adi degil SIRKET adi
-- (Wasserman, CAA Stellar, Gestifute...). 4.842 ayri sirket, gercek
-- musteri sayilariyla.
--
-- Bu yuzden client_count UYDURULMAZ, SAYILIR. Ayni sekilde reputation
-- musterilerin piyasa degerinden, specialization musteri profilinden
-- turetilir. Yalnizca negotiation_power tohumdandir -- pazarlik gucu
-- kaynakta olcume gelmiyor -- ve o da itibar bandindan cekilir, havadan
-- degil.
CREATE TABLE IF NOT EXISTS agency (
  id                INTEGER PRIMARY KEY,
  external_key      TEXT    NOT NULL UNIQUE,
  name_real         TEXT    NOT NULL,
  name_masked       TEXT    NOT NULL,
  country_id        INTEGER REFERENCES country(id),
  client_count      INTEGER NOT NULL DEFAULT 0,
  reputation        INTEGER NOT NULL,
  influence         INTEGER NOT NULL,
  negotiation_power INTEGER NOT NULL,
  specialization    TEXT    NOT NULL CHECK (specialization IN
                      ('elite','international','domestic','youth',
                       'regional','commercial')),
  active            INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS ix_agency_reputation ON agency(reputation);

-- OYUNCU <-> SIRKET. player.agency_id KOLONU ACILMADI.
--
-- Cunku bir oyuncu zaman icinde sirket degistirir ve eski iliski
-- KORUNMALIDIR. Dogrudan FK bunu tasiyamaz. Kismi unique index guncel
-- durumu yine TEK sorguda verdigi icin normalizasyonun bedelini odemiyoruz.
CREATE TABLE IF NOT EXISTS player_agency (
  id          INTEGER PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES player(id),
  agency_id   INTEGER NOT NULL REFERENCES agency(id),
  start_year  INTEGER,
  end_year    INTEGER,
  is_current  INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS ix_pa_player ON player_agency(player_id);
CREATE INDEX IF NOT EXISTS ix_pa_agency ON player_agency(agency_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pa_current
  ON player_agency(player_id) WHERE is_current = 1;

-- ---------------------------------------------------------------- kaynak koprusu
-- IKI DATASET, IKI KIMLIK UZAYI.
--
-- FC26 nitelik ve mevki tasiyor ama menajerlik sirketi tasimiyor;
-- Transfermarkt tam tersi. Ayni oyuncu ikisinde FARKLI ID'ye sahip
-- (sofifa player_id vs transfermarkt player_id), bu yuzden eslestirme
-- ad + dogum yili + uyruk uzerinden YAPILIR ve ne kadar guvendigimiz
-- kaydedilir.
--
-- confidence neden kolon: eslestirme kesin degil. Zayif eslesme
-- SESSIZCE kabul edilmez -- oyuncu sirketsiz kalir, ki bu oyunda gecerli
-- bir durumdur ve uydurma sirket atamaktan iyidir.
CREATE TABLE IF NOT EXISTS identity_link (
  entity_kind TEXT    NOT NULL,
  primary_key TEXT    NOT NULL,
  linked_key  TEXT    NOT NULL,
  confidence  INTEGER NOT NULL,
  method      TEXT    NOT NULL,
  PRIMARY KEY (entity_kind, primary_key, linked_key)
) STRICT;

CREATE INDEX IF NOT EXISTS ix_link_linked ON identity_link(entity_kind, linked_key);

-- ---------------------------------------------------------------- maske kilidi
-- GEREKSINIMIN KALBI: bir kere maskelenen isim ve stable_id BIR DAHA DEGISMEZ.
-- Guncel CSV yuklendiginde stat/kulup guncellenir, bu tablo DOKUNULMAZ.
CREATE TABLE IF NOT EXISTS mask_binding (
  entity_kind  TEXT    NOT NULL CHECK (entity_kind IN
                 ('club','player','competition','country','staff','agency')),
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
