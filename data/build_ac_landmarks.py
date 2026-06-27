#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_ac_landmarks.py — vrstva VELKYCH klimatizovanych VEREJNYCH BUDOV jako PLOCHY.

Round 8 (out-of-the-box) projektu Chladek: "cely objekt = area" treatment pro
velke klimatizovane verejne kulturni budovy - muzea, divadla, koncertni/
kongresove/vystavni haly a velke knihovny. Stahuje z OpenStreetMap (Overpass API)
jejich pudorys (`out geom`) a vydava validni GeoJSON FeatureCollection do
`public/data/ac-landmarks.geojson` (WGS84, [lon, lat]).

Tato vrstva DOPLNUJE existujici ac-culture BODY (ktere uz davaji ikonu/marker):
pridava POUZE rozsah budovy (jemna vypln), zadne markery.

Schema kazde feature (frontend na nej spoleha):
  properties: id, name, kind, cooling, area_m2, source
  geometry:   Polygon (jeden vnejsi prstenec) ve WGS84 [lon, lat]

Vyber budov (POUZE skutecne BUILDING polygony - way/relation s tagem `building`):
  way/relation["building"]["tourism"="museum"]                          -> museum
  way/relation["building"]["amenity"="theatre"]                         -> theatre
  way/relation["building"]["amenity"="arts_centre"]                     -> theatre
  way/relation["building"]["amenity"="concert_hall"]                    -> concert
  way/relation["building"]["amenity"="conference_centre"]               -> congress
  way/relation["building"]["amenity"="exhibition_centre"]               -> exhibition
  way/relation["building"]["amenity"="library"]                         -> library

Geometrie se stavi reuse kodem z build_ac_areas.py (way ring, multipolygon
outer-ring chaining, ring_area_m2, Douglas-Peucker simplify). Feature bez
pouzitelneho uzavreneho prstence se PRESKOCI (nefabrikujeme body).

Round 9 (point-in-polygon doplnek): nektere high-profile budovy (Narodni muzeum,
Veletrzni palac, Klementinum, Obecni dum) maji culture tag na NODE, ne na
building polygonu - query vyse je MINE. Pridavame proto prostorovy join:
  1) stahneme culture NODES (museum/theatre/arts_centre/concert_hall/
     conference_centre/exhibition_centre/library) v Praze,
  2) stahneme kandidatske building polygony v ohranicene centralni bbox,
  3) lokalnim point-in-polygon (shapely Point.within, jinak ray-casting) najdeme
     pro kazdy node OBALUJICI budovu -> ta se stane landmarkem (kind z node tagu).
Vysledek se MERGE s query-based vrstvou; DEDUP podle OSM id a podle teziste do
40 m (aby se Rudolfinum / Narodni divadlo z kola 8 nepridaly dvakrat).

FILTR plochy: jen area_m2 >= 1500 (rozumne cele budovy; drobne pavilonky/kiosky
vyhazujeme).

DEDUP vs ac-areas: feature, jejiz teziste lezi do 60 m od teziste nektereho
polygonu v public/data/ac-areas.geojson, se vyradi (zamezeni prekryvu s mally /
obchodnimi domy, ktere uz pokryva ac-areas).

Zdroje a atribuce:
  (c) OpenStreetMap prispevatele (ODbL) - pres Overpass API.

Spusteni:  python data/build_ac_landmarks.py
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
    from shapely.geometry import Point as _ShPoint  # type: ignore
    _HAVE_SHAPELY = True
except ImportError:  # pragma: no cover
    _HAVE_SHAPELY = False

# --- Konfigurace ---------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_PATH = os.path.join(REPO, "public", "data", "ac-landmarks.geojson")
AC_AREAS_PATH = os.path.join(REPO, "public", "data", "ac-areas.geojson")

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

# Filtr plochy: drobne pavilonky/kiosky pod timto prahem vyhazujeme.
MIN_AREA_M2 = 1500

# Dedup vs ac-areas: teziste blize nez tento prah = prekryv -> vyradit.
DEDUP_RADIUS_M = 60.0

# Dedup mezi query-based a point-in-polygon vrstvou: stejna budova podle teziste
# do tohoto prahu = duplikat (vedle dedupu podle OSM id).
LANDMARK_DEDUP_M = 40.0

# Nearest-building fallback: nektere culture kotvy (typicky site relace - napr.
# Narodni muzeum) maji `center` v mezere mezi budovami, takze nepadne DOVNITR
# zadneho polygonu. Pokud bod neni v zadne budove, prirad NEJBLIZSI dostatecne
# velkou budovu, jejiz teziste lezi do tohoto prahu. Drzime maly (75 m), aby se
# nefabrikovala vzdalena shoda.
NEAREST_FALLBACK_M = 75.0

# Ohranicena centralni bbox pro fetch kandidatskych building polygonu.
# (50.05-50.11 N, 14.38-14.46 E pokryva historicke centrum, kde flagshipy lezi.)
# Pri prilis velke odpovedi se rozdeli na sub-bboxy (viz CENTRAL_SUBBOXES).
CENTRAL_BBOX = (50.05, 14.38, 50.11, 14.46)  # (south, west, north, east)

# Sub-bboxy (2x2 mrizka centralni bbox) pro pripad, ze jeden dotaz je moc velky.
def _split_bbox(bbox, nlat=2, nlon=2):
    s, w, n, e = bbox
    dlat = (n - s) / nlat
    dlon = (e - w) / nlon
    out = []
    for i in range(nlat):
        for j in range(nlon):
            out.append((s + i * dlat, w + j * dlon,
                        s + (i + 1) * dlat, w + (j + 1) * dlon))
    return out

CENTRAL_SUBBOXES = _split_bbox(CENTRAL_BBOX, 2, 2)

# --- Overpass dotaz ------------------------------------------------------------
# `out geom` vraci u ways/relations plnou geometrii (souradnice prstencu).
# POUZE skutecne BUILDING polygony (way/relation nesouci tag `building`)
# velkych klimatizovanych verejnych kulturnich budov.
OVERPASS_QUERY = f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];
{PRAGUE_AREA}->.praha;
(
  // muzea (budova)
  way["building"]["tourism"="museum"](area.praha);
  relation["building"]["tourism"="museum"](area.praha);
  // divadla / arts_centre / kongresove / koncertni / vystavni haly (budova)
  way["building"]["amenity"~"theatre|arts_centre|conference_centre|concert_hall|exhibition_centre",i](area.praha);
  relation["building"]["amenity"~"theatre|arts_centre|conference_centre|concert_hall|exhibition_centre",i](area.praha);
  // velke knihovny (budova)
  way["building"]["amenity"="library"](area.praha);
  relation["building"]["amenity"="library"](area.praha);
);
out geom;
"""


# Culture ANCHORS (maly set). Culture tag casto NEsedi na building polygonu, ale
# na NODE uvnitr budovy - nebo na WAY/RELACI (area/site), ktera sama o sobe neni
# pouzitelny building (proto ji kolo 8 minulo: Narodni muzeum, Klementinum,
# Obecni dum maji culture tag na ne-building entite). Bereme nwr a u way/relace
# pouzijeme `out center` (teziste padne dovnitr skutecne budovy). Tyto kotvy se
# nasledne prostorove sparuji s building polygonem.
# `out center body` da u nodu lat/lon, u way/relace center + tagy (name + kind).
OVERPASS_NODES_QUERY = f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];
{PRAGUE_AREA}->.praha;
(
  nwr["tourism"="museum"](area.praha);
  nwr["amenity"~"theatre|arts_centre|concert_hall|conference_centre|exhibition_centre",i](area.praha);
  nwr["amenity"="library"](area.praha);
);
out center body;
"""


def build_buildings_bbox_query(bbox):
    """
    Dotaz na vsechny BUILDING ways/relations v dane bbox (south,west,north,east),
    `out geom` -> plna geometrie prstencu. Bbox drzi fetch ohraniceny (jen
    centralni Praha), nestahujeme vsechny budovy mesta.
    """
    s, w, n, e = bbox
    return f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];
(
  way["building"]({s},{w},{n},{e});
  relation["building"]["type"="multipolygon"]({s},{w},{n},{e});
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


# --- Geo pomocne funkce (reuse z build_ac_areas.py) ----------------------------
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


def ring_centroid(ring):
    """
    Teziste prstence [lon, lat] pres shoelace (vazene plochou). Pri degeneraci
    spadne na prosty prumer vrcholu. Vraci (lon, lat).
    """
    n = len(ring)
    if n == 0:
        return None
    # prosty prumer jako fallback
    avg_lon = sum(p[0] for p in ring) / n
    avg_lat = sum(p[1] for p in ring) / n
    if n < 4:
        return (avg_lon, avg_lat)
    a = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(n - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    a *= 0.5
    if abs(a) < 1e-12:
        return (avg_lon, avg_lat)
    cx /= (6.0 * a)
    cy /= (6.0 * a)
    return (cx, cy)


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


# --- Extrakce prstencu z OSM elementu (reuse z build_ac_areas.py) --------------
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
def classify(tags):
    """
    Z OSM tagu odvodi kind nebo None. Pozaduje skutecny BUILDING (tag `building`).
    Mapovani:
      tourism=museum               -> museum
      amenity=theatre              -> theatre
      amenity=arts_centre          -> theatre  (culture-ish)
      amenity=concert_hall         -> concert
      amenity=conference_centre    -> congress
      amenity=exhibition_centre    -> exhibition
      amenity=library              -> library
    Specificke pred obecnym: muzeum (tourism) ma prednost pred amenity.
    """
    if not tags.get("building"):
        return None  # guard: jen skutecne budovy

    if tags.get("tourism") == "museum":
        return "museum"

    amenity = (tags.get("amenity") or "").lower()
    amap = {
        "theatre": "theatre",
        "arts_centre": "theatre",
        "concert_hall": "concert",
        "conference_centre": "congress",
        "exhibition_centre": "exhibition",
        "library": "library",
    }
    return amap.get(amenity)


def classify_node(tags):
    """
    Jako classify(), ale pro culture NODE - NEpozaduje tag `building` (uzel ho
    nemá; budova se doplni az prostorovym joinem). Vraci kind nebo None.
    """
    if tags.get("tourism") == "museum":
        return "museum"
    amenity = (tags.get("amenity") or "").lower()
    amap = {
        "theatre": "theatre",
        "arts_centre": "theatre",
        "concert_hall": "concert",
        "conference_centre": "congress",
        "exhibition_centre": "exhibition",
        "library": "library",
    }
    return amap.get(amenity)


# --- Point-in-polygon (shapely Point.within, jinak ray-casting fallback) -------
def _point_in_ring(lon, lat, ring):
    """
    Ray-casting: lezi bod (lon,lat) uvnitr prstence [[lon,lat],...]? Hranice se
    pocita jako uvnitr jen nahodne; pro vyber obalujici budovy je to dostacujici.
    """
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        intersect = ((yi > lat) != (yj > lat)) and \
            (lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-15) + xi)
        if intersect:
            inside = not inside
        j = i
    return inside


def point_in_polygon(lon, lat, ring):
    """
    True pokud bod lezi v polygonu danem vnejsim prstencem `ring`. Pouzije
    shapely Point.within(Polygon) je-li dostupna, jinak ray-casting fallback.
    """
    if _HAVE_SHAPELY:
        try:
            poly = _ShPolygon(ring)
            if not poly.is_valid:
                poly = poly.buffer(0)
            return _ShPoint(lon, lat).within(poly) or poly.touches(_ShPoint(lon, lat))
        except Exception:
            pass  # spadni na ray-casting
    return _point_in_ring(lon, lat, ring)


def _bbox_of_ring(ring):
    """Rychly bounding box prstence: (min_lon, min_lat, max_lon, max_lat)."""
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return (min(lons), min(lats), max(lons), max(lats))


def building_rings_from_elements(elements):
    """
    Z OSM elementu (way/relation s building) vytahne kandidatske prstence jako
    seznam (etype, eid, ring, bbox). Multipolygon relace -> vice outer prstencu.
    """
    cands = []
    for el in elements:
        tags = el.get("tags") or {}
        if not tags.get("building"):
            continue
        etype = el.get("type", "way")
        eid = el.get("id")
        if etype == "way":
            ring = _way_ring(el)
            rings = [ring] if ring else []
        elif etype == "relation":
            rings = _relation_outer_rings(el)
        else:
            rings = []
        for ri, ring in enumerate(rings):
            if not ring or len(ring) < 4:
                continue
            suffix = "" if len(rings) == 1 else "-%d" % ri
            cands.append((etype, "%s%s" % (eid, suffix), ring, _bbox_of_ring(ring)))
    return cands


# --- Dedup vs ac-areas ---------------------------------------------------------
def load_ac_areas_centroids():
    """
    Nacte teziste vsech polygonu z public/data/ac-areas.geojson jako [(lon,lat)].
    Pri chybejicim/nevalidnim souboru vrati [] (dedup se proste neaplikuje).
    """
    if not os.path.exists(AC_AREAS_PATH):
        print("[dedup] ac-areas.geojson nenalezeno: %s (dedup preskocen)"
              % AC_AREAS_PATH, file=sys.stderr)
        return []
    try:
        with open(AC_AREAS_PATH, "r", encoding="utf-8") as f:
            fc = json.load(f)
    except Exception as e:
        print("[dedup] nelze nacist ac-areas.geojson: %s (dedup preskocen)" % e, file=sys.stderr)
        return []

    cents = []
    for feat in fc.get("features", []):
        geom = feat.get("geometry") or {}
        if geom.get("type") != "Polygon":
            continue
        coords = geom.get("coordinates") or []
        if not coords:
            continue
        outer = coords[0]
        c = ring_centroid([[float(p[0]), float(p[1])] for p in outer if len(p) >= 2])
        if c is not None:
            cents.append(c)
    print("[dedup] nacteno %d tezist z ac-areas pro dedup (do %.0f m)"
          % (len(cents), DEDUP_RADIUS_M), file=sys.stderr)
    return cents


# --- Sestaveni features --------------------------------------------------------
def features_from_osm(data, area_centroids):
    feats = []
    seen_ids = set()
    stats = {"dropped_geom": 0, "dropped_class": 0, "dropped_small": 0,
             "dropped_dedup": 0, "rings_from_rel": 0, "rings_from_way": 0}

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
            if area < MIN_AREA_M2:
                stats["dropped_small"] += 1
                continue

            # dedup vs ac-areas (teziste do DEDUP_RADIUS_M)
            cen = ring_centroid(ring)
            if cen is not None and area_centroids:
                clon, clat = cen
                is_dup = False
                for alon, alat in area_centroids:
                    if haversine_m(clat, clon, alat, alon) <= DEDUP_RADIUS_M:
                        is_dup = True
                        break
                if is_dup:
                    stats["dropped_dedup"] += 1
                    continue

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
                    "name": name or "",
                    "kind": kind,
                    "cooling": "ac",
                    "area_m2": int(round(area)),
                    "source": "OSM",
                },
            })

    print("[osm] features: %d | vyrazeno bez_geom=%d, mimo_kategorii=%d, male=%d, dedup=%d"
          % (len(feats), stats["dropped_geom"], stats["dropped_class"],
             stats["dropped_small"], stats["dropped_dedup"]), file=sys.stderr)
    print("[osm] prstence: z ways=%d, z relaci(outer)=%d"
          % (stats["rings_from_way"], stats["rings_from_rel"]), file=sys.stderr)
    return feats


# --- Point-in-polygon vrstva (culture node -> obalujici budova) ----------------
def _anchor_coords(el):
    """
    Bod kotvy: u nodu lat/lon, u way/relace center (`out center`). (lon, lat)
    nebo None. Center way/relace lezi prakticky vzdy uvnitr jeji budovy.
    """
    if "lat" in el and "lon" in el:
        return float(el["lon"]), float(el["lat"])
    c = el.get("center")
    if c and "lat" in c and "lon" in c:
        return float(c["lon"]), float(c["lat"])
    return None


def fetch_culture_nodes():
    """
    Stahne culture KOTVY (nodes + ways + relations) v Praze. U way/relace bere
    `center` jako bod do point-in-polygon (nektere flagshipy - Narodni muzeum,
    Klementinum, Obecni dum - nemaji culture tag na nodu ani na building polygonu,
    ale na ne-building way/relaci). Vraci seznam dict {lon, lat, name, kind}.
    Pri selhani Overpassu vrati [] (pip vrstva se proste neaplikuje).
    """
    try:
        data = fetch_overpass(OVERPASS_NODES_QUERY)
    except Exception as e:
        print("[pip] culture kotvy fetch selhal: %s (pip vrstva preskocena)" % e, file=sys.stderr)
        return []
    anchors = []
    n_node = n_way = n_rel = 0
    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        kind = classify_node(tags)
        if kind is None:
            continue
        coords = _anchor_coords(el)
        if coords is None:
            continue
        lon, lat = coords
        etype = el.get("type")
        if etype == "node":
            n_node += 1
        elif etype == "way":
            n_way += 1
        elif etype == "relation":
            n_rel += 1
        anchors.append({
            "lon": lon,
            "lat": lat,
            "name": (tags.get("name") or "").strip(),
            "kind": kind,
        })
    print("[pip] culture kotvy: %d (node=%d, way=%d, relation=%d)"
          % (len(anchors), n_node, n_way, n_rel), file=sys.stderr)
    return anchors


def fetch_candidate_buildings(nodes):
    """
    Stahne kandidatske building polygony v ohranicene centralni bbox. Bere jen
    ty bbox/sub-bboxy, ktere obsahuji aspon jeden culture node (setri fetch).
    Pri prilis velke odpovedi se vraci k sub-bboxum. Vraci seznam kandidatu
    (etype, eid, ring, bbox). Pri uplnem selhani vraci [].
    """
    if not nodes:
        return []

    def _bbox_has_node(bbox):
        s, w, n, e = bbox
        return any(s <= nd["lat"] <= n and w <= nd["lon"] <= e for nd in nodes)

    # nejdriv zkus jeden dotaz na celou centralni bbox (pokud v ni jsou nody)
    if _bbox_has_node(CENTRAL_BBOX):
        try:
            data = fetch_overpass(build_buildings_bbox_query(CENTRAL_BBOX))
            cands = building_rings_from_elements(data.get("elements", []))
            print("[pip] kandidatskych budov (cela bbox): %d" % len(cands), file=sys.stderr)
            if cands:
                return cands
        except Exception as e:
            print("[pip] cela centralni bbox selhala (%s), zkousim sub-bboxy..." % e, file=sys.stderr)

    # fallback: po sub-bboxech (jen tech, kde je aspon jeden node)
    all_cands = []
    for i, bb in enumerate(CENTRAL_SUBBOXES, start=1):
        if not _bbox_has_node(bb):
            continue
        try:
            data = fetch_overpass(build_buildings_bbox_query(bb))
            cands = building_rings_from_elements(data.get("elements", []))
            print("[pip] sub-bbox %d/%d: %d kandidatu" % (i, len(CENTRAL_SUBBOXES), len(cands)), file=sys.stderr)
            all_cands.extend(cands)
        except Exception as e:
            print("[pip] sub-bbox %d selhal: %s (preskocen)" % (i, e), file=sys.stderr)
    print("[pip] kandidatskych budov (sub-bboxy): %d" % len(all_cands), file=sys.stderr)
    return all_cands


def features_from_point_in_polygon(nodes, candidates, area_centroids):
    """
    Pro kazdy culture node najde OBALUJICI budovu (prvni kandidat, do jehoz
    prstence node padne; pri vice kandidatech vybere nejmensi plochou - tesnejsi
    budovu). Budova se stane landmarkem (kind z node). Filtr area_m2 >= 1500,
    dedup vs ac-areas. Vraci seznam features (vcetne pomocnych _osm_etype/_osm_eid
    pro nasledny merge dedup podle OSM id).
    """
    feats = []
    used_buildings = set()  # (etype, eid) uz prirazene -> jeden polygon = jeden landmark
    stats = {"no_match": 0, "small": 0, "dedup_area": 0, "matched": 0, "nearest_fallback": 0}

    for nd in nodes:
        lon, lat = nd["lon"], nd["lat"]
        best = None  # (area, etype, eid, ring)
        for (etype, eid, ring, bb) in candidates:
            min_lon, min_lat, max_lon, max_lat = bb
            if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
                continue
            if not point_in_polygon(lon, lat, ring):
                continue
            area = ring_area_m2(ring)
            if best is None or area < best[0]:
                best = (area, etype, eid, ring)

        # nearest-building fallback: kotva nepadla DOVNITR zadne budovy
        # (typicky site relace s center v mezere) -> nejblizsi velka budova do
        # NEAREST_FALLBACK_M podle teziste.
        if best is None:
            near = None  # (dist_m, area, etype, eid, ring)
            for (etype, eid, ring, bb) in candidates:
                min_lon, min_lat, max_lon, max_lat = bb
                # rychly bbox-guard rozsireny o ~ fallback prah (~0.0011 deg)
                if not (min_lon - 0.0011 <= lon <= max_lon + 0.0011
                        and min_lat - 0.0008 <= lat <= max_lat + 0.0008):
                    continue
                area = ring_area_m2(ring)
                if area < MIN_AREA_M2:
                    continue
                cen = ring_centroid(ring)
                if cen is None:
                    continue
                dist_m = haversine_m(lat, lon, cen[1], cen[0])
                if dist_m > NEAREST_FALLBACK_M:
                    continue
                if near is None or dist_m < near[0]:
                    near = (dist_m, area, etype, eid, ring)
            if near is not None:
                _, area, etype, eid, ring = near
                best = (area, etype, eid, ring)
                stats["nearest_fallback"] += 1

        if best is None:
            stats["no_match"] += 1
            continue

        area, etype, eid, ring = best
        key = (etype, eid)
        if key in used_buildings:
            # tato budova uz je landmark z jineho node -> nepridavej znovu
            continue

        if area < MIN_AREA_M2:
            stats["small"] += 1
            continue

        # dedup vs ac-areas (teziste do DEDUP_RADIUS_M)
        cen = ring_centroid(ring)
        if cen is not None and area_centroids:
            clon, clat = cen
            if any(haversine_m(clat, clon, alat, alon) <= DEDUP_RADIUS_M
                   for alon, alat in area_centroids):
                stats["dedup_area"] += 1
                continue

        simp = simplify_ring(ring, SIMPLIFY_TOL)
        if not simp or len(simp) < 4:
            continue

        used_buildings.add(key)
        fid = "osm-%s-%s" % (etype, eid)
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [simp]},
            "properties": {
                "id": fid,
                "name": nd["name"] or "",
                "kind": nd["kind"],
                "cooling": "ac",
                "area_m2": int(round(area)),
                "source": "OSM",
            },
            "_osm_etype": etype,
            "_osm_eid": eid,
            "_centroid": cen,
        })
        stats["matched"] += 1

    print("[pip] sparovano %d budov (z toho nearest-fallback=%d) | bez_obalu=%d, male=%d, dedup_vs_areas=%d"
          % (stats["matched"], stats["nearest_fallback"], stats["no_match"],
             stats["small"], stats["dedup_area"]),
          file=sys.stderr)
    return feats


def merge_landmarks(query_feats, pip_feats):
    """
    Sloucenni query-based + point-in-polygon vrstvy. DEDUP:
      (a) podle OSM building id (`properties.id`),
      (b) podle teziste do LANDMARK_DEDUP_M (Rudolfinum / Narodni divadlo apod.
          z kola 8 nesmi byt pridany dvakrat).
    Query vrstva ma prednost (drzi se, pip pridava jen nove). Vraci finalni
    seznam features (bez pomocnych podtrzitkovych poli).
    """
    out = []
    seen_ids = set()
    centroids = []  # (lon, lat) uz prijatych landmarku

    def _feat_centroid(f):
        coords = f.get("geometry", {}).get("coordinates") or []
        if not coords:
            return None
        return ring_centroid([[float(p[0]), float(p[1])] for p in coords[0] if len(p) >= 2])

    # 1) query vrstva (prednost)
    for f in query_feats:
        fid = f["properties"]["id"]
        seen_ids.add(fid)
        c = _feat_centroid(f)
        if c is not None:
            centroids.append(c)
        out.append(f)

    # 2) pip vrstva - pridej jen nove
    added = 0
    skip_id = 0
    skip_cent = 0
    for f in pip_feats:
        fid = f["properties"]["id"]
        if fid in seen_ids:
            skip_id += 1
            continue
        c = f.get("_centroid") or _feat_centroid(f)
        is_dup = False
        if c is not None:
            clon, clat = c
            for plon, plat in centroids:
                if haversine_m(clat, clon, plat, plon) <= LANDMARK_DEDUP_M:
                    is_dup = True
                    break
        if is_dup:
            skip_cent += 1
            continue
        seen_ids.add(fid)
        if c is not None:
            centroids.append(c)
        clean = {"type": "Feature", "geometry": f["geometry"], "properties": f["properties"]}
        out.append(clean)
        added += 1

    print("[merge] query=%d + pip pridano=%d (preskoceno: stejne_id=%d, teziste<%.0fm=%d) -> celkem %d"
          % (len(query_feats), added, skip_id, LANDMARK_DEDUP_M, skip_cent, len(out)), file=sys.stderr)
    return out, added


# --- Hlavni beh ----------------------------------------------------------------
def main():
    try:
        data = fetch_overpass(OVERPASS_QUERY)
    except Exception as e:
        print("[CHYBA] Overpass selhal: %s" % e, file=sys.stderr)
        print("[CHYBA] existujici ac-landmarks.geojson NEBUDE prepsan.", file=sys.stderr)
        return 2

    area_centroids = load_ac_areas_centroids()
    query_feats = features_from_osm(data, area_centroids)
    if not query_feats:
        print("[CHYBA] zadne polygony - ac-landmarks.geojson NEBUDE prepsan.", file=sys.stderr)
        return 3

    # --- Round 9: point-in-polygon doplnek (culture node -> obalujici budova) ---
    # Failure-safe: kdyz kterykoli krok pip vrstvy selze, drzime se query vrstvy
    # (nikdy nezahodime jiz nalezene landmarky kvuli selhani spatial joinu).
    pip_added = 0
    try:
        nodes = fetch_culture_nodes()
        candidates = fetch_candidate_buildings(nodes)
        pip_feats = features_from_point_in_polygon(nodes, candidates, area_centroids)
        feats, pip_added = merge_landmarks(query_feats, pip_feats)
    except Exception as e:
        print("[pip] VAROVANI: point-in-polygon vrstva selhala (%s) - pouzivam jen query vrstvu" % e,
              file=sys.stderr)
        feats = query_feats

    fc = {
        "type": "FeatureCollection",
        "metadata": {
            "title": "Chladek - velke klimatizovane verejne budovy jako plochy (muzea, divadla, koncertni/kongresove/vystavni haly, knihovny)",
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

    # par ukazkovych nazvu (jen pojmenovane)
    sample_names = [f["properties"]["name"] for f in feats if f["properties"]["name"]][:8]

    print("\n=== VYSLEDEK ===")
    print("Soubor: %s" % OUT_PATH)
    print("Polygonu celkem: %d" % len(feats))
    print("  z toho kolo 8 (query): %d" % len(query_feats))
    print("  pridano kolo 9 (point-in-polygon): %d" % pip_added)
    print("Velikost: %.1f KB" % size_kb)
    print("shapely=%s, requests=%s" % (_HAVE_SHAPELY, _HAVE_REQUESTS))
    print("\nPodle kind:")
    for k in sorted(by_kind, key=lambda x: -by_kind[x]):
        print("  %-12s %d" % (k, by_kind[k]))
    print("\nUkazkove nazvy:")
    for nm in sample_names:
        print("  - %s" % nm)

    # explicitni kontrola high-profile budov (kvuli kterym kolo 9 vzniklo).
    # Hledame diacritics-insensitive a podle skutecnych OSM nazvu budov:
    #  - Klementinum  -> budova nese nazev "Narodni knihovna Ceske republiky"
    #  - Obecni dum    -> centralni budova nese nazev "Smetanova sin" (koncertni sal)
    #  - Veletrzni palac -> "Narodni galerie v Praze - Veletrzni palac"
    def _ascii_fold(s):
        repl = {
            "á": "a", "č": "c", "ď": "d", "é": "e", "ě": "e", "í": "i", "ň": "n",
            "ó": "o", "ř": "r", "š": "s", "ť": "t", "ú": "u", "ů": "u", "ý": "y",
            "ž": "z",
        }
        return "".join(repl.get(ch, ch) for ch in (s or "").lower())

    all_names = [f["properties"].get("name") or "" for f in feats]
    folded = [(_ascii_fold(nm), nm) for nm in all_names]
    flagships = ["Narodni muzeum", "Veletrzni palac", "Klementinum", "Obecni dum"]
    flag_needles = {
        # (folded substring varianty, vcetne nazvu budovy, pod kterym landmark v OSM je)
        "Narodni muzeum": ("narodni muzeum", "national museum"),
        "Veletrzni palac": ("veletrzni palac",),
        "Klementinum": ("klementinum", "clementinum", "narodni knihovna ceske republiky"),
        "Obecni dum": ("obecni dum", "smetanova sin"),
    }
    print("\nKontrola flagship budov (podle nazvu):")
    for label in flagships:
        needles = flag_needles[label]
        hit = next((orig for fold, orig in folded
                    if any(nd in fold for nd in needles)), None)
        if hit:
            print("  [OK] %s -> '%s'" % (label, hit))
        else:
            print("  [CHYBI] %s" % label)
    return 0


if __name__ == "__main__":
    sys.exit(main())
