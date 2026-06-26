#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_mlzitka.py – mlžítka / mlžící body „Oázy chladu" IPR Praha.

Vrstva mlžítek (mlžících sprch / bran) v Praze z otevřených dat IPR Praha
(„Oázy chladu", Geoportál Praha). Bez API klíče. Statická vrstva – mění se zřídka
(refresh týdně přes GitHub Action).

Zdroj (ArcGIS FeatureServer, GeoJSON ve WGS84 [lon, lat]):
  AGD_CUR_AGD_OCH_MLZITKA_B/FeatureServer/0/query

Vlastnosti zdroje: nazev, typ, provoz, provoz_spec, provozovatel, spravce, x, y.

Výstup `public/data/mlzitka.geojson` (FeatureCollection, WGS84 [lon, lat]):
  properties: { id, name, note, source }
  note = lidsky čitelný popis (typ mlžítka / provoz / provozovatel) nebo null.

Robustnost: při selhání fetch se NEPŘEPISUJE existující snapshot (exit nonzero).
UTF-8 píše Python přímo (ensure_ascii=False).

Spuštění:  python data/fetch_mlzitka.py
Atribuce:  © IPR Praha „Oázy chladu" (CC BY) – Geoportál Praha.
"""

import json
import os
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_PATH = os.path.join(REPO, "public", "data", "mlzitka.geojson")

BASE = "https://mp.iprpraha.cz/arcgis/rest/services/Hosted/AGD_CUR_AGD_OCH_MLZITKA_B/FeatureServer/0/query"
QUERY = {"where": "1=1", "outFields": "*", "f": "geojson", "outSR": "4326"}
HTTP_TIMEOUT = 60
UA = {"User-Agent": "chladek-data-pipeline/1.0 (Institut Efektivity)"}

# Hranice Prahy (hrubý bounding box) pro sanity check bodů.
PRAHA_BBOX = (12.0, 49.5, 15.0, 50.5)  # (min_lon, min_lat, max_lon, max_lat)

# typ mlžítka (číselník IPR) → čitelný popis.
TYP_LABEL = {
    1: "mlžící sprcha",
    2: "mlžící brána",
    3: "ostatní mlžící prvek",
    4: "mlžítko",
}

SOURCE_LABEL = "IPR Praha – Oázy chladu"  # „IPR Praha – Oázy chladu"


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
    props = feat.get("properties") or {}
    x, y = props.get("x"), props.get("y")
    if x is not None and y is not None:
        try:
            return float(x), float(y)
        except (TypeError, ValueError):
            pass
    return None


def _note(props):
    """Sestaví poznámku z typu / provozu / provozovatele. None když nic užitečného."""
    bits = []
    typ = props.get("typ")
    try:
        typ_n = int(typ)
    except (TypeError, ValueError):
        typ_n = None
    if typ_n in TYP_LABEL:
        bits.append(TYP_LABEL[typ_n])

    spec = (props.get("provoz_spec") or "").strip()
    if spec:
        bits.append(spec)

    prov = (props.get("provozovatel") or "").strip()
    spravce = (props.get("spravce") or "").strip()
    if prov:
        bits.append("provozovatel: %s" % prov)
    elif spravce:
        bits.append("správce: %s" % spravce)

    return "; ".join(bits) if bits else None


def main():
    try:
        raw = fetch_features()
    except Exception as e:  # noqa: BLE001 – nepřepisuj existující snapshot
        print("[mlzitka] CHYBA: %s – ponechavam existujici snapshot beze zmeny."
              % repr(e)[:120], file=sys.stderr)
        sys.exit(1)

    features = []
    skipped_geo = 0
    for rf in raw:
        coords = _coords(rf)
        if coords is None:
            skipped_geo += 1
            continue
        lon, lat = coords
        if not _in_prague(lon, lat):
            skipped_geo += 1
            continue
        props = rf.get("properties") or {}
        name = (props.get("nazev") or "").strip() or "Mlžítko"
        oid = props.get("objectid")
        fid = "ipr-mlzitka-%s" % (oid if oid is not None else len(features) + 1)
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": fid,
                "name": name,
                "note": _note(props),
                "source": SOURCE_LABEL,
            },
        })

    if not features:
        print("[mlzitka] CHYBA: zadny bod – ponechavam existujici snapshot beze zmeny.",
              file=sys.stderr)
        sys.exit(1)

    out = {
        "type": "FeatureCollection",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "IPR Praha – Oazy chladu (Geoportal Praha, CC BY)",
        "features": features,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")

    print("OK: %d mlzitek -> %s (preskoceno bez geometrie/mimo Prahu: %d)"
          % (len(features), OUT_PATH, skipped_geo))
    for feat in features[:2]:
        p = feat["properties"]
        nm = p["name"].encode("ascii", "replace").decode("ascii")
        note = (p["note"] or "").encode("ascii", "replace").decode("ascii")
        print("  - %s | %s" % (nm, note))
    return 0


if __name__ == "__main__":
    sys.exit(main())
