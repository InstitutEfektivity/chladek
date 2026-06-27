#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_golemio_libraries.py - mestske knihovny Prahy z Golemio (PDP) pro web Chladek.

Mestske verejne knihovny (Mestska knihovna v Praze) z Prazske datove platformy.
Knihovny jsou idealni chladne utociste: volny vstup, klimatizace a ZIVE oteviraci
hodiny, ze kterych frontend pocita "otevreno ted". Proto si strukturovane pole
opening_hours ponechavame AS-IS (frontend ho potrebuje k vypoctu open-now).

Zdroj: https://api.golemio.cz/v2/municipallibraries (vyzaduje X-Access-Token).
Klic se NIKDY necommituje - bere se z env GOLEMIO_API_KEY (lokalne z .env.local,
v GitHub Action z secrets). Klient cte jen vysledny staticky GeoJSON.

Vystup `public/data/libraries.geojson` (FeatureCollection, WGS84 [lon, lat]):
  properties: { id, name, address, opening_hours, opening_hours_text?, cooling,
                tier, source }

Robustnost: pri selhani fetch se NEPREPISUJE existujici snapshot (exit nonzero).
UTF-8 pise Python primo (ensure_ascii=False). Vsechny print() jsou ASCII-only.

Spusteni (lokalne s klicem):
  set -a; source .env.local; set +a; python data/fetch_golemio_libraries.py
Atribuce:  Golemio / Mestska knihovna v Praze (Prazska datova platforma).
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_PATH = os.path.join(REPO, "public", "data", "libraries.geojson")

API_URL = "https://api.golemio.cz/v2/municipallibraries"
HTTP_TIMEOUT = 30

SOURCE_LABEL = "Golemio / Městská knihovna v Praze"

# Hranice Prahy (hruby bounding box) pro sanity check bodu.
PRAHA_BBOX = (12.0, 49.5, 15.0, 50.5)  # (min_lon, min_lat, max_lon, max_lat)


def fetch():
    key = os.environ.get("GOLEMIO_API_KEY", "").strip()
    if not key:
        print("CHYBA: GOLEMIO_API_KEY neni v env.", file=sys.stderr)
        sys.exit(2)
    req = urllib.request.Request(
        API_URL, headers={"X-Access-Token": key, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        return json.load(resp)


def _in_prague(lon, lat):
    min_lon, min_lat, max_lon, max_lat = PRAHA_BBOX
    return (min_lon <= lon <= max_lon) and (min_lat <= lat <= max_lat)


def _coords(feat):
    geom = feat.get("geometry") or {}
    coords = geom.get("coordinates")
    if geom.get("type") == "Point" and isinstance(coords, (list, tuple)) and len(coords) >= 2:
        try:
            return float(coords[0]), float(coords[1])
        except (TypeError, ValueError):
            pass
    return None


def _address(props):
    """Slozi adresu z address objektu (Golemio: address.address_formatted nebo slozky)."""
    addr = props.get("address")
    if isinstance(addr, str):
        s = addr.strip()
        return s or None
    if isinstance(addr, dict):
        formatted = (addr.get("address_formatted") or "").strip()
        if formatted:
            return formatted
        street = (addr.get("street_address") or "").strip()
        city = (addr.get("address_locality") or "").strip()
        parts = [p for p in (street, city) if p]
        return ", ".join(parts) if parts else None
    return None


def main():
    try:
        raw = fetch()
    except Exception as e:  # noqa: BLE001 - neprepisuj existujici snapshot
        print("[libraries] CHYBA: %s - ponechavam existujici snapshot beze zmeny."
              % repr(e)[:120], file=sys.stderr)
        sys.exit(1)

    raw_features = raw.get("features", []) or []

    # Diagnostika: prvni feature - klice + presny tvar pole opening_hours (ASCII-only).
    if raw_features:
        sample = raw_features[0].get("properties", {}) or {}
        print("[libraries] sample feature.properties keys: %s"
              % ", ".join(sorted(sample.keys())))
        oh = sample.get("opening_hours")
        oh_dump = json.dumps(oh, ensure_ascii=True)
        if len(oh_dump) > 1500:
            oh_dump = oh_dump[:1500] + "...(truncated)"
        print("[libraries] sample opening_hours shape: %s" % oh_dump)

    features = []
    skipped_geo = 0
    for rf in raw_features:
        coords = _coords(rf)
        if coords is None:
            skipped_geo += 1
            continue
        lon, lat = coords
        if not _in_prague(lon, lat):
            skipped_geo += 1
            continue

        props = rf.get("properties") or {}
        name = (props.get("name") or "").strip() or "Knihovna"
        oid = props.get("id")
        if oid is None:
            oid = props.get("slug")
        fid = "golemio-library-%s" % (oid if oid is not None else len(features) + 1)

        props_out = {
            "id": fid,
            "name": name,
            "address": _address(props),
            # strukturovane oteviraci hodiny AS-IS (frontend pocita open-now).
            "opening_hours": props.get("opening_hours"),
            "cooling": "ac",
            "tier": "A",
            "source": SOURCE_LABEL,
        }
        # lidsky citelna textova varianta, pokud ji zdroj poskytuje.
        oh_text = props.get("opening_hours_text") or props.get("openingHoursText")
        if isinstance(oh_text, str) and oh_text.strip():
            props_out["opening_hours_text"] = oh_text.strip()

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": props_out,
        })

    if not features:
        print("[libraries] CHYBA: zadny bod - ponechavam existujici snapshot beze zmeny.",
              file=sys.stderr)
        sys.exit(1)

    out = {
        "type": "FeatureCollection",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Golemio / Mestska knihovna v Praze (Prazska datova platforma)",
        "features": features,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")

    print("OK: %d knihoven -> %s (preskoceno bez geometrie/mimo Prahu: %d)"
          % (len(features), OUT_PATH, skipped_geo))
    return 0


if __name__ == "__main__":
    sys.exit(main())
