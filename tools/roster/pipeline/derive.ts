/**
 * TURETME ASAMALARI -- kaynakta olmayan ama kaynaktan CIKARILABILEN yapilar.
 *
 * Buradaki hicbir deger uydurulmuyor: hepsi ithal edilmis veriden
 * hesaplaniyor. Uretilmis (tohumlu) veriler `staff.ts`, `referees.ts` ve
 * `agents.ts` icinde; burasi TURETME.
 */

import type { IssueLog } from '../db.js';
import type { DatabaseSyncType } from '../sqlite.js';
import { MaskBinder, poolCompetitionMask } from '../masking.js';
import type { ImportScope } from '../scope.js';

/**
 * ULKE KUPALARI -- artik CALISMA ANINDA degil VERITABANINDA.
 *
 * OLCULEN SORUN: kupalar hicbir zaman veritabaninda olmadi. `dbWorld.ts`
 * her acilista `cup_<ulkeId>` diye bir kimlik uyduruyordu. Sonuclari:
 *   - Kupanin ADI yoktu; anlati "kupa" diyemiyordu.
 *   - ITIBARI yoktu; kupa finali ile lig maci ayni agirliktaydi.
 *   - `referee_eligibility` kupaya kokart sarti KOYAMIYORDU, cunku
 *     kupanin bir `competition.id`si yoktu.
 *   - Editor kupalari goremiyordu.
 *
 * NEDEN ULKE BASINA BIR KUPA:
 *   Tek bir kupaya butun kulupleri sokmak futbol degil: Premier League
 *   kulubu ilk turda Portekiz 2. Lig takimiyla eslesirdi. Ulke basina kupa
 *   hem gercek yapiya sadik hem de "dev yikan amator" anlatisini korur --
 *   bir ulkenin TUM basamaklari ayni kurada.
 *
 * ITIBAR: o ulkenin kuluplerinin ortalamasi. Kupa, ulkesinin ayarindadir.
 */
export function buildCups(
  db: DatabaseSyncType,
  binder: MaskBinder,
  scope: ImportScope,
  log: IssueLog,
): number {
  const countries = db
    .prepare(
      `SELECT n.id, n.name_real, COUNT(c.id) AS club_count,
              CAST(ROUND(AVG(c.reputation)) AS INTEGER) AS reputation
       FROM country n JOIN club c ON c.country_id = n.id
       GROUP BY n.id
       HAVING COUNT(c.id) >= 4`,
    )
    .all() as unknown as {
    id: number;
    name_real: string;
    club_count: number;
    reputation: number;
  }[];

  if (countries.length === 0) {
    log.warn('cups', 'kupa kurulacak ulke yok (her ulkede en az 4 kulup gerekir)');
    return 0;
  }

  const insert = db.prepare(
    `INSERT INTO competition(
       id, external_key, country_id, kind, level, name_real, name_masked,
       format_kind, legs, matches_per_club, club_count,
       window_start, window_end, slot_preference, promoted, relegated,
       reputation, source_league_id)
     VALUES (?, ?, ?, 'domestic_cup', NULL, ?, ?, 'explicit', 1, NULL, ?, ?, ?, 'midweek', 0, 0, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       club_count = excluded.club_count,
       reputation = excluded.reputation`,
  );

  let created = 0;
  db.exec('BEGIN');
  try {
    for (const country of countries) {
      const realName = `${country.name_real} Cup`;
      const key = `cup:${country.id}`;
      // PES MANTIGI: 'England Cup' -> 'English Cup'.
      const bound = binder.resolve('competition', key, realName, (salt) => ({
        name: poolCompetitionMask(realName, salt, {
          country: country.name_real,
          kind: 'domestic_cup',
        }),
        strategy: 'pool',
      }));

      insert.run(
        bound.stableId,
        key,
        country.id,
        realName,
        bound.name,
        country.club_count,
        scope.leagueWindow.start,
        scope.leagueWindow.end,
        // Kupa ligden BIR TIK saygin: finali bir lig macindan buyuktur.
        Math.min(99, country.reputation + 4),
      );
      created += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return created;
}

/**
 * HAKEM UYGUNLUGU -- hangi turnuva hangi kokarti zorunlu kilar.
 *
 * OLCULEN SORUN: `referee_eligibility` tablosu semada vardi ama HIC
 * DOLDURULMUYORDU ve `dbWorld.ts` `requiredBadgeOf` callback'ini hic
 * gecirmiyordu. Yani tablo tamamen oluydu: atama her seferinde koddaki
 * taban `requiredBadge()` fonksiyonuna dusuyor ve "yeni bir turnuva
 * eklendiginde kod degismez, satir eklenir" vaadi calismiyordu.
 *
 * Kural VERIDIR: burada bir kez turetilir, sonra editorden degistirilebilir.
 */
export function fillRefereeEligibility(db: DatabaseSyncType, log: IssueLog): number {
  const inserted = db
    .prepare(
      `INSERT INTO referee_eligibility(competition_id, min_badge)
       SELECT id, CASE
         WHEN kind = 'international' THEN 'fifa'
         WHEN kind = 'continental'   THEN 'elite'
         WHEN kind = 'domestic_cup'  THEN 'national'
         WHEN level = 1              THEN 'national'
         ELSE 'regional' END
       FROM competition
       WHERE id NOT IN (SELECT competition_id FROM referee_eligibility)`,
    )
    .run();

  const count = Number(inserted.changes ?? 0);
  log.info('referees', `${count} turnuva icin kokart sarti tanimlandi`);
  return count;
}

/**
 * FINANSAL GUC -- transfer butcesinden AYRI bir kavram.
 *
 *   budget_transfer = BU SEZON harcanabilir para
 *   financial_power = kulubun YAPISAL buyuklugu
 *
 * Bir kulubun transfer butcesi bir sezon sifir olabilir; finansal gucu
 * yine yuksektir ve oyuncu hala oraya gitmek ister. Transfer cazibesini
 * butceyle olcmek "bu yaz para harcamayan dev kulup cazip degil" gibi
 * yanlis bir sonuc uretirdi.
 *
 * Uc bilesen: kadro degeri (kuresel olarak fiyatlanmis tek olcek), kulup
 * itibari ve oynadigi ligin itibari. Sonuc YUZDELIGE cevrilir -- hangi
 * evreni ithal edersek edelim kullanilabilir bir dagilim cikar.
 */
export function computeFinancialPower(db: DatabaseSyncType, log: IssueLog): number {
  const rows = db
    .prepare(
      `SELECT c.id, c.reputation, COALESCE(c.squad_value, 0) AS squad_value,
              COALESCE(comp.reputation, 40) AS league_reputation
       FROM club c LEFT JOIN competition comp ON comp.id = c.competition_id`,
    )
    .all() as unknown as {
    id: number;
    reputation: number;
    squad_value: number;
    league_reputation: number;
  }[];

  if (rows.length === 0) return 0;

  const scored = rows.map((r) => ({
    id: r.id,
    score:
      Math.log10(Math.max(r.squad_value, 100_000)) * 0.55 +
      (r.reputation / 100) * 0.3 +
      (r.league_reputation / 100) * 0.15,
  }));

  const ranked = [...scored].sort((a, b) => a.score - b.score);
  const n = ranked.length;
  const update = db.prepare('UPDATE club SET financial_power = ? WHERE id = ?');

  db.exec('BEGIN');
  try {
    ranked.forEach((club, i) => {
      update.run(n <= 1 ? 55 : Math.round(5 + (94 * i) / (n - 1)), club.id);
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  log.info('finance', `${n} kulup icin finansal guc hesaplandi`);
  return n;
}

/**
 * KADRO DEGERI -- oyunculardan toplanir.
 *
 * Itibar ve butce zaten bu degerden turetiliyordu ama deger hicbir yerde
 * SAKLANMIYORDU; her ihtiyacta yeniden toplaniyordu. Artik kolon.
 */
export function computeSquadValue(db: DatabaseSyncType, log: IssueLog): number {
  const result = db
    .prepare(
      `UPDATE club SET squad_value = COALESCE((
         SELECT SUM(p.market_value) FROM player p WHERE p.club_id = club.id
       ), 0)`,
    )
    .run();
  const n = Number(result.changes ?? 0);
  log.info('finance', `${n} kulubun kadro degeri hesaplandi`);
  return n;
}

/**
 * MENAJER -> SIRKET baglama.
 *
 * Menajer bir KISI, sirket bir KURUM. Uretilmis menajerler itibar
 * bandina gore bir sirkete baglanir: itibarli menajer itibarli sirkette
 * calisir. Esleme tam sirali degil -- band icinde tohumlu bir kayma var,
 * yoksa her sezon ayni menajer ayni sirkete duserdi.
 *
 * Sirket yoksa (agency asamasi atlanmis) alan NULL kalir ve menajerin
 * erisimi olceklenmez -- zarif bozulma.
 */
export function linkAgentsToAgencies(db: DatabaseSyncType, log: IssueLog): number {
  const agencies = db
    .prepare('SELECT id, reputation FROM agency ORDER BY reputation DESC')
    .all() as unknown as { id: number; reputation: number }[];
  if (agencies.length === 0) return 0;

  const agents = db
    .prepare('SELECT id, reputation FROM agent ORDER BY reputation DESC')
    .all() as unknown as { id: number; reputation: number }[];
  if (agents.length === 0) return 0;

  const update = db.prepare('UPDATE agent SET agency_id = ? WHERE id = ?');
  let linked = 0;

  db.exec('BEGIN');
  try {
    agents.forEach((agent, i) => {
      // Menajerin itibar siralamasindaki yeri, sirket siralamasina
      // ORANTILI olarak esleniyor: en itibarli menajer en itibarli
      // sirkete, en dusuk en dusuge.
      const ratio = agents.length <= 1 ? 0 : i / (agents.length - 1);
      const index = Math.min(agencies.length - 1, Math.round(ratio * (agencies.length - 1)));
      update.run(agencies[index]!.id, agent.id);
      linked += 1;
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  log.info('agency', `${linked} menajer sirkete baglandi`);
  return linked;
}
