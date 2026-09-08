# -*- coding: utf-8 -*-
"""SAGLAYICI PORTU -- hat hangi modeli kullandigini bilmez.

Gemini bugun, baska bir model yarin, hicbiri (elle yazim) bugun de mumkun.
Ucu de ayni arayuzu doldurur; `cli.py` tek satir degismez.

Anahtar YALNIZCA ortam degiskeninden okunur. Hicbir saglayici anahtari
dosyaya, log'a ya da uretilen JSON'a yazmaz.
"""
from __future__ import annotations

import os
from abc import ABC, abstractmethod


class ProviderError(RuntimeError):
    """Saglayici cagrisi basarisiz -- anahtar yok, kota doldu, ag hatasi."""


class Provider(ABC):
    """Bir prompt alir, metin dondurur. Fazlasi degil."""

    name: str = "base"

    @abstractmethod
    def generate(self, prompt: str) -> str:
        """Prompt'u modele gonderir ve ham metni dondurur."""

    @property
    def available(self) -> bool:
        return True


class NullProvider(Provider):
    """Model yok. Prompt'u diske yazar, uretimi insana birakir.

    LLM erisimi olmadan da hattin geri kalani calisir: planlayici brief uretir,
    prompt dosyasi olusur, insan (ya da baska bir arac) doldurur, `ingest`
    komutu kapiya sokar. Hattin hicbir parcasi modele BAGIMLI degildir.
    """

    name = "null"

    def generate(self, prompt: str) -> str:
        raise ProviderError(
            "Model saglayicisi yok. `--provider=gemini` verin ya da uretilen "
            "prompt dosyalarini elle doldurup `ingest` komutunu kullanin."
        )

    @property
    def available(self) -> bool:
        return False


def env_key(name: str) -> str | None:
    """Ortam degiskenini okur; bos string'i de yok sayar."""
    value = os.environ.get(name, "").strip()
    return value or None


def load_dotenv(path) -> None:
    """`.env` dosyasini ortama yukler -- yalnizca eksik anahtarlari.

    Zaten tanimli bir degiskeni EZMEZ: CI'da ortamdan gelen anahtar, yerel
    `.env`ten daha onceliklidir.
    """
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value and not os.environ.get(key):
            os.environ[key] = value
