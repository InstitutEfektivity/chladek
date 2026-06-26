#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_ac_areas.py — vrstva CELYCH klimatizovanych BUDOV jako PLOCHY (polygony).

USP projektu Chladek = "kde je v Praze ve verejne pristupnych mistech klima".
Velke klimatizovane budovy (obchodni centra, obchodni domy, hypermarkety,
hobbymarkety, IKEA) nejsou bod, ale rozsahla plocha. Tento skript stahuje z
OpenStreetMap (Overpass API) jejich pudorys (`out geom`) a vydava validni
GeoJSON FeatureCollection do `public/data/ac-areas.geojson` (WGS84, [lon, lat]).

Schema kazde feature (frontend na nej spoleha):
  properties: id, name, kind, cooling, tier, area_m2, source
  geometry:   Polygon (jeden vnejsi prstenec) ve WGS84 [lon, lat]

Kategorie (kind):
  shop=mall                                 -> mall
  shop=department_store                     -> department_store
  shop=supermarket (jen velkoformat: Kaufland|Globus|Tesco|Makro|Albert Hyper.)
    + shop=wholesale                        -> hypermarket
  shop=doityourself|hardware (OBI|HORNBACH|Bauhaus|Mountfield) -> diy
  shop=furniture (IKEA)                     -> ikea

Geometrie se staví reuse kódem z build_areas.py (way ring, multipolygon
outer-ring chaining, ring_area_m2, Douglas-Peucker simplify). Feature bez
pouzitelneho uzavreneho prstence se PRESKOCI (nefabrikujeme body).

Zdroje a atribuce:
  (c) OpenStreetMap prispevatele (ODbL) - pres Overpass API.

Spusteni:  python data/build_ac_areas.py
Zavislosti: standardni knihovna; volitelne `requests` + `shapely` (jinak fallback).
"""

import json
import math
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

try:
    from shapely.geometry import Polygon as _ShPolygon  # type: ignore
    _HAVE_SHAPELY = True
except ImportError:  # pragma: no cover
    _HAVE_SHAPELY = False

# --- Konfigurace ---------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_PATH = os.path.join(REPO, "public", "data", "ac-areas.geojson")

# Primarni + zalozni Overpass instance (mirrors). Pri 504/429/timeout dalsi.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
PRAGUE_AREA = "area(3600435514)"  # OSM relation 435514 = hl. m. Praha
OVERPASS_TIMEOUT = 240            # serverovy timeout dotazu (s)
HTTP_TIMEOUT = 300                # klientsky timeout (s)
MAX_ATTEMPTS = 4                  # pocet pokusu (kolo pres mirrors)

# Geometricka simplifikace (Douglas-Peucker tolerance ve stupnich ~ 12 m).
SIMPLIFY_TOL = 0.00012
COORD_PRECISION = 6

# --- Overpass dotaz ------------------------------------------------------------
# `out geom` vraci u ways/relations plnou geometrii (souradnice prstencu).
# Velkoformatove prodejny ohranicujeme znackou (name regex), aby se nepritahly
# stovky malych shop=supermarket. shop=mall + department_store bereme bez znacky.
OVERPASS_QUERY = f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];
{PRAGUE_AREA}->.praha;
(
  // obchodni centra (mall)
  way["shop"="mall"](area.praha);
  relation["shop"="mall"](area.praha);
  // obchodni domy (department_store)
  way["shop"="department_store"](area.praha);
  relation["shop"="department_store"](area.praha);
  // hypermarkety: jen velkoformatove znacky (NE bare shop=supermarket)
  way["shop"="supermarket"]["name"~"Kaufland|Globus|Tesco|Makro|Albert Hypermarket",i](area.praha);
  way["shop"="wholesale"](area.praha);
  // hobbymarkety (DIY)
  way["shop"="doityourself"]["name"~"OBI|HORNBACH|Bauhaus|Mountfield",i](area.praha);
  way["shop"="hardware"]["name"~"OBI|HORNBACH|Bauhaus|Mountfield",i](area.praha);
  // IKEA (furniture)
  way["shop"="furniture"]["name"~"IKEA",i](area.praha);
);
out geom;
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


# --- Geo pomocne funkce (reuse z build_areas.py) -------------------------------
def haversine_m(lat1, lon1, lat2, lon2):
    """Vzdalenost dvou bodu v metrech (haversine)."""
    R = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def ring_area_m2(ring):
    """
    Plocha prstence (uzavreneho seznamu [lon, lat]) v m^2 pres shoelace na
    lokalni equirektangularni projekci kolem teziste. Vraci absolutni hodnotu.
    """
    if len(ring) < 4:
        return 0.0
    lat0 = sum(p[1] for p in ring) / len(ring)
    coslat = math.cos(math.radians(lat0))
    m_per_deg = 111320.0
    pts = [((lon * coslat) * m_per_deg, lat * m_per_deg) for lon, lat in ring]
    s = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def _close_ring(coords):
    """Zajisti uzavreny prstenec (prvni == posledni bod). Vraci novy seznam."""
    if not coords:
        return coords
    if coords[0] != coords[-1]:
        return coords + [coords[0]]
    return coords


# --- Douglas-Peucker simplifikace (stdlib fallback) ----------------------------
def _perp_dist(pt, a, b):
    """Kolma vzdalenost bodu pt od usecky a-b ve stupnich (rovinne)."""
    (x, y), (x1, y1), (x2, y2) = pt, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    px, py = x1 + t * dx, y1 + t * dy
    return math.hypot(x - px, y - py)


def _dp(points, tol):
    """Douglas-Peucker na otevreny seznam bodu [(lon,lat), ...]."""
    if len(points) < 3:
        return points[:]
    dmax, idx = 0.0, 0
    for i in range(1, len(points) - 1):
        d = _perp_dist(points[i], points[0], points[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        left = _dp(points[:idx + 1], tol)
        right = _dp(points[idx:], tol)
        return left[:-1] + right
    return [points[0], points[-1]]


def simplify_ring(ring, tol):
    """
    Zjednodusi uzavreny prstenec. Pri dostupne shapely pouzije
    .simplify(preserve_topology=True), jinak stdlib Douglas-Peucker.
    Vraci uzavreny prstenec zaokrouhleny na COORD_PRECISION desetin.
    """
    closed = _close_ring(ring)
    if len(closed) < 4:
        return None

    if _HAVE_SHAPELY:
        try:
            poly = _ShPolygon(closed)
            if not poly.is_valid:
                poly = poly.buffer(0)
            simp = poly.simplify(tol, preserve_topology=True)
            geom = simp.geoms[0] if simp.geom_type == "MultiPolygon" else simp
            ext = list(geom.exterior.coords)
            out = [[round(x, COORD_PRECISION), round(y, COORD_PRECISION)] for x, y in ext]
            out = _close_ring(out)
            return out if len(out) >= 4 else None
        except Exception:
            pass  # spadni na stdlib

    # stdlib Douglas-Peucker (na otevrenem prstenci, pak znovu uzavri)
    open_pts = closed[:-1]
    simp = _dp(open_pts, tol)
    out = [[round(x, COORD_PRECISION), round(y, COORD_PRECISION)] for x, y in simp]
    out = _close_ring(out)
    return out if len(out) >= 4 else None


# --- Extrakce prstencu z OSM elementu (reuse z build_areas.py) -----------------
def _way_ring(el):
    """Vrati seznam [lon, lat] z `geometry` zavreneho way, nebo None."""
    geom = el.get("geometry")
    if not geom:
        return None
    ring = [[float(p["lon"]), float(p["lat"])] for p in geom if "lon" in p and "lat" in p]
    if len(ring) < 4:
        if len(ring) == 3:
            ring = _close_ring(ring)
        if len(ring) < 4:
            return None
    return _close_ring(ring)


def _relation_outer_rings(el):
    """
    Z multipolygon relace vrati seznam OUTER prstencu jako [[lon,lat], ...].
    Spojuje navazujici useky se stejnou roli `outer` do uzavrenych prstencu.
    Inner (diry) ignorujeme. `out geom` dava u kazdeho membera `geometry`.
    """
    members = el.get("members") or []
    segments = []
    for m in members:
        if m.get("type") != "way":
            continue
        role = m.get("role") or "outer"
        if role and role != "outer":
            continue  # inner / jine role ignorujeme
        geom = m.get("geometry")
        if not geom:
            continue
        seg = [[float(p["lon"]), float(p["lat"])] for p in geom if "lon" in p and "lat" in p]
        if len(seg) >= 2:
            segments.append(seg)

    if not segments:
        return []

    rings = []
    used = [False] * len(segments)

    def _key(pt):
        return (round(pt[0], 7), round(pt[1], 7))

    for i in range(len(segments)):
        if used[i]:
            continue
        used[i] = True
        chain = list(segments[i])
        changed = True
        while changed and _key(chain[0]) != _key(chain[-1]):
            changed = False
            for j in range(len(segments)):
                if used[j]:
                    continue
                seg = segments[j]
                if _key(seg[0]) == _key(chain[-1]):
                    chain.extend(seg[1:]); used[j] = True; changed = True
                elif _key(seg[-1]) == _key(chain[-1]):
                    chain.extend(list(reversed(seg))[1:]); used[j] = True; changed = True
                elif _key(seg[-1]) == _key(chain[0]):
                    chain = seg[:-1] + chain; used[j] = True; changed = True
                elif _key(seg[0]) == _key(chain[0]):
                    chain = list(reversed(seg))[:-1] + chain; used[j] = True; changed = True
        ring = _close_ring(chain)
        if len(ring) >= 4 and _key(ring[0]) == _key(ring[-1]):
            rings.append(ring)
    return rings


# --- Klasifikace OSM tagu na kind ----------------------------------------------
def _name_matches(name, *needles):
    """True pokud name (case-insensitive) obsahuje nektery z needles."""
    low = (name or "").lower()
    return any(nd.lower() in low for nd in needles)


def classify(tags):
    """
    Z OSM tagu odvodi kind nebo None. Poradi: specificke pred obecnym.
    Velkoformatove prodejny jeste jednou overime znackou v Pythonu (Overpass
    regex uz filtruje, ale guard zde brani driftu pri zmene dotazu).
    """
    shop = tags.get("shop")
    name = tags.get("name") or ""

    if shop == "mall":
        return "mall"
    if shop == "department_store":
        return "department_store"
    if shop == "wholesale":
        return "hypermarket"
    if shop == "supermarket":
        if _name_matches(name, "Kaufland", "Globus", "Tesco", "Makro", "Albert Hypermarket"):
            return "hypermarket"
        return None  # bare supermarket nechceme (stovky malych prodejen)
    if shop in ("doityourself", "hardware"):
        if _name_matches(name, "OBI", "HORNBACH", "Bauhaus", "Mountfield"):
            return "diy"
        return None
    if shop == "furniture":
        if _name_matches(name, "IKEA"):
            return "ikea"
        return None
    return None


# --- Sestaveni features --------------------------------------------------------
def features_from_osm(data):
    feats = []
    seen_ids = set()
    stats = {"dropped_geom": 0, "dropped_class": 0,
             "rings_from_rel": 0, "rings_from_way": 0}

    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        kind = classify(tags)
        if kind is None:
            stats["dropped_class"] += 1
            continue
        name = (tags.get("name") or "").strip()

        etype = el.get("type", "way")
        eid = el.get("id")

        # ziskej prstence (way -> 1, relace -> N outer); skip bez uzavreneho prstence
        if etype == "way":
            ring = _way_ring(el)
            rings = [ring] if ring else []
            stats["rings_from_way"] += len(rings)
        elif etype == "relation":
            rings = _relation_outer_rings(el)
            stats["rings_from_rel"] += len(rings)
        else:
            rings = []

        if not rings:
            stats["dropped_geom"] += 1
            continue

        for ri, ring in enumerate(rings):
            if not ring or len(ring) < 4:
                stats["dropped_geom"] += 1
                continue
            area = ring_area_m2(ring)
            simp = simplify_ring(ring, SIMPLIFY_TOL)
            if not simp or len(simp) < 4:
                stats["dropped_geom"] += 1
                continue

            suffix = "" if len(rings) == 1 else "-%d" % ri
            fid = "osm-%s-%s%s" % (etype, eid, suffix)
            if fid in seen_ids:
                continue
            seen_ids.add(fid)

            feats.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [simp]},
                "properties": {
                    "id": fid,
                    "name": name or None,
                    "kind": kind,
                    "cooling": "ac",
                    "tier": "A",
                    "area_m2": int(round(area)),
                    "source": "OSM",
                },
            })

    print("[osm] features: %d | vyrazeno bez_geom=%d, mimo_kategorii=%d"
          % (len(feats), stats["dropped_geom"], stats["dropped_class"]), file=sys.stderr)
    print("[osm] prstence: z ways=%d, z relaci(outer)=%d"
          % (stats["rings_from_way"], stats["rings_from_rel"]), file=sys.stderr)
    return feats


# --- Hlavni beh ----------------------------------------------------------------
def main():
    try:
        data = fetch_overpass(OVERPASS_QUERY)
    except Exception as e:
        print("[CHYBA] Overpass selhal: %s" % e, file=sys.stderr)
        print("[CHYBA] existujici ac-areas.geojson NEBUDE prepsan.", file=sys.stderr)
        return 2

    feats = features_from_osm(data)
    if not feats:
        print("[CHYBA] zadne polygony - ac-areas.geojson NEBUDE prepsan.", file=sys.stderr)
        return 3

    fc = {
        "type": "FeatureCollection",
        "metadata": {
            "title": "Chladek - klimatizovane budovy jako plochy (mall, OD, hyper, DIY, IKEA)",
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
    print("Polygonu celkem: %d" % len(feats))
    print("Velikost: %.1f KB" % size_kb)
    print("shapely=%s, requests=%s" % (_HAVE_SHAPELY, _HAVE_REQUESTS))
    print("\nPodle kind:")
    for k in sorted(by_kind, key=lambda x: -by_kind[x]):
        print("  %-16s %d" % (k, by_kind[k]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
