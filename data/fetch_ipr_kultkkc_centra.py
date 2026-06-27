#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_ipr_kultkkc_centra.py – komunitni / kulturni centra Prahy (IPR Praha, UAP / KULTKKC).

Datova vrstva kulturnich, komunitnich a knihovnickych zarizeni (KKC) z Uzemne
analytickych podkladu (UAP) IPR Praha. Hostovany ArcGIS FeatureServer, GeoJSON ve
WGS84/CRS84 ([lon, lat]). Bez API klice (otevrena data). Statická vrstva – meni se
zridka (refresh tydne pres GitHub Action).

Tato vrstva je doplnek k `fetch_ipr_kultkkc.py` (round 2). Stejny endpoint
FSV_CUR_OV_KULTKKC_B, jen INVERTOVANY filtr knihoven: tady ponechavame NEKNIHOVNI
zarizeni – komunitni centra, kulturni centra, kluby senioru, rodinna centra apod.
(~210 bodu). Knihovni vrstvu resi round 2 (`libraries-kkc.geojson`).

Obcansky uhel pohledu: komunitni a kulturni centra jsou verejne pristupna mista
casto s klimatizovanymi vnitrnimi prostory (saly, kluby, cajovny), kde se da v lete
schovat pred horkem. Primarni ucel neni pobyt v chladu -> Tier B (mekci vnitrni
utociste). Schema ac-civic (stejne jako polikliniky).

Zdroj (ArcGIS FeatureServer, ~294 features, jeden dotaz):
  FSV_CUR_OV_KULTKKC_B/FeatureServer/0/query?where=1=1&outFields=*&f=geojson

Pole zdroje (overeno live): nazev_zar, adresa_zar, typ_kkc, typ_kkc_txt, typ_uap,
  druh_uap, web, bezbar, poskyt, id_zar, objectid, globalid, ...

Filtr: ponechame jen features, jejichz typ_kkc_txt NEOBSAHUJE "knihov"
  (case-insensitive). Tim vyradime "knihovna" i kombinace ("kulturni centrum,
  knihovna" apod.) a zustanou cista neknihovni zarizeni.

Vystup `public/data/civic-centra.geojson` (FeatureCollection, WGS84 [lon, lat]):
  properties: { id, name, type, address, cooling, tier, source }

Robustnost: pri selhani fetch se NEPREPISUJE existujici snapshot (exit nonzero).
UTF-8 pise Python primo (ensure_ascii=False, indent=1). Vsechny print() ASCII-only.

Spusteni:  python data/fetch_ipr_kultkkc_centra.py
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
OUT_PATH = os.path.join(REPO, "public", "data", "civic-centra.geojson")

BASE = "https://mp.iprpraha.cz/arcgis/rest/services/Hosted/FSV_CUR_OV_KULTKKC_B/FeatureServer/0/query"
QUERY = {"where": "1=1", "outFields": "*", "f": "geojson"}
HTTP_TIMEOUT = 120
UA = {"User-Agent": "chladek-data-pipeline/1.0 (Institut Efektivity)"}

SOURCE_LABEL = "IPR Praha – ÚAP (KULTKKC)"

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
        print("[centra] CHYBA: %s - ponechavam existujici snapshot beze zmeny."
              % repr(e)[:120], file=sys.stderr)
        sys.exit(1)

    # Diagnostika: prvni feature.properties (ASCII-only) pro potvrzeni poli.
    if raw:
        sample = raw[0].get("properties", {}) or {}
        print("[centra] sample feature.properties keys: %s"
              % ", ".join(sorted(sample.keys())))

    total = len(raw)
    libs_seen = 0
    skipped_geo = 0
    features = []
    type_counts = {}

    for rf in raw:
        props = rf.get("properties") or {}
        typ_txt = (props.get("typ_kkc_txt") or "").strip()
        is_library = "knihov" in typ_txt.lower()
        if is_library:
            libs_seen += 1
            continue

        coords = _coords(rf)
        if coords is None:
            skipped_geo += 1
            continue
        lon, lat = coords
        if not _in_prague(lon, lat):
            skipped_geo += 1
            continue

        name = (props.get("nazev_zar") or "").strip() or "Komunitni centrum"
        ctype = typ_txt or None
        address = (props.get("adresa_zar") or "").strip() or None
        oid = props.get("objectid")
        fid = "ipr-kultkkc-centra-%s" % (oid if oid is not None else len(features) + 1)

        if ctype:
            type_counts[ctype] = type_counts.get(ctype, 0) + 1

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": fid,
                "name": name,
                "type": ctype,
                "address": address,
                "cooling": "ac",
                "tier": "B",
                "source": SOURCE_LABEL,
            },
        })

    if not features:
        print("[centra] CHYBA: zadne komunitni/kulturni centrum - ponechavam existujici snapshot beze zmeny.",
              file=sys.stderr)
        sys.exit(1)

    out = {
        "type": "FeatureCollection",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "IPR Praha - UAP (KULTKKC, komunitni / kulturni centra, Geoportal Praha)",
        "features": features,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")

    # Statistiky (ASCII-only).
    print("OK: %d komunitnich / kulturnich center -> %s" % (len(features), OUT_PATH))
    print("  KULTKKC celkem: %d | neknihovni (ponechano): %d | knihovny (vyrazeno): %d"
          % (total, len(features), libs_seen))
    print("  (preskoceno bez geometrie/mimo Prahu: %d)" % skipped_geo)
    print("  distinct typ_kkc_txt (%d):" % len(type_counts))
    for ctype, cnt in sorted(type_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        ct = ctype.encode("ascii", "replace").decode("ascii")
        print("    %4d  %s" % (cnt, ct))
    for feat in features[:2]:
        p = feat["properties"]
        nm = p["name"].encode("ascii", "replace").decode("ascii")
        addr = (p["address"] or "").encode("ascii", "replace").decode("ascii")
        print("  - %s | %s" % (nm, addr))
    return 0


if __name__ == "__main__":
    sys.exit(main())
