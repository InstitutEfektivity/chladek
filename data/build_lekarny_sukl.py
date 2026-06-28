#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_lekarny_sukl.py — AUTORITATIVNI vrstva lekaren z otevrenych dat SUKL.

Lekarny jsou silny kandidat AC vrstvy: vyhlaska 84/2008 Sb. + Cesky lekopis
(uchovavani leciv "do 25 C") fakticky vynucuji v lete chlazeni prostoru. SUKL
vede uplny otevreny registr lekaren (mesicni CSV), ale BEZ GPS souradnic. Tento
skript:
  1) stahne SUKL "Seznam lekaren" (NKOD CSV), vyfiltruje Prahu,
  2) sezene souradnice LOKALNIM PAROVANIM proti dvema OSM vrstvam z Overpassu:
       a) lekarny (amenity=pharmacy) – nejpresnejsi (POI),
       b) vsechny prazske adresni body (node + addr:street + addr:housenumber)
          – jeden dotaz (~138 tis. bodu), index ulice+cislo -> souradnice.
     Zadne per-adresni API (Nominatim/Photon) -> zadny rate-limit, cron-safe.
  3) vyda validni GeoJSON FeatureCollection do public/data/lekarny.geojson.

NIKDY nefabrikuje souradnice – lekarna bez shody adresy se preskoci (zaloguje).

Schema kazde feature (frontend na nej spoleha):
  properties: id, name, address, web, pohotovost, cooling, tier, source
  geometry:   Point ve WGS84 [lon, lat]

Zdroje a atribuce:
  - SUKL (Statni ustav pro kontrolu leciv) - "Seznam lekaren", otevrena data.
  - Souradnice: (c) OpenStreetMap prispevatele (ODbL) - OSM adresni body + POI.

Spusteni:  python data/build_lekarny_sukl.py
Zavislosti: standardni knihovna; volitelne `requests`.
"""

import csv
import io
import json
import os
import re
import sys
import time
import unicodedata

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
OUT_PATH = os.path.join(REPO, "public", "data", "lekarny.geojson")

SUKL_CSV_URL = "https://opendata.sukl.cz/soubory/NKOD/LEKARNY/nkod_lekarny_seznam.csv"

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
PRAGUE_AREA = "area(3600435514)"
OVERPASS_TIMEOUT = 180
HTTP_TIMEOUT = 300
MAX_ATTEMPTS = 4
COORD_PRECISION = 6
UA = {"User-Agent": "chladek-data-pipeline/1.0 (Institut Efektivity; open-data map)"}

OSM_PHARMACY_QUERY = f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];
{PRAGUE_AREA}->.praha;
nwr["amenity"="pharmacy"](area.praha);
out center tags;
"""


def build_addr_query(streets):
    """Adresni dotaz ZUZENY na ulice, kde jsou SUKL lekarny (lehci nez cela Praha).
    Davkujeme nazvy ulic do regex alternace ^(a|b|...)$ (case-insensitive)."""
    clean = sorted({s.replace('"', "").strip() for s in streets if s and s.strip()})
    alt = "|".join(re.escape(s) for s in clean)
    return f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];
{PRAGUE_AREA}->.praha;
node["addr:street"~"^({alt})$",i]["addr:housenumber"](area.praha);
out tags qt;
"""


# --- HTTP ----------------------------------------------------------------------
CONNECT_TIMEOUT = 15  # fail-fast na mrtvy mirror (jinak visi na connectu minuty)


def _http_get(url):
    if _HAVE_REQUESTS:
        r = requests.get(url, headers=UA, timeout=(CONNECT_TIMEOUT, HTTP_TIMEOUT))
        r.raise_for_status()
        return r.content
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        return resp.read()


def _overpass(query):
    last_err = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        url = OVERPASS_URLS[(attempt - 1) % len(OVERPASS_URLS)]
        print("[overpass] pokus %d/%d -> %s..." % (attempt, MAX_ATTEMPTS, url), file=sys.stderr)
        t0 = time.time()
        try:
            if _HAVE_REQUESTS:
                r = requests.post(url, data={"data": query}, headers=UA,
                                  timeout=(CONNECT_TIMEOUT, HTTP_TIMEOUT))
                r.raise_for_status()
                data = r.json()
            else:
                body = urllib.parse.urlencode({"data": query}).encode("utf-8")
                req = urllib.request.Request(url, data=body, headers=UA)
                with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
            print("[overpass] hotovo za %.1fs, %d elementu"
                  % (time.time() - t0, len(data.get("elements", []))), file=sys.stderr)
            return data
        except Exception as e:
            last_err = e
            print("[overpass] pokus selhal: %s" % e, file=sys.stderr)
            if attempt < MAX_ATTEMPTS:
                time.sleep(8 * attempt)
    raise RuntimeError("Overpass nedostupne: %s" % last_err)


# --- Normalizace pro match -----------------------------------------------------
def _strip_diacritics(s):
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def norm_street(s):
    """Klic ulice: bez diakritiky, lowercase, jen alnum oddelene mezerou."""
    s = _strip_diacritics(s or "").lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def hn_parts(num):
    """Mnozina ciselnych skupin v cisle domu ('775/8' -> {'775','8'})."""
    return set(re.findall(r"\d+", num or ""))


def split_street_num(ulice):
    """'Vaclavske namesti 775/8' -> ('Vaclavske namesti', '775/8')."""
    ulice = (ulice or "").strip()
    m = re.match(r"^(.*?)[\s,]+(\d[\d/\-a-zA-Z]*)\s*$", ulice)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return ulice, ""


def _coords(el):
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    c = el.get("center") or {}
    if "lat" in c and "lon" in c:
        return float(c["lat"]), float(c["lon"])
    return None


# --- SUKL CSV ------------------------------------------------------------------
def fetch_sukl_prague():
    raw = _http_get(SUKL_CSV_URL)
    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for r in reader:
        mesto = (r.get("MESTO") or "").strip()
        psc = re.sub(r"\s+", "", (r.get("PSC") or ""))
        is_prague = mesto.lower().startswith("praha") or (psc[:1] == "1" and len(psc) == 5)
        if is_prague:
            rows.append(r)
    print("[sukl] Praha: %d lekaren (z CSV)" % len(rows), file=sys.stderr)
    return rows


# --- OSM indexy ----------------------------------------------------------------
def _build_street_index(elements):
    """dict[norm_street] -> list of {parts:set, lat, lon}."""
    idx = {}
    n = 0
    for el in elements:
        tags = el.get("tags") or {}
        street = tags.get("addr:street")
        if not street:
            continue
        c = _coords(el)
        if not c:
            continue
        key = norm_street(street)
        idx.setdefault(key, []).append({
            "parts": hn_parts(tags.get("addr:housenumber")),
            "lat": c[0], "lon": c[1],
        })
        n += 1
    return idx, n


# Genericka jmena lekaren – nematchovat podle jmena (prilis nejednoznacne).
_GENERIC_NAMES = {
    "lekarna", "pharmacy", "dr max", "drmax", "benu", "benu lekarna",
    "lekarna dr max", "pilulka", "lekarna benu", "magistra", "verejna lekarna",
}


def fetch_osm_pharmacy_index():
    """Vrati (street_idx, name_idx). name_idx mapuje jen UNIKATNI negenericka jmena."""
    data = _overpass(OSM_PHARMACY_QUERY)
    els = data.get("elements", [])
    street_idx, n = _build_street_index(els)
    # name index: norm_name -> list coords; pak ponechame jen ty s 1 vyskytem
    name_multi = {}
    for el in els:
        tags = el.get("tags") or {}
        nm = norm_street(tags.get("name") or "")  # reuse normalizace (alnum lower)
        if not nm or nm in _GENERIC_NAMES:
            continue
        c = _coords(el)
        if not c:
            continue
        name_multi.setdefault(nm, []).append((c[0], c[1]))
    name_idx = {k: v[0] for k, v in name_multi.items() if len(v) == 1}
    print("[osm] lekaren-POI s adresou: %d (ulic %d) | unikatnich jmen: %d"
          % (n, len(street_idx), len(name_idx)), file=sys.stderr)
    return street_idx, name_idx


def fetch_addr_index(streets):
    if not streets:
        return {}
    data = _overpass(build_addr_query(streets))
    idx, n = _build_street_index(data.get("elements", []))
    print("[osm] adresnich bodu: %d (ulic %d, dotaz na %d ulic)"
          % (n, len(idx), len(set(streets))), file=sys.stderr)
    return idx


def match_in_index(street, num, idx):
    """Najdi souradnice na stejne ulici a (idealne) cisle. Vraci (lat, lon) nebo None."""
    cands = idx.get(norm_street(street))
    if not cands:
        return None
    want = hn_parts(num)
    if want:
        # 1) presna shoda mnoziny cisel
        for c in cands:
            if c["parts"] == want:
                return (c["lat"], c["lon"])
        # 2) sdilena ciselna skupina (popisne/orientacni)
        for c in cands:
            if c["parts"] & want:
                return (c["lat"], c["lon"])
    # 3) ulice unikatni (jen jeden bod) -> vezmi ji
    if len(cands) == 1:
        return (cands[0]["lat"], cands[0]["lon"])
    return None


# --- Hlavni beh ----------------------------------------------------------------
def main():
    try:
        sukl = fetch_sukl_prague()
    except Exception as e:
        print("[CHYBA] SUKL CSV nedostupne: %s" % e, file=sys.stderr)
        print("[CHYBA] lekarny.geojson NEBUDE prepsan.", file=sys.stderr)
        return 2
    if not sukl:
        print("[CHYBA] zadne prazske lekarny v CSV.", file=sys.stderr)
        return 3

    use_addr = "--addr" in sys.argv  # opt-in: zuzeny adresni index (na verejnem Overpassu pomaly)

    # Ulice, na kterych SUKL lekarny jsou (pro zuzeny adresni dotaz).
    sukl_streets = []
    for r in sukl:
        st, _ = split_street_num((r.get("ULICE") or "").strip())
        if st:
            sukl_streets.append(st)

    try:
        pharm_idx, name_idx = fetch_osm_pharmacy_index()
    except Exception as e:
        print("[VAROVANI] OSM lekarny-POI nedostupne: %s" % e, file=sys.stderr)
        pharm_idx, name_idx = {}, {}
    addr_idx = {}
    if use_addr:
        try:
            addr_idx = fetch_addr_index(sukl_streets)
        except Exception as e:
            print("[VAROVANI] OSM adresni body nedostupne: %s" % e, file=sys.stderr)
            addr_idx = {}

    feats = []
    seen = set()
    stats = {"pharm": 0, "name": 0, "addr": 0, "skip": 0, "dup": 0}
    skipped_examples = []

    for r in sukl:
        kod = (r.get("KOD_LEKARNY") or "").strip() or (r.get("KOD_PRACOVISTE") or "").strip()
        name = (r.get("NAZEV") or "").strip() or "Lékárna"
        ulice = (r.get("ULICE") or "").strip()
        psc = re.sub(r"\s+", "", (r.get("PSC") or ""))
        www = (r.get("WWW") or "").strip()
        pohotovost = bool((r.get("POHOTOVOST") or "").strip())
        street, num = split_street_num(ulice)

        coords = match_in_index(street, num, pharm_idx) if pharm_idx else None
        if coords:
            stats["pharm"] += 1
        elif name_idx.get(norm_street(name)):
            coords = name_idx[norm_street(name)]
            stats["name"] += 1
        elif addr_idx:
            coords = match_in_index(street, num, addr_idx)
            if coords:
                stats["addr"] += 1
        if not coords:
            stats["skip"] += 1
            if len(skipped_examples) < 12:
                skipped_examples.append(ulice or name)
            continue

        fid = "sukl-%s" % kod if kod else "sukl-%d" % (len(feats) + 1)
        if fid in seen:
            stats["dup"] += 1
            continue
        seen.add(fid)

        lat, lon = coords
        if ulice and psc:
            addr = "%s, %s Praha" % (ulice, psc)
        elif ulice:
            addr = "%s, Praha" % ulice
        elif psc:
            addr = "%s Praha" % psc
        else:
            addr = None
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point",
                         "coordinates": [round(lon, COORD_PRECISION), round(lat, COORD_PRECISION)]},
            "properties": {
                "id": fid,
                "name": name,
                "address": addr,
                "web": www or None,
                "pohotovost": pohotovost,
                "cooling": "ac",
                "tier": "A",
                "source": "SÚKL",
            },
        })

    print("[match] lekarna-POI=%d, jmeno=%d, adresni-bod=%d, preskoceno(bez_shody)=%d, dup=%d"
          % (stats["pharm"], stats["name"], stats["addr"], stats["skip"], stats["dup"]), file=sys.stderr)
    if skipped_examples:
        print("[match] priklady bez shody: %s" % "; ".join(skipped_examples), file=sys.stderr)

    if not feats:
        print("[CHYBA] zadne lekarny s polohou - lekarny.geojson NEBUDE prepsan.", file=sys.stderr)
        return 4

    fc = {
        "type": "FeatureCollection",
        "metadata": {
            "title": "Chladek - lekarny (SUKL, autoritativni; AC z titulu uchovavani leciv)",
            "attribution": "Zdroj: SUKL (Seznam lekaren); souradnice (c) OpenStreetMap prispevatele (ODbL)",
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
    print("\n=== VYSLEDEK ===")
    print("Soubor: %s" % OUT_PATH)
    print("Lekaren s polohou: %d / %d (Praha)" % (len(feats), len(sukl)))
    print("  z toho lekarna-POI: %d, jmeno: %d, adresni-bod: %d"
          % (stats["pharm"], stats["name"], stats["addr"]))
    print("Bez shody (preskoceno): %d" % stats["skip"])
    print("Velikost: %.1f KB" % size_kb)
    print("requests=%s" % _HAVE_REQUESTS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
