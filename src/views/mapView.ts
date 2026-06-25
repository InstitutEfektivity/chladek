import maplibregl, {
  Map as MlMap,
  GeoJSONSource,
  Popup,
  Marker,
  type MapGeoJSONFeature,
  type ExpressionSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { ui } from "../content/site.ts";
import { baseStyle, coolingColors } from "../lib/mapStyle.ts";
import { fetchCurrentWeather } from "../lib/weather.ts";
import { haversine, escapeHtml } from "../lib/geo.ts";
import type {
  Cooling,
  VenueCollection,
  VenueFeature,
  CurrentWeather,
} from "../lib/types.ts";

const COOLINGS: Cooling[] = ["ac", "natural", "water", "shade"];
const HEAT_THRESHOLD = 31; // apparent_temperature [°C]
const SOURCE_ID = "venues";

const coolingLabels: Record<Cooling, string> = {
  ac: ui.filters.ac,
  natural: ui.filters.natural,
  water: ui.filters.water,
  shade: ui.filters.shade,
};

// Mutable stav pohledu mapy.
interface MapState {
  active: Set<Cooling>;
  nearMarkers: Marker[];
  data: VenueCollection | null;
}

export function renderMapView(root: HTMLElement): () => void {
  root.innerHTML = `
    <section class="map-view" aria-label="Mapa chladných míst">
      <div class="map-container">
        <div id="map" role="application" aria-label="Interaktivní mapa Prahy s chladnými místy"></div>
        <div class="map-topbar">
          <div class="temp-badge" id="temp-badge" role="status" aria-live="polite">
            <span class="temp-dot" aria-hidden="true"></span>
            <span>
              <span class="temp-label">${escapeHtml(ui.liveTemp.outsideNow)}</span>
              <span class="temp-value" id="temp-value">${escapeHtml(ui.liveTemp.loading)}</span>
              <span class="temp-feels" id="temp-feels"></span>
            </span>
          </div>
          <div class="heat-warning" id="heat-warning" role="alert" hidden>
            <span class="heat-icon" aria-hidden="true">⚠️</span>
            <span>${escapeHtml(ui.heatWarning)}</span>
          </div>
        </div>
      </div>
      <div class="map-controls">
        <fieldset class="filters">
          <legend>Filtr podle typu ochlazení</legend>
          ${COOLINGS.map(
            (c) => `
            <button type="button" class="chip" data-cooling="${c}" aria-pressed="true">
              <span class="chip-dot" style="background:${coolingColors[c]}" aria-hidden="true"></span>
              ${escapeHtml(coolingLabels[c])}
            </button>`
          ).join("")}
        </fieldset>
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
  };

  const map = new maplibregl.Map({
    container: "map",
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

  map.on("load", () => {
    void initData(map, state);
  });

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
      applyFilter(map, state);
    });
  }

  // Geolokace „3 nejbližší chládky"
  const locateBtn = root.querySelector<HTMLButtonElement>("#locate-btn");
  const locateStatus = root.querySelector<HTMLElement>("#locate-status");
  locateBtn?.addEventListener("click", () => {
    handleLocate(map, state, locateBtn, locateStatus);
  });

  // Živá teplota + výstraha
  void initWeather(root);

  // Cleanup při změně view.
  return () => {
    clearNearMarkers(state);
    map.remove();
  };
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

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data,
    cluster: true,
    clusterRadius: 50,
    clusterMaxZoom: 14,
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
  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: SOURCE_ID,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 13,
    },
    paint: {
      "text-color": [
        "step",
        ["get", "point_count"],
        "#0F2D43",
        100,
        "#FFFFFF",
      ],
    },
  });

  // Jednotlivé body obarvené podle cooling.
  map.addLayer({
    id: "venues-point",
    type: "circle",
    source: SOURCE_ID,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": [
        "match",
        ["get", "cooling"],
        "ac",
        coolingColors["ac"]!,
        "water",
        coolingColors["water"]!,
        "natural",
        coolingColors["natural"]!,
        "shade",
        coolingColors["shade"]!,
        "#888888",
      ],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 5, 16, 9],
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#FFFFFF",
    },
  });

  applyFilter(map, state);
  wireInteractions(map);
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

  const html = `
    <div class="popup">
      <h3>${escapeHtml(name)}</h3>
      <span class="popup-cooling">
        <span class="chip-dot" style="background:${dotColor}"></span>
        ${escapeHtml(ui.popup.coolingLabel)}: ${escapeHtml(coolingLabel)}
      </span>
      ${openingHtml}
      ${freeHtml}
      <a class="btn-navigate" href="${navUrl}" target="_blank" rel="noopener noreferrer">
        🧭 ${escapeHtml(ui.popup.navigate)}
      </a>
    </div>
  `;

  new Popup({ closeButton: true, maxWidth: "280px", focusAfterOpen: true })
    .setLngLat([lon, lat])
    .setHTML(html)
    .addTo(map);
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
    new Marker({ element: userEl }).setLngLat([lon, lat]).addTo(map)
  );

  const bounds = new maplibregl.LngLatBounds([lon, lat], [lon, lat]);

  for (const { f } of ranked) {
    const el = document.createElement("div");
    el.className = "near-marker";
    el.textContent = "❄️";
    const [flon, flat] = f.geometry.coordinates;
    const marker = new Marker({ element: el })
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
  return new Popup({ closeButton: true, maxWidth: "280px" }).setHTML(html);
}

// ---------- Počasí ----------

async function initWeather(root: HTMLElement): Promise<void> {
  const valueEl = root.querySelector<HTMLElement>("#temp-value");
  const feelsEl = root.querySelector<HTMLElement>("#temp-feels");
  const warning = root.querySelector<HTMLElement>("#heat-warning");

  try {
    const w: CurrentWeather = await fetchCurrentWeather();
    if (valueEl) valueEl.textContent = `${Math.round(w.temperature)} °C`;
    if (feelsEl) {
      feelsEl.textContent = `pocitově ${Math.round(w.apparent)} °C`;
    }
    if (warning && w.apparent >= HEAT_THRESHOLD) {
      warning.hidden = false;
    }
  } catch (err) {
    console.warn("Teplota nedostupná:", err);
    if (valueEl) valueEl.textContent = ui.liveTemp.failed;
    if (feelsEl) feelsEl.textContent = "";
  }
}
