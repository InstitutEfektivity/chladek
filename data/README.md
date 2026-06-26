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

### 2. IPR Praha „Oázy chladu" (Geoportál Praha, open data)

Tři bodové vrstvy z [Geoportálu Praha](https://opendata.geoportalpraha.cz)
(open data, bez API klíče, GeoJSON ve WGS84/CRS84 – souřadnice `[lon, lat]`,
žádná transformace CRS není potřeba). Stahuje `features_from_ipr()`. Každý
dataset má primární `opendata.geoportalpraha.cz` endpoint + ArcGIS FeatureServer
fallback (`mp.iprpraha.cz/.../FeatureServer/0/query?...&f=geojson`).

| Dataset | počet (raw) | category | cooling | poznámka |
|---|---|---|---|---|
| Pítka | 115 | `fountain` | `water` | zrušená pítka (`provoz_spec=ZRUŠENO`) se vyřazují |
| Kašny / fontány | 423 | `fountain` | `water` | `typ` 1=fontána, 2=kašna, 3=ostatní → do `note` |
| Koupání | 52 | `pool` | `water` | `web` → pole `address`; `provoz_spec` (letní/celotýdenní/mimo provoz) → `note` |

Mapování polí: `name` z `nazev` (chybí → výchozí „Pítko" / „Kašna / fontána" /
„Koupání"), `note` se skládá ze `spravce` / `provozovatel` / `provoz_spec` /
`pristupnost` / `typ` (vynechávají se neinformativní hodnoty jako „neznámo",
„nezadáno", „není v provozování PVK a.s."). `id` má tvar `ipr-<dataset>-<n>`.

Sanity check: každý bod musí padnout do hrubého bounding boxu Prahy
(`12<lon<15`, `49.5<lat<50.5`), jinak se zahodí.

**Dedup IPR vs OSM:** IPR pítka/fontány se překrývají s OSM `drinking_water` /
`fountain`. OSM vodní bod, který leží **do 30 m** od IPR vodního bodu, se
odstraní (priorita **IPR > OSM**, IPR je kurátorštější). IPR pítka nemají
`name`, takže tento krok je čistě na blízkost (ne na jméno). Provádí ho
`dedup_ipr_vs_osm()` před jmennou deduplikací.

### 3. Ruční kurátorská vrstva – `manual_overlay.csv`

~25 ručně ověřených míst s jistou klimatizací, která OSM tag postrádá (velké
obchoďáky, velká muzea, plavecké haly, klimatizované knihovny). Sloupce:

```
name,category,cooling,lat,lon,address,free_entry,opening_hours,typical_c,note
```

Souřadnice jsou reálné pražské GPS. **Manual přepisuje OSM** při shodě názvu a
blízkosti (do ~150 m) – viz deduplikace.

### 5. Živá výstraha ČHMÚ před horkem – `fetch_heat_warning.py`

Samostatný skript `data/fetch_heat_warning.py` stahuje CAP XML feed ČHMÚ (SIVS,
`https://vystrahy-cr.chmi.cz/data2/XOCZ50_OKPR.xml`, bez klíče) a vydává malý
`public/data/heat-warning.json`. Není součástí `venues.geojson` – jde o živou
vrstvu, kterou frontend čte přímo z raw.githubusercontent.com.

- Filtruje výstrahy typu **vysoké teploty** (parametr `awareness_type` =
  `high-temperature`, fallback na text `<event>`) pokrývající **Prahu**
  (`areaDesc` „Praha" nebo `geocode CISORP` 1100–1110), bere jen CS verzi.
- Vybírá nejrelevantnější: **aktivní** (onset ≤ teď < expires) s nejvyšší
  závažností; jinak nejbližší **budoucí**. Expirované ignoruje.
- Výstup (aktivní): `{ active, level (Moderate｜Severe｜Extreme), headline,
  event, validFrom, validTo, updatedAt, source }`; bez výstrahy:
  `{ active:false, updatedAt, source }`.
- Robustně: timeout + fallback. Při selhání fetch/parse **nepřepisuje** existující
  soubor (ponechá poslední stav); jen když soubor chybí, zapíše `active:false`
  s chybovou poznámkou.
- Cron: GitHub Action `.github/workflows/heat-warning.yml` každých 30 min.

### 6. Golemio (Pražská datová platforma) – TODO / volitelné

Golemio (Operátor ICT) nabízí doplňkové městské datasety (knihovny, parky,
mikroklima). **Vyžaduje API klíč** (`X-Access-Token`) – zatím neregistrován,
proto zatím nenapojeno. Až bude:

- Přidat extraktor `golemio` (REST, hlavička `X-Access-Token`).
- Zdroj features označit `source: "golemio"`.
- Mikroklima senzory → samostatná live vrstva (snapshot přes GitHub Action),
  ne do statického `venues.geojson`.

## Deduplikace

Dvoufázová deduplikace:

1. **IPR vs OSM (na blízkost, 30 m)** – `dedup_ipr_vs_osm()` odstraní OSM vodní
   body překryté IPR (priorita IPR > OSM, IPR pítka nemají jméno).
2. **Jmenná dedup (150 m)** – položky se stejným normalizovaným názvem do 150 m
   se slučují do jedné. Priorita: **manual > ipr > osm**.

Při běhu v2 (2026-06-26): IPR vs OSM odstranilo 32 OSM bodů, jmenná dedup
1616 → 1586 (30 duplikátů).

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
| `source` | string | `osm｜manual｜ipr｜golemio` |
| `note` | string｜null | poznámka |

Pozn.: `id` má tvar `osm-node-123` / `osm-way-…` / `manual-1` / `ipr-pitka-7`
podle zdroje. U IPR koupání nese `address` web provozovatele (z pole `web`).

Navíc top-level `metadata` (title, attribution, generated, count) – informativní,
frontend ji nepotřebuje.

## Aktuální rozpad (v2, 2026-06-26)

Features celkem: **1586**

- Podle kategorie: fountain 552, church 263, park 178, museum 140, cafe_food 120,
  library 97, shop_ac 91, pool 75, mall 39, cinema 31.
- Podle chlazení: water 627, ac 518, natural 263, shade 178.
- Podle zdroje: osm 1007, ipr 553, manual 26.

Skok ve `water` / `fountain` oproti v1 (108 → 627) je daný napojením IPR vrstev
(pítka + kašny/fontány + koupání), po deduplikaci proti OSM.

## Licence a atribuce

Data i web musí uvádět:

- **© OpenStreetMap přispěvatelé** – licence **ODbL** (geo-vrstva z Overpassu).
- **IPR Praha „Oázy chladu"** – licence **CC BY**, © IPR Praha (pítka,
  kašny/fontány, koupání z Geoportálu Praha).
- **ČHMÚ (SIVS)** – Systém integrované výstražné služby, výstrahy před vysokými
  teplotami (`heat-warning.json`, živě).
- **Open-Meteo** (CC-BY) – živá venkovní teplota, fetchováno client-side.
- **Golemio / Operátor ICT** – Pražská datová platforma (TODO, vyžaduje API klíč –
  zatím neregistrován).

## Provoz / refresh

Dva GitHub Actions crony:

- **`venues.geojson`** – `.github/workflows/refresh-data.yml`, týdně (po 04:00 UTC).
  Idempotentní: `python data/build_venues.py`, commitne změněný výstup. Zahrnuje
  OSM (Overpass) + IPR „Oázy chladu" + ruční vrstvu.
- **`heat-warning.json`** – `.github/workflows/heat-warning.yml`, každých 30 min.
  `python data/fetch_heat_warning.py`, commitne změněný výstup. Frontend banner
  čte JSON živě z raw.githubusercontent.com (cron aktualizuje bez redeploye).
