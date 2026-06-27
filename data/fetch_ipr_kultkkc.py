#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_ipr_kultkkc.py – knihovny vnejsich casti Prahy (IPR Praha, UAP / KULTKKC).

Datova vrstva kulturnich, komunitnich a knihovnickych zarizeni (KKC) z Uzemne
analytickych podkladu (UAP) IPR Praha. Hostovany ArcGIS FeatureServer, GeoJSON ve
WGS84/CRS84 ([lon, lat]). Bez API klice (otevrena data). Statická vrstva – meni se
zridka (refresh tydne pres GitHub Action).

Smysl teto vrstvy v ramci AC-sources loopu: rozsirit pokryti KNIHOVEN do vnejsich
mestskych casti. Hlavni knihovni vrstva (`public/data/libraries.geojson`, Mestska
knihovna v Praze z Golemio) je autoritativni a ma ZIVE oteviraci hodiny. KULTKKC
obsahuje navic mistni a obecni knihovny okrajovych MC, ktere v MKP datech nejsou.
Proti MKP se proto deduplikuje: kazdou KULTKKC knihovnu do 150 m od libovolne MKP
knihovny (haversine) zahodime – MKP vyhravra. Zustanou jen NET-NEW knihovny.

Knihovny = spolehlive chladne utociste (volny vstup, klimatizace) -> Tier A.

Zdroj (ArcGIS FeatureServer, ~294 features, jeden dotaz):
  FSV_CUR_OV_KULTKKC_B/FeatureServer/0/query?where=1=1&outFields=*&f=geojson

Pole zdroje (overeno live): nazev_zar, adresa_zar, typ_kkc, typ_kkc_txt, typ_uap,
  druh_uap, web, bezbar, poskyt, id_zar, objectid, globalid, ...

Filtr: ponechame jen features, jejichz typ_kkc_txt obsahuje "knihov" (case-insensitive).
  Tim chytime "knihovna" i kombinace ("kulturni centrum, knihovna" apod.).

Vystup `public/data/libraries-kkc.geojson` (FeatureCollection, WGS84 [lon, lat]):
  properties: { id, name, address, cooling, tier, source }

Robustnost: pri selhani fetch se NEPREPISUJE existujici snapshot (exit nonzero).
UTF-8 pise Python primo (ensure_ascii=False, indent=1). Vsechny print() ASCII-only.

Spusteni:  python data/fetch_ipr_kultkkc.py
Atribuce:  (c) IPR Praha – Uzemne analyticke podklady (UAP), Geoportal Praha.
"""

import json
import math
import os
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_PATH = os.path.join(REPO, "public", "data", "libraries-kkc.geojson")
MKP_PATH = os.path.join(REPO, "public", "data", "libraries.geojson")

BASE = "https://mp.iprpraha.cz/arcgis/rest/services/Hosted/FSV_CUR_OV_KULTKKC_B/FeatureServer/0/query"
QUERY = {"where": "1=1", "outFields": "*", "f": "geojson"}
HTTP_TIMEOUT = 120
UA = {"User-Agent": "chladek-data-pipeline/1.0 (Institut Efektivity)"}

SOURCE_LABEL = "IPR Praha – ÚAP (KULTKKC)"

# Hranice Prahy (hruby bounding box) pro sanity check bodu.
PRAHA_BBOX = (12.0, 49.5, 15.0, 50.5)  # (min_lon, min_lat, max_lon, max_lat)

# Dedup proti autoritativni MKP vrstve: KULTKKC knihovnu do tohoto okruhu (metry)
# od libovolne MKP knihovny zahodime (povazujeme za stejnou pobocku, MKP vyhravra).
DEDUP_RADIUS_M = 150.0


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


def _haversine_m(lon1, lat1, lon2, lat2):
    """Vzdalenost dvou bodu (lon/lat ve stupnich) v metrech."""
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = (math.sin(dphi / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2)
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def load_mkp_points():
    """Nacte body MKP knihoven (autoritativni vrstva) jako seznam (lon, lat).

    Pri chybejicim/poskozenem souboru vrati prazdny seznam (dedup se proste
    neprovede – radeji par duplicit nez zadny vystup).
    """
    try:
        with open(MKP_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:  # noqa: BLE001
        print("[kultkkc] VAROVANI: MKP vrstvu nelze nacist (%s) - dedup vynechan."
              % repr(e)[:100], file=sys.stderr)
        return []
    pts = []
    for feat in (data.get("features", []) or []):
        c = _coords(feat)
        if c is not None:
            pts.append(c)
    return pts


def _is_dup(lon, lat, mkp_points):
    for mlon, mlat in mkp_points:
        if _haversine_m(lon, lat, mlon, mlat) <= DEDUP_RADIUS_M:
            return True
    return False


def main():
    try:
        raw = fetch_features()
    except Exception as e:  # noqa: BLE001 - neprepisuj existujici snapshot
        print("[kultkkc] CHYBA: %s - ponechavam existujici snapshot beze zmeny."
              % repr(e)[:120], file=sys.stderr)
        sys.exit(1)

    # Diagnostika: prvni feature.properties (ASCII-only) pro potvrzeni poli.
    if raw:
        sample = raw[0].get("properties", {}) or {}
        print("[kultkkc] sample feature.properties keys: %s"
              % ", ".join(sorted(sample.keys())))

    mkp_points = load_mkp_points()
    print("[kultkkc] MKP referencnich bodu pro dedup: %d" % len(mkp_points))

    total = len(raw)
    libs_seen = 0
    community_seen = 0
    skipped_geo = 0
    dropped_dup = 0
    features = []

    for rf in raw:
        props = rf.get("properties") or {}
        typ_txt = (props.get("typ_kkc_txt") or "").strip()
        is_library = "knihov" in typ_txt.lower()
        if not is_library:
            community_seen += 1
            continue
        libs_seen += 1

        coords = _coords(rf)
        if coords is None:
            skipped_geo += 1
            continue
        lon, lat = coords
        if not _in_prague(lon, lat):
            skipped_geo += 1
            continue

        if _is_dup(lon, lat, mkp_points):
            dropped_dup += 1
            continue

        name = (props.get("nazev_zar") or "").strip() or "Knihovna"
        address = (props.get("adresa_zar") or "").strip() or None
        oid = props.get("objectid")
        fid = "ipr-kultkkc-%s" % (oid if oid is not None else len(features) + 1)

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": fid,
                "name": name,
                "address": address,
                "cooling": "ac",
                "tier": "A",
                "source": SOURCE_LABEL,
            },
        })

    if not features:
        print("[kultkkc] CHYBA: zadna net-new knihovna - ponechavam existujici snapshot beze zmeny.",
              file=sys.stderr)
        sys.exit(1)

    out = {
        "type": "FeatureCollection",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "IPR Praha - UAP (KULTKKC, knihovny vnejsich casti, Geoportal Praha)",
        "features": features,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")

    # Statistiky (ASCII-only).
    print("OK: %d net-new knihoven -> %s" % (len(features), OUT_PATH))
    print("  KULTKKC celkem: %d | knihovny: %d | komunitni/ostatni: %d"
          % (total, libs_seen, community_seen))
    print("  knihovny pred dedup (po geo filtru): %d | zahozeno do %dm od MKP: %d | net-new: %d"
          % (libs_seen - skipped_geo, int(DEDUP_RADIUS_M), dropped_dup, len(features)))
    print("  (preskoceno bez geometrie/mimo Prahu: %d)" % skipped_geo)
    for feat in features[:2]:
        p = feat["properties"]
        nm = p["name"].encode("ascii", "replace").decode("ascii")
        addr = (p["address"] or "").encode("ascii", "replace").decode("ascii")
        print("  - %s | %s" % (nm, addr))
    return 0


if __name__ == "__main__":
    sys.exit(main())
