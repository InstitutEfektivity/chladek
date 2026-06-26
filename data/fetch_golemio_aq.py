#!/usr/bin/env python3
"""Stáhne živé stanice kvality ovzduší z Golemio (Pražská datová platforma)
a uloží zredukovaný GeoJSON snapshot pro web Chládek.

Zdroj: https://api.golemio.cz/v2/airqualitystations (vyžaduje X-Access-Token).
Klíč se NIKDY necommituje – bere se z env GOLEMIO_API_KEY (lokálně z .env.local,
v GitHub Action z secrets). Klient čte jen výsledný statický GeoJSON.

Aktualizace zdroje: hodinově. Spouští se přes GitHub Action cron.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

API_URL = "https://api.golemio.cz/v2/airqualitystations"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "public", "data", "air-quality-stations.geojson")

# ČHMÚ index kvality ovzduší 1–6 → slovní stupeň + barva (laděno na paletu Chládku).
AQ_INDEX = {
    1: ("velmi dobrá", "#19B8CE"),
    2: ("dobrá", "#5FE0CF"),
    3: ("přijatelná", "#9BD17A"),
    4: ("zhoršená", "#F4C04E"),
    5: ("špatná", "#F4794E"),
    6: ("velmi špatná", "#D64545"),
}


def parse_index(raw):
    """'3A' -> (3, 'přijatelná', barva). Vrací (None, 'neznámá', šedá) když nelze."""
    if not raw:
        return None, "neznámá", "#9AA7AE"
    digit = next((c for c in str(raw) if c.isdigit()), None)
    if digit is None:
        return None, "neznámá", "#9AA7AE"
    n = int(digit)
    label, color = AQ_INDEX.get(n, ("neznámá", "#9AA7AE"))
    return n, label, color


def fetch():
    key = os.environ.get("GOLEMIO_API_KEY", "").strip()
    if not key:
        print("CHYBA: GOLEMIO_API_KEY není v env.", file=sys.stderr)
        sys.exit(2)
    req = urllib.request.Request(API_URL, headers={"X-Access-Token": key, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def main():
    try:
        raw = fetch()
    except Exception as exc:  # noqa: BLE001 – při selhání nepřepisuj existující snapshot
        print(f"Fetch selhal ({exc}) – ponechávám existující snapshot beze změny.", file=sys.stderr)
        sys.exit(1)

    out_features = []
    for feat in raw.get("features", []):
        props = feat.get("properties", {})
        geom = feat.get("geometry", {})
        coords = geom.get("coordinates")
        if not coords or len(coords) != 2:
            continue
        meas = props.get("measurement", {}) or {}
        n, label, color = parse_index(meas.get("AQ_hourly_index"))
        components = [
            {"type": c.get("type"), "value": (c.get("averaged_time") or {}).get("value")}
            for c in meas.get("components", [])
            if c.get("type")
        ]
        out_features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(coords[0], 6), round(coords[1], 6)]},
            "properties": {
                "id": props.get("id"),
                "name": props.get("name"),
                "district": props.get("district"),
                "aqIndex": n,
                "aqLabel": label,
                "aqColor": color,
                "components": components,
                "updatedAt": props.get("updated_at"),
            },
        })

    out = {
        "type": "FeatureCollection",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Golemio / Operátor ICT (Pražská datová platforma)",
        "features": out_features,
    }
    path = os.path.normpath(OUT_PATH)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"OK: {len(out_features)} stanic -> {path}")


if __name__ == "__main__":
    main()
