# -*- coding: utf-8 -*-
"""ZINCIR BESTECISI -- kelebek etkisinin uretildigi yer.

Tek tek olay planlamak yeterli degil. Bir karar ancak YILLAR SONRA geri
donduginde agirlik kazanir; bunun icin tohumu ve odemeleri BIRLIKTE planlamak
gerekir.

Besteci bunu garanti eder:
  - tohum bir `mem_*` izi yazar
  - her odeme o izi `turnsSince` ile okur
  - odemeler zaman icinde dagitilir (ay, yil, uc yil)
  - odemelerden biri medya cagina duyarlidir: ayni iz, farkli cagda farkli sahne

Sonuc: `OrphanMemoryFlagRule` yapisal olarak saglanir. Olaylar tek tek
planlansaydi yazilan izin okunmasi ancak sansa kalirdi.
"""
from __future__ import annotations

import random

from .brief import ArcBrief, BEATS, Brief, ChoiceSpec, GatingCell
from .ledger import SceneLedger
from .planner import PROFILES, Planner
from .vocab import Vocabulary

# Odeme mesafeleri (tur = hafta; 40 tur = 1 sezon).
# Uc farkli olcek: ayni sezon icinde, bir yil sonra, uc yil sonra.
HORIZONS: tuple[tuple[str, int, int], ...] = (
    ("yakin", 20, 30),     # ~yarim sezon
    ("orta", 40, 60),      # ~bir yil
    ("uzak", 110, 140),    # ~uc yil
)

# Tohumdan odemeye giden duygusal yol. Ayni beat iki kez kullanilmaz:
# bir kararin uc farkli bedeli, uc farkli duygu tasimalidir.
PAYOFF_BEATS: dict[str, tuple[str, ...]] = {
    "ayartma": ("borc", "yuzlesme", "suc_ortakligi"),
    "borc": ("yuzlesme", "kirilma", "ihanet"),
    "suc_ortakligi": ("yuzlesme", "itiraf", "kirilma"),
    "ihanet": ("yuzlesme", "geri_donus", "kayip"),
    "itiraf": ("taninma", "reddedilis", "geri_donus"),
    "kirilma": ("itiraf", "geri_donus", "devir_teslim"),
    "sadakat_sinavi": ("ihanet", "geri_donus", "zafer_bedeli"),
    "terk_edilis": ("geri_donus", "kayip", "yuzlesme"),
    "maske_dusmesi": ("yuzlesme", "reddedilis", "itiraf"),
    "golge": ("yuzlesme", "taninma", "devir_teslim"),
    "sinav": ("zafer_bedeli", "kirilma", "taninma"),
    "kayip": ("geri_donus", "kirilma", "devir_teslim"),
    "taninma": ("zafer_bedeli", "golge", "reddedilis"),
    "reddedilis": ("geri_donus", "yuzlesme", "kirilma"),
    "zafer_bedeli": ("kayip", "kirilma", "yuzlesme"),
    "geri_donus": ("yuzlesme", "taninma", "devir_teslim"),
    "devir_teslim": ("taninma", "kayip", "zafer_bedeli"),
    "suc_ortakligi_alt": ("itiraf", "yuzlesme", "kirilma"),
}

# Odemenin gectigi kategori tohumdan FARKLI olabilir -- olmali da. Sahada
# verilen bir karar medyada, mahkemede ya da evde odenir.
#
# `life` bu projede ozel: hapis ve rehab demek. Oraya yalnizca gercekten
# oraya goturebilecek tohumlar yonlendirilir; her zincirin sonunu hapiste
# bitirmek hem inandirici degil hem de kapilama yuzunden gorunmez olur.
PAYOFF_CATEGORY: dict[str, tuple[str, ...]] = {
    "dark": ("legal", "media", "dark", "life"),
    # Gizlenen sakatlik ve performans artirici, uzun vadede tibbi degil HUKUKI
    # bir fatura keser: yasakli madde sorusturmasi. `legal` bu yuzden havuzda.
    "mind": ("mind", "media", "personal", "legal"),
    "personal": ("personal", "mind", "media"),
    "locker": ("locker", "media", "transfer"),
    "money": ("money", "legal", "business"),
    "transfer": ("transfer", "fandom", "locker"),
    "fandom": ("media", "fandom", "locker"),
    "business": ("business", "legal", "money"),
    "media": ("media", "fandom", "legal"),
    "legal": ("legal", "media", "life"),
    "life": ("life", "personal", "mind"),
}


class ArcError(RuntimeError):
    pass


class ArcComposer:
    """Tohum + odemeleri tek parca planlar."""

    def __init__(self, vocab: Vocabulary, ledger: SceneLedger, seed: int = 0) -> None:
        self.vocab = vocab
        self.ledger = ledger
        self.rng = random.Random(seed)
        self.planner = Planner(vocab, ledger, seed=seed)

    def compose(self, category: str, payoffs: int = 3) -> ArcBrief:
        """Bir zincir kurar: 1 tohum + `payoffs` odeme."""
        seed_brief = self._seed(category)
        memory = seed_brief.writes_memory[0]

        chain_id = f"arc_{seed_brief.primary_slot}_{seed_brief.beat}"
        seed_brief.chain_role = "seed"
        seed_brief.chain_id = chain_id

        beats = list(PAYOFF_BEATS.get(seed_brief.beat, ("yuzlesme", "kirilma", "kayip")))
        self.rng.shuffle(beats)

        count = min(payoffs, len(HORIZONS))
        out: list[Brief] = []
        # Her odeme bir oncekinin izini de okur; zincir kendi uzerine kapanir.
        # Son halka YENI iz birakmaz -- birakirsa onu okuyacak kimse kalmaz.
        previous: str | None = None

        for i in range(count):
            horizon_name, low, high = HORIZONS[i]
            terminal = i == count - 1
            brief = self._payoff(
                seed_brief,
                memory=memory,
                previous=previous,
                beat=beats[i % len(beats)],
                delay=self.rng.randint(low, high),
                horizon=horizon_name,
                chain_id=chain_id,
                terminal=terminal,
            )
            previous = brief.writes_memory[0] if brief.writes_memory else previous
            out.append(brief)

        arc = ArcBrief(
            chain_id=chain_id,
            title=f"{seed_brief.primary_slot} / {seed_brief.beat}",
            seed=seed_brief,
            payoffs=tuple(out),
        )
        if not arc.is_closed():
            # Bu bir programlama hatasidir, icerik hatasi degil: bestecinin
            # tek isi zinciri kapatmak. Sessizce gecerse kelebek etkisi
            # yerine yetim flag uretiriz.
            raise ArcError(f"Zincir kapanmadi, okunmayan iz: {sorted(arc.orphans())}")
        return arc

    # ------------------------------------------------------------ parcalar

    def _seed(self, category: str) -> Brief:
        briefs = self.planner.plan(1, category=category)
        return briefs[0]

    def _payoff(
        self,
        seed: Brief,
        memory: str,
        previous: str | None,
        beat: str,
        delay: int,
        horizon: str,
        chain_id: str,
        terminal: bool,
    ) -> Brief:
        """Bir odeme brief'i.

        Kapilama tohumdan ILERI kayar: uc yil sonraki odeme, tohumun gectigi
        evrede degil bir sonrakinde gecer. Aksi halde "uc yil sonra" cumlesi
        yalan olur.
        """
        category = self.rng.choice(PAYOFF_CATEGORY.get(seed.category, (seed.category,)))
        profile = PROFILES.get(category, PROFILES[seed.category])

        slot = self._payoff_slot(profile, seed)
        cell = self._reconcile(self._shift_cell(seed.cell, horizon), profile, slot)

        reads = (memory,) if previous is None else (memory, previous)
        writes = () if terminal else (f"{memory}_{horizon}",)

        return Brief(
            event_id=f"evt_{category}_{slot}_{beat}_{horizon}",
            category=category,
            family=f"fam_{chain_id}",
            tier="epic" if horizon == "uzak" else "major",
            beat=beat,
            primary_slot=slot,
            cell=cell,
            reads_memory=reads,
            writes_memory=writes,
            consequence_hint="memory" if writes else "life_state",
            chain_role="payoff",
            chain_id=chain_id,
            delay_turns=delay,
            supporting_slots=(seed.primary_slot,),
            choices=self._payoff_choices(slot, horizon),
            premise=self._payoff_premise(beat, delay, memory, previous, terminal),
            weight=40,
            once=True,
            cooldown_self=200,
            cooldown_family=40,
        )

    def _payoff_premise(
        self, beat: str, delay: int, memory: str, previous: str | None, terminal: bool
    ) -> str:
        """Yazara sahnenin BIR ODEME oldugunu ve neyin odendigini soyler.

        Yazar bunu bilmezse sahne bagimsiz bir olay gibi yazilir ve kelebek
        etkisi kaybolur: oyuncu "bu nereden cikti" der, "ah, o karar" demez.
        """
        head = (
            f"{BEATS[beat]} Bu sahne bir ODEMEDIR: oyuncu yaklasik {delay} hafta once "
            f"bir karar verdi ({memory}) ve fatura simdi geliyor. Sahne o karari "
            f"acikca anmali -- oyuncu bagi kurabilmeli."
        )
        if previous:
            head += f" Aradaki halka da ({previous}) yasandi; sahne onun uzerine biner."
        if terminal:
            head += (
                " Zincirin SON halkasi: yeni bir gizli iz birakma. Sonuc kalici bir "
                "durum degisimi olsun (hayat durumu, NPC yayinin kapanmasi)."
            )
        return head

    def _payoff_slot(self, profile: dict, seed: Brief) -> str:
        """Odemeyi kim getiriyor.

        Bazen tohumdaki kisinin KENDISI (borcunu tahsile gelir), bazen bambaska
        biri (gazeteci olayi ortaya cikarir). Ikisi de mesru; her odemeyi ayni
        kisiye baglamak zinciri tahmin edilebilir yapar.
        """
        if self.rng.random() < 0.35:
            return seed.primary_slot
        pool = [
            s for s in profile["slots"]
            if s != seed.primary_slot and any(v.id == s for v in self.vocab.slots)
        ]
        return self.rng.choice(pool) if pool else seed.primary_slot

    def _reconcile(self, cell: GatingCell, profile: dict, slot: str) -> GatingCell:
        """Hucreyi odemenin gectigi kategoriyle uzlastirir.

        Kategori ile hayat durumu celisirse sahne ya hic cikmaz ya da sacma
        olur: hapishane kategorisindeki bir sahne `lifeState: playing` ile
        kapilanamaz. Kategori kazanir -- odeme oraya bilerek yonlendirildi.
        """
        allowed = tuple(s for s in profile["life_states"] if s in self.vocab.life_states)
        if not allowed:
            return cell

        slot_states = self.vocab.slot(slot).life_states
        if slot_states:
            # Duruma bagli slot (gardiyan, hucre arkadasi) kendi durumunu
            # DAYATIR; onunla tartisilmaz.
            return GatingCell(
                era=cell.era,
                stature=cell.stature,
                club_tier=cell.club_tier,
                life_state=slot_states,
            )

        if set(cell.life_state) & set(allowed):
            return cell
        return GatingCell(
            era=cell.era,
            stature=cell.stature,
            club_tier=cell.club_tier,
            life_state=(self.rng.choice(allowed),),
        )

    def _shift_cell(self, cell: GatingCell, horizon: str) -> GatingCell:
        """Kapilamayi zaman ufkuna gore ileri kaydirir."""
        steps = {"yakin": 0, "orta": 1, "uzak": 2}[horizon]
        if steps == 0:
            return cell

        eras = self.vocab.eras
        if cell.era:
            last = max(eras.index(e) for e in cell.era)
            # Ufuk kadar ilerler: bir yillik odeme ile uc yillik odeme ayni
            # evrede gecerse "uc yil sonra" cumlesi anlamini kaybeder.
            start = min(last + steps, len(eras) - 1)
            shifted = eras[start : start + 2] or (eras[-1],)
        else:
            shifted = ()

        # Sohret de yukselir: uc yil sonra ayni bandda olmak beklenmez.
        statures = self.vocab.statures
        if cell.stature:
            last_s = max(statures.index(s) for s in cell.stature)
            start_s = min(last_s + steps, len(statures) - 1)
            shifted_stature = statures[max(0, start_s - 1) : start_s + 2]
        else:
            shifted_stature = ()

        return GatingCell(
            era=tuple(shifted),
            stature=tuple(shifted_stature),
            club_tier=cell.club_tier,
            life_state=cell.life_state,
        )

    def _payoff_choices(self, slot: str, horizon: str) -> tuple[ChoiceSpec, ...]:
        base = [
            ChoiceSpec(
                kind="safe",
                gains=("medya_itibari", "profesyonellik"),
                costs=("moral", "servet"),
                note="Faturayi kabul et ve ode.",
            ),
            ChoiceSpec(
                kind="risky",
                gains=("sokak_itibari", "taraftar_destegi"),
                costs=("medya_baskisi", "skandal_seviyesi"),
                note="Inkar et; bedeli buyuyerek geri gelsin.",
            ),
            ChoiceSpec(
                kind="grey",
                gains=("servet", f"iliski_{slot}"),
                costs=("moral", "medya_itibari"),
                note="Isi kapatmak icin baska bir borc al.",
            ),
        ]
        if horizon == "uzak":
            base.append(
                ChoiceSpec(
                    kind="past",
                    gains=("mental_dayaniklilik", "medya_itibari"),
                    costs=("moral", "iliski_" + slot),
                    note="Gecmisi acikca anlat; kimse bunu beklemiyordu.",
                )
            )
        return tuple(base)
