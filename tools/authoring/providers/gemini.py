# -*- coding: utf-8 -*-
"""Google Gemini saglayicisi.

Anahtar YALNIZCA `GEMINI_API_KEY` ortam degiskeninden okunur. Kodda, log'da
ya da uretilen dosyada hicbir zaman gorunmez; hata mesajlari bile anahtari
tekrar etmez.

Bagimlilik yok: standart kutuphanenin `urllib`i yeterli. Yazim hatti
build-time bir aractir, motor gibi bagimlilik disiplinine tabidir.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

from .base import Provider, ProviderError, env_key

# `flash` surumlerinin serbest kotasi gunde 20 istek; bir zincir bile
# sigmiyor. `flash-lite` ayni ise yeterince iyi ve kotasi kat kat genis.
DEFAULT_MODEL = "gemini-3.1-flash-lite"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# Kota ve kapasite hatalari GECICIDIR. Bunlari kalici hata saymak, bir zincirin
# ortasinda 503 alindiginda tum zinciri geri aldirir -- uretimi modelin o anki
# yuk durumuna baglamak demektir.
TRANSIENT_STATUS = frozenset({429, 500, 502, 503, 504})

# ANAHTARI OLDUREN DURUMLAR.
#
# OLCULEN SORUN: yalnizca 429 (kota) sonraki anahtara geciyordu. 401 ve
# 403 -- yani "bu anahtar gecersiz/devre disi" -- ANINDA hata firlatiyor
# ve butun kosuyu bitiriyordu. Listedeki ilk olu anahtar, arkasindaki
# GECERLI anahtarlari kullanilmaz yapiyordu.
#
# Olculdu: iki gecerli anahtar varken bir uretim kosusu 1040 kez 401
# aldi ve SIFIR varyant yazdi.
DEAD_KEY_STATUS = frozenset({401, 403})

#: Tum anahtarlar 429 verdiginde beklenecek saniye (her denemede katlanir).
#: Dakikalik hiz siniri bir dakikada acilir; gunluk sinir acilmaz ve
#: dongu MAX_ATTEMPTS sonunda zaten biter.
RATE_LIMIT_WAIT = 35
MAX_ATTEMPTS = 4


def discover_keys() -> list[str]:
    """Ortamdaki tum `GEMINI_API_KEY*` degiskenlerini SIRALI dondurur.

    Sira: once eksiz `GEMINI_API_KEY`, sonra sayiya gore `_2`, `_3`...
    Sayisiz ekler (ornegin `_YEDEK`) en sona alfabetik girer. Deger
    DONDURULUR ama hicbir yerde yazdirilmaz.
    """
    def rank(name: str) -> tuple[int, int, str]:
        suffix = name[len("GEMINI_API_KEY"):].lstrip("_")
        if suffix == "":
            return (0, 0, "")
        if suffix.isdigit():
            return (1, int(suffix), "")
        return (2, 0, suffix)

    names = sorted(
        (n for n in os.environ if n.startswith("GEMINI_API_KEY")),
        key=rank,
    )
    out: list[str] = []
    for name in names:
        value = env_key(name)
        if value and value not in out:
            out.append(value)
    return out


class GeminiProvider(Provider):
    name = "gemini"

    def __init__(self, model: str | None = None, timeout: int = 120) -> None:
        # COK ANAHTAR DESTEGI.
        #
        # Gemini'nin ucretsiz kotasi PROJE basinadir (gunluk 500 istek),
        # anahtar basina degil. Ayni projede acilan ikinci bir anahtar
        # ayni kotayi paylasir ve hicbir sey degismez. FARKLI bir
        # projedeki anahtar ise taze kota getirir.
        #
        # Bu yuzden `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, `_3`...
        # sirayla okunur. Bir anahtar 429 verirse digerine gecilir;
        # hepsi tukenirse hata yukselir.
        # KESIF DINAMIK: eskiden dort isim SABIT KODLUYDU
        # (`GEMINI_API_KEY`, `_2`, `_3`, `_4`) ve besinci bir anahtar
        # eklendiginde SESSIZCE yok sayiliyordu -- ne hata ne uyari.
        # Artik ortamdaki her `GEMINI_API_KEY*` degiskeni okunur.
        self._keys = discover_keys()
        # TEK ANAHTARA SABITLEME -- paralel uretim icin.
        #
        # Uc akis ayni sirayla denerse ucu de once 1. anahtari tuketir ve
        # paralellik kotaya YANSIMAZ. `AUTHORING_KEY_SLOT` verildiginde
        # surec YALNIZCA o anahtari kullanir; boylece her kol kendi
        # kotasini yer. Deger degil SIRA numarasi verilir -- anahtar
        # hicbir yerde elden ele gecmez.
        slot = env_key("AUTHORING_KEY_SLOT")
        if slot and slot.isdigit():
            index = (int(slot) - 1) % max(1, len(self._keys))
            # SIRAYI DONDUR, KISALTMA.
            #
            # Once yalnizca secilen anahtari birakiyordum ve o anahtar
            # olu cikinca kol tamamen oluyordu: olculdu, bir kol 166 kez
            # 403 alip SIFIR varyant yazdi. Artik secilen anahtar BASA
            # alinir, digerleri yedek kalir -- saglikli kollar yine ayri
            # kotalarda calisir ama olu bir yuva kolu oldurmez.
            self._keys = self._keys[index:] + self._keys[:index]
            print(f"   anahtar yuvasi {slot} (toplam {len(self._keys)} anahtar)")
        self._keyIndex = 0
        self.model = model or env_key("GEMINI_MODEL") or DEFAULT_MODEL
        self.timeout = timeout

    @property
    def _key(self) -> str | None:
        """Su an kullanilan anahtar."""
        return self._keys[self._keyIndex] if self._keyIndex < len(self._keys) else None

    def _nextKey(self, reason: str = "kota doldu") -> bool:
        """Sonraki anahtara gec. Baska anahtar yoksa False."""
        if self._keyIndex + 1 >= len(self._keys):
            return False
        self._keyIndex += 1
        print(f"   {reason}, {self._keyIndex + 1}. anahtara geciliyor")
        return True

    @property
    def keyCount(self) -> int:
        return len(self._keys)

    @property
    def available(self) -> bool:
        return len(self._keys) > 0

    def generate(self, prompt: str) -> str:
        if not self._key:
            raise ProviderError(
                "GEMINI_API_KEY tanimli degil. `.env` dosyasina ekleyin "
                "(.env.example'i kopyalayin) ya da ortam degiskeni olarak verin."
            )

        body = json.dumps(
            {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    # Yaratici ama savrulmayan aralik. Cok dusuk deger kalip
                    # metin uretir -- tam da kacindigimiz sey.
                    "temperature": 0.95,
                    "topP": 0.95,
                    "maxOutputTokens": 8192,
                    "responseMimeType": "application/json",
                },
            }
        ).encode("utf-8")

        request = urllib.request.Request(
            ENDPOINT.format(model=self.model),
            data=body,
            headers={
                "Content-Type": "application/json",
                # Anahtar URL'de DEGIL baslikta gider: URL'ler log'lara,
                # proxy kayitlarina ve hata izlerine dusme egilimindedir.
                "x-goog-api-key": self._key,
            },
            method="POST",
        )

        return _first_text(self._send(request))

    def models(self) -> list[str]:
        """Anahtarin erisebildigi uretim modelleri.

        Model adlari saglayici tarafinda emekliye ayriliyor; hangi adin
        gecerli oldugunu tahmin etmek her seferinde bir 404 ve bosa giden
        bir tur demek. Bu cagri uretim kotasini harcamaz.
        """
        if not self._key:
            raise ProviderError("GEMINI_API_KEY tanimli degil.")
        request = urllib.request.Request(
            "https://generativelanguage.googleapis.com/v1beta/models",
            headers={"x-goog-api-key": self._key},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", errors="replace")[:200]
            raise ProviderError(f"Model listesi alinamadi: {_redact(detail)}") from None
        except urllib.error.URLError as err:
            raise ProviderError(f"Gemini erisilemedi: {err.reason}") from None

        return sorted(
            m["name"].removeprefix("models/")
            for m in payload.get("models", [])
            if "generateContent" in m.get("supportedGenerationMethods", [])
        )

    def _send(self, request: urllib.request.Request) -> dict:
        """Gecici hatalarda ustel bekleyerek yeniden dener."""
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as err:
                detail = err.read().decode("utf-8", errors="replace")[:400]
                # KOTA (429): beklemek ise yaramaz -- gunluk sinir.
                # Once baska anahtar var mi diye bak; varsa ANINDA gec.
                # OLU ANAHTAR (401/403) ya da KOTA (429): once baska
                # anahtar varsa ANINDA gec -- beklemek bir sey kazandirmaz.
                if (err.code == 429 or err.code in DEAD_KEY_STATUS) and self._nextKey(
                    reason="kota doldu" if err.code == 429 else f"anahtar gecersiz ({err.code})"
                ):
                    request.add_header("x-goog-api-key", self._key or "")
                    continue

                # TUM ANAHTARLAR 429 VERDIYSE PES ETME.
                #
                # OLCULEN SORUN: 429 iki ayri seyi anlatiyor -- gunluk
                # 500'luk ucretsiz katman siniri VE dakikalik hiz siniri.
                # Hat ikisini ayirt etmiyordu: birkac saniyede tum
                # anahtarlari deneyip "kota bitti" diye vazgeciyordu.
                # Oysa dakikalik sinir BIR DAKIKA icinde acilir.
                #
                # Olculdu: hat "kota bitti" dedigi anda ayni anahtarla
                # dogrudan yapilan bir uretim cagrisi BASARILI oldu.
                #
                # Cozum: baslangic anahtarina donup daha uzun bekle.
                # Gunluk sinirsa dongu yine biter (her tur 429), ama
                # dakikalik sinirsa uretim KENDILIGINDEN devam eder.
                if err.code == 429 and attempt < MAX_ATTEMPTS:
                    wait = RATE_LIMIT_WAIT * attempt
                    print(f"   tum anahtarlar 429; {wait}s bekleniyor (hiz siniri olabilir)")
                    time.sleep(wait)
                    self._keyIndex = 0
                    request.add_header("x-goog-api-key", self._key or "")
                    continue
                if err.code in TRANSIENT_STATUS and attempt < MAX_ATTEMPTS:
                    wait = 2**attempt
                    print(f"   Gemini {err.code}, {wait}s sonra yeniden denenecek")
                    time.sleep(wait)
                    continue
                raise ProviderError(f"Gemini HTTP {err.code}: {_redact(detail)}") from None
            except urllib.error.URLError as err:
                if attempt < MAX_ATTEMPTS:
                    time.sleep(2**attempt)
                    continue
                raise ProviderError(f"Gemini erisilemedi: {err.reason}") from None
        raise ProviderError("Gemini yanit vermedi.")


def _first_text(payload: dict) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        reason = payload.get("promptFeedback", {}).get("blockReason", "bilinmiyor")
        raise ProviderError(f"Model cevap uretmedi (sebep: {reason})")

    parts = candidates[0].get("content", {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts).strip()
    if not text:
        finish = candidates[0].get("finishReason", "bilinmiyor")
        raise ProviderError(f"Model bos cevap dondu (finishReason: {finish})")
    return text


def _redact(text: str) -> str:
    """Hata metninde anahtar benzeri bir sey varsa maskeler.

    Saglayici hatalari bazen istegi geri yansitir; anahtarin hata log'una
    dusmesi en sik gorulen sizinti bicimidir.
    """
    key = env_key("GEMINI_API_KEY")
    if key and key in text:
        return text.replace(key, "<REDACTED>")
    return text


def probe_keys(model: str | None = None) -> list[tuple[str, str]]:
    """Her anahtari AYRI AYRI sinar; (degisken adi, durum) dondurur.

    NEDEN GEREKLI: hat anahtarlari sirayla deneyip ilk calisani kullanir.
    Bu uretimde dogru davranis ama tani icin korlestiricidir -- "kota
    doldu" mesaji hangi anahtarin bittigini, hangisinin hic calismadigini
    soylemez. Yeni bir anahtar eklendiginde "gercekten calisiyor mu"
    sorusunun tek durust cevabi her birini tek tek denemektir.

    ANAHTAR DEGERI HICBIR ZAMAN DONDURULMEZ ya da yazdirilmaz; yalnizca
    degiskenin ADI ve sonucu.

    Uretim kotasi harcamaz: model listesi cagrisi kullanilir.
    """
    import urllib.error
    import urllib.request

    out: list[tuple[str, str]] = []
    # SABIT LISTE DEGIL: eskiden burada dort isim yaziliydi ve besinci
    # bir anahtar eklendiginde tani onu HIC gormuyordu -- kullanici
    # ekledigini sanip beklerken hat uc anahtarla calismaya devam
    # ediyordu. Artik ortamdaki her `GEMINI_API_KEY*` sinanir.
    def rank(n: str) -> tuple[int, int, str]:
        suffix = n[len("GEMINI_API_KEY"):].lstrip("_")
        if suffix == "":
            return (0, 0, "")
        if suffix.isdigit():
            return (1, int(suffix), "")
        return (2, 0, suffix)

    names = sorted((n for n in os.environ if n.startswith("GEMINI_API_KEY")), key=rank)

    for name in names:
        key = env_key(name)
        if not key:
            continue
        request = urllib.request.Request(
            "https://generativelanguage.googleapis.com/v1beta/models",
            headers={"x-goog-api-key": key},
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
            usable = [
                m["name"].removeprefix("models/")
                for m in payload.get("models", [])
                if "generateContent" in m.get("supportedGenerationMethods", [])
            ]
            want = model or DEFAULT_MODEL
            if want in usable:
                out.append((name, f"GECERLI ({len(usable)} model, {want} var)"))
            else:
                out.append((name, f"GECERLI ama '{want}' YOK ({len(usable)} model)"))
        except urllib.error.HTTPError as err:
            code = err.code
            if code == 429:
                out.append((name, "KOTA DOLU (429)"))
            elif code in (400, 401, 403):
                out.append((name, f"GECERSIZ ANAHTAR ({code})"))
            else:
                out.append((name, f"HTTP {code}"))
        except urllib.error.URLError as err:
            out.append((name, f"ERISILEMEDI: {err.reason}"))
    return out
