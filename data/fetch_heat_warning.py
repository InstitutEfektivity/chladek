#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_heat_warning.py — živá výstraha ČHMÚ před vysokými teplotami pro Prahu.

Stáhne CAP XML feed ČHMÚ (Systém integrované výstražné služby, SIVS), vyparsuje
výstrahy typu „vysoké teploty" platné pro Prahu a vybere tu nejrelevantnější
(přednost aktivní > budoucí, při shodě vyšší závažnost). Výstup je malý JSON,
který frontend čte živě z raw.githubusercontent.com (cron ho aktualizuje bez
redeploye).

Výstup `public/data/heat-warning.json`:
  aktivní:   { "active": true, "level": "...", "headline": "...", "event": "...",
               "validFrom": ISO, "validTo": ISO, "updatedAt": ISO, "source": "ČHMÚ (SIVS)" }
  bez výstrahy: { "active": false, "updatedAt": ISO, "source": "ČHMÚ (SIVS)" }

Robustnost: timeout, fallback. Když fetch/parse selže, NEPŘEPISUJE existující
soubor (ponechá poslední známý stav); jen když soubor neexistuje, zapíše
`active:false` s chybovou poznámkou. UTF-8 píše Python přímo.

Spuštění:  python data/fetch_heat_warning.py
Atribuce:  © ČHMÚ – Systém integrované výstražné služby (SIVS).
"""

import json
import os
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

# --- HTTP klient: requests pokud je, jinak urllib (stdlib) ---------------------
import urllib.request

try:
    import requests  # type: ignore
    _HAVE_REQUESTS = True
except ImportError:  # pragma: no cover
    _HAVE_REQUESTS = False

# --- Konfigurace ---------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_PATH = os.path.join(REPO, "public", "data", "heat-warning.json")

# CAP XML feed ČHMÚ (SIVS). Bez API klíče.
CAP_URL = "https://vystrahy-cr.chmi.cz/data2/XOCZ50_OKPR.xml"
HTTP_TIMEOUT = 60

CAP_NS = "{urn:oasis:names:tc:emergency:cap:1.2}"
SOURCE_LABEL = "ČHMÚ (SIVS)"

# Severity → uživatelská úroveň (CAP používá anglické termíny).
SEVERITY_LEVELS = {"Moderate", "Severe", "Extreme"}
SEVERITY_RANK = {"Minor": 1, "Moderate": 2, "Severe": 3, "Extreme": 4, "Unknown": 0}


def _q(tag):
    return CAP_NS + tag


def fetch_cap_xml():
    """Stáhne CAP XML. Vrací bytes. Vyhodí výjimku při chybě sítě."""
    ua = {"User-Agent": "chladek-data-pipeline/1.0 (Institut Efektivity)"}
    if _HAVE_REQUESTS:
        resp = requests.get(CAP_URL, timeout=HTTP_TIMEOUT, headers=ua, allow_redirects=True)
        resp.raise_for_status()
        return resp.content
    req = urllib.request.Request(CAP_URL, headers=ua)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        return r.read()


def _is_heat_info(info):
    """True pokud je <info> výstraha před vysokou teplotou.

    Primárně podle parametru awareness_type = „...; high-temperature" (jazykově
    nezávislé), s fallbackem na text <event> (Vysoké teploty / High Temperatures).
    """
    for p in info.findall(_q("parameter")):
        if p.findtext(_q("valueName")) == "awareness_type":
            val = (p.findtext(_q("value")) or "").lower()
            if "high-temperature" in val:
                return True
    event = (info.findtext(_q("event")) or "").lower()
    if "vysok" in event and "teplot" in event:
        return True
    if "high temperature" in event:
        return True
    return False


def _is_prague(info):
    """True pokud výstraha pokrývá Prahu (areaDesc „Praha" nebo CISORP 11xx)."""
    for area in info.findall(_q("area")):
        desc = area.findtext(_q("areaDesc")) or ""
        if "Praha" in desc:
            return True
        for gc in area.findall(_q("geocode")):
            if gc.findtext(_q("valueName")) == "CISORP":
                val = (gc.findtext(_q("value")) or "").strip()
                # Praha = ORP 1100 (rezerva 1100–1110 dle zadání)
                if val.startswith("11") and len(val) == 4:
                    try:
                        if 1100 <= int(val) <= 1110:
                            return True
                    except ValueError:
                        pass
    return False


def _parse_dt(s):
    """ISO 8601 s offsetem -> aware datetime, jinak None."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.strip())
    except ValueError:
        return None


def parse_heat_warnings(xml_bytes):
    """
    Z CAP XML vrátí list dictů kandidátních horkých výstrah pro Prahu (jen CS
    jazyková verze, kvůli českým textům). Každý dict: event, severity, level,
    headline, onset, expires (ISO stringy).
    """
    root = ET.fromstring(xml_bytes)
    out = []
    for info in root.findall(_q("info")):
        lang = (info.findtext(_q("language")) or "")
        if not lang.startswith("cs"):
            continue
        if not _is_heat_info(info):
            continue
        if not _is_prague(info):
            continue

        severity = (info.findtext(_q("severity")) or "Unknown").strip()
        # bereme jen reálné výstrahy (Moderate+); „žádná výstraha" má jinou severity
        if severity not in SEVERITY_LEVELS:
            continue

        event = (info.findtext(_q("event")) or "").strip()
        # headline: CAP <headline> bývá prázdné → fallback na <description>
        headline = (info.findtext(_q("headline")) or "").strip()
        if not headline:
            headline = (info.findtext(_q("description")) or "").strip()

        onset = (info.findtext(_q("onset")) or "").strip() or None
        # eventEndingTime parametr je spolehlivější než <expires> u některých feedů
        expires = (info.findtext(_q("expires")) or "").strip() or None
        for p in info.findall(_q("parameter")):
            if p.findtext(_q("valueName")) == "eventEndingTime":
                ee = (p.findtext(_q("value")) or "").strip()
                if ee:
                    expires = ee

        out.append({
            "event": event,
            "severity": severity,
            "level": severity,
            "headline": headline or None,
            "onset": onset,
            "expires": expires,
        })
    return out


def select_warning(candidates, now=None):
    """
    Z kandidátů vybere nejrelevantnější výstrahu:
      1) aktivní (onset <= now < expires) – z nich nejvyšší závažnost,
      2) jinak nejbližší budoucí (onset > now) – nejdřívější, pak nejvyšší závažnost.
    Expirované ignoruje. Vrací dict nebo None.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    active = []
    future = []
    for c in candidates:
        onset = _parse_dt(c["onset"])
        expires = _parse_dt(c["expires"])
        # expirované zahodíme
        if expires is not None and expires <= now:
            continue
        if onset is None or onset <= now:
            active.append(c)
        else:
            future.append(c)

    def rank(c):
        return SEVERITY_RANK.get(c["severity"], 0)

    if active:
        active.sort(key=rank, reverse=True)
        return active[0]
    if future:
        # nejdřívější onset; při shodě vyšší závažnost
        future.sort(key=lambda c: (_parse_dt(c["onset"]), -rank(c)))
        return future[0]
    return None


def build_payload(warning, now=None):
    """Sestaví výstupní JSON payload z vybrané výstrahy (nebo None)."""
    if now is None:
        now = datetime.now(timezone.utc)
    updated = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    if warning is None:
        return {"active": False, "updatedAt": updated, "source": SOURCE_LABEL}
    return {
        "active": True,
        "level": warning["level"],
        "headline": warning["headline"],
        "event": warning["event"],
        "validFrom": warning["onset"],
        "validTo": warning["expires"],
        "updatedAt": updated,
        "source": SOURCE_LABEL,
    }


def write_json(payload):
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    # Python píše přímo v UTF-8 (žádná PowerShell pipeline → diakritika OK).
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    now = datetime.now(timezone.utc)
    try:
        xml_bytes = fetch_cap_xml()
        candidates = parse_heat_warnings(xml_bytes)
        warning = select_warning(candidates, now=now)
        payload = build_payload(warning, now=now)
        write_json(payload)
        if warning:
            print("[heat] AKTIVNÍ výstraha: %s (%s) %s–%s"
                  % (warning["event"], warning["level"],
                     warning["onset"], warning["expires"]), file=sys.stderr)
        else:
            print("[heat] žádná aktivní/budoucí horká výstraha pro Prahu", file=sys.stderr)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    except Exception as e:
        print("[heat] CHYBA při fetch/parse: %s" % e, file=sys.stderr)
        # Robustně: neměň existující soubor (ponech poslední známý stav).
        if os.path.exists(OUT_PATH):
            print("[heat] ponechávám stávající %s beze změny" % OUT_PATH, file=sys.stderr)
            return 1
        # soubor neexistuje → zapiš bezpečné active:false s chybovou poznámkou
        fallback = {
            "active": False,
            "updatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": SOURCE_LABEL,
            "note": "fetch/parse selhal: %s" % e,
        }
        write_json(fallback)
        return 1


if __name__ == "__main__":
    sys.exit(main())
