#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_ac_services.py — vrstva klimatizovanych SLUZEB/PROVOZOVEN jako BODY.

Net-new AC kategorie z deep-research (2026-06-28), ktere zadna stavajici vrstva
nepokryva: bezne supermarkety (Albert/Billa/Lidl/Penny), bankovni pobocky,
fitness a hotely 4*/5*. U techto kategorii lze klimatizaci predpokladat z
podstaty provozu ("kategorie implikuje AC"). Stahuje z OpenStreetMap (Overpass
API) jejich teziste (`out center;`) a vydava validni GeoJSON FeatureCollection
do `public/data/ac-services.geojson` (WGS84, [lon, lat]).

Schema kazde feature (frontend na nej spoleha — shape jako ac-shops):
  properties: id, name, brand, kind, cooling, tier, address, source
  geometry:   Point ve WGS84 [lon, lat]

Kategorie (kind) a tier:
  shop=supermarket (mimo velkoformat. znacky)  -> supermarket  (tier A)
  amenity=bank                                 -> bank         (tier A)
  leisure=fitness_centre                       -> fitness      (tier B = za clenstvi)
  tourism=hotel + stars>=4                      -> hotel        (tier B = lobby/recepce)

DEDUP: velkoformatove hypermarkety (Kaufland|Globus|Tesco|Makro|Albert
Hypermarket) jsou uz v ac-areas.geojson jako PLOCHY -> u supermarketu je podle
jmena preskakujeme. Navic cross-layer dedup podle OSM id: pokud uz element
existuje ve venues/ac-areas/ac-shops, do ac-services ho nepridavame (zabranuje
dvojimu vykresleni stejneho OSM objektu).

Bez jmena se feature zahodi. Bez geometrie se zahodi.

Zdroje a atribuce:
  (c) OpenStreetMap prispevatele (ODbL) - pres Overpass API.

Spusteni:  python data/build_ac_services.py
Zavislosti: standardni knihovna; volitelne `requests` (jinak fallback na urllib).
"""

import json
import os
import re
import sys
import time

import urllib.request
import urllib.parse

try:
    import requests  # type: ignore
    _HAVE_REQUESTS = True
except ImportError:  # pragma: no cover
    _HAVE_REQUESTS = False

# --- Konfigurace ---------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DATA_DIR = os.path.join(REPO, "public", "data")
OUT_PATH = os.path.join(DATA_DIR, "ac-services.geojson")

# Existujici vrstvy, proti kterym dedupujeme podle OSM id (at se stejny objekt
# nevykresli dvakrat – napr. supermarket jako bod + uz jako ac-areas plocha).
DEDUP_SOURCES = ["venues.geojson", "ac-areas.geojson", "ac-shops.geojson"]

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
PRAGUE_AREA = "area(3600435514)"  # OSM relation 435514 = hl. m. Praha
OVERPASS_TIMEOUT = 180
HTTP_TIMEOUT = 240
MAX_ATTEMPTS = 4
COORD_PRECISION = 6

# Velkoformatove znacky, ktere jsou uz v ac-areas jako plochy -> u supermarketu
# (shop=supermarket) je podle jmena vynechavame, aby se nedublovaly.
BIGFORMAT_RE = re.compile(r"kaufland|globus|tesco|makro|albert hypermarket", re.I)

OVERPASS_QUERY = f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];
{PRAGUE_AREA}->.praha;
(
  // bezne supermarkety (Albert/Billa/Lidl/Penny...) – velkoformat odfiltrujeme v Pythonu
  nwr["shop"="supermarket"]["name"](area.praha);
  // bankovni pobocky
  nwr["amenity"="bank"]["name"](area.praha);
  // fitness
  nwr["leisure"="fitness_centre"]["name"](area.praha);
  // hotely (filtr stars>=4 v Pythonu)
  nwr["tourism"="hotel"]["name"](area.praha);
);
out center tags;
"""


def _fetch_one(url, query):
    ua = {"User-Agent": "chladek-data-pipeline/1.0 (Institut Efektivity)"}
    if _HAVE_REQUESTS:
        resp = requests.post(url, data={"data": query}, timeout=HTTP_TIMEOUT, headers=ua)
        resp.raise_for_status()
        return resp.json()
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=ua)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        raw = r.read().decode("utf-8")
    return json.loads(raw)


def fetch_overpass(query):
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
        except Exception as e:
            last_err = e
            print("[overpass] pokus selhal: %s" % e, file=sys.stderr)
            if attempt < MAX_ATTEMPTS:
                backoff = 8 * attempt
                print("[overpass] cekam %ds pred dalsim pokusem..." % backoff, file=sys.stderr)
                time.sleep(backoff)
    raise RuntimeError("Overpass API nedostupne po %d pokusech: %s" % (MAX_ATTEMPTS, last_err))


def element_coords(el):
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    c = el.get("center")
    if c and "lat" in c and "lon" in c:
        return float(c["lat"]), float(c["lon"])
    return None


def _base_osm_id(fid):
    """Z 'osm-way-123-0' (ring suffix) udela 'osm-way-123' pro cross-layer dedup."""
    if not isinstance(fid, str) or not fid.startswith("osm-"):
        return None
    # strip pripadny '-<cislo>' ring suffix u ploch
    m = re.match(r"^(osm-(?:node|way|relation)-\d+)", fid)
    return m.group(1) if m else fid


def load_existing_osm_ids():
    """Posbira base OSM id ze stavajicich vrstev pro cross-layer dedup."""
    ids = set()
    for fname in DEDUP_SOURCES:
        path = os.path.join(DATA_DIR, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                fc = json.load(f)
        except Exception:
            continue
        for feat in fc.get("features", []):
            fid = (feat.get("properties") or {}).get("id")
            base = _base_osm_id(fid)
            if base:
                ids.add(base)
    print("[dedup] nacteno %d existujicich OSM id z %d vrstev"
          % (len(ids), len(DEDUP_SOURCES)), file=sys.stderr)
    return ids


def _stars_at_least_4(tags):
    raw = tags.get("stars") or ""
    m = re.match(r"\s*(\d)", str(raw))
    if not m:
        return False
    try:
        return int(m.group(1)) >= 4
    except ValueError:
        return False


def classify(tags):
    """Vrati (kind, tier) nebo None. Velkoformat supermarketu vynechavame (jsou v ac-areas)."""
    name = tags.get("name") or ""
    if tags.get("shop") == "supermarket":
        if BIGFORMAT_RE.search(name):
            return None  # uz jako plocha v ac-areas
        return ("supermarket", "A")
    if tags.get("amenity") == "bank":
        return ("bank", "A")
    if tags.get("leisure") == "fitness_centre":
        return ("fitness", "B")  # za clenstvi -> vnitrni utociste
    if tags.get("tourism") == "hotel":
        if _stars_at_least_4(tags):
            return ("hotel", "B")  # lobby/recepce pristupne -> vnitrni utociste
        return None
    return None


def _address(tags):
    street = tags.get("addr:street")
    hn = tags.get("addr:housenumber")
    if street and hn:
        return "%s %s" % (street, hn)
    return street or None


def features_from_osm(data, existing_ids):
    feats = []
    seen = set()
    dropped = {"noname": 0, "geo": 0, "class": 0, "dedup": 0, "dupid": 0}

    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        cls = classify(tags)
        if cls is None:
            dropped["class"] += 1
            continue
        kind, tier = cls

        name = (tags.get("name") or "").strip()
        if not name:
            dropped["noname"] += 1
            continue

        coords = element_coords(el)
        if coords is None:
            dropped["geo"] += 1
            continue
        lat, lon = coords

        etype = el.get("type", "node")
        eid = el.get("id")
        fid = "osm-%s-%s" % (etype, eid)
        if fid in seen:
            dropped["dupid"] += 1
            continue
        if fid in existing_ids:
            dropped["dedup"] += 1
            continue
        seen.add(fid)

        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point",
                         "coordinates": [round(lon, COORD_PRECISION), round(lat, COORD_PRECISION)]},
            "properties": {
                "id": fid,
                "name": name,
                "brand": tags.get("brand"),
                "kind": kind,
                "cooling": "ac",
                "tier": tier,
                "address": _address(tags),
                "source": "OSM",
            },
        })

    print("[osm] features: %d | vyrazeno bez_jmena=%d, bez_geometrie=%d, "
          "mimo_kategorii=%d, cross-layer_dedup=%d, dup_id=%d"
          % (len(feats), dropped["noname"], dropped["geo"], dropped["class"],
             dropped["dedup"], dropped["dupid"]), file=sys.stderr)
    return feats


def main():
    existing_ids = load_existing_osm_ids()
    try:
        data = fetch_overpass(OVERPASS_QUERY)
    except Exception as e:
        print("[CHYBA] Overpass selhal: %s" % e, file=sys.stderr)
        print("[CHYBA] existujici ac-services.geojson NEBUDE prepsan.", file=sys.stderr)
        return 2

    feats = features_from_osm(data, existing_ids)
    if not feats:
        print("[CHYBA] zadne sluzby - ac-services.geojson NEBUDE prepsan.", file=sys.stderr)
        return 3

    fc = {
        "type": "FeatureCollection",
        "metadata": {
            "title": "Chladek - klimatizovane sluzby/provozovny jako body (supermarket, banka, fitness, hotel 4*/5*)",
            "attribution": "(c) OpenStreetMap prispevatele (ODbL)",
            "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "count": len(feats),
        },
        "features": feats,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, indent=1)
        f.write("\n")

    size_kb = os.path.getsize(OUT_PATH) / 1024.0
    by_kind = {}
    for ft in feats:
        k = ft["properties"]["kind"]
        by_kind[k] = by_kind.get(k, 0) + 1

    print("\n=== VYSLEDEK ===")
    print("Soubor: %s" % OUT_PATH)
    print("Bodu celkem: %d" % len(feats))
    print("Velikost: %.1f KB" % size_kb)
    print("requests=%s" % _HAVE_REQUESTS)
    print("\nPodle kind:")
    for k in sorted(by_kind, key=lambda x: -by_kind[x]):
        print("  %-14s %d" % (k, by_kind[k]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
