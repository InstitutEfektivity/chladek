#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_metro.py – stanice pražského metra (PID/DPP) jako „chládek pod zemí".

Statická vrstva stanic metra A/B/C v Praze z otevřených dat PID (ROPID). Metro
je v létě přirozeně chladnější – nástupiště jako útočiště před vedrem. Bez API
klíče. Stanice se prakticky nemění → generuje se jednorázově (cron netřeba).

Zdroj: https://data.pid.cz/stops/json/stops.json (~19 MB). Iteruje stopGroups;
ponechá skupiny, které mají v některém ze svých stops linku typu „metro"
(group-level mainTrafficType u tohoto feedu metro NEoznačuje). Linky A/B/C se
odvodí z lines[].name. Souřadnice: avgLat/avgLon skupiny.

Výstup `public/data/metro.geojson` (FeatureCollection, WGS84 [lon, lat]):
  properties: { id, name, lines (např. "A" / "A, C"), source }

Robustnost: při selhání fetch se NEPŘEPISUJE existující snapshot (exit nonzero).
UTF-8 píše Python přímo (ensure_ascii=False).

Spuštění:  python data/build_metro.py
Atribuce:  © PID / ROPID – otevřená data (data.pid.cz).
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_PATH = os.path.join(REPO, "public", "data", "metro.geojson")

STOPS_URL = "https://data.pid.cz/stops/json/stops.json"
HTTP_TIMEOUT = 120  # velký soubor (~19 MB)
UA = {"User-Agent": "chladek-data-pipeline/1.0 (Institut Efektivity)"}

# Hranice Prahy (hrubý bounding box) pro sanity check.
PRAHA_BBOX = (12.0, 49.5, 15.0, 50.5)  # (min_lon, min_lat, max_lon, max_lat)

SOURCE_LABEL = "PID / ROPID"


def fetch_stops():
    req = urllib.request.Request(STOPS_URL, headers=UA)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        return json.load(r)


def _metro_lines(group):
    """Vrátí seřazenou množinu názvů metro linek (A/B/C) v dané skupině."""
    lines = set()
    for st in group.get("stops", []) or []:
        for ln in st.get("lines", []) or []:
            if ln.get("type") == "metro" and ln.get("name"):
                lines.add(str(ln["name"]).strip())
    return sorted(lines)


def _group_coords(group):
    """Vrátí (lon, lat) z avgLon/avgLat, fallback na první stop. None když nejde."""
    la, lo = group.get("avgLat"), group.get("avgLon")
    if la is not None and lo is not None:
        try:
            return float(lo), float(la)
        except (TypeError, ValueError):
            pass
    for st in group.get("stops", []) or []:
        if st.get("lat") is not None and st.get("lon") is not None:
            try:
                return float(st["lon"]), float(st["lat"])
            except (TypeError, ValueError):
                continue
    return None


def _in_prague(lon, lat):
    min_lon, min_lat, max_lon, max_lat = PRAHA_BBOX
    return (min_lon <= lon <= max_lon) and (min_lat <= lat <= max_lat)


def main():
    try:
        data = fetch_stops()
    except Exception as e:  # noqa: BLE001 – nepřepisuj existující snapshot
        print("[metro] CHYBA pri stahovani stops.json: %s" % repr(e)[:120], file=sys.stderr)
        if os.path.exists(OUT_PATH):
            print("[metro] ponechavam existujici snapshot beze zmeny.", file=sys.stderr)
        else:
            print("[metro] soubor zatim neexistuje – feed metro preskocen.", file=sys.stderr)
        sys.exit(1)

    groups = data.get("stopGroups", []) or []
    print("[metro] stopGroups celkem: %d" % len(groups), file=sys.stderr)

    features = []
    skipped_geo = 0
    for g in groups:
        lines = _metro_lines(g)
        if not lines:
            continue
        coords = _group_coords(g)
        if coords is None:
            skipped_geo += 1
            continue
        lon, lat = coords
        if not _in_prague(lon, lat):
            skipped_geo += 1
            continue
        node = g.get("node")
        fid = "pid-metro-%s" % (node if node is not None else len(features) + 1)
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": fid,
                "name": g.get("name") or g.get("fullName") or "Stanice metra",
                "lines": ", ".join(lines),
                "source": SOURCE_LABEL,
            },
        })

    if not features:
        print("[metro] CHYBA: zadna stanice metra nenalezena – snapshot nezmenen.",
              file=sys.stderr)
        if os.path.exists(OUT_PATH):
            sys.exit(1)
        sys.exit(1)

    # stabilní pořadí podle názvu (reprodukovatelnost diffu)
    features.sort(key=lambda f: f["properties"]["name"])

    out = {
        "type": "FeatureCollection",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "PID / ROPID – otevrena data (data.pid.cz)",
        "features": features,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")

    print("OK: %d stanic metra -> %s (preskoceno bez geometrie/mimo Prahu: %d)"
          % (len(features), OUT_PATH, skipped_geo))
    sample = [f["properties"] for f in features
              if f["properties"]["name"] in ("Můstek", "Muzeum", "Dejvická", "Anděl", "Florenc")]
    for p in sample:
        nm = p["name"].encode("ascii", "replace").decode("ascii")
        print("  - %s [%s]" % (nm, p["lines"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
