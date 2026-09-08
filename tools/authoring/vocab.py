# -*- coding: utf-8 -*-
"""PROJE SOZLUGU -- eksen degerleri, slotlar ve flag'ler tek kaynaktan okunur.

Bu dosya hicbir sabit LISTE tutmaz. Eksenler `src/domain/axes.ts`ten, slotlar
`content/orchestrator/roles.json`dan, flag'ler `core.json`dan okunur. Boylece
motora yeni bir hayat durumu ya da slot eklendiginde yazim hatti kendiliginden
ogrenir; ikinci bir listeyi guncellemeyi unutmak diye bir hata olusamaz.

Okuma basarisiz olursa SESSIZCE bos donmez, hata firlatir: eksik sozlukle
uretilen brief yanlis kapilama uretir ve bunu ancak validator yakalar.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path


class VocabError(RuntimeError):
    """Proje sozlugu okunamadi -- yol yanlis ya da kaynak dosya degismis."""


def _read_const_array(source: str, name: str) -> tuple[str, ...]:
    """`export const NAME = ['a', 'b'] as const;` bicimindeki diziyi okur."""
    match = re.search(
        rf"export const {name}\s*=\s*\[(.*?)\]\s*as const", source, re.DOTALL
    )
    if not match:
        raise VocabError(f"axes.ts icinde {name} bulunamadi")
    values = re.findall(r"'([a-z_]+)'", match.group(1))
    if not values:
        raise VocabError(f"{name} bos okundu")
    return tuple(values)


@dataclass(frozen=True)
class Slot:
    """roles.json'daki bir NPC slotu."""

    id: str
    scope: str
    label: str
    life_states: tuple[str, ...]

    @property
    def relation_flag(self) -> str:
        return f"iliski_{self.id}"

    @property
    def arc_flag(self) -> str:
        return f"npc_{self.id}_arc"


@dataclass(frozen=True)
class Vocabulary:
    """Yazim hattinin bildigi her sey. Hepsi projeden okundu, hicbiri uydurulmadi."""

    eras: tuple[str, ...]
    statures: tuple[str, ...]
    club_tiers: tuple[str, ...]
    life_states: tuple[str, ...]
    media_eras: tuple[str, ...]
    archetypes: tuple[str, ...]
    tiers: tuple[str, ...]
    slots: tuple[Slot, ...]
    memory_flags: tuple[str, ...]
    stat_flags: tuple[str, ...]
    pressure_flags: tuple[str, ...]
    resource_flags: tuple[str, ...]
    incident_flags: tuple[str, ...]
    categories: tuple[str, ...]

    def slot(self, slot_id: str) -> Slot:
        for s in self.slots:
            if s.id == slot_id:
                return s
        raise VocabError(f"Tanimsiz slot: {slot_id}")

    def slots_for(self, life_state: str) -> tuple[Slot, ...]:
        """O hayat durumunda sahneye cikabilen slotlar.

        `lifeStates` bos olan slot her durumda gecerlidir; hapishane slotlari
        yalnizca `incarcerated`ta cikar.
        """
        return tuple(
            s for s in self.slots if not s.life_states or life_state in s.life_states
        )

    def writable_flags(self) -> tuple[str, ...]:
        """Icerigin yazmasina izin verilen flag'ler.

        `derived` ve `match` turleri DISARIDA: onlari motor ve host uretir,
        icerik yalnizca okur. `ReadOnlyFlagRule` bunu zaten reddeder; hatta
        dusmeden once brief'te engellemek daha ucuz.
        """
        return (
            self.stat_flags
            + self.pressure_flags
            + self.resource_flags
            + self.memory_flags
        )


# Icerik klasoru altinda gecerli kategoriler. Klasor adiyla `category` alaninin
# ayni olmasi ContentLoader tarafindan zorunlu tutuluyor.
CATEGORIES = (
    "match",
    "reaction",
    "legal",
    "life",
    "media",
    "rival",
    "dark",
    "locker",
    "personal",
    "mind",
    "money",
    "transfer",
    "fandom",
    "business",
    "national",
    "tactics",
    "social",
    "sponsor",
    "ritual",
    "legacy",
)


def load(project_root: Path) -> Vocabulary:
    """Projeyi okuyup sozlugu kurar."""
    axes_path = project_root / "src" / "domain" / "axes.ts"
    if not axes_path.exists():
        raise VocabError(f"axes.ts bulunamadi: {axes_path}")
    axes = axes_path.read_text(encoding="utf-8")

    roles_path = project_root / "content" / "orchestrator" / "roles.json"
    roles = json.loads(roles_path.read_text(encoding="utf-8"))
    slots = tuple(
        Slot(
            id=s["id"],
            scope=s.get("scope", "career"),
            label=s.get("label", s["id"]),
            life_states=tuple(s.get("lifeStates", ()) or ()),
        )
        for s in roles.get("slots", [])
    )
    if not slots:
        raise VocabError("roles.json icinde slot yok")

    core_path = project_root / "content" / "orchestrator" / "core.json"
    core = json.loads(core_path.read_text(encoding="utf-8"))

    def by_kind(kind: str) -> tuple[str, ...]:
        return tuple(f["key"] for f in core.get("flags", []) if f.get("kind") == kind)

    return Vocabulary(
        eras=_read_const_array(axes, "ERAS"),
        statures=_read_const_array(axes, "STATURES"),
        club_tiers=_read_const_array(axes, "CLUB_TIERS"),
        life_states=_read_const_array(axes, "LIFE_STATES"),
        media_eras=_read_const_array(axes, "MEDIA_ERAS"),
        archetypes=_read_const_array(axes, "ARCHETYPES"),
        tiers=_read_const_array(axes, "TIERS"),
        slots=slots,
        memory_flags=by_kind("memory"),
        stat_flags=by_kind("stat"),
        pressure_flags=by_kind("pressure"),
        resource_flags=by_kind("resource"),
        incident_flags=by_kind("incident"),
        categories=CATEGORIES,
    )
