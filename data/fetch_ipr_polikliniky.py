#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_ipr_polikliniky.py – polikliniky / zdravotni strediska Prahy (IPR Praha, UAP).

Datova vrstva poliklinik a zdravotnich stredisek z Uzemne analytickych podkladu
(UAP) IPR Praha. Hostovany ArcGIS FeatureServer, GeoJSON ve WGS84/CRS84
([lon, lat]). Bez API klice (otevrena data). Statická vrstva – meni se zridka
(refresh tydne pres GitHub Action).

Obcansky uhel pohledu: cekarny poliklinik a zdravotnich stredisek jsou v lete
temer vzdy klimatizovane a verejne pristupne – presne typ mista, ktere by stat
mel oficialne oznacit jako utociste pred horkem (cooling refuge). Tier B (mekci
vnitrni utociste – primarni ucel je zdravotni pece, ne pobyt v chladu).

Zdroj (ArcGIS FeatureServer, ~68 features, jeden dotaz):
  FSV_CUR_OV_ZDRAVPOLIKLINIKY_B/FeatureServer/0/query?where=1=1&outFields=*&f=geojson

Pole zdroje (overeno live): nazev_zar, adresa_zar, typ_uap, druh_uap, poskyt,
  id_zar, id_poskyt, zdroj, objectid, globalid.

Vystup `public/data/ac-civic.geojson` (FeatureCollection, WGS84 [lon, lat]):
  properties: { id, name, type, address, cooling, tier, source }

Robustnost: pri selhani fetch se NEPREPISUJE existujici snapshot (exit nonzero).
UTF-8 pise Python primo (ensure_ascii=False, indent=1). Vsechny print() ASCII-only.

Spusteni:  python data/fetch_ipr_polikliniky.py
Atribuce:  (c) IPR Praha – Uzemne analyticke podklady (UAP), Geoportal Praha.
"""

import json
import os
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_PATH = os.path.join(REPO, "public", "data", "ac-civic.geojson")

BASE = "https://mp.iprpraha.cz/arcgis/rest/services/Hosted/FSV_CUR_OV_ZDRAVPOLIKLINIKY_B/FeatureServer/0/query"
QUERY = {"where": "1=1", "outFields": "*", "f": "geojson"}
HTTP_TIMEOUT = 120
UA = {"User-Agent": "chladek-data-pipeline/1.0 (Institut Efektivity)"}

SOURCE_LABEL = "IPR Praha – ÚAP"

# Hranice Prahy (hruby bounding box) pro sanity check bodu.
PRAHA_BBOX = (12.0, 49.5, 15.0, 50.5)  # (min_lon, min_lat, max_lon, max_lat)


def fetch_features():
    url = BASE + "?" + urllib.parse.urlencode(QUERY)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        data = json.load(r)
    return data.get("features", []) or []


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


def main():
    try:
        raw = fetch_features()
    except Exception as e:  # noqa: BLE001 - neprepisuj existujici snapshot
        print("[polikliniky] CHYBA: %s - ponechavam existujici snapshot beze zmeny."
              % repr(e)[:120], file=sys.stderr)
        sys.exit(1)

    # Diagnostika: prvni feature.properties (ASCII-only) pro potvrzeni poli.
    if raw:
        sample = raw[0].get("properties", {}) or {}
        print("[polikliniky] sample feature.properties keys: %s"
              % ", ".join(sorted(sample.keys())))

    features = []
    skipped_geo = 0

    for rf in raw:
        props = rf.get("properties") or {}

        coords = _coords(rf)
        if coords is None:
            skipped_geo += 1
            continue
        lon, lat = coords
        if not _in_prague(lon, lat):
            skipped_geo += 1
            continue

        name = (props.get("nazev_zar") or "").strip() or "Poliklinika"
        address = (props.get("adresa_zar") or "").strip() or None
        oid = props.get("objectid")
        fid = "ipr-polikliniky-%s" % (oid if oid is not None else len(features) + 1)

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": fid,
                "name": name,
                "type": "poliklinika",
                "address": address,
                "cooling": "ac",
                "tier": "B",
                "source": SOURCE_LABEL,
            },
        })

    if not features:
        print("[polikliniky] CHYBA: zadny bod - ponechavam existujici snapshot beze zmeny.",
              file=sys.stderr)
        sys.exit(1)

    out = {
        "type": "FeatureCollection",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "IPR Praha - UAP (polikliniky / zdravotni strediska, Geoportal Praha)",
        "features": features,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")

    # Statistiky (ASCII-only).
    print("OK: %d poliklinik / zdravotnich stredisek -> %s" % (len(features), OUT_PATH))
    print("  (preskoceno bez geometrie/mimo Prahu: %d)" % skipped_geo)
    for feat in features[:2]:
        p = feat["properties"]
        nm = p["name"].encode("ascii", "replace").decode("ascii")
        addr = (p["address"] or "").encode("ascii", "replace").decode("ascii")
        print("  - %s | %s" % (nm, addr))
    return 0


if __name__ == "__main__":
    sys.exit(main())
