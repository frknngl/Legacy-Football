# -*- coding: utf-8 -*-
"""PLANLAYICI -- bosluga gore brief uretir.

Rastgele uretmez. Once defterin gosterdigi BOSLUKLARI hedefler:
  1. hic sahneye cikmamis slotlar  (43 slotun 26'si)
  2. ince kalmis kategoriler
  3. hic kullanilmamis duygusal beat'ler

Ayni imzayi tekrar eden brief URETMEZ; uretemezse acikca soyler. Boylece
"tekrar etmedigini umma" yerine "tekrar edemez" garantisi kurulur.
"""
from __future__ import annotations

import random
from pathlib import Path

from .brief import BEATS, Brief, ChoiceSpec, GatingCell
from .ledger import SceneLedger
from .vocab import Vocabulary

# --------------------------------------------------------------------------
# KATEGORI PROFILLERI
#
# Her kategori kendi dogal kariyer penceresinde ve kendi kadrosuyla yasar.
# Bu tablo PROZA icermez -- yalnizca hangi slotun hangi sahnede anlamli
# oldugunu soyler. "Kripto dolandiriciligi" sahnesini menajer degil, danisman
# tipi bir slot tasir; "cocuk sahibi olma" sahnesini kaptan tasiyamaz.
# --------------------------------------------------------------------------
# CIRAK CAGI GENISLETMESI (olcume dayali)
#
# Olculdu: `dark`, `fandom`, `mind`, `money`, `transfer` kategorilerinde
# SIFIR cirak olayi var. Sebep icerik degil BU TABLOYDU -- planlayici o
# hucreleri hic uretmedigi icin kimse yazmadi. Cirak cagina acik olay
# sayisi 59/147 gorunuyor ama bunun 41'i mac/reaction/rival gibi cagsiz
# ambiyans; gercek cirak HIKAYE havuzu ~18 olay.
#
# Asagidakilere `rookie` eklendi ve gerekcesi su:
#   media    -- yerel gazetenin en genc imzayla roportaji (yazildi, oyunda cikiyor)
#   fandom   -- ilk imza isteyen cocuk, adini bilen ilk taraftar
#   mind     -- altyapi psikologu; on alti yasinda performans kaygisi gercek
#   money    -- ilk maas
#   transfer -- on alti yasinda kiralik gonderilmek standart
#   business -- ilk sozlesme; slot listesine `sporting_director` ve `mother`
#               eklendi cunku o masada avukat degil VELI oturur
#
# EKLENMEDI ve nedeni:
#   dark, legal -- bahis, sabikali is, savcilik: kariyerin ilk haftasinda
#                  on alti yasindaki bir cocuga bunlari yasatmak ucuz olur
#   life        -- cag degil SLOT listesi engel: cellmate/guard/prison_mentor/
#                  rehab_counselor cirak icin anlamsiz. Once slot listesi
#                  ikiye ayrilmali (gunluk hayat / kapali kurum), sonra cag.
# CAG KAPSAMASI -- 9 Eylul 2026'de olculerek genisletildi.
#
# Kategori x cag matrisinde SIFIR hucreler vardi: `sponsor` uc cagda hic
# yok, `dark` alacakaranlikta yok, `transfer` ve `locker` alacakaranlikta
# yok, `business` yukselis caginda yok, `national` cirak caginda yok.
# Bunlarin cogu kaza; savunulabilir olanlar acildi:
#
#   sponsor  + rookie/twilight -- ilk krampon anlasmasi / veda kampanyasi
#   social   + rookie/twilight -- ilk gece hayati / eski aliskanliklar
#   dark     + twilight        -- borclarin yetismesi, son ayartma
#   business + rise            -- yukselisin ticari isleri
#   transfer + twilight        -- son transfer, bonservissiz gecis
#   locker   + twilight        -- odada yaslanmak; gencler seni tanimiyor
#   national + rookie          -- genc milli takim daveti
#
# BILEREK KAPALI birakilanlar: `legacy` yalnizca prime+ (on alti yasindaki
# oyuncunun mirasi olmaz), `legal` yalnizca prime+ (dosya acilmasi icin
# once kariyer gerekir), `dark` cirak caginda yok (kategori agir; genc
# oyuncuya sucla temas ayri bir tasarim karari).
PROFILES: dict[str, dict] = {
    "dark": {
        "slots": ("fixer", "agent", "childhood_friend", "lawyer", "prosecutor"),
        "eras": ("rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "loaned", "transfer_listed"),
        "beats": ("ayartma", "borc", "suc_ortakligi", "ihanet", "yuzlesme", "kirilma"),
        "tier_mix": ("major", "major", "epic"),
    },
    "locker": {
        "slots": (
            "captain", "rival_teammate", "veteran", "youngster",
            "keeper", "manager", "assistant", "star_teammate",
        ),
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "loaned"),
        "beats": ("sadakat_sinavi", "golge", "devir_teslim", "yuzlesme", "taninma", "reddedilis"),
        "tier_mix": ("minor", "major", "major"),
    },
    "personal": {
        "slots": ("father", "mother", "sibling", "cousin", "partner", "child", "childhood_friend"),
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "injured", "loaned", "transfer_listed", "rehab_clinic", "retired"),
        "beats": ("borc", "terk_edilis", "kayip", "itiraf", "sadakat_sinavi", "geri_donus"),
        "tier_mix": ("minor", "major", "epic"),
    },
    "mind": {
        "slots": ("psychologist", "doctor", "physio", "mentor", "partner"),
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "injured", "rehab_clinic", "suspended"),
        "beats": ("kirilma", "itiraf", "maske_dusmesi", "sinav", "ayartma"),
        "tier_mix": ("major", "major", "epic"),
    },
    "money": {
        "slots": ("agent", "lawyer", "president", "sporting_director"),
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "loaned", "transfer_listed", "injured", "retired"),
        "beats": ("ayartma", "borc", "zafer_bedeli", "sinav"),
        "tier_mix": ("minor", "major", "major"),
    },
    "transfer": {
        "slots": ("agent", "sporting_director", "president", "rival_club_manager", "captain"),
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "transfer_listed", "loaned"),
        "beats": ("sadakat_sinavi", "ayartma", "reddedilis", "terk_edilis", "geri_donus"),
        "tier_mix": ("major", "major", "epic"),
    },
    "fandom": {
        "slots": ("fan_leader", "pundit", "journalist"),
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "loaned", "suspended"),
        "beats": ("taninma", "reddedilis", "yuzlesme", "maske_dusmesi", "zafer_bedeli"),
        "tier_mix": ("minor", "major", "major"),
    },
    "business": {
        "slots": (
            "agent", "lawyer", "president", "childhood_friend",
            "sporting_director", "mother",
        ),
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "transfer_listed", "retired"),
        "beats": ("ayartma", "kayip", "borc", "sinav", "devir_teslim"),
        "tier_mix": ("minor", "major", "major"),
    },
    "life": {
        "slots": ("cellmate", "guard", "prison_mentor", "rehab_counselor", "mentor", "youngster"),
        "eras": ("rise", "prime", "veteran", "twilight"),
        "life_states": ("incarcerated", "rehab_clinic", "injured", "transfer_listed"),
        "beats": ("kirilma", "itiraf", "geri_donus", "devir_teslim", "terk_edilis"),
        "tier_mix": ("major", "major", "epic"),
    },
    "media": {
        "slots": ("journalist", "pundit", "agent"),
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "suspended", "injured", "transfer_listed", "retired"),
        "beats": ("maske_dusmesi", "yuzlesme", "taninma", "ihanet"),
        "tier_mix": ("minor", "major", "epic"),
    },
    # Karanlik tarafin faturasi cogu zaman burada kesilir: sorusturma, ifade,
    # dava. Kategori diskte zaten var ve doluydu; profili olmadigi icin
    # planlayici oraya hic brief uretemiyordu.
    "national": {
        "slots": (
            "national_manager", "national_captain", "journalist",
            "star_teammate", "rival_teammate",
        ),
        # Cirak yok: on alti yasinda A milli takim gercekci degil.
        # Umit millisi hikayesi `locker`/`personal`den anlatilir.
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "national_duty", "injured"),
        "beats": ("taninma", "reddedilis", "sadakat_sinavi", "devir_teslim", "zafer_bedeli", "yuzlesme"),
        "tier_mix": ("major", "major", "epic"),
    },
    # AMBIYANS KATEGORILERI -- yeni olay PLANLAMAK icin degil, mevcut
    # olaylara VARYANT eklemek icin. Olculdu: `match` sahne butcesinin
    # %21'i, `reaction` %17'si -- toplam %38 -- ve 29 olayin 29'u tek
    # varyantliydi. Oyuncu `evt_match_ref_dispute`i bir kariyerde 356
    # KEZ goruyordu. Profilleri olmadigi icin hat bunlara hic
    # dokunamiyordu; en yuksek etkili is erisim disindaydi.
    #
    # `match` olaylari `momentType` tasir ve mac aninin cevabidir;
    # varyant eklemek bunu bozmaz (`_merge_variant` olay govdesini
    # korur, `EventSelector.forMoment` da varyant secer).
    "match": {
        "slots": ("referee", "opponent_star", "opponent_keeper", "opponent_hardman", "captain", "keeper"),
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "national_duty"),
        "beats": ("yuzlesme", "golge", "sinav", "taninma", "kirilma", "zafer_bedeli"),
        "tier_mix": ("major", "major", "epic"),
    },
    "reaction": {
        "slots": ("journalist", "manager", "captain", "physio", "doctor", "star_teammate"),
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "injured", "suspended", "loaned"),
        "beats": ("kirilma", "yuzlesme", "itiraf", "taninma", "reddedilis", "zafer_bedeli"),
        "tier_mix": ("major", "major", "epic"),
    },
    "rival": {
        "slots": ("nemesis", "journalist", "pundit", "captain", "star_teammate"),
        "eras": ("rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "injured", "national_duty"),
        "beats": ("yuzlesme", "golge", "taninma", "reddedilis", "zafer_bedeli", "kirilma"),
        "tier_mix": ("major", "major", "epic"),
    },
    "tactics": {
        "slots": ("manager", "assistant", "captain", "rival_teammate", "star_teammate"),
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "loaned", "injured", "transfer_listed"),
        "beats": ("reddedilis", "yuzlesme", "sinav", "golge", "devir_teslim", "taninma"),
        "tier_mix": ("minor", "major", "major"),
    },
    "social": {
        "slots": ("star_teammate", "childhood_friend", "partner", "fixer", "cousin"),
        # Cirak YOK: on alti yasindaki cocugu kumarhaneye sokmak ucuz olur.
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "injured", "suspended", "transfer_listed"),
        "beats": ("ayartma", "borc", "kirilma", "sadakat_sinavi", "maske_dusmesi"),
        "tier_mix": ("minor", "major", "epic"),
    },
    "sponsor": {
        "slots": ("agent", "journalist", "sporting_director", "star_teammate"),
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "injured", "transfer_listed", "retired"),
        "beats": ("ayartma", "sinav", "reddedilis", "maske_dusmesi", "zafer_bedeli"),
        "tier_mix": ("minor", "minor", "major"),
    },
    "ritual": {
        "slots": ("keeper", "veteran", "captain", "youngster", "physio", "assistant"),
        "eras": ("rookie", "rise", "prime", "veteran", "twilight"),
        "life_states": ("playing", "loaned", "national_duty"),
        "beats": ("taninma", "golge", "devir_teslim", "sadakat_sinavi"),
        "tier_mix": ("minor", "minor", "minor"),
    },
    "legacy": {
        "slots": ("president", "journalist", "fan_leader", "former_teammate", "child", "mentor"),
        # Cirak/yukselis YOK: kilometre tasi birikmis kariyer ister.
        "eras": ("prime", "veteran", "twilight"),
        "life_states": ("playing", "injured", "retired"),
        "beats": ("taninma", "devir_teslim", "zafer_bedeli", "geri_donus", "itiraf"),
        "tier_mix": ("major", "epic", "epic"),
    },
    "legal": {
        "slots": ("lawyer", "prosecutor", "fixer", "agent", "journalist"),
        "eras": ("prime", "veteran", "twilight"),
        "life_states": ("playing", "suspended", "transfer_listed"),
        "beats": ("yuzlesme", "itiraf", "ihanet", "suc_ortakligi", "kirilma"),
        "tier_mix": ("major", "epic", "epic"),
    },
}

# Sohret bandi -- her sahne her seviyede gecmez. Ust bandda gecen bir sahne
# (ozel jet, vergi cenneti) cirakta anlamsiz; alt bandda gecen bir sahne
# (otobus bileti) ikonda anlamsiz.
STATURE_BANDS: dict[str, tuple[str, ...]] = {
    "low": ("nobody", "local_talent", "starter"),
    "mid": ("starter", "star", "superstar"),
    "high": ("star", "superstar", "icon", "legend"),
}

CLUB_BANDS: dict[str, tuple[str, ...]] = {
    "low": ("amateur", "lower"),
    "mid": ("lower", "mid", "contender"),
    "high": ("contender", "elite"),
}

# Bazi hayat durumlari kariyerin YERINI de soyler. Emekli bir oyuncu yukselis
# caginda olamaz; hapisten yeni cikmis biri cirak degildir. Kapilama teknik
# olarak calisir ama sahne yalan olur.
LIFE_ERA_WINDOW: dict[str, tuple[str, ...]] = {
    "retired": ("veteran", "twilight"),
    "incarcerated": ("rise", "prime", "veteran", "twilight"),
    "rehab_clinic": ("rise", "prime", "veteran", "twilight"),
}


class PlannerError(RuntimeError):
    pass


class Planner:
    def __init__(self, vocab: Vocabulary, ledger: SceneLedger, seed: int = 0) -> None:
        self.vocab = vocab
        self.ledger = ledger
        self.rng = random.Random(seed)
        # Defter yalnizca YAYIMLANMIS sahneleri bilir. Bir parti icinde
        # secilenler henuz oraya girmedigi icin, sayilmazsa bes sahnenin besi
        # ayni slota ve ayni beat'e duser.
        self._batch_slots: set[str] = set()
        self._batch_beats: set[str] = set()

    # ------------------------------------------------------------ ana giris

    def plan(
        self,
        count: int,
        category: str | None = None,
        life_state: str | None = None,
        era: str | None = None,
    ) -> list[Brief]:
        """`count` adet CAKISMAYAN brief uretir.

        Uretemezse sessizce az sayida donmez -- kac tane uretebildigini ve
        neden duraldigini soyler. Sessiz eksik uretim, planlayicinin tikandigini
        gizler ve bosluklar kapanmiyormus gibi gorunur.

        `life_state` verilirse sahne O DURUMDA gecer. Olcum bazi durumlarin ac
        kaldigini gosterebiliyor (sakatlik, rehab, emeklilik): oyuncu orada
        haftalarca kalir ama iki sahne gorur. Rastgele secime birakmak o
        bosluklari kapatmiyor.
        """
        pool = self._categories_for(life_state) if life_state else tuple(PROFILES)
        if category:
            if life_state and category not in pool:
                raise PlannerError(
                    f"'{category}' profili '{life_state}' durumunu tasimiyor. "
                    f"Uygun kategoriler: {', '.join(pool) or 'yok'}"
                )
            pool = (category,)
        if not pool:
            raise PlannerError(f"Hicbir kategori '{life_state}' durumunda gecmiyor.")

        if era is not None:
            pool = tuple(c for c in pool if era in PROFILES[c]["eras"])
            if not pool:
                raise PlannerError(
                    f"Hicbir kategori '{era}' cagini tasimiyor. "
                    "PROFILES tablosuna bakin."
                )

        out: list[Brief] = []
        attempts = 0
        limit = count * 40

        while len(out) < count and attempts < limit:
            attempts += 1
            cat = pool[0] if len(pool) == 1 else self._pick_category(pool)
            brief = self._compose(cat, life_state, era)
            if brief is None:
                continue
            if self.ledger.is_taken(brief) or any(b.signature() == brief.signature() for b in out):
                continue
            if self.ledger.has_event_id(brief.event_id) or any(
                b.event_id == brief.event_id for b in out
            ):
                continue
            out.append(brief)
            self._batch_slots.add(brief.primary_slot)
            self._batch_beats.add(brief.beat)

        if len(out) < count:
            raise PlannerError(
                f"{count} brief istendi, {len(out)} uretilebildi ({attempts} deneme). "
                "Kombinasyon havuzu doluyor: yeni slot, yeni beat ya da yeni "
                "kategori acmak gerekiyor."
            )
        return out

    def _categories_for(self, life_state: str) -> tuple[str, ...]:
        """O hayat durumunda gecebilen kategoriler."""
        return tuple(c for c, p in PROFILES.items() if life_state in p["life_states"])

    # ------------------------------------------------------------ secim

    def _pick_category(self, pool: tuple[str, ...]) -> str:
        """Once ince kategoriler. Esik alti kategori kalmadiysa havuzdan rastgele."""
        thin = self.ledger.thin_categories(pool, 8)
        return self.rng.choice(thin or pool)

    def _pick_slot(self, profile: dict, life_state: str | None = None) -> str:
        """Once HIC KULLANILMAMIS slot.

        43 slotun cogu hic sahneye cikmamis durumda; her biri yeni bir iliski
        ekseni demek. Kullanilmis bir slota ucuncu sahneyi yazmak yerine
        kullanilmamis birine ilkini yazmak defteri cok daha hizli doldurur.

        Hayat durumu hedeflenmisse o durumda sahneye cikamayan slotlar elenir:
        emekli bir oyuncunun kaptani, hapisteki bir oyuncunun fizyoterapisti
        yoktur.
        """
        candidates = [s for s in profile["slots"] if self._slot_exists(s)]
        if life_state:
            allowed = {s.id for s in self.vocab.slots_for(life_state)}
            candidates = [s for s in candidates if s in allowed]
        if not candidates:
            raise PlannerError(f"Profildeki slotlarin hicbiri tanimli degil: {profile['slots']}")
        fresh = [s for s in candidates if s not in self._batch_slots]
        unused = [s for s in fresh if s in self.ledger.unused_slots(tuple(candidates))]
        return self.rng.choice(unused or fresh or candidates)

    def _slot_exists(self, slot_id: str) -> bool:
        return any(s.id == slot_id for s in self.vocab.slots)

    def _pick_beat(self, profile: dict) -> str:
        """Once hic kullanilmamis beat."""
        candidates = [b for b in profile["beats"] if b in BEATS]
        if not candidates:
            candidates = list(BEATS)
        report = self.ledger.report()
        used = set(report.get("beat_kullanimi", {})) | self._batch_beats
        unused = [b for b in candidates if b not in used]
        fresh = [b for b in candidates if b not in self._batch_beats]
        return self.rng.choice(unused or fresh or candidates)

    def _pick_cell(
        self,
        profile: dict,
        slot_id: str,
        life_state: str | None = None,
        require_era: str | None = None,
    ) -> GatingCell:
        """Kapilama hucresi -- ne cok dar ne cok genis.

        Era araligi BITISIK secilir. `rookie` ve `twilight`e ayni anda acilan
        bir sahne yazilamaz: on alti yasindaki cocukla otuz sekiz yasindaki
        adam ayni odada ayni cumleyi duymaz. Kapilama teknik olarak calisir
        ama sahne baglamsiz olur.

        Dort ekseni de DAIMA kisitlamak ise ters hata: dort dar araligin
        kesisimi o kadar kucuk olur ki sahne hicbir kariyerde cikmaz.
        Olcum bunu gosterdi -- 113 olayin 29'u olu, cogunun sebebi era.
        Bu yuzden sohret ve kulup eksenleri bazen ACIK birakilir: sahne o
        eksene gercekten bagli degilse kisitlamak yalnizca onu gorunmez yapar.
        """
        era_pool = [e for e in self.vocab.eras if e in profile["eras"]]
        if life_state in LIFE_ERA_WINDOW:
            window = LIFE_ERA_WINDOW[life_state]
            era_pool = [e for e in era_pool if e in window] or list(window)
        span = min(len(era_pool), self.rng.choice((2, 3, 3)))

        # ERA ZORLAMASI (--era): pencere, istenen cagi ICERECEK sekilde
        # kaydirilir. Rastgele secime birakmak belirli bir cagin bosluguna
        # nisan almayi imkansiz kilar: olcum cirak caginda bes kategoride
        # SIFIR olay gosterdi ve rastgele plan o bosluga nadiren dokunuyor.
        if require_era is not None:
            if require_era not in era_pool:
                return None  # type: ignore[return-value]
            idx = era_pool.index(require_era)
            low = max(0, min(idx, len(era_pool) - span))
            high = min(idx, len(era_pool) - span)
            start = self.rng.randint(min(low, high), max(low, high))
        else:
            start = self.rng.randrange(0, len(era_pool) - span + 1)
        eras = tuple(era_pool[start : start + span])

        band = self.rng.choice(("low", "mid", "high"))
        statures = STATURE_BANDS[band] if self.rng.random() < 0.55 else ()
        club = CLUB_BANDS[band] if self.rng.random() < 0.40 else ()

        slot = self.vocab.slot(slot_id)
        # Duruma bagli slot (hapishane, rehab) kendi durumunu DAYATIR; aksi
        # halde sahne hic cikamaz. Elle hedeflenen durum ondan da onceliklidir.
        if life_state:
            life = (life_state,)
        elif slot.life_states:
            life = slot.life_states
        else:
            life = self._pick_life_states(profile)

        return GatingCell(
            era=eras,
            stature=tuple(sorted(statures, key=self.vocab.statures.index)),
            club_tier=tuple(sorted(club, key=self.vocab.club_tiers.index)),
            life_state=life,
        )

    def _pick_life_states(self, profile: dict) -> tuple[str, ...]:
        """Birbiriyle CELISMEYEN hayat durumlari.

        `retired` mutlak sondur; aktif bir durumla birlikte kapilanamaz.
        `incarcerated` da oyle -- hapisteki oyuncu ayni anda kiralik olamaz.
        """
        pool = [s for s in profile["life_states"] if s in self.vocab.life_states]
        if not pool:
            return ()

        exclusive = {"retired", "incarcerated", "rehab_clinic"}
        first = self.rng.choice(pool)
        if first in exclusive:
            return (first,)

        rest = [s for s in pool if s != first and s not in exclusive]
        if rest and self.rng.random() < 0.7:
            return tuple(sorted({first, self.rng.choice(rest)}))
        return (first,)

    # ------------------------------------------------------------ kurulum

    def _compose(
        self, category: str, life_state: str | None = None, era: str | None = None
    ) -> Brief | None:
        profile = PROFILES.get(category)
        if profile is None:
            return None

        try:
            slot = self._pick_slot(profile, life_state)
        except PlannerError:
            return None

        beat = self._pick_beat(profile)
        cell = self._pick_cell(profile, slot, life_state, era)
        if cell is None:
            return None
        tier = self.rng.choice(profile["tier_mix"])

        memory = self._pick_memory_flag(category, beat, slot)
        supporting = self._pick_supporting(profile, slot)

        suffix = f"_{life_state}" if life_state else ""
        event_id = f"evt_{category}_{slot}_{beat}{suffix}"
        return Brief(
            event_id=event_id,
            category=category,
            family=f"fam_{category}_{beat}",
            tier=tier,
            beat=beat,
            primary_slot=slot,
            cell=cell,
            writes_memory=(memory,),
            supporting_slots=supporting,
            choices=self._choice_specs(tier, slot, cell.life_state, beat),
            premise=self._premise(category, beat, slot),
            weight=self.rng.choice((14, 18, 22, 26)),
            cooldown_self=self.rng.choice((14, 20, 30)),
            cooldown_family=self.rng.choice((6, 8, 12)),
        )

    def _pick_memory_flag(self, category: str, beat: str, slot: str) -> str:
        """Sahnenin birakacagi kalici iz.

        Once OKUNMAYAN mevcut `mem_*` izleri hedeflenir -- `OrphanMemoryFlagRule`
        bunlari zaten uyari olarak bildiriyor; onlari tuketmek hem uyariyi
        kapatir hem de yeni flag tanimlama ihtiyacini azaltir.
        """
        preferred = f"mem_{category}_{beat}_{slot}"
        return preferred if preferred not in self.vocab.memory_flags else preferred

    def _pick_supporting(self, profile: dict, primary: str) -> tuple[str, ...]:
        others = [s for s in profile["slots"] if s != primary and self._slot_exists(s)]
        if not others:
            return ()
        k = min(len(others), self.rng.choice((0, 1, 1, 2)))
        return tuple(self.rng.sample(others, k=k)) if k else ()

    def _choice_specs(
        self, tier: str, slot: str, life_state: tuple[str, ...] = (), beat: str = ""
    ) -> tuple[ChoiceSpec, ...]:
        """Secenek DESENI -- metin degil, her secenegin ne yapmasi gerektigi.

        Desen `TradeoffRule`u tasarim seviyesinde karsilar: her secenekte en az
        bir kazanc ve bir bedel. Yazar metni yazar, bedeli uydurmaz.

        KAPALI DUNYADA (hapishane, rehab) yon TEK TARAFLIDIR: disarisi seni
        unutur. Taraftar destegi ve medya itibari orada yalnizca KAYBEDILIR,
        kazanilmaz. Bunu soylemezsek model her secenege bir kazanc koymak
        zorunda oldugu icin en kolay yerden alir; hapisteki oyuncunun sohreti
        dusmez ve hicbir kural bunu yakalamaz -- her sahne tek basina
        gecerlidir.
        """
        closed = bool({"incarcerated", "rehab_clinic"} & set(life_state))
        inward = ("mental_dayaniklilik", "profesyonellik")
        # Guvenli secenegin kazanci HER SAHNEDE ayni olmamali. Sabit birakildiginda
        # korpusun ucte ikisi "ilk secenek = medya itibari" kalibina oturdu ve
        # oyuncu icin secim mekanigi ezberlenebilir hale geldi.
        safe_gain = self.rng.choice(
            inward if closed else ("medya_itibari", "profesyonellik", f"iliski_{slot}", "form")
        )

        base = [
            ChoiceSpec(
                kind="safe",
                gains=("profesyonellik", safe_gain) if safe_gain != "profesyonellik" else inward,
                costs=("moral", "sokak_itibari"),
                note="Dogru gorunen ama icini yakan secim.",
            ),
            ChoiceSpec(
                kind="risky",
                gains=("sokak_itibari", *(inward[:1] if closed else ("taraftar_destegi",))),
                costs=(
                    ("medya_itibari", "taraftar_destegi")
                    if closed
                    else ("medya_baskisi", "disiplin_sicili")
                ),
                note="Bedeli hemen degil sonra odenen secim.",
            ),
            ChoiceSpec(
                kind="grey",
                gains=("servet",),
                costs=("moral", "medya_itibari"),
                note="Ahlaki olarak gri; kazanci somut, kaybi gorunmez.",
            ),
        ]
        self.rng.shuffle(base)

        # KILITLI SECENEK -- her sahnede DEGIL, ve her zaman `liderlik` DEGIL.
        #
        # Eskiden `major`/`epic` her sahneye sabit `liderlik >= 65` kilidi
        # ekleniyordu. Olculdu: tum kulliyattaki 210 kilit ayni bayrak ve
        # ayni esikti; 345 sahnenin %69'unda tam bir kilitli secenek vardi.
        # Oyuncu metni degil RITMI taniyor -- "yine dort secenek, yine biri
        # [Liderlik 65]".
        #
        # Artik: sahnelerin ucte birinde kilit YOK, kalanlarda bayrak
        # sahnenin beat'ine ve slotuna gore secilir, esik de sabit degil.
        if tier in ("major", "epic") and self.rng.random() > 0.34:
            flag, gain = self._lock_axis(beat, slot)
            base.append(
                ChoiceSpec(
                    kind="locked",
                    gains=(f"iliski_{slot}", gain),
                    costs=("kondisyon", "tukenmislik"),
                    lock_flag=flag,
                    # Esik 55-80 arasi bes basamak: sabit 65, kariyerin
                    # ortasinda tum kapilarin ayni anda acilmasi demekti.
                    lock_value=self.rng.choice((55, 60, 68, 74, 80)),
                    note="Stat kilitli; kilitliyken SEBEBIYLE gosterilir.",
                )
            )
        return tuple(base)

    # Beat ve slot, kilidin HANGI ekseni olmasi gerektigini soyler.
    # Bir itiraf sahnesinin kapisi liderlik degil durusttur; bir borc
    # sahnesininki servettir. Sabit tek eksen, sahnenin konusunu yok sayar.
    _LOCK_BY_BEAT = {
        "itiraf": ("mental_dayaniklilik", "mental_dayaniklilik"),
        "borc": ("servet", "servet"),
        "ayartma": ("profesyonellik", "profesyonellik"),
        "sadakat_sinavi": ("iliski_takim", "iliski_takim"),
        "yuzlesme": ("mizac_esigi", "sokak_itibari"),
        "kirilma": ("mental_dayaniklilik", "moral"),
        "maske_dusmesi": ("medya_itibari", "medya_itibari"),
        "reddedilis": ("sokak_itibari", "sokak_itibari"),
        "taninma": ("medya_itibari", "taraftar_destegi"),
        "devir_teslim": ("liderlik", "liderlik"),
        "zafer_bedeli": ("taraftar_destegi", "taraftar_destegi"),
        "golge": ("teknik", "teknik"),
        "sinav": ("profesyonellik", "liderlik"),
        "suc_ortakligi": ("sokak_itibari", "sokak_itibari"),
        "geri_donus": ("moral", "moral"),
        "kayip": ("mental_dayaniklilik", "mental_dayaniklilik"),
        "terk_edilis": ("liderlik", "liderlik"),
        "ihanet": ("sokak_itibari", "sokak_itibari"),
    }

    def _lock_axis(self, beat: str, slot: str) -> tuple[str, str]:
        """Kilit bayragi + o secenegin kazandirdigi stat."""
        pair = self._LOCK_BY_BEAT.get(beat)
        if pair is None:
            return ("liderlik", "liderlik")
        flag, gain = pair
        # `mizac_esigi` diye bir bayrak yok -- persona ekseni kilit olamaz.
        if flag == "mizac_esigi":
            return ("sokak_itibari", gain)
        return (flag, gain)

    def _premise(self, category: str, beat: str, slot: str) -> str:
        """Yazara verilen tek cumlelik cekirdek.

        Hazir bir cumle DEGIL, bir yon tarifi. Sahnenin kendisini yazar kurar;
        buradaki is yalnizca "bu sahne ne hakkinda" sorusunu yanitlamak.
        """
        return (
            f"{BEATS[beat]} Sahnenin merkezinde {{actor.{slot}.name}} var ve "
            f"olay {category} dunyasinda geciyor."
        )
