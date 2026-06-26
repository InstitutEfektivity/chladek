#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_golemio_temps.py – pouliční teploty z teploměrů cyklosčítačů (Golemio/CAMEA).

Doplňková teplotní vrstva Chládku: teplota měřená u silnice senzory cyklosčítačů
v Praze (Golemio – Pražská datová platforma, data CAMEA). Senzory u vozovky na
slunci čtou vysoko – to je v pořádku (ukazuje rozpálené ulice vs. chladná místa).

Klíč se NIKDY necommituje – bere se z env GOLEMIO_API_KEY (lokálně z .env.local,
v GitHub Action z secrets). Stejný klíč jako fetch_golemio_aq.py.

Postup:
  1. GET /v2/bicyclecounters → FeatureCollection sčítačů (id + Point + name).
  2. GET /v2/bicyclecounters/temperatures?from=<~3h zpět>&to=<teď> → pole měření
     [{id, value, measured_from, measured_to, measurement_count}, ...]. id měření
     odpovídá properties.id sčítače. Pro každý sčítač se vezme NEJNOVĚJŠÍ měření
     (podle measured_to).

Výstup `public/data/temp-sensors.geojson` (FeatureCollection, WGS84 [lon, lat]):
  properties: { id, name, temp_c, measuredAt, source }
  (sčítače bez aktuální teploty se vynechají)

Robustnost: při selhání fetch se NEPŘEPISUJE existující snapshot (exit nonzero).
UTF-8 píše Python přímo (ensure_ascii=False).

Spuštění:  set -a; source .env.local; set +a; python data/fetch_golemio_temps.py
Atribuce:  © Golemio / Operátor ICT (Pražská datová platforma), data CAMEA.
"""

import json
import os
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_PATH = os.path.join(REPO, "public", "data", "temp-sensors.geojson")

COUNTERS_URL = "https://api.golemio.cz/v2/bicyclecounters"
TEMPS_URL = "https://api.golemio.cz/v2/bicyclecounters/temperatures"
HTTP_TIMEOUT = 60
LOOKBACK_HOURS = 3
SOURCE_LABEL = "Golemio / CAMEA"


def _headers(key):
    return {
        "X-Access-Token": key,
        "Accept": "application/json",
        "User-Agent": "chladek-data-pipeline/1.0 (Institut Efektivity)",
    }


def _get_json(url, key):
    req = urllib.request.Request(url, headers=_headers(key))
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        return json.load(r)


def fetch_counters(key):
    """Vrátí dict id -> {name, lon, lat} pro všechny sčítače s Point geometrií."""
    data = _get_json(COUNTERS_URL, key)
    out = {}
    for feat in data.get("features", []):
        props = feat.get("properties", {}) or {}
        geom = feat.get("geometry", {}) or {}
        cid = props.get("id")
        coords = geom.get("coordinates")
        if not cid or geom.get("type") != "Point" or not coords or len(coords) < 2:
            continue
        try:
            lon, lat = float(coords[0]), float(coords[1])
        except (TypeError, ValueError):
            continue
        out[cid] = {"name": props.get("name") or cid, "lon": lon, "lat": lat}
    return out


def fetch_latest_temps(key):
    """Vrátí dict counter_id -> (temp_c, measuredAt_iso) – nejnovější měření na sčítač."""
    now = datetime.now(timezone.utc)
    frm = (now - timedelta(hours=LOOKBACK_HOURS)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    to = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    url = TEMPS_URL + "?" + urllib.parse.urlencode({"from": frm, "to": to})
    rows = _get_json(url, key)
    if not isinstance(rows, list):
        raise RuntimeError("neocekavany tvar odpovedi teplot (ne list)")

    latest = {}  # id -> (measured_to, value)
    for row in rows:
        cid = row.get("id")
        val = row.get("value")
        mto = row.get("measured_to")
        if cid is None or val is None or not mto:
            continue
        prev = latest.get(cid)
        if prev is None or mto > prev[0]:
            latest[cid] = (mto, val)

    out = {}
    for cid, (mto, val) in latest.items():
        try:
            out[cid] = (round(float(val), 1), mto)
        except (TypeError, ValueError):
            continue
    return out


def main():
    key = os.environ.get("GOLEMIO_API_KEY", "").strip()
    if not key:
        print("CHYBA: GOLEMIO_API_KEY neni v env.", file=sys.stderr)
        sys.exit(2)

    try:
        counters = fetch_counters(key)
        temps = fetch_latest_temps(key)
    except Exception as e:  # noqa: BLE001 – nepřepisuj existující snapshot
        print("[golemio-temps] CHYBA: %s – ponechavam existujici snapshot beze zmeny."
              % repr(e)[:120], file=sys.stderr)
        sys.exit(1)

    features = []
    for cid, meta in counters.items():
        t = temps.get(cid)
        if t is None:
            continue
        temp_c, measured_at = t
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(meta["lon"], 6), round(meta["lat"], 6)]},
            "properties": {
                "id": cid,
                "name": meta["name"],
                "temp_c": temp_c,
                "measuredAt": measured_at,
                "source": SOURCE_LABEL,
            },
        })

    if not features:
        print("[golemio-temps] CHYBA: zadny scitac nema aktualni teplotu – "
              "ponechavam existujici snapshot beze zmeny.", file=sys.stderr)
        sys.exit(1)

    out = {
        "type": "FeatureCollection",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Golemio / Operator ICT (Prazska datova platforma), data CAMEA",
        "features": features,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")

    print("OK: %d scitacu s aktualni teplotou -> %s" % (len(features), OUT_PATH))
    for feat in features[:3]:
        p = feat["properties"]
        nm = p["name"].encode("ascii", "replace").decode("ascii")
        print("  - %s: %.1f C @ %s" % (nm, p["temp_c"], p["measuredAt"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
