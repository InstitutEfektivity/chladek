# Datová pipeline – Chládek

Generuje `public/data/venues.geojson` – mapu chladných veřejných míst v Praze
(klimatizované budovy, kostely, bazény, pítka, parky se stínem). Frontend
(`chladek-frontend`, MapLibre GL) čte tento soubor jako statickou geo-vrstvu.

## Jak spustit

```bash
python data/build_venues.py
```

Skript stáhne data z Overpass API, slije je s ruční kurátorskou vrstvou
(`manual_overlay.csv`), deduplikuje a zapíše `public/data/venues.geojson`.

- **Závislosti:** standardní knihovna Pythonu 3. Volitelně `requests`
  (jinak fallback na `urllib`).
- **Idempotence:** běh je deterministický (pevný Overpass dotaz, žádné
  hand-picked URL). Opakované spuštění přepíše výstup čerstvými daty.
- **UTF-8:** Python zapisuje soubor přímo v UTF-8 (žádná PowerShell pipeline,
  která by rozbila diakritiku).

## Zdroje dat

### 1. OpenStreetMap přes Overpass API (primární)

- Endpoint: `https://overpass-api.de/api/interpreter` (POST), s automatickým
  fallbackem na mirrors `overpass.kumi.systems` a `overpass.private.coffee`
  při 504/429/timeout (retry s backoffem, fair-use – jeden dotaz na pokus).
- Oblast: `area(3600435514)` = OSM relation 435514 = hl. m. Praha.
- Server-side timeout dotazu: 180 s.

**Jeden Overpass dotaz** sbírá tyto kategorie a mapuje je na schéma
`(category, cooling)`:

| OSM tag | category | cooling | poznámka |
|---|---|---|---|
| `amenity=library` | `library` | `ac` | knihovny |
| `tourism=museum` / `amenity=museum` | `museum` | `ac` | muzea, galerie |
| `amenity=place_of_worship` (jen s `name`) | `church` | `natural` | kostely jsou přirozeně chladné |
| `amenity=cinema` | `cinema` | `ac` | kina |
| `leisure=swimming_pool` (access != private) | `pool` | `water` | bazény, koupaliště |
| `leisure=water_park` | `pool` | `water` | aquaparky |
| `amenity=drinking_water` | `fountain` | `water` | pítka |
| `amenity=fountain` / `natural=spring` | `fountain` | `water` | fontány, prameny |
| `shop=mall` | `mall` | `ac` | obchodní centra |
| `air_conditioning=yes` (s `name`) | `cafe_food` / `shop_ac` | `ac` | explicitní klimatizace; `cafe_food` pro restaurant/cafe/fast_food/bar, jinak `shop_ac` |
| `leisure=park` (jen s `name`, plocha ≥ ~1 ha) | `park` | `shade` | viz filtr níže |

Surový dotaz (zkráceně – přesné znění v `build_venues.py`, proměnná
`OVERPASS_QUERY`):

```overpassql
[out:json][timeout:180];
area(3600435514)->.praha;
(
  nwr["amenity"="library"](area.praha);
  nwr["tourism"="museum"](area.praha);
  nwr["amenity"="museum"](area.praha);
  nwr["amenity"="place_of_worship"]["name"](area.praha);
  nwr["amenity"="cinema"](area.praha);
  nwr["leisure"="swimming_pool"](area.praha);
  nwr["leisure"="water_park"](area.praha);
  nwr["amenity"="drinking_water"](area.praha);
  nwr["amenity"="fountain"](area.praha);
  nwr["natural"="spring"](area.praha);
  nwr["shop"="mall"](area.praha);
  nwr["air_conditioning"="yes"]["name"](area.praha);
  nwr["leisure"="park"]["name"](area.praha);
);
out center tags;
```

Pro ways/relations se používá `out center` – těžiště (centroid) plochy se bere
jako bodová geometrie.

#### Filtr parků (selektivita)

Parky by jinak dataset zahltily. Pravidla:

- Bereme **jen pojmenované** parky (`name` musí existovat).
- Bereme jen parky s **plochou ≥ ~1 ha** (`PARK_MIN_AREA_M2 = 10000`).
  Plocha se odhaduje z bounding boxu (`bounds`) plochy vrácené Overpassem.
- Parky bez známé plochy (vzácný případ – pojmenovaný `node`) se ponechávají,
  protože jde o prominentní pojmenované body.

Filtr ladíme zde, pokud by parky převažovaly. Stejně tak pítka (`fountain`):
pokud by jejich počet narůstal nad únosnou mez, zúžíme je na ověřená/významná.

### 2. Ruční kurátorská vrstva – `manual_overlay.csv`

~25 ručně ověřených míst s jistou klimatizací, která OSM tag postrádá (velké
obchoďáky, velká muzea, plavecké haly, klimatizované knihovny). Sloupce:

```
name,category,cooling,lat,lon,address,free_entry,opening_hours,typical_c,note
```

Souřadnice jsou reálné pražské GPS. **Manual přepisuje OSM** při shodě názvu a
blízkosti (do ~150 m) – viz deduplikace.

### 3. Golemio (Pražská datová platforma) – TODO / volitelné

Golemio (Operátor ICT) nabízí doplňkové městské datasety (knihovny, parky,
mikroklima). **V1 je postavena na OSM + manual**, protože API klíč zatím není
nasazený. Až bude:

- Přidat extraktor `golemio` (REST, hlavička `X-Access-Token`).
- Zdroj features označit `source: "golemio"`.
- Mikroklima senzory → samostatná live vrstva (snapshot přes GitHub Action),
  ne do statického `venues.geojson`.

## Deduplikace

Položky se **stejným (normalizovaným) názvem do 150 m** se slučují do jedné.
Priorita: **manual > osm**. Při běhu v1: 1082 → 1067 (15 duplikátů odstraněno).

## Výstupní schéma (`venues.geojson`)

GeoJSON `FeatureCollection` (RFC 7946), `geometry` = Point `[lon, lat]` (WGS84).
Každá `properties`:

| pole | typ | popis |
|---|---|---|
| `id` | string | stabilní (`osm-node-123`, `osm-way-…`, `manual-1`) |
| `name` | string | povinné (položky bez názvu se zahazují) |
| `category` | string | `library｜museum｜church｜cinema｜pool｜fountain｜mall｜cafe_food｜shop_ac｜park` |
| `cooling` | string | `ac｜natural｜water｜shade` |
| `typical_c` | number｜null | indikativní vnitřní teplota, jen u `ac` (~23 °C), jinak null |
| `free_entry` | bool｜null | volný vstup (z OSM `fee` nebo manual) |
| `opening_hours` | string｜null | otevírací doba |
| `address` | string｜null | složeno z `addr:street` + `addr:housenumber` (+ město) |
| `source` | string | `osm｜manual｜golemio` |
| `note` | string｜null | poznámka |

Navíc top-level `metadata` (title, attribution, generated, count) – informativní,
frontend ji nepotřebuje.

## Aktuální rozpad (v1, 2026-06-25)

Features celkem: **1067**

- Podle kategorie: church 263, park 178, museum 140, cafe_food 120, library 97,
  shop_ac 91, fountain 81, mall 39, cinema 31, pool 27.
- Podle chlazení: ac 518, natural 263, shade 178, water 108.
- Podle zdroje: osm 1041, manual 26.

## Licence a atribuce

Data i web musí uvádět:

- **© OpenStreetMap přispěvatelé** – licence **ODbL** (geo-vrstva z Overpassu).
- **Golemio / Operátor ICT** – Pražská datová platforma (až bude napojeno).
- **Open-Meteo** (CC-BY) – živá venkovní teplota, fetchováno client-side.
- **ČHMÚ** – výstrahy před vysokými teplotami, fetchováno client-side.

## Provoz / refresh

`venues.geojson` se obnovuje přes GitHub Actions cron (viz `chladek-devops`).
Běh je idempotentní – stačí spustit `python data/build_venues.py` a commitnout
změněný výstup.
