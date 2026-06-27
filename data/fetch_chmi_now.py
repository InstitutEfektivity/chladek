#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_chmi_now.py – živá MĚŘENÁ teplota vzduchu ČHMÚ pro pražské stanice.

Hlavní (headline) datová vrstva Chládku: reálná 2m teplota vzduchu z otevřených
dat ČHMÚ („now" – aktuální měření v 10min krocích). Bez API klíče.

Postup:
  1. Stáhne registr stanic meta1-YYYYMMDD.json (dnešek; při 404 zkusí včerejšek).
     Sloupce: WSI, GH_ID, FULL_NAME, GEOGR1(=lon), GEOGR2(=lat), ELEVATION, BEGIN_DATE.
  2. Vyfiltruje pražské stanice (bbox 14.22–14.71 E / 49.94–50.18 N a/nebo název
     „Praha...").
  3. Pro každou stáhne její datový soubor 10m-{WSI}-{YYYYMMDD}.json. Některé
     stanice z registru aktuální soubor nemají (404) – ty se přeskočí. Zahrnou se
     jen stanice, které dnes vrátily soubor s reálným čtením teploty.
  4. Z řádků data.data.values [STATION, ELEMENT, DT, VAL, FLAG, QUALITY] vezme
     ELEMENT == "T" (2m teplota) a řádek s NEJNOVĚJŠÍM DT → temp_c + measuredAt.

Výstup `public/data/temp-stations.geojson` (FeatureCollection, WGS84 [lon, lat]):
  properties: { id, name, temp_c, measuredAt, klass ("pro"|"auto"), source }

Robustnost: při selhání stažení registru se NEPŘEPISUJE existující snapshot
(exit nonzero). UTF-8 píše Python přímo (ensure_ascii=False).

Spuštění:  python data/fetch_chmi_now.py
Atribuce:  © ČHMÚ – otevřená data (opendata.chmi.cz).
Aktualizace zdroje: ~10min. Spouští se přes GitHub Action cron (hodinově).
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_PATH = os.path.join(REPO, "public", "data", "temp-stations.geojson")

META_URL = "https://opendata.chmi.cz/meteorology/climate/now/metadata/meta1-%s.json"
DATA_URL = "https://opendata.chmi.cz/meteorology/climate/now/data/10m-%s-%s.json"

# Pražský bounding box (min_lon, min_lat, max_lon, max_lat).
PRAHA_BBOX = (14.22, 49.94, 14.71, 50.18)

HTTP_TIMEOUT = 30
UA = {"User-Agent": "chladek-data-pipeline/1.0 (Institut Efektivity)", "Accept": "application/json"}
SOURCE_LABEL = "ČHMÚ"  # "ČHMÚ"


def _get_json(url):
    """GET libovolného JSON endpointu. Vrací parsed dict, vyhodí výjimku při chybě."""
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        return json.load(r)


def fetch_metadata():
    """Stáhne registr stanic (dnešek; při 404 zkusí včerejšek). Vrací (rows, day)."""
    now = datetime.now(timezone.utc)
    last_err = None
    for back in (0, 1):
        day = (now - timedelta(days=back)).strftime("%Y%m%d")
        try:
            data = _get_json(META_URL % day)
            rows = data["data"]["data"]["values"]
            print("[meta] registr %s: %d stanic" % (day, len(rows)), file=sys.stderr)
            return rows, day
        except Exception as e:  # noqa: BLE001
            last_err = e
            print("[meta] %s nedostupne (%s)" % (day, repr(e)[:80]), file=sys.stderr)
    raise RuntimeError("registr stanic nedostupny: %s" % last_err)


def _in_prague(lon, lat):
    min_lon, min_lat, max_lon, max_lat = PRAHA_BBOX
    return (min_lon <= lon <= max_lon) and (min_lat <= lat <= max_lat)


def select_prague(rows):
    """Z registru vybere pražské stanice. Vrací list dictů {wsi, name, lon, lat, klass}."""
    out = []
    for row in rows:
        try:
            wsi = row[0]
            name = row[2]
            lon = float(row[3])
            lat = float(row[4])
        except (IndexError, TypeError, ValueError):
            continue
        name_pha = isinstance(name, str) and name.startswith("Praha")
        if not (_in_prague(lon, lat) or name_pha):
            continue
        # mimo Prahu i přes název (Praha, Brdy je u Příbrami) zahodíme podle bbox
        if name_pha and not _in_prague(lon, lat):
            continue
        # klasifikace: profesionální (0-20000-0) vs automatická (0-203-0)
        klass = "pro" if "-20000-" in wsi else "auto"
        out.append({"wsi": wsi, "name": name, "lon": lon, "lat": lat, "klass": klass})
    return out


def latest_temp(wsi, day):
    """Stáhne datový soubor stanice a vrátí (temp_c, measuredAt_iso) nebo None.

    None když soubor neexistuje (404) nebo neobsahuje žádné čtení teploty (T).
    """
    url = DATA_URL % (wsi, day)
    try:
        data = _get_json(url)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        print("[data] %s HTTP %s" % (wsi, e.code), file=sys.stderr)
        return None
    except Exception as e:  # noqa: BLE001
        print("[data] %s chyba: %s" % (wsi, repr(e)[:60]), file=sys.stderr)
        return None

    try:
        values = data["data"]["data"]["values"]
    except (KeyError, TypeError):
        return None

    best_dt = None
    best_val = None
    for r in values:
        if len(r) < 4 or r[1] != "T":
            continue
        dt = r[2]
        val = r[3]
        if dt is None or val is None:
            continue
        if best_dt is None or dt > best_dt:
            best_dt = dt
            best_val = val
    if best_dt is None or best_val is None:
        return None
    try:
        return round(float(best_val), 1), best_dt
    except (TypeError, ValueError):
        return None


def main():
    try:
        rows, day = fetch_metadata()
    except Exception as e:  # noqa: BLE001 – registr nedostupný → nepřepisuj snapshot
        print("[chmi] CHYBA: %s – ponechavam existujici snapshot beze zmeny." % repr(e)[:120],
              file=sys.stderr)
        sys.exit(1)

    stations = select_prague(rows)
    print("[chmi] prazskych stanic v registru: %d" % len(stations), file=sys.stderr)

    features = []
    for st in stations:
        res = latest_temp(st["wsi"], day)
        if res is None:
            continue
        temp_c, measured_at = res
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(st["lon"], 6), round(st["lat"], 6)]},
            "properties": {
                "id": st["wsi"],
                "name": st["name"],
                "temp_c": temp_c,
                "measuredAt": measured_at,
                "klass": st["klass"],
                "source": SOURCE_LABEL,
            },
        })

    if not features:
        print("[chmi] CHYBA: zadna prazska stanice nevratila aktualni cteni – "
              "ponechavam existujici snapshot beze zmeny.", file=sys.stderr)
        sys.exit(1)

    out = {
        "type": "FeatureCollection",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "ČHMÚ – otevrena data (opendata.chmi.cz)",
        "features": features,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")

    print("OK: %d prazskych stanic s aktualnim ctenim -> %s" % (len(features), OUT_PATH))
    for feat in features[:3]:
        p = feat["properties"]
        # ASCII-safe vypis (nazev muze mit diakritiku)
        nm = p["name"].encode("ascii", "replace").decode("ascii")
        print("  - %s: %.1f C @ %s [%s]" % (nm, p["temp_c"], p["measuredAt"], p["klass"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
