#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_venues.py — datová pipeline projektu Chládek.

Sbírá chladná veřejná místa v Praze z OpenStreetMap (Overpass API) a slučuje je
s ruční kurátorskou vrstvou (`manual_overlay.csv`). Výstup: validní GeoJSON
FeatureCollection do `public/data/venues.geojson` (WGS84, [lon, lat]).

Schéma každé feature (frontend na něj spoléhá):
  properties: id, name, category, cooling, typical_c, free_entry,
              opening_hours, address, source, note

Zdroje a atribuce: viz data/README.md.
  © OpenStreetMap přispěvatelé (ODbL) – přes Overpass API.

Spuštění:  python data/build_venues.py
Závislosti: standardní knihovna; volitelně `requests` (jinak fallback na urllib).
"""

import csv
import json
import math
import os
import sys
import time

# --- HTTP klient: requests pokud je, jinak urllib (stdlib) ---------------------
try:
    import requests  # type: ignore
    _HAVE_REQUESTS = True
except ImportError:  # pragma: no cover
    _HAVE_REQUESTS = False
    import urllib.request
    import urllib.parse

# --- Konfigurace ---------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_PATH = os.path.join(REPO, "public", "data", "venues.geojson")
MANUAL_CSV = os.path.join(HERE, "manual_overlay.csv")

# Primární + záložní Overpass instance (mirrors). Při 504/429/timeout zkusíme další.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
PRAGUE_AREA = "area(3600435514)"  # OSM relation 435514 = hl. m. Praha
OVERPASS_TIMEOUT = 180            # serverový timeout dotazu (s)
HTTP_TIMEOUT = 240               # klientský timeout (s)
MAX_ATTEMPTS = 4                  # počet pokusů (kolo přes mirrors)

# Práh deduplikace: stejné jméno do tohoto poloměru = jedna položka.
DEDUP_RADIUS_M = 150.0
# Manuální vrstva přepisuje OSM, pokud je do tohoto poloměru u stejného jména.
MANUAL_MATCH_M = 150.0

# Selektivita parků: pojmenovaný park bereme jen pokud má plochu >= tohoto prahu.
PARK_MIN_AREA_M2 = 10000.0  # ~1 ha

# Indikativní vnitřní teplota – jen u klimatizace (ac). Jinde null.
AC_TYPICAL_C = 23


# --- Overpass dotaz ------------------------------------------------------------
# Jeden dotaz, fair-use. `out center` u ways/relations vrací těžiště (center).
OVERPASS_QUERY = f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];
{PRAGUE_AREA}->.praha;
(
  // knihovny
  nwr["amenity"="library"](area.praha);
  // muzea
  nwr["tourism"="museum"](area.praha);
  nwr["amenity"="museum"](area.praha);
  // kostely (jen pojmenované)
  nwr["amenity"="place_of_worship"]["name"](area.praha);
  // kina
  nwr["amenity"="cinema"](area.praha);
  // bazény / koupaliště / aquaparky
  nwr["leisure"="swimming_pool"](area.praha);
  nwr["leisure"="water_park"](area.praha);
  // pítka
  nwr["amenity"="drinking_water"](area.praha);
  // fontány a prameny
  nwr["amenity"="fountain"](area.praha);
  nwr["natural"="spring"](area.praha);
  // obchodní centra
  nwr["shop"="mall"](area.praha);
  // cokoli s explicitní klimatizací (jen pojmenované)
  nwr["air_conditioning"="yes"]["name"](area.praha);
  // parky (jen pojmenované; plochu filtrujeme až v Pythonu)
  nwr["leisure"="park"]["name"](area.praha);
);
out center tags;
"""


def _fetch_one(url, query):
    """Jeden HTTP pokus proti dané Overpass instanci. Vrací parsed JSON dict."""
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
    Stáhne data z Overpass API s retry přes záložní instance (mirrors).
    Fair-use: jeden dotaz na pokus, mezi pokusy backoff. Vrací parsed JSON dict.
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
            print("[overpass] hotovo za %.1fs, %d elementů" % (dt, n), file=sys.stderr)
            return data
        except Exception as e:  # 504/429/timeout/connection apod.
            last_err = e
            print("[overpass] pokus selhal: %s" % e, file=sys.stderr)
            if attempt < MAX_ATTEMPTS:
                backoff = 8 * attempt
                print("[overpass] čekám %ds před dalším pokusem..." % backoff, file=sys.stderr)
                time.sleep(backoff)
    raise RuntimeError("Overpass API nedostupné po %d pokusech: %s" % (MAX_ATTEMPTS, last_err))


# --- Geo pomocné funkce --------------------------------------------------------
def haversine_m(lat1, lon1, lat2, lon2):
    """Vzdálenost dvou bodů v metrech (haversine)."""
    R = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def element_coords(el):
    """Vrátí (lat, lon) pro node (lat/lon) nebo way/relation (center). None pokud chybí."""
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    c = el.get("center")
    if c and "lat" in c and "lon" in c:
        return float(c["lat"]), float(c["lon"])
    return None


# --- Mapování OSM tagů na schéma ----------------------------------------------
def classify(tags):
    """
    Z OSM tagů odvodí (category, cooling) nebo None pokud položku nechceme.
    Pořadí pravidel odpovídá zadání (specifické přebíjí obecné).
    """
    name = tags.get("name")

    # knihovna
    if tags.get("amenity") == "library":
        return "library", "ac"

    # muzeum
    if tags.get("tourism") == "museum" or tags.get("amenity") == "museum":
        return "museum", "ac"

    # kostel (jen s name)
    if tags.get("amenity") == "place_of_worship":
        if not name:
            return None
        return "church", "natural"

    # kino
    if tags.get("amenity") == "cinema":
        return "cinema", "ac"

    # bazén / koupaliště (access != private) + aquapark
    if tags.get("leisure") == "swimming_pool":
        if tags.get("access") == "private":
            return None
        return "pool", "water"
    if tags.get("leisure") == "water_park":
        return "pool", "water"

    # pítko
    if tags.get("amenity") == "drinking_water":
        return "fountain", "water"

    # fontána / pramen
    if tags.get("amenity") == "fountain" or tags.get("natural") == "spring":
        return "fountain", "water"

    # obchodní centrum
    if tags.get("shop") == "mall":
        return "mall", "ac"

    # explicitní klimatizace (cokoli s name)
    if tags.get("air_conditioning") == "yes" and name:
        if tags.get("amenity") in ("restaurant", "cafe", "fast_food", "bar"):
            return "cafe_food", "ac"
        return "shop_ac", "ac"

    # park (jen s name; plocha se řeší zvlášť ve filter_park)
    if tags.get("leisure") == "park" and name:
        return "park", "shade"

    return None


def way_area_m2(el):
    """
    Odhad plochy way/relation v m^2 z bounding boxu (`bounds`), pokud je k dispozici.
    Overpass u `out center` vrací u ways i `bounds`. Bez bounds vracíme None.
    """
    b = el.get("bounds")
    if not b:
        return None
    try:
        minlat = float(b["minlat"]); maxlat = float(b["maxlat"])
        minlon = float(b["minlon"]); maxlon = float(b["maxlon"])
    except (KeyError, ValueError):
        return None
    # převod stupňů na metry kolem středu
    midlat = (minlat + maxlat) / 2.0
    h = haversine_m(minlat, midlon if False else minlon, maxlat, minlon)  # výška (lat rozsah)
    w = haversine_m(minlat, minlon, minlat, maxlon)                        # šířka (lon rozsah)
    # plocha bboxu; reálný polygon je menší, ale jako proxy stačí
    return h * w


def build_address(tags):
    """Složí adresu z addr:street + addr:housenumber, případně doplní addr:city."""
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


def parse_free_entry(tags):
    """Odhad free_entry z fee tagu. Vrací True/False/None."""
    fee = tags.get("fee")
    if fee in ("no", "free"):
        return True
    if fee == "yes":
        return False
    return None


# --- Sestavení features z OSM --------------------------------------------------
def features_from_osm(data):
    feats = []
    dropped_park_small = 0
    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        name = tags.get("name")
        if not name:
            # bez jména zahazujeme (pítka/fontány bez name nemají v mapě smysl jako bod zájmu)
            continue

        cls = classify(tags)
        if cls is None:
            continue
        category, cooling = cls

        coords = element_coords(el)
        if coords is None:
            continue
        lat, lon = coords

        # selektivita parků: jen dostatečně velké pojmenované parky
        if category == "park":
            area = way_area_m2(el)
            if area is not None and area < PARK_MIN_AREA_M2:
                dropped_park_small += 1
                continue
            # pokud plochu neznáme (node bez bounds), park pustíme dál jen
            # když je to vyloženě pojmenovaný park – ponecháme (řídký případ)

        osm_type = el.get("type", "node")
        osm_id = el.get("id")
        fid = "osm-%s-%s" % (osm_type, osm_id)

        typical_c = AC_TYPICAL_C if cooling == "ac" else None

        props = {
            "id": fid,
            "name": name,
            "category": category,
            "cooling": cooling,
            "typical_c": typical_c,
            "free_entry": parse_free_entry(tags),
            "opening_hours": tags.get("opening_hours"),
            "address": build_address(tags),
            "source": "osm",
            "note": None,
        }
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": props,
            "_lat": lat,
            "_lon": lon,
        })
    if dropped_park_small:
        print("[osm] vyřazeno %d malých parků (< %.0f m2)" % (dropped_park_small, PARK_MIN_AREA_M2),
              file=sys.stderr)
    return feats


# --- Manuální vrstva -----------------------------------------------------------
def _to_bool(s):
    s = (s or "").strip().lower()
    if s in ("true", "1", "yes", "ano"):
        return True
    if s in ("false", "0", "no", "ne"):
        return False
    return None


def _to_num(s):
    s = (s or "").strip()
    if s == "" or s.lower() == "null":
        return None
    try:
        v = float(s)
        return int(v) if v.is_integer() else v
    except ValueError:
        return None


def features_from_manual():
    feats = []
    if not os.path.exists(MANUAL_CSV):
        print("[manual] CSV nenalezeno: %s" % MANUAL_CSV, file=sys.stderr)
        return feats
    with open(MANUAL_CSV, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader, start=1):
            name = (row.get("name") or "").strip()
            if not name:
                continue
            try:
                lat = float(row["lat"]); lon = float(row["lon"])
            except (KeyError, ValueError):
                print("[manual] řádek %d bez platných souřadnic, přeskočeno" % i, file=sys.stderr)
                continue
            address = (row.get("address") or "").strip() or None
            opening = (row.get("opening_hours") or "").strip() or None
            note = (row.get("note") or "").strip() or None
            props = {
                "id": "manual-%d" % i,
                "name": name,
                "category": (row.get("category") or "").strip(),
                "cooling": (row.get("cooling") or "").strip(),
                "typical_c": _to_num(row.get("typical_c")),
                "free_entry": _to_bool(row.get("free_entry")),
                "opening_hours": opening,
                "address": address,
                "source": "manual",
                "note": note,
            }
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                "properties": props,
                "_lat": lat,
                "_lon": lon,
            })
    print("[manual] načteno %d ověřených míst" % len(feats), file=sys.stderr)
    return feats


# --- Deduplikace ---------------------------------------------------------------
def _norm_name(s):
    return " ".join((s or "").lower().split())


def dedup(features):
    """
    Sloučí položky se stejným (normalizovaným) jménem do DEDUP_RADIUS_M.
    Priorita: manual > osm. Manuální položka přepíše OSM duplikát.
    """
    # manuální nejdřív, aby měly přednost při výběru "keepera"
    features_sorted = sorted(features, key=lambda f: 0 if f["properties"]["source"] == "manual" else 1)

    kept = []
    for f in features_sorted:
        nm = _norm_name(f["properties"]["name"])
        lat, lon = f["_lat"], f["_lon"]
        dup_of = None
        for k in kept:
            if _norm_name(k["properties"]["name"]) != nm:
                continue
            if haversine_m(lat, lon, k["_lat"], k["_lon"]) <= DEDUP_RADIUS_M:
                dup_of = k
                break
        if dup_of is None:
            kept.append(f)
        # pokud je to duplikát, zahazujeme (keeper už má vyšší/rovnou prioritu)
    return kept


# --- Hlavní běh ----------------------------------------------------------------
def main():
    data = fetch_overpass(OVERPASS_QUERY)
    osm_feats = features_from_osm(data)
    print("[osm] sestaveno %d features" % len(osm_feats), file=sys.stderr)

    manual_feats = features_from_manual()

    all_feats = manual_feats + osm_feats
    before = len(all_feats)
    deduped = dedup(all_feats)
    print("[dedup] %d -> %d (odstraněno %d duplikátů)" % (before, len(deduped), before - len(deduped)),
          file=sys.stderr)

    # odstraň interní pomocná pole, sestav finální FeatureCollection
    out_features = []
    for f in deduped:
        out_features.append({
            "type": "Feature",
            "geometry": f["geometry"],
            "properties": f["properties"],
        })

    fc = {
        "type": "FeatureCollection",
        "metadata": {
            "title": "Chládek – chladná veřejná místa v Praze",
            "attribution": "© OpenStreetMap přispěvatelé (ODbL) + ruční kurace IE",
            "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "count": len(out_features),
        },
        "features": out_features,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    # Python píše soubor PŘÍMO v UTF-8 (žádná PowerShell pipeline → diakritika OK).
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, indent=1)
        f.write("\n")

    # --- statistiky ---
    by_cat = {}
    by_cool = {}
    by_src = {}
    for f in out_features:
        p = f["properties"]
        by_cat[p["category"]] = by_cat.get(p["category"], 0) + 1
        by_cool[p["cooling"]] = by_cool.get(p["cooling"], 0) + 1
        by_src[p["source"]] = by_src.get(p["source"], 0) + 1

    print("\n=== VÝSLEDEK ===")
    print("Soubor: %s" % OUT_PATH)
    print("Features celkem: %d" % len(out_features))
    print("\nPodle kategorie:")
    for k in sorted(by_cat, key=lambda x: -by_cat[x]):
        print("  %-12s %d" % (k, by_cat[k]))
    print("\nPodle typu chlazení:")
    for k in sorted(by_cool, key=lambda x: -by_cool[x]):
        print("  %-10s %d" % (k, by_cool[k]))
    print("\nPodle zdroje:")
    for k in sorted(by_src, key=lambda x: -by_src[x]):
        print("  %-8s %d" % (k, by_src[k]))

    return len(out_features)


if __name__ == "__main__":
    n = main()
    # varování při extrémech (viz zadání)
    if n > 3000:
        print("\n[VAROVÁNÍ] >3000 features – zvaž zpřísnění filtru parků/pítek.", file=sys.stderr)
    elif n < 300:
        print("\n[VAROVÁNÍ] <300 features – zkontroluj, zda Overpass vrátil data.", file=sys.stderr)
