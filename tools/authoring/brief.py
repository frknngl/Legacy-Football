# -*- coding: utf-8 -*-
"""BRIEF -- bir sahnenin YAPISI.

Brief prozayi icermez; sahnenin iskeletini ve sozlesmesini tasir: kim sahnede,
hangi kariyer hucresinde geciyor, hangi izi birakiyor, hangi izi okuyor, kac
secenek, kac kelime.

Ayrim bilinclidir. Yapi PROSEDUREL uretilebilir cunku kombinasyonu denetlenebilir;
proza uretilemez cunku kombinasyonu jenerik okunur. Bu yuzden brief'i planlayici
uretir, prozayi yazar (ya da LLM) yazar, validator ikisini birden denetler.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Literal


# --------------------------------------------------------------------------
# DUYGUSAL BEAT
#
# Sahnenin ne HAKKINDA oldugu. Iki sahne ayni slotta, ayni kariyer hucresinde
# gecebilir ama farkli beat tasiyorsa farkli hikayelerdir. Ayni beat'i tasiyorsa
# -- isimleri ne kadar degisirse degissin -- ayni sahnedir.
#
# Sahne Defteri'nin tekrari yakalamasi tam olarak buna dayanir.
# --------------------------------------------------------------------------
BEATS: dict[str, str] = {
    "ihanet": "Guvendigin biri seni satar ya da sen birini satarsin.",
    "ayartma": "Kolay yol acilir; bedeli sonra odenecek turden.",
    "borc": "Birine borclusun ve o bunu hatirlatmaya geldi.",
    "kayip": "Elinden bir sey gider ve geri gelmez.",
    "sinav": "Yetenegin degil karakterin olculur.",
    "itiraf": "Sakladigin sey artik saklanamaz hale gelir.",
    "yuzlesme": "Kacindigin kisiyle ayni odaya girersin.",
    "terk_edilis": "Yaninda olmasi gereken kisi yok.",
    "zafer_bedeli": "Kazanirsin ve kazanmak bir sey goturur.",
    "sadakat_sinavi": "Iki tarafa da bagliligin var; birini secmelisin.",
    "maske_dusmesi": "Baskalarina gosterdigin yuz catlar.",
    "devir_teslim": "Senden sonrakine bir sey birakirsin ya da birakmazsin.",
    "geri_donus": "Gecmiste biraktigin yere geri dersin.",
    "golge": "Bir baskasiyla kiyaslanirsin ve kiyas bitmez.",
    "kirilma": "Tasidiginin agirligi tasima kapasiteni asar.",
    "suc_ortakligi": "Yapmadigin bir seyin icinde bulursun kendini.",
    "taninma": "Ilk kez birisi seni gercekten gorur.",
    "reddedilis": "Istedigin kapi yuzune kapanir.",
}

ChainRole = Literal["standalone", "seed", "payoff"]


@dataclass(frozen=True)
class GatingCell:
    """Sahnenin gectigi kariyer hucresi.

    Bos birakilan eksen "hepsi" demektir; brief bunu bilinerek dar tutar.
    Cok dar kapilama iceriği olu birakir, cok genis kapilama sahneyi baglamsiz
    yapar -- ikisi de sessizce bozar.
    """

    era: tuple[str, ...] = ()
    stature: tuple[str, ...] = ()
    club_tier: tuple[str, ...] = ()
    life_state: tuple[str, ...] = ()
    media_era: tuple[str, ...] = ()
    archetype: tuple[str, ...] = ()

    def signature(self) -> tuple[str, str, str, str]:
        """Defter imzasinda kullanilan sadelestirilmis hucre.

        Medya cagi ve arketip imzaya GIRMEZ: ayni sahnenin farkli cagda farkli
        anlatilmasi mesru bir varyanttir, tekrar degildir.
        """
        return (
            ",".join(self.era) or "*",
            ",".join(self.stature) or "*",
            ",".join(self.club_tier) or "*",
            ",".join(self.life_state) or "*",
        )


@dataclass(frozen=True)
class ChoiceSpec:
    """Bir secenegin YAPISI -- metni degil, ne yapmasi gerektigi.

    `TradeoffRule` her secenekte en az bir kazanc ve bir bedel arar. Brief bunu
    yazarin insafina birakmaz, once tanimlar.
    """

    kind: Literal["safe", "risky", "locked", "grey", "past"]
    gains: tuple[str, ...]
    costs: tuple[str, ...]
    lock_flag: str | None = None
    lock_value: int | None = None
    note: str = ""


@dataclass
class Brief:
    """Tek bir olayin uretim sozlesmesi."""

    event_id: str
    category: str
    family: str
    tier: str
    beat: str
    primary_slot: str
    cell: GatingCell

    # Kelebek sozlesmesi
    writes_memory: tuple[str, ...] = ()
    # Bu olayin ACMASI gereken incident'ler. Mac anlari incident'lerin
    # kaynagidir; varyant onlari tasimazsa mac SONUCSUZ kalir ve
    # tepki/zincir sahneleri sessizce olur.
    expects_incidents: tuple[str, ...] = ()
    #: Varyantin TASIMASI ZORUNLU durum gecisleri.
    #:
    #: Kanonik bicim: "lifeState:incarcerated", "suspend:3",
    #: "clubTier:lower", "schedule:evt_x".
    #:
    #: Bir olay `lifeState` ya da `clubTier` degistiriyorsa yalnizca
    #: sahne degil bir KAPIDIR: hapisten cikis, lige donus,
    #: sakatliktan donme. Varyant o gecisi yazmazsa oyuncu kapinin
    #: arkasinda kalir -- ve bunu hicbir kural yakalamaz, cunku her
    #: iki varyant da TEK BASINA gecerlidir.
    expects_transitions: tuple[str, ...] = ()
    reads_memory: tuple[str, ...] = ()
    chain_role: ChainRole = "standalone"
    chain_id: str | None = None
    # `payoff` icin: tohumdan kac tur sonra odenecek
    delay_turns: int | None = None
    # Bu olay bitince zorunlu olarak sirada ne var
    schedules: tuple[str, ...] = ()

    choices: tuple[ChoiceSpec, ...] = ()
    # Sahnede gecen ikincil slotlar -- yazara isim vermek icin
    supporting_slots: tuple[str, ...] = ()
    # Yazara verilen tek cumlelik cekirdek fikir
    premise: str = ""

    weight: int = 20
    cooldown_self: int = 12
    cooldown_family: int = 6
    once: bool = False

    # Bu brief bir VARYANTSA hangi olayin varyanti oldugu.
    variant_of: str | None = None

    # `ConsequenceHookRule` her olayda bir sonuc arar, ama bu sonucun MUTLAKA
    # yeni bir `mem_*` olmasi gerekmez. Zincirin son halkasinda yeni iz yazmak
    # zararlidir: kimse okumaz, orphan uyarisi verir. Orada sonuc hayat
    # durumu degisimi ya da NPC yayi olur.
    consequence_hint: Literal["memory", "life_state", "npc_arc", "schedule"] = "memory"

    def signature(self) -> tuple[str, ...]:
        """SAHNE DEFTERI IMZASI.

        Iki brief ayni imzayi tasiyorsa ayni sahnedir -- metinleri ne kadar
        farkli yazilirsa yazilsin. Planlayici bu imzayi tekrar eden brief
        URETMEZ; tekrarsizlik burada, uretim aninda garanti edilir.

        Varyant bu kuralin DISINDA kalir: bagimsiz bir sahne degil, belirli bir
        olayin ikinci anlatimidir. Ayni hucrede gecen iki farkli olayin ikisi
        de ayni beat'te varyant alabilir -- cakisan sey olay degil, anlatim.
        """
        base = (self.category, self.primary_slot, self.beat) + self.cell.signature()
        return base if self.variant_of is None else (self.variant_of,) + base

    def word_budget(self) -> tuple[int, int]:
        """Tier'a gore branch node kelime araligi.

        `TierComplianceRule` ile ayni aralik. Yazara butce verilmezse epic
        sahneler kisa, beat sahneler sisirilmis cikar.
        """
        return {
            "epic": (70, 280),
            "major": (45, 220),
            "minor": (40, 180),
            "beat": (30, 150),
        }[self.tier]

    def choice_count(self) -> int:
        return len(self.choices)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ArcBrief:
    """Bir zincirin tamami: tohum + odemeler.

    Zinciri tek parca planlamak `OrphanMemoryFlagRule`u GARANTI eder: tohumun
    yazdigi her `mem_*` icin en az bir odeme onu okur. Olaylar tek tek
    planlansaydi bu ancak sansla saglanirdi.
    """

    chain_id: str
    title: str
    seed: Brief
    payoffs: tuple[Brief, ...]

    def all_briefs(self) -> tuple[Brief, ...]:
        return (self.seed,) + self.payoffs

    def written_memories(self) -> set[str]:
        """Zincirin TAMAMININ biraktigi izler -- yalnizca tohumunkiler degil.

        Odemeler de iz birakir; onlari saymamak `is_closed`i yalanci pozitif
        yapardi: tohum kapanmis gorunur, odemenin izi ortada kalirdi.
        """
        out: set[str] = set()
        for b in self.all_briefs():
            out.update(b.writes_memory)
        return out

    def read_memories(self) -> set[str]:
        out: set[str] = set()
        for b in self.all_briefs():
            out.update(b.reads_memory)
        return out

    def is_closed(self) -> bool:
        """Yazilan her iz okunuyor mu."""
        return self.written_memories().issubset(self.read_memories())

    def orphans(self) -> set[str]:
        """Kapanmamis izler -- hata mesajinda adlariyla gorunsunler."""
        return self.written_memories() - self.read_memories()
