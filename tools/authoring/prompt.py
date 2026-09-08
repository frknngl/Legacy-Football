# -*- coding: utf-8 -*-
"""BRIEF -> YAZIM PROMPTU.

Prompt iki is yapar:
  1. Sahnenin sozlesmesini (slot, kapilama, iz, secenek deseni, kelime butcesi)
     yazara/modele eksiksiz gecirir
  2. Validator'un zaten zorunlu tuttugu kurallari ONCEDEN soyler

Ikincisi kritik: kurallari yalnizca kapida uygulamak, uretimi bos yere uc kez
denetmek demektir. Kurali once soyleyip sonra denetlemek hem ucuz hem daha
iyi sonuc verir.

Prompt Turkce yazilir cunku uretilecek icerik Turkce; kurallari ingilizce
verip Turkce metin istemek modeli iki dil arasinda gezdirir ve uslup bozulur.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .brief import BEATS, Brief

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schema" / "event.schema.json"


SYSTEM = """Sen odullu bir oyun anlati tasarimcisisin. Turkce yaziyorsun.
Bir futbol kariyeri simulasyonu icin SAHNE yaziyorsun: oyuncunun karsisina
cikan, karar verdigi ve sonucunu yillarca tasidigi anlar.

Uslubun: sinematik, profesyonel, ahlaki olarak GRI. Kolay dogru cevap yok.
Kisa cumleler kullan. Sahneyi aciklamaz, GOSTERIRSIN: mekan, ses, bir bakis,
soylenmeyen sey. Melodram yok, sloganvari cumle yok.

ASLA ozel isim yazma. Kisiler yalnizca yer tutucuyla anilir:
  {actor.<slot>.name}   tam ad
  {actor.<slot>.first}  yalnizca ad
Bir yerde ozel isim yazarsan sahne REDDEDILIR."""


RULES = """KURALLAR (ihlali sahneyi reddettirir):

1. Her `branch` node en az 3, tercihen 4 secenek tasir.
2. Her secenekte EN AZ BIR KAZANC ve EN AZ BIR BEDEL olur. Bedelsiz secim
   dolgudur. "Dogru" secenek bile bir sey goturmeli.
3. En az bir secenek KOSULSUZ olmali; oyuncu hicbir secenegi acamayacak
   duruma dusmemeli.
4. Sahne kalici bir iz birakir: verilen `mem_*` flag'i yazilir.
5. Secenek metni KARAKTERIN SESIDIR, mekanik ozet degil.
   Kotu : "Parayi al (+50.000, medya -10)"
   Iyi  : "Zarfi cebine koy. Sabaha kadar acmayacaksin."
6. Kilitli secenek varsa metninde kilit yazmaz; kilit ayri alanda durur.
7. Sahne bir SORUYLA degil bir DURUMLA acilir. Oyuncuya "ne yapacaksin?"
   diye sorma; onu odaya sok, karar kendiliginden dogsun.
8. Ayni cumleyi ya da ayni kalibi baska bir sahnede kullanma.
9. FLAG ADLARI METINDE GECMEZ. `mem_...`, `iliski_...`, `persona_...` gibi
   anahtarlar motorun ic dilidir; oyuncu onlari asla gormez. Gecmis bir karara
   atif yapacaksan OLAYI anlat ("o odada yasadiklarin"), anahtari yazma.
10. Sana verilen `mem_*` izlerinin DISINDA yeni iz uydurma. Uydurdugun izi
   hicbir sahne okumaz; olu kelebek olur.
11. FLAG UYDURMA. `trigger` ve `requires` yalnizca sana verilen `mem_*`
   izlerini ya da secenek deseninde gecen flag adlarini kullanabilir.
   `career_started` gibi olmayan bir flag sahneyi reddettirir.
12. \"bir doktor\", \"bir oyuncu\", \"takim arkadasin\" gibi JENERIK kaliplar
   yasak. Sahnedeki herkes bir slot yer tutucusudur: {actor.<slot>.name}."""


# CAGIN SESI.
#
# OLCULEN SORUN: prompt cagi yalnizca LISTELIYORDU ("Kariyer evresi:
# rookie, rise"). Model bunu bir kapi olarak okuyup sahneyi yine kidemli
# agziyla yaziyordu: `evt_national_star_teammate_sadakat_sinavi` cirak
# cagina acikken hero milli takim soyunma odasina hukmediyordu ve
# `SeniorVoiceRule` onu yakaladi.
#
# Cag bir kapi degil bir SES. On alti yasindaki cocuk odaya giremez,
# kapida bekler; otuz bes yasindaki adam odanin kendisidir.
_ERA_VOICE = {
    "rookie": (
        "CIRAK (16-19). Hero burada COCUK. Odaya giremez, kapida bekler. "
        "Kimseye emir veremez, kimse ona danismaz; izler, dinler, yanlis "
        "anlar. Korkusu 'kesilmek', umudu 'bir sans'. Otoriteye (hoca, "
        "baskan, kaptan) akran gibi konusamaz. Para kucuktur, ev uzaktir, "
        "aile yakindir."
    ),
    "rise": (
        "YUKSELIS (20-23). Adi duyulmaya basladi. Artik odada ama en arkada. "
        "Ilk kez biri onu KULLANMAK istiyor: menajer, marka, eski arkadas. "
        "Kendine guveni yeni ve kirilgan; abartili tepkiler verir."
    ),
    "prime": (
        "ZIRVE (24-29). Soz sahibi. Odada konustugunda susulur. "
        "Kararlarinin bedeli baskalarina da doker. Kaybedecek seyi var."
    ),
    "veteran": (
        "TECRUBELI (30-34). Beden yavaslamis, akil hizlanmis. Gencler ona "
        "'abi' diyor. Her yeni sezon bir pazarlik. Gelecek kisaliyor."
    ),
    "twilight": (
        "ALACAKARANLIK (35+). Son perdeler. Sahada gecirdigi sure azaliyor, "
        "adi hala buyuk. Sonrasini dusunmek zorunda: ne yapacak, kim kalacak, "
        "ne hatirlanacak."
    ),
}


def _era_voice(eras) -> str:
    """Brief'in cagi icin SES talimati -- kapi degil, ton."""
    picked = [e for e in (eras or ()) if e in _ERA_VOICE]
    if not picked:
        return ""
    lines = ["", "CAGIN SESI (sahne bu tonda yazilmali):"]
    for e in picked:
        lines.append(f"  - {_ERA_VOICE[e]}")
    if len(picked) > 1:
        lines.append(
            "  Sahne bu caglarin HEPSINDE cikabilir; en GENC olanina gore "
            "yaz, yoksa cocuga kidemli replik verirsin."
        )
    return "\n".join(lines)


def _cell_lines(brief: Brief) -> str:
    c = brief.cell
    rows = [
        ("Kariyer evresi", c.era),
        ("Sohret", c.stature),
        ("Kulup seviyesi", c.club_tier),
        ("Hayat durumu", c.life_state),
    ]
    head = "\n".join(
        f"  {label:16}: {', '.join(v) if v else 'hepsi'}" for label, v in rows
    )
    return head + _era_voice(c.era)


def _choice_lines(brief: Brief) -> str:
    out = []
    labels = {
        "safe": "GUVENLI",
        "risky": "RISKLI",
        "grey": "AHLAKI GRI",
        "locked": "STAT KILITLI",
        "past": "GECMISE BAGLI",
    }
    for i, ch in enumerate(brief.choices, 1):
        lock = ""
        if ch.lock_flag:
            lock = f"  [kilit: {ch.lock_flag} >= {ch.lock_value}]"
        out.append(
            f"  {i}. {labels.get(ch.kind, ch.kind)}{lock}\n"
            f"     kazanc : {', '.join(ch.gains)}\n"
            f"     bedel  : {', '.join(ch.costs)}\n"
            f"     yon    : {ch.note}"
        )
    return "\n".join(out)


def _consequence(brief: Brief) -> str:
    """Sahnenin birakacagi kalici iz.

    `ConsequenceHookRule` sonucsuz olayi reddeder, ama sonuc her zaman yeni bir
    `mem_*` OLAMAZ: zincirin son halkasinda birakilan izi okuyacak kimse
    kalmaz. Orada bedel hayat durumunda odenir. Bunu soylemezsek model bos
    kalan alani kendi doldurur ve iki hatadan birine duser -- ya iz uydurur
    ya da hicbir sonuc birakmaz.
    """
    if brief.writes_memory:
        return (
            f"{', '.join(brief.writes_memory)}\n"
            "  Bir `outcome` node'unun `onEnter` alaninda `set` ile yazilir.\n"
            "  BASKA iz uydurma."
        )
    return (
        "YOK -- bu zincirin SON halkasi.\n"
        "  Yeni `mem_*` YAZMA; okuyacak sahne kalmadi.\n"
        "  Sonuc kalici bir DURUM degisimi olsun. En az biri gerekli:\n"
        '    { "op": "lifeState", "to": "<durum>" }\n'
        '    { "op": "suspend", "matches": <sayi>, "reason": "<sebep>" }\n'
        '    { "flag": "npc_<slot>_arc", "op": "add", "value": <sayi> }'
    )


def _shape(brief: Brief) -> str:
    """Tier'a gore beklenen node yapisi."""
    if brief.tier == "epic":
        return (
            "1 acilis `branch` + 3-4 `outcome` node (her secenegin kendi kapanisi). "
            "Istege bagli 1 `roll` node: karar oyuncunun, sonuc statin."
        )
    if brief.tier == "major":
        return "1 acilis `branch` + 3-4 `outcome` node."
    return "1 acilis `branch` + 2-3 `outcome` node. Kisa ve sert."


def _incident_lines(brief: Brief) -> list[str]:
    """Sahnenin ACMASI zorunlu olan olaylar (incident).

    NEDEN ZORUNLU:
      Mac anlari incident'lerin KAYNAGIDIR. Tepki sahneleri ve uzun
      zincirler (`inc_var_against` -> roportaj -> PFDK -> ceza) bunlarla
      tetiklenir. Olculdu: bu bolum prompt'ta YOKKEN uretilen 30 mac
      varyantinin hicbiri incident tasimadi ve motor o varyanti
      sectiginde mac SONUCSUZ kaliyordu -- zincir sessizce oluyordu.
    """
    if not brief.expects_incidents:
        return []
    listed = ", ".join(brief.expects_incidents)
    return [
        "",
        f"ACILACAK OLAYLAR (ZORUNLU): {listed}",
        "  Bu sahne bir MAC ANI. Sonuclarinin en az birinde su bicimde",
        '  bir efekt OLMALI:  {"op": "match", "incident": "<yukaridakilerden biri>"}',
        "  Hangi sonucun hangi olayi acacagini sen secersin ama HEPSI",
        "  bir yerde acilmali. Acilmazsa mac sonucsuz kalir ve o maca",
        "  bagli tepki sahneleri hic cikmaz.",
    ]


def build(brief: Brief, example: dict | None = None, avoid: list[dict] | None = None) -> str:
    """Brief'i yazim promptuna cevirir.

    `avoid`: bu olayin MEVCUT varyantlarinin ozeti. Varyant uretirken
    zorunludur.

    NEDEN: olculdu ki 271 varyant ciftinin %97'si ayni sayida secenege,
    %93'u ayni kilit desenine sahip. Sebep basitti -- model onceki
    varyantlari HIC GORMUYORDU. `example` parametresi tanimliydi ama
    hicbir yerden gecilmiyordu; modele yalnizca "ilk anlatimin kalibini
    tekrar etme" diye tek cumlelik bir rica gidiyordu. Neyin kalibi
    oldugunu bilmeden kacinmasi imkansizdi.
    """
    low, high = brief.word_budget()
    actors = [brief.primary_slot, *brief.supporting_slots]

    parts = [
        SYSTEM,
        "",
        "=" * 60,
        "SAHNE BRIEF'I",
        "=" * 60,
        "",
        f"Olay kimligi : {brief.event_id}",
        f"Kategori     : {brief.category}",
        f"Agirlik      : {brief.tier}",
        "",
        f"DUYGUSAL BEAT: {brief.beat}",
        f"  {BEATS[brief.beat]}",
        "",
        "SAHNENIN GECTIGI KARIYER HUCRESI:",
        _cell_lines(brief),
        "",
        "SAHNEDEKI KISILER (yalnizca bu slotlari kullan):",
        "\n".join(f"  {{actor.{a}.name}}" for a in actors),
        "",
        f"CEKIRDEK: {brief.premise}",
        "",
        f"YAPI: {_shape(brief)}",
        *_incident_lines(brief),
        f"ACILIS METNI: {low}-{high} kelime.",
        "",
        "SECENEK DESENI (bu deseni doldur, sirasini koruma zorunlulugun yok):",
        _choice_lines(brief),
        "",
        f"BIRAKILACAK KALICI IZ: {_consequence(brief)}",
    ]

    if brief.reads_memory:
        # Tetikleyiciyi modele YAZDIRMAK yerine hazir veriyoruz. Bu yapidir,
        # proza degil: model iki izden birini unuttugunda odeme ya hic gelmez
        # ya da yanlis kariyerde gelir, ve bunu ancak kapi yakalar.
        trigger = {
            "trigger": {
                "allOf": [
                    {"flag": m, "op": "turnsSince", "value": brief.delay_turns}
                    for m in brief.reads_memory
                ]
            }
        }
        parts += [
            "",
            "OKUNAN GECMIS IZ (bu sahne bir ODEMEDIR -- oyuncu yillar once bir "
            "karar verdi, simdi faturasi geliyor):",
            *(f"  {m}" for m in brief.reads_memory),
            f"  Aradan gecen sure: yaklasik {brief.delay_turns} hafta.",
            "  Sahne o karari ANLATARAK anmali -- anahtari yazmadan, olayi hatirlatarak.",
            "",
            "  `trigger` alanina AYNEN sunu yaz; izlerin hepsi okunmali:",
            json.dumps(trigger, ensure_ascii=False, indent=2),
        ]

    parts += ["", RULES, "", "=" * 60, "CIKTI BICIMI", "=" * 60, "", SCHEMA_HINT, _vocabulary()]

    if avoid:
        parts += [
            "",
            "=" * 60,
            "KACINILACAK -- bu olayin MEVCUT anlatimlari",
            "=" * 60,
            "",
            "Asagidakiler ayni olayin daha once yazilmis sahneleri. Yeni",
            "sahne bunlarin hicbirine BENZEMEMELI. Kelimeleri degistirmek",
            "yetmez; su dortunu degistir:",
            "  1. MEKAN     -- ayni odada gecmesin",
            "  2. NESNE     -- masadaki kagit, telefon, bardak: ayni olmasin",
            "  3. UCUNCU KISI -- sahnede baska kim var",
            "  4. SECENEKLERIN SEKLI -- ayni sayida, ayni sirada, ayni",
            "     turden secenek sunma. Bir sahnede dort secenek varsa",
            "     digerinde iki ya da bes olabilir; birinde kilit varsa",
            "     digerinde olmayabilir.",
            "",
        ]
        for i, prev in enumerate(avoid, 1):
            parts += [
                f"--- Mevcut anlatim {i}: \"{prev.get('title', '?')}\"",
                f"    Sahne: {prev.get('text', '')[:220]}",
                f"    Secenekler ({prev.get('count', 0)} tane): {prev.get('choices', '')}",
                "",
            ]

    if example:
        parts += [
            "",
            "ORNEK (yapiyi goster; metnini KOPYALAMA):",
            json.dumps(example, ensure_ascii=False, indent=2),
        ]

    parts += [
        "",
        "Yalnizca gecerli JSON dondur. Aciklama, markdown cercevesi ya da yorum ekleme.",
    ]
    return "\n".join(parts)


SCHEMA_HINT = """{
  "id": "<verilen olay kimligi>",
  "family": "<verilen aile>",
  "category": "<verilen kategori>",
  "tier": "<verilen agirlik>",
  "weight": <sayi>,
  "cooldown": { "self": <sayi>, "family": <sayi> },
  "eras": [...], "stature": [...], "clubTiers": [...], "lifeStates": [...],
  "trigger": { "flag": "...", "op": "gte", "value": 0 },
  "rootNode": "n_root",
  "nodes": {
    "n_root": {
      "title": "<kisa baslik>",
      "kind": "branch",
      "text": "<sahne metni>",
      "choices": [
        {
          "id": "c_...",
          "text": "<karakterin sesi>",
          "target": "n_...",
          "effects": [
            { "flag": "moral", "op": "add", "value": -8 },
            { "flag": "sokak_itibari", "op": "add", "value": 6 }
          ],
          "persona": { "durus": 5 },
          "requires": { "flag": "liderlik", "op": "gte", "value": 65 },
          "lockLabel": "[Liderlik 65]"
        }
      ]
    },
    "n_...": {
      "title": "...",
      "kind": "outcome",
      "text": "<kapanis>",
      "onEnter": [ { "flag": "mem_...", "op": "set", "value": true } ]
    }
  }
}

NOTLAR:
- `requires` varsa `lockLabel` ZORUNLU.
- Persona katkisi -12..12 araliginda kalir.
- Kalici iz `onEnter` icinde `set` ile yazilir."""


@lru_cache(maxsize=1)
def _schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def _vocabulary() -> str:
    """Izin verilen degerleri SEMADAN okur.

    Elle yazilmis bir liste sema degistiginde sessizce eskir; model o zaman
    gecerli GORUNEN ama kapiyi gecmeyen JSON uretir ve hata prompt'ta degil
    uretim turunda ortaya cikar.
    """
    d = _schema()["definitions"]
    rows = (
        ("node kind", d["node"]["properties"]["kind"]["enum"]),
        ("kosul op", d["condition"]["oneOf"][-1]["properties"]["op"]["enum"]),
        ("efekt op", d["effect"]["oneOf"][0]["properties"]["op"]["enum"]),
        ("persona ekseni", sorted(d["persona"]["properties"])),
        ("lifeState", d["lifeState"]["enum"]),
        ("mediaEra", d["mediaEra"]["enum"]),
    )
    lines = ["", "IZIN VERILEN DEGERLER (schema/event.schema.json'dan okundu):"]
    lines += [f"  {name:15}: {', '.join(values)}" for name, values in rows]
    return "\n".join(lines)


def build_retry(brief: Brief, previous: str, errors: list[str]) -> str:
    """Validator'dan donen hatalari geri besleyen prompt.

    Sifirdan yeniden uretmek yerine hatalari duzelttirmek hem ucuz hem de
    ilk uretimdeki iyi kismi korur.
    """
    return "\n".join(
        [
            build(brief),
            "",
            "=" * 60,
            "ONCEKI DENEMEN REDDEDILDI",
            "=" * 60,
            "",
            "Uretttigin JSON:",
            previous,
            "",
            "Validator hatalari:",
            *(f"  - {e}" for e in errors),
            "",
            "Yalnizca bu hatalari duzelt. Gecen kisimlari OLDUGU GIBI birak; "
            "yeniden yazma. Duzeltilmis tam JSON'u dondur.",
        ]
    )
