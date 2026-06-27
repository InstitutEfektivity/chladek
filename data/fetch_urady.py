#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_urady.py – prazske mestske urady (urady mestskych casti + magistrat).

Datova vrstva verejnych uradu z OpenStreetMap (Overpass API). Verejne pristupne
haly uradu – prepazky, matrika, CzechPOINT, podatelny – jsou v lete temer vzdy
klimatizovane a otevrene komukoli. Presne typ mista, ktere by stat / mesto melo
oficialne oznacit jako utociste pred horkem (cooling refuge). Silny obcansky /
IE narativ: "co by stat mel oficialne urcit jako chladici centra".

Schema ac-civic (stejne jako polikliniky / centra): Tier B (mekci vnitrni
utociste – primarni ucel je urad, ne pobyt v chladu).

Zdroj (Overpass, Praha area(3600435514), jeden dotaz):
  nwr["amenity"="townhall"](area.praha);
  nwr["office"="government"](area.praha);

Filtr (vyhneme se neverejnemu / nesouvisejicimu balastu):
  - amenity=townhall  -> ponechame VZDY (jen pojmenovane)
  - office=government -> ponechame jen kdyz name matchuje
      /urad|magistrat|radnice|mestska cast/ (case-insensitive, vc. diakritiky)
  - zbytek (ambasady, stranicke kancelare, ...) zahodime.

Klasifikace "type":
  - name obsahuje "magistrat"                          -> "magistrat"
  - amenity=townhall NEBO name "urad mestske casti" /
    "radnice"                                          -> "urad mestske casti"
  - jinak                                              -> "urad"

Dedup: dle normalizovaneho jmena do 150 m (jeden radek na urad; townhall ma
prednost pred office=government).

Vystup `public/data/civic-urady.geojson` (FeatureCollection, WGS84 [lon, lat]):
  properties: { id, name, type, address, cooling, tier, source }

Robustnost: Overpass s retry/backoff pres mirrors (jako build_venues.py). Pri
selhani vsech mirrors se NEPREPISUJE existujici snapshot (exit nonzero).
UTF-8 pise Python primo (ensure_ascii=False, indent=1). Vsechny print() ASCII-only.

Spusteni:  python data/fetch_urady.py
Atribuce:  (c) OpenStreetMap prispevatele (ODbL) – pres Overpass API.
"""

import json
import math
import os
import re
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone

try:
    import requests  # type: ignore
    _HAVE_REQUESTS = True
except ImportError:  # pragma: no cover
    _HAVE_REQUESTS = False

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_PATH = os.path.join(REPO, "public", "data", "civic-urady.geojson")

# Primarni + zalozni Overpass instance (mirrors). Pri 504/429/timeout dalsi.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
PRAGUE_AREA = "area(3600435514)"  # OSM relation 435514 = hl. m. Praha
OVERPASS_TIMEOUT = 180            # serverovy timeout dotazu (s)
HTTP_TIMEOUT = 240                # klientsky timeout (s)
MAX_ATTEMPTS = 4                  # pocet pokusu (kolo pres mirrors)

UA = {"User-Agent": "chladek-data-pipeline/1.0 (Institut Efektivity)"}

SOURCE_LABEL = "OSM"

# Prah deduplikace: stejne jmeno do tohoto polomeru = jedna polozka.
DEDUP_RADIUS_M = 150.0

# Hranice Prahy (hruby bounding box) pro sanity check bodu.
PRAHA_BBOX = (12.0, 49.5, 15.0, 50.5)  # (min_lon, min_lat, max_lon, max_lat)

# office=government ponechame jen pri shode nazvu s timto patternem.
GOV_KEEP_RE = re.compile(r"(úřad|urad|magistrát|magistrat|radnice|městská část|mestska cast)", re.IGNORECASE)

OVERPASS_QUERY = f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];
{PRAGUE_AREA}->.praha;
(
  nwr["amenity"="townhall"](area.praha);
  nwr["office"="government"](area.praha);
);
out center tags;
"""


def _fetch_one(url, query):
    """Jeden HTTP pokus proti dane Overpass instanci. Vraci parsed JSON dict."""
    if _HAVE_REQUESTS:
        resp = requests.post(url, data={"data": query}, timeout=HTTP_TIMEOUT, headers=UA)
        resp.raise_for_status()
        return resp.json()
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=UA)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        raw = r.read().decode("utf-8")
    return json.loads(raw)


def fetch_overpass(query):
    """
    Stahne data z Overpass API s retry pres zalozni instance (mirrors).
    Fair-use: jeden dotaz na pokus, mezi pokusy backoff. Vraci parsed JSON dict.
    """
    last_err = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        url = OVERPASS_URLS[(attempt - 1) % len(OVERPASS_URLS)]
        print("[overpass] pokus %d/%d -> %s (timeout %ds)..."
              % (attempt, MAX_ATTEMPTS, url, OVERPASS_TIMEOUT), file=sys.stderr)
        t0 = time.time()
        try:
            data = _fetch_one(url, query)
            dt = time.time() - t0
            n = len(data.get("elements", []))
            print("[overpass] hotovo za %.1fs, %d elementu" % (dt, n), file=sys.stderr)
            return data
        except Exception as e:  # 504/429/timeout/connection apod.
            last_err = e
            print("[overpass] pokus selhal: %s" % repr(e)[:120], file=sys.stderr)
            if attempt < MAX_ATTEMPTS:
                backoff = 8 * attempt
                print("[overpass] cekam %ds pred dalsim pokusem..." % backoff, file=sys.stderr)
                time.sleep(backoff)
    raise RuntimeError("Overpass API nedostupne po %d pokusech: %s" % (MAX_ATTEMPTS, last_err))


def haversine_m(lat1, lon1, lat2, lon2):
    """Vzdalenost dvou bodu v metrech (haversine)."""
    R = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def element_coords(el):
    """Vrati (lat, lon) pro node (lat/lon) nebo way/relation (center). None kdyz chybi."""
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    c = el.get("center")
    if c and "lat" in c and "lon" in c:
        return float(c["lat"]), float(c["lon"])
    return None


def _in_prague(lon, lat):
    min_lon, min_lat, max_lon, max_lat = PRAHA_BBOX
    return (min_lon <= lon <= max_lon) and (min_lat <= lat <= max_lat)


def build_address(tags):
    """Slozi adresu z addr:street + addr:housenumber, pripadne doplni addr:city."""
    street = tags.get("addr:street")
    hn = tags.get("addr:housenumber")
    parts = []
    if street and hn:
        parts.append("%s %s" % (street, hn))
    elif street:
        parts.append(street)
    city = tags.get("addr:city")
    if city:
        parts.append(city)
    return ", ".join(parts) if parts else None


def keep_feature(tags):
    """
    Rozhodne, zda feature ponechat:
      - amenity=townhall -> vzdy True (jen pojmenovane, name resime jinde)
      - office=government -> jen kdyz name matchuje GOV_KEEP_RE
      - jinak False
    """
    name = tags.get("name") or ""
    if tags.get("amenity") == "townhall":
        return True
    if tags.get("office") == "government":
        return bool(GOV_KEEP_RE.search(name))
    return False


def classify_type(tags):
    """
    Klasifikuje typ uradu dle zadani:
      - name obsahuje "magistrat" -> "magistrat"
      - amenity=townhall NEBO name "urad mestske casti"/"radnice" -> "urad mestske casti"
      - jinak -> "urad"
    """
    name = (tags.get("name") or "")
    nlow = name.lower()
    if "magistrát" in nlow or "magistrat" in nlow:
        return "magistrát"
    if tags.get("amenity") == "townhall":
        return "úřad městské části"
    if "úřad městské části" in nlow or "urad mestske casti" in nlow or "radnice" in nlow:
        return "úřad městské části"
    return "úřad"


def _norm_name(s):
    return " ".join((s or "").lower().split())


def dedup(features):
    """
    Slouci polozky se stejnym (normalizovanym) jmenem do DEDUP_RADIUS_M.
    Priorita: townhall > office=government (townhall si drzime jako keeper).
    """
    # townhall nejdriv, aby mel prednost pri vyberu keepera
    feats_sorted = sorted(features, key=lambda f: 0 if f["_townhall"] else 1)
    kept = []
    removed = 0
    for f in feats_sorted:
        nm = _norm_name(f["properties"]["name"])
        lat, lon = f["_lat"], f["_lon"]
        is_dup = False
        for k in kept:
            if _norm_name(k["properties"]["name"]) != nm:
                continue
            if haversine_m(lat, lon, k["_lat"], k["_lon"]) <= DEDUP_RADIUS_M:
                is_dup = True
                break
        if is_dup:
            removed += 1
            continue
        kept.append(f)
    return kept, removed


def main():
    try:
        data = fetch_overpass(OVERPASS_QUERY)
    except Exception as e:  # noqa: BLE001 - neprepisuj existujici snapshot
        print("[urady] CHYBA: %s - ponechavam existujici snapshot beze zmeny."
              % repr(e)[:160], file=sys.stderr)
        sys.exit(1)

    elements = data.get("elements", []) or []

    raw_townhall = 0
    raw_government = 0
    no_name = 0
    no_geo = 0
    dropped_filter = 0
    candidates = []

    for el in elements:
        tags = el.get("tags") or {}
        if tags.get("amenity") == "townhall":
            raw_townhall += 1
        elif tags.get("office") == "government":
            raw_government += 1

        name = (tags.get("name") or "").strip()
        if not name:
            no_name += 1
            continue

        if not keep_feature(tags):
            dropped_filter += 1
            continue

        coords = element_coords(el)
        if coords is None:
            no_geo += 1
            continue
        lat, lon = coords
        if not _in_prague(lon, lat):
            no_geo += 1
            continue

        is_townhall = tags.get("amenity") == "townhall"
        ctype = classify_type(tags)
        osm_type = el.get("type", "node")
        osm_id = el.get("id")
        fid = "osm-urad-%s-%s" % (osm_type, osm_id)

        candidates.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": fid,
                "name": name,
                "type": ctype,
                "address": build_address(tags),
                "cooling": "ac",
                "tier": "B",
                "source": SOURCE_LABEL,
            },
            "_lat": lat,
            "_lon": lon,
            "_townhall": is_townhall,
        })

    kept, removed_dup = dedup(candidates)

    # odstran interni pomocna pole
    features = []
    for f in kept:
        features.append({
            "type": "Feature",
            "geometry": f["geometry"],
            "properties": f["properties"],
        })

    if not features:
        print("[urady] CHYBA: zadny urad po filtru - ponechavam existujici snapshot beze zmeny.",
              file=sys.stderr)
        sys.exit(1)

    out = {
        "type": "FeatureCollection",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "OpenStreetMap (Overpass) - prazske urady (townhall + office=government)",
        "features": features,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")

    # Statistiky (ASCII-only).
    type_counts = {}
    for feat in features:
        t = feat["properties"]["type"]
        type_counts[t] = type_counts.get(t, 0) + 1

    print("OK: %d uradu -> %s" % (len(features), OUT_PATH))
    print("  raw Overpass: townhall=%d | office=government=%d (elementu celkem %d)"
          % (raw_townhall, raw_government, len(elements)))
    print("  vyrazeno: bez nazvu=%d | mimo filtr (gov bez shody)=%d | bez geometrie/mimo Prahu=%d"
          % (no_name, dropped_filter, no_geo))
    print("  po filtru+dedup: %d (odstraneno duplikatu do %.0f m: %d)"
          % (len(features), DEDUP_RADIUS_M, removed_dup))
    print("  podle typu:")
    for t, cnt in sorted(type_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        tt = t.encode("ascii", "replace").decode("ascii")
        print("    %4d  %s" % (cnt, tt))
    print("  vzorek nazvu:")
    for feat in features[:12]:
        p = feat["properties"]
        nm = p["name"].encode("ascii", "replace").decode("ascii")
        tt = p["type"].encode("ascii", "replace").decode("ascii")
        addr = (p["address"] or "-").encode("ascii", "replace").decode("ascii")
        print("    - [%s] %s | %s" % (tt, nm, addr))
    return 0


if __name__ == "__main__":
    sys.exit(main())
