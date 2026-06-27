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
  © IPR Praha „Oázy chladu" (CC BY) – pítka, kašny/fontány, koupání (Geoportál Praha).

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
# urllib je potřeba vždy (IPR GET stahování, i když requests existuje).
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

# --- IPR Praha „Oázy chladu" (statické vodní vrstvy) --------------------------
# Open data Geoportál Praha (CC BY, © IPR Praha), bez API klíče. Pro každý
# dataset primární opendata endpoint + ArcGIS FeatureServer fallback (oba vrací
# GeoJSON ve WGS84/CRS84, souřadnice [lon, lat]).
IPR_DATASETS = {
    "pitka": {
        "category": "fountain",
        "cooling": "water",
        "default_name": "Pítko",
        "urls": [
            "https://opendata.geoportalpraha.cz/api/download/v1/items/ae0ef46774394e09a91850fb9b826788/geojson?layers=0",
            "https://mp.iprpraha.cz/arcgis/rest/services/Hosted/AGD_CUR_AGD_OCH_PITKA_B/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
        ],
    },
    "fontany": {
        "category": "fountain",
        "cooling": "water",
        "default_name": "Kašna / fontána",
        "urls": [
            "https://opendata.geoportalpraha.cz/api/download/v1/items/3d3add84fb784ed297725c566f149a51/geojson?layers=0",
            "https://mp.iprpraha.cz/arcgis/rest/services/Hosted/AGD_CUR_AGD_OCH_FONTANY_B/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
        ],
    },
    "koupani": {
        "category": "pool",
        "cooling": "water",
        "default_name": "Koupání",
        "urls": [
            "https://opendata.geoportalpraha.cz/api/download/v1/items/8d435d33cd5d431cbaeda5837b3d3a77/geojson?layers=0",
            "https://mp.iprpraha.cz/arcgis/rest/services/Hosted/AGD_CUR_AGD_OCH_KOUPANI_B/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
        ],
    },
}

# Práh deduplikace IPR vs OSM vodních bodů (pítka/fontány se překrývají).
# IPR je kurátorštější → má prioritu, OSM duplikát v tomto poloměru zahodíme.
IPR_OSM_DEDUP_M = 30.0

# Hranice Prahy (hrubý bounding box) pro sanity check IPR bodů.
PRAHA_BBOX = (12.0, 49.5, 15.0, 50.5)  # (min_lon, min_lat, max_lon, max_lat)


# --- Overpass dotaz ------------------------------------------------------------
# Jeden dotaz, fair-use. `out center` u ways/relations vrací těžiště (center).
OVERPASS_QUERY = f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];
{PRAGUE_AREA}->.praha;
(
  // POZN.: knihovny, muzea, kina a obchodní centra (mall) jsou nově řešeny
  // samostatnými autoritativními vrstvami (ac-culture.geojson, ac-areas.geojson),
  // proto je tu už NEsbíráme – jinak by se dvojitě renderovaly.
  // kostely (jen pojmenované)
  nwr["amenity"="place_of_worship"]["name"](area.praha);
  // bazény / koupaliště / aquaparky
  nwr["leisure"="swimming_pool"](area.praha);
  nwr["leisure"="water_park"](area.praha);
  // kryté plavecké haly (budovy/haly, odlišné od leisure=swimming_pool bazénů)
  nwr["leisure"="sports_centre"]["sport"~"swimming",i](area.praha);
  // pítka
  nwr["amenity"="drinking_water"](area.praha);
  // fontány a prameny
  nwr["amenity"="fountain"](area.praha);
  nwr["natural"="spring"](area.praha);
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


# --- Kryté bazény (klimatizované haly) vs venkovní koupaliště -----------------
# Kurátorský whitelist substringů názvů, které spolehlivě označují KRYTÝ bazén /
# plaveckou halu (klimatizovaná budova → tier-A AC). Match case-insensitive.
INDOOR_POOL_NAME_HINTS = (
    "podol", "šutka", "sutka", "axa", "slavia", "hloubětín", "hloubetin",
    "jedenáctka", "barrandov", "petynka", "ymca", "letňany lagoon",
    "aquapalace", "aquacentrum", "aquapark", "tyršův dům", "strahov",
    "radlice", "klíčov", "krytý bazén", "plavecký stadion", "plavecká hala",
    "krytý plavecký",
)
# Substringy, které naopak značí VENKOVNÍ koupání (přebíjejí whitelist).
OUTDOOR_POOL_NAME_HINTS = ("koupaliště", "koupaliste", "přírodní")

# Indikativní vnitřní teplota a poznámka pro kryté bazény.
INDOOR_POOL_TYPICAL_C = 26
INDOOR_POOL_NOTE = "krytý bazén (klimatizovaná hala)"


def _is_indoor_pool(tags):
    """
    Vrátí True, pokud jde o KRYTÝ (klimatizovaný) bazén/plaveckou halu.
    Logika dle zadání: INDOOR pokud platí některá z indoor podmínek A ZÁROVEŇ
    název neobsahuje venkovní indikátor (koupaliště/přírodní).
    """
    name = (tags.get("name") or "")
    nlow = name.lower()

    # venkovní indikátor v názvu přebíjí vše → není to krytá hala
    for bad in OUTDOOR_POOL_NAME_HINTS:
        if bad in nlow:
            return False

    # 1) sports_centre se sportem obsahujícím "swimming"
    if tags.get("leisure") == "sports_centre":
        sport = (tags.get("sport") or "").lower()
        if "swimming" in sport:
            return True

    # 2) má building=*, nebo indoor=yes, nebo covered=yes/roof
    if tags.get("building"):
        return True
    if tags.get("indoor") == "yes":
        return True
    if tags.get("covered") in ("yes", "roof"):
        return True

    # 3) název odpovídá indoor whitelistu
    for hint in INDOOR_POOL_NAME_HINTS:
        if hint in nlow:
            return True

    return False


# --- Mapování OSM tagů na schéma ----------------------------------------------
def classify(tags):
    """
    Z OSM tagů odvodí (category, cooling) nebo None pokud položku nechceme.
    Pořadí pravidel odpovídá zadání (specifické přebíjí obecné).
    """
    name = tags.get("name")

    # POZN.: knihovny, muzea, kina a obchodní centra (mall) jsou nově řešeny
    # samostatnými autoritativními vrstvami (ac-culture / ac-areas), proto je
    # tu už NEklasifikujeme – jinak by se dvojitě renderovaly.

    # kostel (jen s name)
    if tags.get("amenity") == "place_of_worship":
        if not name:
            return None
        return "church", "natural"

    # bazén / koupaliště (access != private) + aquapark + krytá plavecká hala
    # INDOOR (krytá hala) → cooling "ac"; OUTDOOR (koupaliště) → cooling "water".
    # Kategorie zůstává "pool" v obou případech (frontend ikona je na category="pool").
    if tags.get("leisure") == "swimming_pool":
        if tags.get("access") == "private":
            return None
        return "pool", ("ac" if _is_indoor_pool(tags) else "water")
    if tags.get("leisure") == "water_park":
        return "pool", ("ac" if _is_indoor_pool(tags) else "water")
    # plavecká hala / sportovní centrum se sportem swimming (krytá budova)
    if tags.get("leisure") == "sports_centre":
        sport = (tags.get("sport") or "").lower()
        if "swimming" in sport:
            return "pool", ("ac" if _is_indoor_pool(tags) else "water")
        return None

    # pítko
    if tags.get("amenity") == "drinking_water":
        return "fountain", "water"

    # fontána / pramen
    if tags.get("amenity") == "fountain" or tags.get("natural") == "spring":
        return "fountain", "water"

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
        note = None
        # krytý bazén (klimatizovaná hala): vlastní teplota + poznámka
        if category == "pool" and cooling == "ac":
            typical_c = INDOOR_POOL_TYPICAL_C
            note = INDOOR_POOL_NOTE

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
            "note": note,
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


# Kategorie, které jsou nově řešeny autoritativními vrstvami (ac-areas / ac-culture)
# – ruční řádky s těmito kategoriemi přeskakujeme, aby se nerenderovaly dvojitě.
MANUAL_SKIP_CATEGORIES = {"mall", "museum", "library"}


def features_from_manual():
    feats = []
    skipped_superseded = 0
    if not os.path.exists(MANUAL_CSV):
        print("[manual] CSV nenalezeno: %s" % MANUAL_CSV, file=sys.stderr)
        return feats
    with open(MANUAL_CSV, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader, start=1):
            name = (row.get("name") or "").strip()
            if not name:
                continue
            category = (row.get("category") or "").strip().lower()
            if category in MANUAL_SKIP_CATEGORIES:
                skipped_superseded += 1
                continue
            try:
                lat = float(row["lat"]); lon = float(row["lon"])
            except (KeyError, ValueError):
                print("[manual] řádek %d bez platných souřadnic, přeskočeno" % i, file=sys.stderr)
                continue
            address = (row.get("address") or "").strip() or None
            opening = (row.get("opening_hours") or "").strip() or None
            note = (row.get("note") or "").strip() or None
            cooling = (row.get("cooling") or "").strip()
            typical_c = _to_num(row.get("typical_c"))

            # Kryté bazény v ruční vrstvě → cooling "ac". Match: indoor whitelist,
            # nebo (category pool a název obsahuje krytý/plavecký/Aquacentrum/Šutka/Podolí).
            nlow = name.lower()
            is_indoor_manual = any(h in nlow for h in INDOOR_POOL_NAME_HINTS) and not any(
                bad in nlow for bad in OUTDOOR_POOL_NAME_HINTS)
            if not is_indoor_manual and category == "pool":
                for hint in ("krytý", "plavecký", "aquacentrum", "šutka", "podolí"):
                    if hint in nlow:
                        is_indoor_manual = True
                        break
            if is_indoor_manual:
                cooling = "ac"

            props = {
                "id": "manual-%d" % i,
                "name": name,
                "category": (row.get("category") or "").strip(),
                "cooling": cooling,
                "typical_c": typical_c,
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
    print("[manual] načteno %d ověřených míst (přeskočeno %d superseded: mall/museum/library)"
          % (len(feats), skipped_superseded), file=sys.stderr)
    return feats


# --- IPR Praha „Oázy chladu" ---------------------------------------------------
def _http_get_json(url, timeout=HTTP_TIMEOUT):
    """GET libovolného JSON/GeoJSON endpointu. Vrací parsed dict."""
    ua = {"User-Agent": "chladek-data-pipeline/1.0 (Institut Efektivity)"}
    if _HAVE_REQUESTS:
        resp = requests.get(url, timeout=timeout, headers=ua, allow_redirects=True)
        resp.raise_for_status()
        return resp.json()
    req = urllib.request.Request(url, headers=ua)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode("utf-8")
    return json.loads(raw)


def fetch_ipr_dataset(key, cfg):
    """
    Stáhne jeden IPR GeoJSON dataset. Zkusí primární opendata endpoint, při chybě
    ArcGIS fallback. Vrací list raw GeoJSON features (nebo [] když oba selžou).
    """
    last_err = None
    for url in cfg["urls"]:
        try:
            print("[ipr:%s] stahuji %s ..." % (key, url.split("?")[0]), file=sys.stderr)
            data = _http_get_json(url)
            feats = data.get("features", []) or []
            print("[ipr:%s] hotovo, %d raw features" % (key, len(feats)), file=sys.stderr)
            if feats:
                return feats
            # prázdná odpověď → zkus fallback
            print("[ipr:%s] prázdná odpověď, zkouším fallback" % key, file=sys.stderr)
        except Exception as e:
            last_err = e
            print("[ipr:%s] zdroj selhal: %s" % (key, e), file=sys.stderr)
    if last_err:
        print("[ipr:%s] VAROVÁNÍ: žádný zdroj nedostupný (%s) – vrstva přeskočena"
              % (key, last_err), file=sys.stderr)
    return []


def _ipr_point_coords(feat):
    """Z IPR feature vytáhne (lon, lat) z geometry, případně z polí x/y. None když nejde."""
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


def _in_prague(lon, lat):
    min_lon, min_lat, max_lon, max_lat = PRAHA_BBOX
    return (min_lon <= lon <= max_lon) and (min_lat <= lat <= max_lat)


def _ipr_note(key, props):
    """Sestaví lidsky čitelnou poznámku ze správce / provozu / přístupnosti / typu."""
    bits = []
    spravce = (props.get("spravce") or "").strip()
    provozovatel = (props.get("provozovatel") or "").strip()
    provoz_spec = (props.get("provoz_spec") or "").strip()
    pristupnost = props.get("pristupnost")
    typ = props.get("typ")

    if key in ("pitka", "fontany"):
        # typ fontán: 1 = fontána, 2 = kašna, 3 = ostatní vodní prvek
        if key == "fontany" and typ in (1, "1"):
            bits.append("fontána")
        elif key == "fontany" and typ in (2, "2"):
            bits.append("kašna")

    if provoz_spec and provoz_spec.upper() == "ZRUŠENO":
        bits.append("zrušeno")
    elif provoz_spec:
        bits.append(provoz_spec)

    # správce/provozovatel jen pokud nejde o „neznámo"/„nezadáno"
    def _useful(s):
        s = (s or "").strip().lower()
        return s and s not in ("neznámo", "nezadáno", "není v provozování pvk a.s.")

    if _useful(spravce):
        bits.append("správce: %s" % spravce)
    elif _useful(provozovatel):
        bits.append("provozovatel: %s" % provozovatel)

    if key == "pitka" and pristupnost in (2, "2"):
        bits.append("omezená přístupnost")

    return "; ".join(bits) if bits else None


def features_from_ipr():
    """Stáhne a zmapuje IPR „Oázy chladu" (pítka, fontány/kašny, koupání)."""
    feats = []
    for key, cfg in IPR_DATASETS.items():
        raw = fetch_ipr_dataset(key, cfg)
        n_ok = 0
        n_skip_zrus = 0
        n_skip_geo = 0
        for i, rf in enumerate(raw, start=1):
            props = rf.get("properties") or {}
            provoz_spec = (props.get("provoz_spec") or "").strip().upper()
            # zrušená pítka nemají na mapě chladných míst smysl
            if key == "pitka" and provoz_spec == "ZRUŠENO":
                n_skip_zrus += 1
                continue
            # koupaliště „mimo provoz" si necháme (info je v note), jen zrušená pítka filtrujeme

            coords = _ipr_point_coords(rf)
            if coords is None:
                n_skip_geo += 1
                continue
            lon, lat = coords
            if not _in_prague(lon, lat):
                n_skip_geo += 1
                continue

            name = (props.get("nazev") or "").strip() or cfg["default_name"]
            web = (props.get("web") or "").strip() or None

            props_out = {
                "id": "ipr-%s-%d" % (key, i),
                "name": name,
                "category": cfg["category"],
                "cooling": cfg["cooling"],
                "typical_c": None,
                "free_entry": None,
                "opening_hours": None,
                "address": web,  # u koupání bývá web; jinde None
                "source": "ipr",
                "note": _ipr_note(key, props),
            }
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                "properties": props_out,
                "_lat": lat,
                "_lon": lon,
            })
            n_ok += 1
        print("[ipr:%s] použito %d (vyřazeno: zrušená %d, mimo Prahu/bez geometrie %d)"
              % (key, n_ok, n_skip_zrus, n_skip_geo), file=sys.stderr)
    print("[ipr] sestaveno %d features celkem" % len(feats), file=sys.stderr)
    return feats


def dedup_ipr_vs_osm(features):
    """
    Odstraní OSM vodní body, které leží do IPR_OSM_DEDUP_M od IPR vodního bodu.
    Priorita IPR > OSM (IPR je kurátorštější). Dedup se dělá jen mezi vodními
    body (cooling == "water"), na blízkost (ne na jméno – IPR pítka mají name=None).
    Vrací odfiltrovaný seznam features.
    """
    ipr_water = [f for f in features
                 if f["properties"]["source"] == "ipr" and f["properties"]["cooling"] == "water"]
    if not ipr_water:
        return features

    removed = 0
    kept = []
    for f in features:
        p = f["properties"]
        if p["source"] == "osm" and p["cooling"] == "water":
            lat, lon = f["_lat"], f["_lon"]
            is_dup = False
            for ipr in ipr_water:
                if haversine_m(lat, lon, ipr["_lat"], ipr["_lon"]) <= IPR_OSM_DEDUP_M:
                    is_dup = True
                    break
            if is_dup:
                removed += 1
                continue
        kept.append(f)
    print("[dedup-ipr] odstraněno %d OSM vodních bodů překrytých IPR (do %.0f m)"
          % (removed, IPR_OSM_DEDUP_M), file=sys.stderr)
    return kept


# --- Deduplikace ---------------------------------------------------------------
def _norm_name(s):
    return " ".join((s or "").lower().split())


def dedup(features):
    """
    Sloučí položky se stejným (normalizovaným) jménem do DEDUP_RADIUS_M.
    Priorita: manual > ipr > osm. Kurátorská položka přepíše OSM duplikát.
    """
    _prio = {"manual": 0, "ipr": 1, "osm": 2}
    # kurátorské zdroje nejdřív, aby měly přednost při výběru "keepera"
    features_sorted = sorted(features, key=lambda f: _prio.get(f["properties"]["source"], 9))

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
    ipr_feats = features_from_ipr()

    # 1) IPR vs OSM dedup na blízkost (IPR pítka/fontány nemají name) – priorita IPR
    pre_ipr = osm_feats + ipr_feats
    pre_ipr = dedup_ipr_vs_osm(pre_ipr)

    # 2) jmenná dedup přes všechny zdroje (manual > ipr > osm)
    all_feats = manual_feats + pre_ipr
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
