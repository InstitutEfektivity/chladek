import type {
  Map as MlMap,
  GeoJSONSource,
  Popup,
  Marker,
  MapGeoJSONFeature,
  ExpressionSpecification,
} from "maplibre-gl";

// maplibre-gl je servírovaný jako self-hosted UMD (viz index.html) – kvůli
// spolehlivému web workeru. Bundlovaný worker přes Vite/esbuild se nenačítal
// a style nikdy nedoběhl do _loaded (bílá mapa). Typy bereme jen pro kontrolu.
declare const maplibregl: typeof import("maplibre-gl");

import { ui } from "../content/site.ts";
import { baseStyle, coolingColors } from "../lib/mapStyle.ts";
import { fetchCurrentWeather } from "../lib/weather.ts";
import { fetchHeatWarning } from "../lib/heatWarning.ts";
import {
  fetchAirQuality,
  uvCategory,
  aqiCategory,
} from "../lib/airquality.ts";
import { fetchAirStations } from "../lib/airStations.ts";
import { fetchAreas } from "../lib/areas.ts";
import { fetchMlzitka } from "../lib/mlzitka.ts";
import { fetchMetro } from "../lib/metro.ts";
import {
  fetchTempStations,
  fetchTempSensors,
  tempColor,
} from "../lib/temperatures.ts";
import {
  registerVenueIcons,
  registerOverlayIcons,
  chipIconSvg,
} from "../lib/icons.ts";
import { haversine, escapeHtml } from "../lib/geo.ts";
import type {
  Cooling,
  VenueCollection,
  VenueFeature,
  CurrentWeather,
  HeatWarning,
  TempStationFeature,
  TempSensorFeature,
} from "../lib/types.ts";

const COOLINGS: Cooling[] = ["ac", "natural", "water", "shade"];
const HEAT_THRESHOLD = 31; // apparent_temperature [°C]
const SOURCE_ID = "venues";
const AREAS_SOURCE_ID = "areas";

// Samostatná datová vrstva: stanice kvality ovzduší (Golemio). Vlastní source,
// BEZ clusteru – nesmí se míchat do chládek-bodů ani do geolokačního „3 nejbližší".
const AIR_SOURCE_ID = "air-stations";
const AIR_LAYER_ID = "air-stations-point";

// Mlžítka (IPR) – samostatná symbol vrstva, defaultně skrytá.
const MIST_SOURCE_ID = "mlzitka";
const MIST_LAYER_ID = "mlzitka-point";

// Metro (PID) – samostatná symbol vrstva, defaultně skrytá.
const METRO_SOURCE_ID = "metro";
const METRO_LAYER_ID = "metro-point";

// Teploty (živě) – DOM Markery (ne GL vrstva). Default ON.
// Pod tímto zoomem ukazujeme jen oficiální ČHMÚ stanice, nad ním přidáme i čidla.
const TEMP_SENSOR_MIN_ZOOM = 12;

const coolingLabels: Record<Cooling, string> = {
  ac: ui.filters.ac,
  natural: ui.filters.natural,
  water: ui.filters.water,
  shade: ui.filters.shade,
};

// Jeden teplotní DOM marker + metadata pro zoom-řízenou viditelnost čidel.
interface TempMarker {
  marker: Marker;
  el: HTMLElement;
  isSensor: boolean; // true = pouliční čidlo (Golemio/CAMEA), false = ČHMÚ stanice
}

// Mutable stav pohledu mapy.
interface MapState {
  active: Set<Cooling>;
  nearMarkers: Marker[];
  data: VenueCollection | null;
  tempMarkers: TempMarker[];
  tempVisible: boolean; // přepínač „Teploty (živě)" – default ON
}

export function renderMapView(root: HTMLElement): () => void {
  root.innerHTML = `
    <section class="map-view" aria-label="Mapa chladných míst">
      <div class="map-container">
        <div id="map" role="application" aria-label="Interaktivní mapa Prahy s chladnými místy"></div>
        <div class="map-topbar">
          <div class="topbar-badges">
            <div class="temp-badge" id="temp-badge" role="status" aria-live="polite">
              <span class="temp-dot" aria-hidden="true"></span>
              <span>
                <span class="temp-label">${escapeHtml(ui.liveTemp.outsideNow)}</span>
                <span class="temp-value" id="temp-value">${escapeHtml(ui.liveTemp.loading)}</span>
                <span class="temp-feels" id="temp-feels"></span>
              </span>
            </div>
            <div class="measured-badge" id="measured-badge" role="status" aria-live="polite" hidden>
              <span class="measured-dot" id="measured-dot" aria-hidden="true"></span>
              <span>
                <span class="measured-label">${escapeHtml(ui.liveTemp.measuredNow)}</span>
                <span class="measured-value" id="measured-value"></span>
                <span class="measured-meta" id="measured-meta"></span>
              </span>
            </div>
            <div class="env-badge" id="uv-badge" role="status" aria-live="polite" hidden>
              <span class="env-label">${escapeHtml(ui.airQuality.uvLabel)}</span>
              <span class="env-value" id="uv-value"></span>
            </div>
            <div class="env-badge" id="aqi-badge" role="status" aria-live="polite" hidden>
              <span class="env-label">${escapeHtml(ui.airQuality.aqiLabel)}</span>
              <span class="env-value" id="aqi-value"></span>
            </div>
          </div>
          <div class="heat-warning" id="heat-warning" role="alert" hidden>
            <span class="heat-icon" aria-hidden="true">⚠️</span>
            <span class="heat-text" id="heat-text">${escapeHtml(ui.heatWarning)}</span>
          </div>
        </div>
      </div>
      <div class="map-controls">
        <fieldset class="filters">
          <legend>Filtr podle typu ochlazení</legend>
          ${COOLINGS.map(
            (c) => `
            <button type="button" class="chip chip-cooling" data-cooling="${c}" style="--chip-accent:${coolingColors[c]}" aria-pressed="true">
              <span class="chip-icon" style="color:${coolingColors[c]}" aria-hidden="true">${chipIconSvg(c)}</span>
              ${escapeHtml(coolingLabels[c])}
            </button>`
          ).join("")}
        </fieldset>
        <div class="overlay-toggles" role="group" aria-label="Datové vrstvy">
          <button type="button" class="chip chip-overlay" id="temps-toggle" aria-pressed="true">
            <span class="chip-dot chip-dot-temp" aria-hidden="true"></span>
            ${escapeHtml(ui.temps.toggle)}
          </button>
          <button type="button" class="chip chip-overlay" id="air-stations-toggle" aria-pressed="false">
            <span class="chip-dot chip-dot-air" aria-hidden="true"></span>
            ${escapeHtml(ui.airStations.toggle)}
          </button>
          <button type="button" class="chip chip-overlay" id="mlzitka-toggle" aria-pressed="false">
            <span class="chip-dot chip-dot-mist" aria-hidden="true"></span>
            ${escapeHtml(ui.mlzitka.toggle)}
          </button>
          <button type="button" class="chip chip-overlay" id="metro-toggle" aria-pressed="false">
            <span class="chip-dot chip-dot-metro" aria-hidden="true"></span>
            ${escapeHtml(ui.metro.toggle)}
          </button>
        </div>
        <div class="locate-wrap">
          <button type="button" class="btn btn-primary" id="locate-btn">
            <span class="btn-icon" aria-hidden="true">📍</span>
            ${escapeHtml(ui.locate.button)}
          </button>
          <span class="locate-status" id="locate-status" role="status" aria-live="polite"></span>
        </div>
        <p class="map-attribution">${escapeHtml(ui.attribution)}</p>
      </div>
    </section>
  `;

  const state: MapState = {
    active: new Set(COOLINGS),
    nearMarkers: [],
    data: null,
    tempMarkers: [],
    tempVisible: true,
  };

  // MapLibre se vykreslí správně jen tehdy, když má kontejner v okamžiku vzniku
  // reálnou velikost. Když ho vytvoříme dřív (než flex layout dopočítá výšku),
  // basemap i geojson vrstvy se natilují pro nulový viewport a zůstanou bílé.
  // Proto mapu vytvoříme až ve chvíli, kdy #map má nenulovou výšku.
  const mapEl = document.getElementById("map");
  let map: MlMap | null = null;
  let started = false;
  const resizeObserver = new ResizeObserver(() => map?.resize());
  let gate: ResizeObserver | null = null;

  function startMap(): void {
    if (started || !mapEl) return;
    started = true;
    map = new maplibregl.Map({
      container: mapEl,
      style: baseStyle,
      center: [14.43, 50.08],
      zoom: 11.5,
      attributionControl: false,
    });
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right"
    );
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
      }),
      "top-right"
    );
    resizeObserver.observe(mapEl);
    map.on("error", (e) => {
      const msg = (e as { error?: { message?: string } }).error?.message;
      if (msg) console.warn("Chládek – mapa:", msg);
    });
    map.on("load", () => {
      // Pořadí je důležité: nejdřív základní vrstvy (areas → glow → clusters →
      // venues-point), teprve PAK overlay vrstvy (mlžítka, metro, ovzduší) – ty
      // musí zůstat NAD chládek-body. Teplotní DOM Markery jsou nad vším (HTML).
      if (!map) return;
      const m = map;
      void initData(m, state).then(async () => {
        await initOverlayPoints(m);
        await initAirStations(m);
        await initTemperatures(m, state);
      });
    });
  }

  if (mapEl && mapEl.clientHeight > 0) {
    startMap();
  } else if (mapEl) {
    gate = new ResizeObserver(() => {
      if (mapEl.clientHeight > 0) {
        gate?.disconnect();
        gate = null;
        startMap();
      }
    });
    gate.observe(mapEl);
  }

  // Filtry
  const chips = Array.from(
    root.querySelectorAll<HTMLButtonElement>(".chip[data-cooling]")
  );
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      const cooling = chip.dataset["cooling"] as Cooling;
      if (state.active.has(cooling)) {
        state.active.delete(cooling);
        chip.setAttribute("aria-pressed", "false");
      } else {
        state.active.add(cooling);
        chip.setAttribute("aria-pressed", "true");
      }
      if (map) applyFilter(map, state);
    });
  }

  // Přepínač „Teploty (živě)" – ukazuje/skrývá teplotní DOM Markery. Default ON.
  const tempsToggle = root.querySelector<HTMLButtonElement>("#temps-toggle");
  tempsToggle?.addEventListener("click", () => {
    if (!map) return;
    state.tempVisible = !state.tempVisible;
    applyTempVisibility(map, state);
    tempsToggle.setAttribute("aria-pressed", state.tempVisible ? "true" : "false");
  });

  // Přepínač overlay vrstvy „Ovzduší (stanice)" – přepíná visibility air vrstvy.
  const airToggle = root.querySelector<HTMLButtonElement>("#air-stations-toggle");
  airToggle?.addEventListener("click", () => {
    if (!map || !map.getLayer(AIR_LAYER_ID)) return;
    const visible =
      map.getLayoutProperty(AIR_LAYER_ID, "visibility") === "visible";
    const next = visible ? "none" : "visible";
    map.setLayoutProperty(AIR_LAYER_ID, "visibility", next);
    if (map.getLayer(`${AIR_LAYER_ID}-halo`)) {
      map.setLayoutProperty(`${AIR_LAYER_ID}-halo`, "visibility", next);
    }
    airToggle.setAttribute("aria-pressed", visible ? "false" : "true");
  });

  // Přepínač „Mlžítka" – visibility symbol vrstvy. Default OFF.
  wireLayerToggle(root, "#mlzitka-toggle", () => map, MIST_LAYER_ID);

  // Přepínač „Metro (chládek pod zemí)" – visibility symbol vrstvy. Default OFF.
  wireLayerToggle(root, "#metro-toggle", () => map, METRO_LAYER_ID);

  // Geolokace „3 nejbližší chládky"
  const locateBtn = root.querySelector<HTMLButtonElement>("#locate-btn");
  const locateStatus = root.querySelector<HTMLElement>("#locate-status");
  locateBtn?.addEventListener("click", () => {
    if (map) handleLocate(map, state, locateBtn, locateStatus);
  });

  // Živá teplota + výstraha ČHMÚ + kvalita ovzduší / UV
  void initWeather(root);
  void initHeatWarning(root);
  void initAirQuality(root);

  // Cleanup při změně view.
  return () => {
    gate?.disconnect();
    resizeObserver.disconnect();
    clearNearMarkers(state);
    clearTempMarkers(state);
    map?.remove();
  };
}

// Obecný přepínač visibility symbol vrstvy (mlžítka, metro). Vrstva nemusí
// existovat (graceful – soubor chyběl), pak klik nic nedělá.
function wireLayerToggle(
  root: HTMLElement,
  selector: string,
  getMap: () => MlMap | null,
  layerId: string
): void {
  const btn = root.querySelector<HTMLButtonElement>(selector);
  btn?.addEventListener("click", () => {
    const map = getMap();
    if (!map || !map.getLayer(layerId)) return;
    const visible = map.getLayoutProperty(layerId, "visibility") === "visible";
    map.setLayoutProperty(layerId, "visibility", visible ? "none" : "visible");
    btn.setAttribute("aria-pressed", visible ? "false" : "true");
  });
}

// ---------- Data + vrstvy ----------

async function initData(map: MlMap, state: MapState): Promise<void> {
  let data: VenueCollection;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/venues.geojson`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as VenueCollection;
    state.data = data;
  } catch (err) {
    console.error("Nepodařilo se načíst data míst:", err);
    return;
  }

  // SPODNÍ vrstva: plošný rozsah chladu (parky/stín, vodní plochy). Volitelný
  // soubor – když chybí, prostě se přeskočí. Přidáváme PRVNÍ, aby seděl pod body.
  await initAreas(map);

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data,
    cluster: true,
    clusterRadius: 50,
    clusterMaxZoom: 14,
  });

  // Halo „do ztracena" pod ikonou: velký rozmazaný disk u velkých obchoďáků
  // (category == "mall"). Měkká chladná záře vytékající z velkého půdorysu.
  map.addLayer({
    id: "venue-glow",
    type: "circle",
    source: SOURCE_ID,
    filter: [
      "all",
      ["!", ["has", "point_count"]],
      ["==", ["get", "category"], "mall"],
    ],
    paint: {
      "circle-color": coolingColors["ac"]!,
      "circle-opacity": 0.18,
      "circle-blur": 0.9,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 18, 16, 55],
    },
  });

  // Clustery
  map.addLayer({
    id: "clusters",
    type: "circle",
    source: SOURCE_ID,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "#5FE0CF",
        25,
        "#19B8CE",
        100,
        "#16405E",
      ],
      "circle-radius": ["step", ["get", "point_count"], 16, 25, 22, 100, 30],
      "circle-stroke-width": 2,
      "circle-stroke-color": "rgba(255,255,255,0.85)",
    },
  });
  // (Počet v clusteru jako text byl symbol vrstva závislá na externích glyphech;
  //  selhání glyphů označovalo celou geojson tile jako errored → nic se nevykreslilo.
  //  Velikost clusteru komunikuje poloměr kruhu. Text se přidá zpět přes self-hosted
  //  glyphy v další iteraci, pokud bude potřeba.)

  // Ikony chládek-bodů MUSÍ být zaregistrované PŘED symbol vrstvou, která je odkazuje
  // (jinak styleimagemissing). Rastrové ikony (ne glyphy) – bezpečné.
  await registerVenueIcons(map);

  // Jednotlivé body jako ikona podle cooling. Symbol vrstva BEZ text-field
  // (žádné glyphy) – icon-image je rastr. icon-size roste se zoomem a u velkých
  // obchoďáků (mall) je o něco větší.
  map.addLayer({
    id: "venues-point",
    type: "symbol",
    source: SOURCE_ID,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": [
        "match",
        ["get", "cooling"],
        "ac",
        "icon-ac",
        "water",
        "icon-water",
        "natural",
        "icon-natural",
        "shade",
        "icon-shade",
        "icon-ac",
      ],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-anchor": "bottom",
      // Pin je 56 px vysoký rastr (pixelRatio 2). Cíl: ~26–34 px vysoký pin
      // ve street zoomu 13–16, aby uživatel hned četl kapku/vločku/oblouk/strom.
      // mall je znatelně větší. Velikosti: z11≈22–26 px, z13≈30–37 px,
      // z16≈37–46 px (mall) / 32 px (ostatní) → 0.56–0.82 × 56.
      "icon-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        ["case", ["==", ["get", "category"], "mall"], 0.47, 0.4],
        13,
        ["case", ["==", ["get", "category"], "mall"], 0.66, 0.55],
        16,
        ["case", ["==", ["get", "category"], "mall"], 0.82, 0.66],
      ],
    },
  });

  applyFilter(map, state);
  wireInteractions(map);
}

// Plošné overlay vrstvy úplně dole (jen nad basemapem). Volitelné – graceful skip.
async function initAreas(map: MlMap): Promise<void> {
  const areas = await fetchAreas();
  if (!areas) return; // soubor chybí / nevalidní → vrstvy se nepřidají

  map.addSource(AREAS_SOURCE_ID, { type: "geojson", data: areas });

  // Výplň – jemná barevná plocha podle cooling.
  map.addLayer({
    id: "areas-fill",
    type: "fill",
    source: AREAS_SOURCE_ID,
    paint: {
      "fill-color": [
        "match",
        ["get", "cooling"],
        "shade",
        "#6FBF73",
        "water",
        "#2A86C9",
        "#6FBF73",
      ],
      "fill-opacity": 0.16,
    },
  });

  // Obrys s blur → měkký okraj „vytrácející se do ztracena".
  map.addLayer({
    id: "areas-outline",
    type: "line",
    source: AREAS_SOURCE_ID,
    paint: {
      "line-color": [
        "match",
        ["get", "cooling"],
        "shade",
        "#6FBF73",
        "water",
        "#2A86C9",
        "#6FBF73",
      ],
      "line-blur": 3,
      "line-width": 2.5,
      "line-opacity": 0.35,
    },
  });
}

function coolingFilter(active: Set<Cooling>): ExpressionSpecification {
  // Cluster vrstvy: respektuj jen aktivní cooling (clustery agregují vše,
  // proto u clusterů ponecháme has point_count – filtrace bodů řeší detail).
  const list = Array.from(active);
  if (list.length === 0) {
    // Nic aktivního: schovej všechny body.
    return ["==", ["get", "cooling"], "__none__"];
  }
  return ["in", ["get", "cooling"], ["literal", list]] as ExpressionSpecification;
}

function applyFilter(map: MlMap, state: MapState): void {
  if (!map.getLayer("venues-point")) return;
  map.setFilter("venues-point", [
    "all",
    ["!", ["has", "point_count"]],
    coolingFilter(state.active),
  ]);
}

function wireInteractions(map: MlMap): void {
  // Klik na cluster -> zoom dovnitř.
  map.on("click", "clusters", (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: ["clusters"],
    });
    const clusterId = features[0]?.properties?.["cluster_id"];
    if (clusterId === undefined) return;
    const src = map.getSource(SOURCE_ID) as GeoJSONSource;
    void src.getClusterExpansionZoom(clusterId as number).then((zoom) => {
      const geom = features[0]?.geometry;
      if (geom?.type === "Point") {
        map.easeTo({
          center: geom.coordinates as [number, number],
          zoom,
        });
      }
    });
  });

  // Klik na bod -> popup.
  map.on("click", "venues-point", (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    openPopup(map, feature);
  });

  const cursorLayers = ["clusters", "venues-point"];
  for (const layer of cursorLayers) {
    map.on("mouseenter", layer, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layer, () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

function openPopup(map: MlMap, feature: MapGeoJSONFeature): void {
  if (feature.geometry.type !== "Point") return;
  const [lon, lat] = feature.geometry.coordinates as [number, number];
  const p = feature.properties as Record<string, unknown>;

  const name = String(p["name"] ?? "");
  const cooling = String(p["cooling"] ?? "") as Cooling;
  const coolingLabel = coolingLabels[cooling] ?? cooling;
  const dotColor = coolingColors[cooling] ?? "#888";
  const opening =
    typeof p["opening_hours"] === "string" && p["opening_hours"]
      ? p["opening_hours"]
      : null;
  const freeEntry = p["free_entry"];

  const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;

  let freeHtml = "";
  if (freeEntry === true) {
    freeHtml = `<span class="popup-free yes">${escapeHtml(ui.popup.freeYes)}</span>`;
  } else if (freeEntry === false) {
    freeHtml = `<span class="popup-free no">${escapeHtml(ui.popup.freeNo)}</span>`;
  }

  let openingHtml = "";
  if (opening) {
    openingHtml = `
      <dl>
        <dt>${escapeHtml(ui.popup.openingLabel)}</dt>
        <dd>${escapeHtml(opening)}</dd>
      </dl>`;
  }

  const coolingIcon =
    cooling === "ac" ||
    cooling === "water" ||
    cooling === "natural" ||
    cooling === "shade"
      ? chipIconSvg(cooling)
      : "";

  const html = `
    <div class="popup">
      <h3>${escapeHtml(name)}</h3>
      <span class="popup-cooling" style="--chip-accent:${dotColor}">
        <span class="popup-cooling-icon" style="color:${dotColor}" aria-hidden="true">${coolingIcon}</span>
        ${escapeHtml(ui.popup.coolingLabel)}: ${escapeHtml(coolingLabel)}
      </span>
      ${openingHtml}
      ${freeHtml}
      <a class="btn-navigate" href="${navUrl}" target="_blank" rel="noopener noreferrer">
        🧭 ${escapeHtml(ui.popup.navigate)}
      </a>
    </div>
  `;

  new maplibregl.Popup({ closeButton: true, maxWidth: "280px", focusAfterOpen: true })
    .setLngLat([lon, lat])
    .setHTML(html)
    .addTo(map);
}

// ---------- Stanice kvality ovzduší (Golemio) – samostatná overlay vrstva ----------

async function initAirStations(map: MlMap): Promise<void> {
  // Živě z raw GitHub (cron, hodinově) → fallback lokální snapshot.
  const data = await fetchAirStations();
  if (!data) {
    console.warn("Stanice ovzduší nedostupné – vrstva se nepřidá.");
    return;
  }

  map.addSource(AIR_SOURCE_ID, {
    type: "geojson",
    data,
    // Žádný cluster – stanice jsou samostatná datová vrstva.
  });

  // Výrazně odlišný styl od chládek-bodů: barva dle aqColor, silný bílý obrys
  // + halo (druhý stroke přes blur), defaultně skryté.
  map.addLayer({
    id: `${AIR_LAYER_ID}-halo`,
    type: "circle",
    source: AIR_SOURCE_ID,
    layout: { visibility: "none" },
    paint: {
      "circle-color": "rgba(22,64,94,0.18)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 11, 16, 15],
      "circle-blur": 0.6,
    },
  });
  map.addLayer({
    id: AIR_LAYER_ID,
    type: "circle",
    source: AIR_SOURCE_ID,
    layout: { visibility: "none" },
    paint: {
      "circle-color": ["get", "aqColor"],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 7, 16, 9],
      "circle-stroke-width": 2.75,
      "circle-stroke-color": "#FFFFFF",
    },
  });

  // Klik na stanici → popup.
  map.on("click", AIR_LAYER_ID, (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    openStationPopup(map, feature);
  });
  map.on("mouseenter", AIR_LAYER_ID, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", AIR_LAYER_ID, () => {
    map.getCanvas().style.cursor = "";
  });
}

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function openStationPopup(map: MlMap, feature: MapGeoJSONFeature): void {
  if (feature.geometry.type !== "Point") return;
  const [lon, lat] = feature.geometry.coordinates as [number, number];
  const p = feature.properties as Record<string, unknown>;

  const name = String(p["name"] ?? "");
  const aqLabel = String(p["aqLabel"] ?? "");
  const aqColor = String(p["aqColor"] ?? "#888");

  // components může přijít jako string (geojson properties se serializují).
  let components: { type: string; value: number }[] = [];
  const rawComp = p["components"];
  if (typeof rawComp === "string") {
    try {
      components = JSON.parse(rawComp) as { type: string; value: number }[];
    } catch {
      components = [];
    }
  } else if (Array.isArray(rawComp)) {
    components = rawComp as { type: string; value: number }[];
  }

  const componentLabels: Record<string, string> = {
    NO2: "NO₂",
    PM10: "PM10",
    PM2_5: "PM2,5",
    O3: "O₃",
    SO2: "SO₂",
    CO: "CO",
  };

  const compHtml = components.length
    ? `<dl class="air-components">${components
        .map((c) => {
          const label = componentLabels[c.type] ?? escapeHtml(c.type);
          const val = Number(c.value);
          const valStr = Number.isFinite(val)
            ? `${Math.round(val * 10) / 10} µg/m³`
            : "–";
          return `<div><dt>${label}</dt><dd>${escapeHtml(valStr)}</dd></div>`;
        })
        .join("")}</dl>`
    : "";

  const updated = formatUpdatedAt(String(p["updatedAt"] ?? ""));
  const updatedHtml = updated
    ? `<p class="air-updated">${escapeHtml(ui.airStations.updatedAt)} ${escapeHtml(updated)}</p>`
    : "";

  const html = `
    <div class="popup popup-air">
      <span class="air-kicker">${escapeHtml(ui.airStations.popupTitle)}</span>
      <h3>${escapeHtml(name)}</h3>
      <span class="air-label" style="background:${escapeHtml(aqColor)}">${escapeHtml(aqLabel)}</span>
      ${compHtml}
      ${updatedHtml}
    </div>
  `;

  new maplibregl.Popup({ closeButton: true, maxWidth: "280px", focusAfterOpen: true })
    .setLngLat([lon, lat])
    .setHTML(html)
    .addTo(map);
}

// ---------- Overlay body: mlžítka (IPR) + metro (PID) ----------

async function initOverlayPoints(map: MlMap): Promise<void> {
  // Ikony overlay bodů MUSÍ být zaregistrované PŘED symbol vrstvami (jinak
  // styleimagemissing). Rastrové ikony (ne glyphy) – bezpečné.
  await registerOverlayIcons(map);
  await initMlzitka(map);
  await initMetro(map);
}

async function initMlzitka(map: MlMap): Promise<void> {
  const data = await fetchMlzitka();
  if (!data) {
    console.warn("Mlžítka nedostupná – vrstva se nepřidá.");
    return;
  }
  map.addSource(MIST_SOURCE_ID, { type: "geojson", data });
  map.addLayer({
    id: MIST_LAYER_ID,
    type: "symbol",
    source: MIST_SOURCE_ID,
    layout: {
      visibility: "none", // default OFF
      "icon-image": "icon-mist",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-anchor": "bottom",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.34, 16, 0.56],
    },
  });

  map.on("click", MIST_LAYER_ID, (e) => {
    const feature = e.features?.[0];
    if (feature) openMistPopup(map, feature);
  });
  map.on("mouseenter", MIST_LAYER_ID, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", MIST_LAYER_ID, () => {
    map.getCanvas().style.cursor = "";
  });
}

async function initMetro(map: MlMap): Promise<void> {
  const data = await fetchMetro();
  if (!data) {
    console.warn("Metro nedostupné – vrstva se nepřidá.");
    return;
  }
  map.addSource(METRO_SOURCE_ID, { type: "geojson", data });
  map.addLayer({
    id: METRO_LAYER_ID,
    type: "symbol",
    source: METRO_SOURCE_ID,
    layout: {
      visibility: "none", // default OFF
      "icon-image": "icon-metro",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-anchor": "bottom",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.34, 16, 0.56],
    },
  });

  map.on("click", METRO_LAYER_ID, (e) => {
    const feature = e.features?.[0];
    if (feature) openMetroPopup(map, feature);
  });
  map.on("mouseenter", METRO_LAYER_ID, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", METRO_LAYER_ID, () => {
    map.getCanvas().style.cursor = "";
  });
}

function openMistPopup(map: MlMap, feature: MapGeoJSONFeature): void {
  if (feature.geometry.type !== "Point") return;
  const [lon, lat] = feature.geometry.coordinates as [number, number];
  const p = feature.properties as Record<string, unknown>;
  const name = String(p["name"] ?? "");
  const note =
    typeof p["note"] === "string" && p["note"] ? String(p["note"]) : null;
  const source = String(p["source"] ?? "");

  const noteHtml = note
    ? `<p class="overlay-note">${escapeHtml(note)}</p>`
    : "";
  const html = `
    <div class="popup popup-overlay">
      <span class="overlay-kicker">${escapeHtml(ui.mlzitka.popupTitle)}</span>
      <h3>${escapeHtml(name)}</h3>
      ${noteHtml}
      <p class="overlay-source">${escapeHtml(ui.popup.sourceLabel)}: ${escapeHtml(source)}</p>
    </div>`;

  new maplibregl.Popup({ closeButton: true, maxWidth: "280px", focusAfterOpen: true })
    .setLngLat([lon, lat])
    .setHTML(html)
    .addTo(map);
}

function openMetroPopup(map: MlMap, feature: MapGeoJSONFeature): void {
  if (feature.geometry.type !== "Point") return;
  const [lon, lat] = feature.geometry.coordinates as [number, number];
  const p = feature.properties as Record<string, unknown>;
  const name = String(p["name"] ?? "");
  const lines =
    typeof p["lines"] === "string" && p["lines"] ? String(p["lines"]) : "";
  const source = String(p["source"] ?? "");

  const linesHtml = lines
    ? `<p class="overlay-lines">${escapeHtml(ui.metro.lineLabel)} ${escapeHtml(lines)}</p>`
    : "";
  const html = `
    <div class="popup popup-overlay">
      <span class="overlay-kicker">${escapeHtml(ui.metro.popupTitle)}</span>
      <h3>${escapeHtml(name)}</h3>
      ${linesHtml}
      <p class="overlay-note">${escapeHtml(ui.metro.refugeNote)}</p>
      <p class="overlay-source">${escapeHtml(ui.popup.sourceLabel)}: ${escapeHtml(source)}</p>
    </div>`;

  new maplibregl.Popup({ closeButton: true, maxWidth: "280px", focusAfterOpen: true })
    .setLngLat([lon, lat])
    .setHTML(html)
    .addTo(map);
}

// ---------- Teploty (živě) – NAMĚŘENÁ teplota jako DOM Markery ----------

async function initTemperatures(map: MlMap, state: MapState): Promise<void> {
  const [stations, sensors] = await Promise.all([
    fetchTempStations(),
    fetchTempSensors(),
  ]);

  if (stations) {
    for (const f of stations.features) {
      addTempMarker(
        map,
        state,
        f.geometry.coordinates,
        f.properties.temp_c,
        false,
        buildStationTempPopup(f)
      );
    }
    // Headline badge: reprezentativní centrální MĚŘENÁ hodnota.
    updateMeasuredBadge(stations.features);
  }

  if (sensors) {
    for (const f of sensors.features) {
      addTempMarker(
        map,
        state,
        f.geometry.coordinates,
        f.properties.temp_c,
        true,
        buildSensorTempPopup(f)
      );
    }
  }

  // Počáteční viditelnost (default ON) + zoom-řízené čidla.
  applyTempVisibility(map, state);
  // Při zoomu přepočítej, které čidla ukázat (čidla jen nad TEMP_SENSOR_MIN_ZOOM).
  map.on("zoomend", () => applyTempVisibility(map, state));
}

function tempPillEl(tempC: number, isSensor: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = isSensor ? "temp-pill temp-pill-sensor" : "temp-pill temp-pill-station";
  el.style.background = tempColor(tempC);
  // Celá čísla na mapě (kompaktní); desetinné jen v popupu/badge.
  el.textContent = `${Math.round(tempC)} °C`;
  el.setAttribute(
    "aria-label",
    `${Math.round(tempC)} stupňů Celsia${isSensor ? ", pouliční čidlo" : ", oficiální stanice ČHMÚ"}`
  );
  return el;
}

function addTempMarker(
  map: MlMap,
  state: MapState,
  coords: [number, number],
  tempC: number,
  isSensor: boolean,
  popupHtml: string
): void {
  if (!Number.isFinite(tempC)) return;
  const el = tempPillEl(tempC, isSensor);
  const popup = new maplibregl.Popup({
    closeButton: true,
    maxWidth: "280px",
    focusAfterOpen: true,
    offset: 14,
  }).setHTML(popupHtml);
  const marker = new maplibregl.Marker({ element: el, anchor: "center" })
    .setLngLat(coords)
    .setPopup(popup)
    .addTo(map);
  state.tempMarkers.push({ marker, el, isSensor });
}

function buildStationTempPopup(f: TempStationFeature): string {
  const p = f.properties;
  return tempPopupHtml({
    title: ui.temps.stationTitle,
    name: p.name,
    tempC: p.temp_c,
    measuredAt: p.measuredAt,
    source: p.source,
    sensorNote: false,
  });
}

function buildSensorTempPopup(f: TempSensorFeature): string {
  const p = f.properties;
  return tempPopupHtml({
    title: ui.temps.sensorTitle,
    name: p.name,
    tempC: p.temp_c,
    measuredAt: p.measuredAt,
    source: p.source,
    sensorNote: true,
  });
}

function tempPopupHtml(o: {
  title: string;
  name: string;
  tempC: number;
  measuredAt: string;
  source: string;
  sensorNote: boolean;
}): string {
  const time = formatUpdatedAt(o.measuredAt);
  const timeHtml = time
    ? `<p class="temp-pop-time">${escapeHtml(ui.temps.measuredAtLabel)} ${escapeHtml(time)}</p>`
    : "";
  const noteHtml = o.sensorNote
    ? `<p class="temp-pop-note">${escapeHtml(ui.temps.sensorNote)}</p>`
    : "";
  return `
    <div class="popup popup-temp">
      <span class="temp-pop-kicker">${escapeHtml(o.title)}</span>
      <h3>${escapeHtml(o.name)}</h3>
      <span class="temp-pop-value" style="background:${tempColor(o.tempC)}">${escapeHtml(formatTempComma(o.tempC))} °C</span>
      ${timeHtml}
      ${noteHtml}
      <p class="overlay-source">${escapeHtml(ui.popup.sourceLabel)}: ${escapeHtml(o.source)}</p>
    </div>`;
}

// České desetinné číslo s čárkou (1 desetinné místo), např. 33,4.
function formatTempComma(c: number): string {
  if (!Number.isFinite(c)) return "–";
  return (Math.round(c * 10) / 10).toFixed(1).replace(".", ",");
}

function applyTempVisibility(map: MlMap, state: MapState): void {
  const zoom = map.getZoom();
  const showSensors = zoom >= TEMP_SENSOR_MIN_ZOOM;
  for (const t of state.tempMarkers) {
    // Čidla jen nad min zoom; ČHMÚ stanice vždy (když je vrstva zapnutá).
    const visible = state.tempVisible && (!t.isSensor || showSensors);
    t.el.style.display = visible ? "" : "none";
  }
}

function clearTempMarkers(state: MapState): void {
  for (const t of state.tempMarkers) t.marker.remove();
  state.tempMarkers = [];
}

function updateMeasuredBadge(features: TempStationFeature[]): void {
  const badge = document.getElementById("measured-badge");
  const valueEl = document.getElementById("measured-value");
  const metaEl = document.getElementById("measured-meta");
  const dotEl = document.getElementById("measured-dot");
  if (!badge || !valueEl || !metaEl) return;

  // Centrum: stanice se jménem obsahujícím „Karlov", jinak první klass == "pro".
  const central =
    features.find((f) => f.properties.name.includes("Karlov")) ??
    features.find((f) => f.properties.klass === "pro") ??
    features[0];
  if (!central) return;

  const tempC = central.properties.temp_c;
  valueEl.textContent = `${formatTempComma(tempC)} °C`;
  metaEl.textContent = `· ČHMÚ · ${central.properties.name}`;
  if (dotEl) dotEl.style.background = tempColor(tempC);
  badge.hidden = false;
}

// ---------- Geolokace ----------

function clearNearMarkers(state: MapState): void {
  for (const m of state.nearMarkers) m.remove();
  state.nearMarkers = [];
}

function handleLocate(
  map: MlMap,
  state: MapState,
  btn: HTMLButtonElement,
  status: HTMLElement | null
): void {
  if (!("geolocation" in navigator)) {
    if (status) {
      status.textContent = ui.locate.denied;
      status.classList.add("error");
    }
    return;
  }
  btn.disabled = true;
  if (status) {
    status.classList.remove("error");
    status.textContent = "Zjišťuji polohu…";
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.disabled = false;
      const { longitude, latitude } = pos.coords;
      showNearest(map, state, longitude, latitude, status);
    },
    () => {
      btn.disabled = false;
      if (status) {
        status.textContent = ui.locate.denied;
        status.classList.add("error");
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

function showNearest(
  map: MlMap,
  state: MapState,
  lon: number,
  lat: number,
  status: HTMLElement | null
): void {
  const data = state.data;
  if (!data) return;

  // 3 nejbližší místa s ac/water.
  const candidates = data.features.filter(
    (f) => f.properties.cooling === "ac" || f.properties.cooling === "water"
  );
  const ranked = candidates
    .map((f) => ({
      f,
      dist: haversine(lon, lat, f.geometry.coordinates[0], f.geometry.coordinates[1]),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3);

  clearNearMarkers(state);

  // Marker uživatele.
  const userEl = document.createElement("div");
  userEl.textContent = "🧍";
  userEl.style.fontSize = "1.4rem";
  userEl.setAttribute("aria-label", "Vaše poloha");
  state.nearMarkers.push(
    new maplibregl.Marker({ element: userEl }).setLngLat([lon, lat]).addTo(map)
  );

  const bounds = new maplibregl.LngLatBounds([lon, lat], [lon, lat]);

  for (const { f } of ranked) {
    const el = document.createElement("div");
    el.className = "near-marker";
    el.textContent = "❄️";
    const [flon, flat] = f.geometry.coordinates;
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([flon, flat])
      .setPopup(buildNearPopup(f))
      .addTo(map);
    state.nearMarkers.push(marker);
    bounds.extend([flon, flat]);
  }

  if (ranked.length > 0) {
    map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 600 });
    if (status) {
      status.classList.remove("error");
      status.textContent = `Nejbližší chládky: ${ranked
        .map((r) => r.f.properties.name)
        .join(", ")}`;
    }
  } else if (status) {
    status.textContent = "V okolí jsme nenašli klimatizované místo.";
  }
}

function buildNearPopup(f: VenueFeature): Popup {
  const [lon, lat] = f.geometry.coordinates;
  const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  const html = `
    <div class="popup">
      <h3>${escapeHtml(f.properties.name)}</h3>
      <a class="btn-navigate" href="${navUrl}" target="_blank" rel="noopener noreferrer">
        🧭 ${escapeHtml(ui.popup.navigate)}
      </a>
    </div>`;
  return new maplibregl.Popup({ closeButton: true, maxWidth: "280px" }).setHTML(html);
}

// ---------- Počasí ----------

async function initWeather(root: HTMLElement): Promise<void> {
  const valueEl = root.querySelector<HTMLElement>("#temp-value");
  const feelsEl = root.querySelector<HTMLElement>("#temp-feels");

  try {
    const w: CurrentWeather = await fetchCurrentWeather();
    if (valueEl) valueEl.textContent = `${Math.round(w.temperature)} °C`;
    if (feelsEl) {
      feelsEl.textContent = `pocitově ${Math.round(w.apparent)} °C`;
    }
  } catch (err) {
    console.warn("Teplota nedostupná:", err);
    if (valueEl) valueEl.textContent = ui.liveTemp.failed;
    if (feelsEl) feelsEl.textContent = "";
  }
}

// ---------- Výstraha ČHMÚ (živá) ----------

async function initHeatWarning(root: HTMLElement): Promise<void> {
  const warning = root.querySelector<HTMLElement>("#heat-warning");
  const textEl = root.querySelector<HTMLElement>("#heat-text");
  if (!warning || !textEl) return;

  // Primárně + fallback 1: živá / build-snapshot ČHMÚ výstraha.
  const hw: HeatWarning | null = await fetchHeatWarning();
  if (hw) {
    if (hw.active) {
      showHeatBanner(warning, textEl, hw);
    } else {
      warning.hidden = true; // výstraha reálně neplatí – nic si nepřivlastňujeme
    }
    return;
  }

  // Fallback 2: odvození z teploty (oba JSON zdroje selhaly).
  try {
    const w = await fetchCurrentWeather();
    if (w.apparent >= HEAT_THRESHOLD) {
      textEl.textContent = ui.heatWarning;
      warning.classList.remove("level-severe");
      warning.hidden = false;
    }
  } catch {
    // bez dat výstrahu nezobrazujeme
  }
}

function showHeatBanner(
  warning: HTMLElement,
  textEl: HTMLElement,
  hw: HeatWarning
): void {
  const headline = hw.headline.trim();
  textEl.textContent = `${ui.heatWarningPrefix} ${headline} ${ui.heatWarningSource}`;
  // Moderate = oranžová (--color-heat), Severe/Extreme = silnější (--color-heat-strong)
  const strong = hw.level === "Severe" || hw.level === "Extreme";
  warning.classList.toggle("level-severe", strong);
  warning.hidden = false;
}

// ---------- Kvalita ovzduší + UV index ----------

async function initAirQuality(root: HTMLElement): Promise<void> {
  const uvBadge = root.querySelector<HTMLElement>("#uv-badge");
  const uvValue = root.querySelector<HTMLElement>("#uv-value");
  const aqiBadge = root.querySelector<HTMLElement>("#aqi-badge");
  const aqiValue = root.querySelector<HTMLElement>("#aqi-value");

  try {
    const aq = await fetchAirQuality();

    if (uvBadge && uvValue && Number.isFinite(aq.uvIndex)) {
      const uv = uvCategory(aq.uvIndex);
      uvValue.textContent = `${Math.round(aq.uvIndex)} · ${uv.label}`;
      uvBadge.style.setProperty("--env-color", uv.color);
      uvBadge.hidden = false;
    }

    if (aqiBadge && aqiValue && Number.isFinite(aq.aqi)) {
      const cat = aqiCategory(aq.aqi);
      aqiValue.textContent = cat.label;
      aqiBadge.style.setProperty("--env-color", cat.color);
      aqiBadge.hidden = false;
    }
  } catch (err) {
    // Graceful: při chybě fetiche badge zůstanou skryté.
    console.warn("Kvalita ovzduší / UV nedostupná:", err);
  }
}
