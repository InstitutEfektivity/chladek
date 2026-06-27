#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_ac_cafe.py - mikro-AC komercni utociste: znackove fast-food + kavarenske
retezce jako BODY.

McDonald's, KFC, Burger King, Starbucks a Costa jsou v Praze husta sit poboček,
ktere jsou v lete klimatizovane firemnim standardem, verejne pristupne (cili
"refuge-ish") a maji dlouhou / pozdni oteviraci dobu. Presne typ komercniho
chladneho mikro-utociste, ktery Barcelona ("refugis climatics") a Pariz
(cooling micro-shelters) zapocitavaji do site klimatickych utocist.

Tato vrstva je NOVY default-OFF overlay (uzivatel si ji zapne sam). Schema je
civic-style (jako fetch_urady.py / polikliniky): Tier B (mekci vnitrni utociste -
primarni ucel je obcerstveni, ne pobyt v chladu).

Zdroj (Overpass, Praha area(3600435514), jeden dotaz pres brand:wikidata):
  nwr["brand:wikidata"~"^Q(38076|524757|177054|37158|608845)$"](area.praha);
    McDonald's  Q38076
    KFC         Q524757
    Burger King Q177054
    Starbucks   Q37158
    Costa       Q608845

Brand-guard: drzime se konsolidovaneho dotazu na brand:wikidata (stabilni
identifikator znacky), ne bare name~ regexu - tim se vyhneme falesnym shodam
(napr. "McDonald's Drive" parkoviste bez budovy ci nahodnym nazvum). Brand se
odvozuje z tagu `brand` (fallback na `name`). Bez jmena se feature zahodi.

Vystup `public/data/ac-cafe.geojson` (FeatureCollection, WGS84 [lon, lat]):
  properties: { id, name, brand, type, address, cooling, tier, source }

Robustnost: Overpass s retry/backoff pres mirrors (jako build_venues.py). Pri
selhani vsech mirrors se NEPREPISUJE existujici snapshot (exit nonzero).
UTF-8 pise Python primo (ensure_ascii=False, indent=1). Vsechny print() ASCII-only.

Spusteni:  python data/build_ac_cafe.py
Atribuce:  (c) OpenStreetMap prispevatele (ODbL) - pres Overpass API.
"""

import json
import os
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
OUT_PATH = os.path.join(REPO, "public", "data", "ac-cafe.geojson")

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
VENUE_TYPE = "kavárna / rychlé občerstvení"

# Hranice Prahy (hruby bounding box) pro sanity check bodu.
PRAHA_BBOX = (12.0, 49.5, 15.0, 50.5)  # (min_lon, min_lat, max_lon, max_lat)

# Mapovani brand:wikidata -> lidsky citelny brand (fallback pro odvozeni znacky,
# kdyz chybi tag `brand` i `name`). Q jako klic bez prefixu.
BRAND_BY_WIKIDATA = {
    "Q38076": "McDonald's",
    "Q524757": "KFC",
    "Q177054": "Burger King",
    "Q37158": "Starbucks",
    "Q608845": "Costa",
}

OVERPASS_QUERY = f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];
{PRAGUE_AREA}->.praha;
(
  nwr["brand:wikidata"~"^Q(38076|524757|177054|37158|608845)$"](area.praha);
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


def derive_brand(tags):
    """
    Odvodi znacku: primarne z tagu `brand`, fallback na `name`, dale na mapu
    brand:wikidata -> brand. Vraci string nebo None.
    """
    brand = (tags.get("brand") or "").strip()
    if brand:
        return brand
    name = (tags.get("name") or "").strip()
    if name:
        return name
    wd = (tags.get("brand:wikidata") or "").strip()
    return BRAND_BY_WIKIDATA.get(wd)


def main():
    try:
        data = fetch_overpass(OVERPASS_QUERY)
    except Exception as e:  # noqa: BLE001 - neprepisuj existujici snapshot
        print("[cafe] CHYBA: %s - ponechavam existujici snapshot beze zmeny."
              % repr(e)[:160], file=sys.stderr)
        sys.exit(1)

    elements = data.get("elements", []) or []

    no_name = 0
    no_geo = 0
    dup_id = 0
    seen_ids = set()
    features = []

    for el in elements:
        tags = el.get("tags") or {}

        name = (tags.get("name") or "").strip()
        if not name:
            # keep only NAMED features
            no_name += 1
            continue

        coords = element_coords(el)
        if coords is None:
            no_geo += 1
            continue
        lat, lon = coords
        if not _in_prague(lon, lat):
            no_geo += 1
            continue

        osm_type = el.get("type", "node")
        osm_id = el.get("id")
        fid = "osm-cafe-%s-%s" % (osm_type, osm_id)
        if fid in seen_ids:
            dup_id += 1
            continue
        seen_ids.add(fid)

        brand = derive_brand(tags)

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": fid,
                "name": name,
                "brand": brand,
                "type": VENUE_TYPE,
                "address": build_address(tags),
                "cooling": "ac",
                "tier": "B",
                "source": SOURCE_LABEL,
            },
        })

    if not features:
        print("[cafe] CHYBA: zadna pobocka po filtru - ponechavam existujici snapshot beze zmeny.",
              file=sys.stderr)
        sys.exit(1)

    out = {
        "type": "FeatureCollection",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "OpenStreetMap (Overpass) - znackove fast-food + kavarny (brand:wikidata)",
        "features": features,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")

    # Statistiky (ASCII-only).
    brand_counts = {}
    for feat in features:
        b = feat["properties"]["brand"] or "(neznama)"
        brand_counts[b] = brand_counts.get(b, 0) + 1

    print("OK: %d pobocek -> %s" % (len(features), OUT_PATH))
    print("  raw Overpass elementu: %d" % len(elements))
    print("  vyrazeno: bez nazvu=%d | bez geometrie/mimo Prahu=%d | duplikat id=%d"
          % (no_name, no_geo, dup_id))
    print("  podle znacky:")
    for b, cnt in sorted(brand_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        bb = b.encode("ascii", "replace").decode("ascii")
        print("    %4d  %s" % (cnt, bb))
    print("  vzorek:")
    for feat in features[:5]:
        p = feat["properties"]
        nm = p["name"].encode("ascii", "replace").decode("ascii")
        br = (p["brand"] or "-").encode("ascii", "replace").decode("ascii")
        addr = (p["address"] or "-").encode("ascii", "replace").decode("ascii")
        print("    - [%s] %s | %s" % (br, nm, addr))
    return 0


if __name__ == "__main__":
    sys.exit(main())
