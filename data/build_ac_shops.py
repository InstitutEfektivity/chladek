#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_ac_shops.py — vrstva ZNACKOVYCH klimatizovanych prodejen jako BODY.

Drogerie (dm/Rossmann/Teta) a elektro (Datart/Alza/Electro World/Euronics) jsou
v Praze husta sit malych klimatizovanych prodejen. Tyto nezobrazujeme jako
plochy (jsou male), ale jako body. Skript stahuje z OpenStreetMap (Overpass API)
jejich teziste (`out center;`) a vydava validni GeoJSON FeatureCollection do
`public/data/ac-shops.geojson` (WGS84, [lon, lat]).

Schema kazde feature (frontend na nej spoleha):
  properties: id, name, brand, kind, cooling, tier, source
  geometry:   Point ve WGS84 [lon, lat]

Kategorie (kind):
  shop=chemist                                          -> drogerie
    (chemist je bezpecna AC kategorie: dm/Rossmann/Teta)
  shop=electronics (Datart|Alza|Electro World|Euronics) -> electronics
    (BRAND-GUARD: vzdy drzime tag shop=electronics + name regex, nikdy bare
     name~, aby se nepritahly AlzaBox vyzvedavaci boxy)

Bez jmena se feature zahodi.

Zdroje a atribuce:
  (c) OpenStreetMap prispevatele (ODbL) - pres Overpass API.

Spusteni:  python data/build_ac_shops.py
Zavislosti: standardni knihovna; volitelne `requests` (jinak fallback na urllib).
"""

import json
import os
import sys
import time

# --- HTTP klient: requests pokud je, jinak urllib (stdlib) ---------------------
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
OUT_PATH = os.path.join(REPO, "public", "data", "ac-shops.geojson")

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

COORD_PRECISION = 6

# --- Overpass dotaz ------------------------------------------------------------
# `out center;` u ways/relations vrati teziste. Elektro drzime za znackou +
# tagem shop=electronics (brand-guard proti AlzaBox parcel lockerum).
OVERPASS_QUERY = f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];
{PRAGUE_AREA}->.praha;
(
  // drogerie (chemist = bezpecna AC kategorie: dm/Rossmann/Teta)
  nwr["shop"="chemist"](area.praha);
  // elektro (BRAND-GUARD: vzdy shop=electronics + name regex, nikdy bare name~)
  nwr["shop"="electronics"]["name"~"Datart|Alza|Electro World|Euronics",i](area.praha);
);
out center;
"""


def _fetch_one(url, query):
    """Jeden HTTP pokus proti dane Overpass instanci. Vraci parsed JSON dict."""
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
            print("[overpass] pokus selhal: %s" % e, file=sys.stderr)
            if attempt < MAX_ATTEMPTS:
                backoff = 8 * attempt
                print("[overpass] cekam %ds pred dalsim pokusem..." % backoff, file=sys.stderr)
                time.sleep(backoff)
    raise RuntimeError("Overpass API nedostupne po %d pokusech: %s" % (MAX_ATTEMPTS, last_err))


# --- Souradnice elementu (node lat/lon nebo way/relation center) ---------------
def element_coords(el):
    """Vrati (lat, lon) pro node (lat/lon) nebo way/relation (center). None pokud chybi."""
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    c = el.get("center")
    if c and "lat" in c and "lon" in c:
        return float(c["lat"]), float(c["lon"])
    return None


# --- Klasifikace OSM tagu na kind ----------------------------------------------
def classify(tags):
    """
    Z OSM tagu odvodi kind nebo None. Elektro guard: musi mit shop=electronics
    A znackove jmeno (brand-guard proti AlzaBoxum). Drogerie = chemist.
    """
    shop = tags.get("shop")
    name = (tags.get("name") or "").lower()

    if shop == "chemist":
        return "drogerie"
    if shop == "electronics":
        # brand-guard: jen znackove elektro prodejny
        for nd in ("datart", "alza", "electro world", "euronics"):
            if nd in name:
                return "electronics"
        return None
    return None


# --- Sestaveni features --------------------------------------------------------
def features_from_osm(data):
    feats = []
    seen_ids = set()
    dropped_noname = 0
    dropped_geo = 0
    dropped_class = 0

    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        kind = classify(tags)
        if kind is None:
            dropped_class += 1
            continue

        name = (tags.get("name") or "").strip()
        if not name:
            dropped_noname += 1
            continue

        coords = element_coords(el)
        if coords is None:
            dropped_geo += 1
            continue
        lat, lon = coords

        etype = el.get("type", "node")
        eid = el.get("id")
        fid = "osm-%s-%s" % (etype, eid)
        if fid in seen_ids:
            continue
        seen_ids.add(fid)

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
                "tier": "A",
                "source": "OSM",
            },
        })

    print("[osm] features: %d | vyrazeno bez_jmena=%d, bez_geometrie=%d, mimo_kategorii=%d"
          % (len(feats), dropped_noname, dropped_geo, dropped_class), file=sys.stderr)
    return feats


# --- Hlavni beh ----------------------------------------------------------------
def main():
    try:
        data = fetch_overpass(OVERPASS_QUERY)
    except Exception as e:
        print("[CHYBA] Overpass selhal: %s" % e, file=sys.stderr)
        print("[CHYBA] existujici ac-shops.geojson NEBUDE prepsan.", file=sys.stderr)
        return 2

    feats = features_from_osm(data)
    if not feats:
        print("[CHYBA] zadne prodejny - ac-shops.geojson NEBUDE prepsan.", file=sys.stderr)
        return 3

    fc = {
        "type": "FeatureCollection",
        "metadata": {
            "title": "Chladek - znackove klimatizovane prodejny jako body (drogerie, elektro)",
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
    for f in feats:
        k = f["properties"]["kind"]
        by_kind[k] = by_kind.get(k, 0) + 1

    print("\n=== VYSLEDEK ===")
    print("Soubor: %s" % OUT_PATH)
    print("Bodu celkem: %d" % len(feats))
    print("Velikost: %.1f KB" % size_kb)
    print("requests=%s" % _HAVE_REQUESTS)
    print("\nPodle kind:")
    for k in sorted(by_kind, key=lambda x: -by_kind[x]):
        print("  %-12s %d" % (k, by_kind[k]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
