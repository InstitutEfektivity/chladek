# Chládek

Veřejná webová mapa klimatizovaných a přirozeně chladných veřejných míst v Praze – obchoďáky, knihovny, muzea, kostely, bazény, pítka i parky. Doplněná o živou venkovní teplotu (Open-Meteo) a výstrahu před horkem.

Projekt [Institutu efektivity](https://institutefektivity.cz) – zároveň praktický nástroj i ukázka toho, co umožňují otevřená data města. Nasazení na `chladek.institutefektivity.cz`.

## Stack

- **Vite** + **TypeScript** (strict)
- **MapLibre GL JS** – mapa bez API klíče (raster basemap CARTO Positron)
- Statický build, žádný backend. Živá data (Open-Meteo) se fetchují přímo z prohlížeče.

## Spuštění

```bash
npm install      # instalace závislostí
npm run dev      # vývojový server na http://localhost:5173
npm run build    # produkční build do dist/ (typecheck + Vite build)
npm run preview  # lokální náhled produkčního buildu
```

## Struktura

```
index.html                 vstupní HTML, Google Fonts, meta
vite.config.ts             Vite konfigurace (base "/")
tsconfig.json              TypeScript strict
public/
  data/venues.geojson      1067 chladných míst (generuje data/ pipeline)
  favicon.svg              wordmark Chládku
  ie-logo.svg              logo IE (patička)
src/
  main.ts                  hash router (#/ mapa, #/o-projektu) + layout shell
  styles.css               design tokeny IE + layout
  content/site.ts          veškerý textový obsah (cs, IE hlas)
  views/
    mapView.ts             mapa, clustering, filtry, popupy, geolokace, počasí
    aboutView.ts           stránka o projektu + patička
  lib/
    types.ts               datové typy
    mapStyle.ts            MapLibre style (basemap bez klíče) + barvy
    weather.ts             Open-Meteo fetch
    geo.ts                 haversine + escapeHtml
data/                      Python pipeline pro venues.geojson (viz data/README.md)
```

## Routy

- `#/` – mapa (výchozí)
- `#/o-projektu` – stránka o projektu (think-tank narativ o open datech)

## Funkce mapy

- **Clustering** bodů; jednotlivé body obarvené podle typu ochlazení (klimatizace / přirozený chlad / voda / stín).
- **Filtry** podle typu ochlazení (chips).
- **Popup** na klik: název, typ ochlazení, otevírací doba, vstupné, tlačítko „Navigovat" (Google Maps).
- **Živá venkovní teplota** z Open-Meteo; při ≥ 31 °C pocitově se zobrazí výstražný banner před horkem.
- **Geolokace** „Najdi 3 nejbližší chládky" – najde 3 nejbližší klimatizovaná / vodní místa a přiblíží na ně.

## Data

`public/data/venues.geojson` generuje Python pipeline ve složce `data/` (viz `data/README.md`). Zdroje: OpenStreetMap (přes Overpass), ruční kurátorská vrstva, Golemio.

**Refresh přes GitHub Actions** (`.github/workflows/refresh-data.yml`): každé pondělí 04:00 UTC (nebo ručně přes „Run workflow") přegeneruje `venues.geojson` a změnu commitne zpět do repa. Tím se aktualizuje **jen repo** – živé nasazení nových dat na server je zatím **manuální re-deploy** (build + scp na `REDACTED-SERVER`), protože web servíruje statický build.

## Nasazení

`dist/` je čistě statický (HTML + JS/CSS + zkopírovaný `public/`). Lze hostovat na jakémkoli statickém serveru. Produkční cíl: Docker `nginx:alpine` na `REDACTED-SERVER` (Compose projekt `ie-chladek`) za reverzní proxy vhostem. `dist/` se necommituje – buildí se při nasazení (`npm ci && npm run build`).

Re-deploy na server (manuální):

```bash
npm run build
scp -i ~/.ssh/REDACTED-KEY -r dist/* root@REDACTED-HOST:REDACTED-PATH/ie-chladek/site/
```

**TODO:** automatický deploy dat/buildu na server přes GitHub Actions zatím **neděláme** – server SSH klíč záměrně nedáváme do veřejného repa. Možné budoucí řešení: deploy přes self-hosted runner, deploy token s úzkým scopem, nebo webhook na serveru stahující artefakt z Actions.

## Licence dat a atribuce

© OpenStreetMap přispěvatelé (ODbL) · © CARTO (dlaždice) · Golemio / Pražská datová platforma · Open-Meteo · ČHMÚ.
