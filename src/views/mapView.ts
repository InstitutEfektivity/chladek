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

import { ui, heatGuide } from "../content/site.ts";
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
import type { AreaFeature } from "../lib/types.ts";
import { fetchMlzitka } from "../lib/mlzitka.ts";
import { fetchMetro } from "../lib/metro.ts";
import { fetchCivic } from "../lib/civic.ts";
import {
  fetchAcCulture,
  fetchAcShops,
  fetchLibraries,
  fetchLibrariesKkc,
  fetchAcAreas,
} from "../lib/acData.ts";
import { computeOpenNow } from "../lib/library.ts";
import {
  fetchTempStations,
  fetchTempSensors,
  tempColor,
} from "../lib/temperatures.ts";
import {
  registerVenueIcons,
  registerOverlayIcons,
  registerAcAreaIcons,
  chipIconSvg,
} from "../lib/icons.ts";
import { haversine, escapeHtml } from "../lib/geo.ts";
import type {
  Cooling,
  Category,
  VenueCollection,
  VenueFeature,
  VenueProperties,
  CurrentWeather,
  HeatWarning,
  TempStationFeature,
  TempSensorFeature,
  AcCultureFeature,
  AcShopFeature,
  LibraryFeature,
  LibraryKkcFeature,
  AcAreaCollection,
} from "../lib/types.ts";

const COOLINGS: Cooling[] = ["ac", "natural", "water", "shade"];
const HEAT_THRESHOLD = 31; // apparent_temperature [°C]
const SOURCE_ID = "venues";
const AREAS_SOURCE_ID = "areas";

// AC budovy jako celé plochy (ac-areas) – samostatný polygonový source + 3 vrstvy
// (fill, outline, icon). Viditelnost řízená „Klimatizace" (ac) chipem.
const AC_AREAS_SOURCE_ID = "ac-areas";
const AC_AREAS_FILL_ID = "ac-areas-fill";
const AC_AREAS_OUTLINE_ID = "ac-areas-outline";
const AC_AREAS_ICON_ID = "ac-areas-icon";

// Popisky AC-budov potřebují kind → label. (Bezpečný malý lookup, ne text-field.)
const AC_AREA_KIND_LABEL: Record<string, string> = {
  mall: "Obchodní centrum",
  hypermarket: "Hypermarket",
  department_store: "Obchodní dům",
  diy: "Hobby / DIY market",
  ikea: "IKEA",
};

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

// Klimatizované čekárny (polikliniky) – samostatná symbol vrstva, defaultně skrytá.
const CIVIC_SOURCE_ID = "ac-civic";
const CIVIC_LAYER_ID = "ac-civic-point";

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
  tempVisible: boolean; // přepínač „Teploty (živě)" – default OFF (AC-first)
  areaLabels: Marker[]; // DOM popisky největších parků (ne text-field)
  acCount: number; // počet klimatizovaných veřejných míst (USP headline)
}

export function renderMapView(root: HTMLElement): () => void {
  root.innerHTML = `
    <section class="map-view" aria-label="Mapa chladných míst">
      <div class="map-container">
        <div id="map" role="application" aria-label="Interaktivní mapa Prahy s chladnými místy"></div>
        <div class="map-topbar">
          <div class="usp-banner" id="usp-banner" role="status" aria-live="polite" hidden>
            <span class="usp-headline" id="usp-headline"></span>
            <span class="usp-subtitle">${escapeHtml(ui.usp.subtitle)}</span>
          </div>
          <div class="topbar-badges">
            <button type="button" class="heat-guide-btn" id="heat-guide-btn" aria-haspopup="dialog" aria-label="${escapeHtml(ui.heatGuide.open)}">
              <span class="heat-guide-btn-icon" aria-hidden="true">☀</span>
              <span>${escapeHtml(ui.heatGuide.button)}</span>
            </button>
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
            <button type="button" class="chip chip-cooling" data-cooling="${c}" style="--chip-accent:${coolingColors[c]}" aria-pressed="${c === "ac" ? "true" : "false"}">
              <span class="chip-icon" style="color:${coolingColors[c]}" aria-hidden="true">${chipIconSvg(c)}</span>
              ${escapeHtml(coolingLabels[c])}
            </button>`
          ).join("")}
        </fieldset>
        <div class="overlay-toggles" role="group" aria-label="Datové vrstvy">
          <button type="button" class="chip chip-overlay" id="temps-toggle" aria-pressed="false">
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
          <button type="button" class="chip chip-overlay" id="civic-toggle" aria-pressed="false">
            <span class="chip-dot chip-dot-civic" aria-hidden="true"></span>
            ${escapeHtml(ui.civic.toggle)}
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
    // AC-first: na startu jen klimatizovaná místa (ostatní typy si uživatel zapne).
    active: new Set<Cooling>(["ac"]),
    nearMarkers: [],
    data: null,
    tempMarkers: [],
    tempVisible: false,
    areaLabels: [],
    acCount: 0,
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

  // Přepínač „Klimatizované čekárny" – visibility symbol vrstvy. Default OFF.
  wireLayerToggle(root, "#civic-toggle", () => map, CIVIC_LAYER_ID);

  // Geolokace „3 nejbližší chládky"
  const locateBtn = root.querySelector<HTMLButtonElement>("#locate-btn");
  const locateStatus = root.querySelector<HTMLElement>("#locate-status");
  locateBtn?.addEventListener("click", () => {
    if (map) handleLocate(map, state, locateBtn, locateStatus);
  });

  // Edukační panel „Co dělat v horku" – modal spouštěný tlačítkem v chrome mapy.
  const heatGuidePanel = setupHeatGuide(root);

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
    clearAreaLabels(state);
    heatGuidePanel.destroy();
    map?.remove();
  };
}

// ---------- Edukační panel „Co dělat v horku" (modal, accessible, focus-trap) ----------

// Postaví modal s radami do horka, zapojí spouštěč v chrome mapy a vrátí destroy().
// Modal: mobile-first frosted panel, zavíratelný (Esc + tlačítko + klik na pozadí),
// focus-trapped, vrací focus na spouštěč. Žádná závislost na mapě – čistě DOM.
function setupHeatGuide(root: HTMLElement): { destroy: () => void } {
  const trigger = root.querySelector<HTMLButtonElement>("#heat-guide-btn");
  if (!trigger) return { destroy: () => {} };

  const overlay = document.createElement("div");
  overlay.className = "heat-guide-overlay";
  overlay.hidden = true;
  overlay.innerHTML = buildHeatGuideHtml();
  root.appendChild(overlay);

  const dialog = overlay.querySelector<HTMLElement>(".heat-guide-modal")!;
  const closeBtns = Array.from(
    overlay.querySelectorAll<HTMLButtonElement>("[data-hg-close]")
  );

  let lastFocused: HTMLElement | null = null;
  let open = false;

  const focusable = (): HTMLElement[] =>
    Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null || el === dialog);

  function onKeydown(e: KeyboardEvent): void {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closePanel();
      return;
    }
    if (e.key === "Tab") {
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function openPanel(): void {
    if (open) return;
    open = true;
    lastFocused = document.activeElement as HTMLElement | null;
    overlay.hidden = false;
    // Vynutíme reflow, ať CSS přechod naskočí.
    void overlay.offsetWidth;
    overlay.classList.add("is-open");
    trigger!.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", onKeydown, true);
    const items = focusable();
    (items[0] ?? dialog).focus();
  }

  function closePanel(): void {
    if (!open) return;
    open = false;
    overlay.classList.remove("is-open");
    trigger!.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onKeydown, true);
    // Po doběhnutí přechodu skryj (a vrať focus na spouštěč).
    window.setTimeout(() => {
      if (!open) overlay.hidden = true;
    }, 200);
    lastFocused?.focus();
  }

  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", openPanel);
  for (const b of closeBtns) b.addEventListener("click", closePanel);
  // Klik na pozadí (mimo modal) zavírá.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePanel();
  });

  return {
    destroy: () => {
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
    },
  };
}

// Sestaví HTML obsahu panelu z heatGuide (skupiny rad + blok první pomoci).
function buildHeatGuideHtml(): string {
  const groupsHtml = heatGuide.groups
    .map(
      (g) => `
      <section class="hg-group">
        <h3 class="hg-group-heading">
          <span class="hg-group-icon" aria-hidden="true">${escapeHtml(g.icon)}</span>
          ${escapeHtml(g.heading)}
        </h3>
        <ul class="hg-tips">
          ${g.tips.map((t) => `<li>${escapeHtml(t)}</li>`).join("\n")}
        </ul>
      </section>`
    )
    .join("\n");

  const em = heatGuide.emergency;
  const emergencyHtml = `
    <section class="hg-group hg-emergency" aria-label="${escapeHtml(em.heading)}">
      <h3 class="hg-group-heading">
        <span class="hg-group-icon" aria-hidden="true">🚑</span>
        ${escapeHtml(em.heading)}
      </h3>
      <p class="hg-emergency-intro">${escapeHtml(em.intro)}</p>
      <div class="hg-emergency-cols">
        <div>
          <h4 class="hg-sub">Příznaky</h4>
          <ul class="hg-tips">${em.symptoms.map((s) => `<li>${escapeHtml(s)}</li>`).join("\n")}</ul>
        </div>
        <div>
          <h4 class="hg-sub">První pomoc</h4>
          <ul class="hg-tips">${em.firstAid.map((s) => `<li>${escapeHtml(s)}</li>`).join("\n")}</ul>
        </div>
      </div>
      <p class="hg-call">${escapeHtml(em.callLine)}</p>
    </section>`;

  return `
    <div class="heat-guide-modal" role="dialog" aria-modal="true" aria-labelledby="hg-title" tabindex="-1">
      <header class="hg-header">
        <div>
          <span class="hg-kicker" aria-hidden="true">☀ Rady do horka</span>
          <h2 id="hg-title">${escapeHtml(ui.heatGuide.title)}</h2>
        </div>
        <button type="button" class="hg-close" data-hg-close aria-label="${escapeHtml(ui.heatGuide.closeAria)}">×</button>
      </header>
      <div class="hg-body">
        <p class="hg-intro">${escapeHtml(ui.heatGuide.intro)}</p>
        <div class="hg-groups">
          ${groupsHtml}
          ${emergencyHtml}
        </div>
        <p class="hg-source">${escapeHtml(ui.heatGuide.sourceNote)}</p>
      </div>
      <footer class="hg-footer">
        <a class="btn hg-map-cta" href="#/" data-hg-close>${escapeHtml(ui.heatGuide.mapCta)}</a>
        <button type="button" class="btn hg-close-btn" data-hg-close>${escapeHtml(ui.heatGuide.close)}</button>
      </footer>
    </div>`;
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
  let baseData: VenueCollection;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/venues.geojson`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    baseData = (await res.json()) as VenueCollection;
  } catch (err) {
    console.error("Nepodařilo se načíst data míst:", err);
    return;
  }

  // Paralelně dotáhni nově sloučené AC bodové datasety (graceful – null když chybí).
  const [acCulture, acShops, libraries, librariesKkc, acAreas] =
    await Promise.all([
      fetchAcCulture(),
      fetchAcShops(),
      fetchLibraries(),
      fetchLibrariesKkc(),
      fetchAcAreas(),
    ]);

  // Normalizuj AC body do jednotného venue shape (jeden ikonový systém + clustering).
  const mergedFeatures: VenueFeature[] = [...baseData.features];
  if (acCulture) {
    for (const f of acCulture.features) mergedFeatures.push(normalizeCulture(f));
  }
  if (acShops) {
    for (const f of acShops.features) mergedFeatures.push(normalizeShop(f));
  }
  if (libraries) {
    for (const f of libraries.features) mergedFeatures.push(normalizeLibrary(f));
  }
  if (librariesKkc) {
    for (const f of librariesKkc.features)
      mergedFeatures.push(normalizeLibraryKkc(f));
  }

  const data: VenueCollection = {
    type: "FeatureCollection",
    features: mergedFeatures,
  };
  state.data = data;

  // USP headline: počet klimatizovaných veřejných míst napříč zdroji.
  state.acCount = computeAcCount({
    acAreas,
    cultureTierA: acCulture
      ? acCulture.features.filter((f) => f.properties.tier === "A").length
      : 0,
    shops: acShops ? acShops.features.length : 0,
    libraries:
      (libraries ? libraries.features.length : 0) +
      (librariesKkc ? librariesKkc.features.length : 0),
    venuesShopAc: baseData.features.filter(
      (f) => f.properties.category === "shop_ac"
    ).length,
  });
  renderUspBanner(state.acCount);

  // SPODNÍ vrstva: plošný rozsah chladu (parky/stín, vodní plochy). Volitelný
  // soubor – když chybí, prostě se přeskočí. Přidáváme PRVNÍ, aby seděl pod body.
  await initAreas(map, state);

  // AC budovy jako celé plochy – NAD zelenými areas, POD clustery/body. Volitelné.
  await initAcAreas(map, state, acAreas);

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data,
    cluster: true,
    clusterRadius: 50,
    // Snížen ze 14 na 13 – velké kategorické ikony (hvězda mapy) naskočí dřív.
    clusterMaxZoom: 13,
  });

  // Halo „do ztracena" pod ikonou: velký rozmazaný disk u velkých chladných budov
  // s rozsáhlým půdorysem (obchoďák, bazén). Měkká chladná záře = „chladné je celé
  // místo, ne jen bod". Barvu řídí cooling daného bodu.
  map.addLayer({
    id: "venue-glow",
    type: "circle",
    source: SOURCE_ID,
    filter: [
      "all",
      ["!", ["has", "point_count"]],
      ["in", ["get", "category"], ["literal", ["mall", "pool"]]],
    ],
    paint: {
      "circle-color": [
        "match",
        ["get", "cooling"],
        "water",
        coolingColors["water"]!,
        coolingColors["ac"]!,
      ],
      "circle-opacity": 0.2,
      "circle-blur": 1,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 22, 16, 66],
    },
  });

  // AC-budova ikona NAD venue-glow, POD clustery (z-order). Polygonový source +
  // ikony už připravil initAcAreas. (Když dataset chyběl, funkce je no-op.)
  addAcAreasIconLayer(map, state);

  // Clustery – moderní „frosted" vzhled: měkký gradient (cool paleta), translucentní
  // vnější halo a jemné škálování podle point_count. Halo kreslíme jako samostatný
  // rozmazaný kruh POD jádrem clusteru.
  map.addLayer({
    id: "clusters-halo",
    type: "circle",
    source: SOURCE_ID,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        coolingColors["ac"]!,
        25,
        "#1899C4",
        100,
        "#1C7E8C",
      ],
      "circle-opacity": 0.22,
      "circle-blur": 0.8,
      "circle-radius": [
        "step",
        ["get", "point_count"],
        26,
        25,
        34,
        100,
        46,
      ],
    },
  });
  map.addLayer({
    id: "clusters",
    type: "circle",
    source: SOURCE_ID,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        coolingColors["ac"]!,
        25,
        "#1899C4",
        100,
        "#1C7E8C",
      ],
      "circle-opacity": 0.94,
      "circle-radius": ["step", ["get", "point_count"], 18, 25, 25, 100, 33],
      "circle-stroke-width": 3,
      "circle-stroke-color": "rgba(255,255,255,0.92)",
    },
  });
  // (Počet v clusteru jako text byl symbol vrstva závislá na externích glyphech;
  //  selhání glyphů označovalo celou geojson tile jako errored → nic se nevykreslilo.
  //  Velikost clusteru komunikuje poloměr kruhu.)

  // Ikony chládek-bodů MUSÍ být zaregistrované PŘED symbol vrstvou, která je odkazuje
  // (jinak styleimagemissing). Rastrové ikony (ne glyphy) – bezpečné.
  await registerVenueIcons(map);

  // Jednotlivé body jako velká kategorická ikona (squircle badge). Symbol vrstva BEZ
  // text-field (žádné glyphy) – icon-image je rastr.
  //
  // Velikostní tiery (icon-size, zoom-interpolované, stepované přes data-expression
  // tierSizeExpr): XL (park, mall) > L (museum, library, cinema, pool, church) >
  // M (shop_ac, cafe_food, fountain). I „M" je výrazně větší než staré drobné piny.
  map.addLayer({
    id: "venues-point",
    type: "symbol",
    source: SOURCE_ID,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": [
        "match",
        ["get", "category"],
        "mall",
        "icon-mall",
        "library",
        "icon-library",
        "museum",
        "icon-museum",
        "cinema",
        "icon-cinema",
        "pool",
        "icon-pool",
        "fountain",
        "icon-fountain",
        "church",
        "icon-church",
        "park",
        "icon-park",
        "shop_ac",
        "icon-shop_ac",
        "cafe_food",
        "icon-cafe_food",
        "theatre",
        "icon-theatre",
        "concert",
        "icon-concert",
        "gallery",
        "icon-gallery",
        "store",
        "icon-store",
        "icon-shop_ac",
      ],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-anchor": "bottom",
      // Base rastr je 128×148 @ pixelRatio 2 → @icon-size 1 ≈ 64×74 px.
      // Tier škála: XL z16 ≈ 0.92 → ~59 px badge; M z16 ≈ 0.62 → ~40 px badge.
      "icon-size": tierSizeExpr(),
    },
    paint: {
      // AC body plně syté, doplňkové (voda/stín/přírodní chlad) mírně ztlumené.
      "icon-opacity": [
        "case",
        ["==", ["get", "cooling"], "ac"],
        1,
        0.8,
      ],
    },
  });

  applyFilter(map, state);
  wireInteractions(map);
}

// Velikost badge podle velikostního tieru kategorie, interpolovaná zoomem.
// XL = celá lokalita/areál (park, mall), L = celá chladná budova
// (museum, library, cinema, pool, church), M = jednotlivý AC bod
// (shop_ac, cafe_food, fountain). Vrací ExpressionSpecification pro icon-size.
function tierSizeExpr(): ExpressionSpecification {
  // tier multiplikátor podle kategorie. Pravidlo majitele: AC body menší (drobné
  // klikatelné pointy), lokalita širší.
  //  XL = park, mall (celá lokalita/areál)
  //  L  = museum, gallery, theatre, cinema, concert, library, pool (celá budova)
  //  M  = store, shop_ac, cafe_food, fountain, church (jednotlivý AC bod) – default
  const tier: ExpressionSpecification = [
    "match",
    ["get", "category"],
    ["park", "mall"],
    1.0, // XL
    ["museum", "gallery", "theatre", "cinema", "concert", "library", "pool"],
    0.82, // L
    0.6, // M (store, shop_ac, cafe_food, fountain, church) – default, AC body menší
  ] as ExpressionSpecification;
  // AC body lehce výraznější než doplňkové typy (voda/stín/přirozený chlad) –
  // klimatizace je hlavní smysl mapy, ostatní jsou doplňkové.
  const acBoost: ExpressionSpecification = [
    "case",
    ["==", ["get", "cooling"], "ac"],
    1.1,
    0.9,
  ] as ExpressionSpecification;
  // Základní zoom škála × tier multiplikátor × AC boost.
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    10,
    ["*", 0.34, tier, acBoost],
    13,
    ["*", 0.62, tier, acBoost],
    16,
    ["*", 0.92, tier, acBoost],
    18,
    ["*", 1.08, tier, acBoost],
  ] as ExpressionSpecification;
}

// ---------- Normalizace nově sloučených AC bodů do venue shape ----------

// Mapování ac-culture subtype → jednotná kategorie (a tím ikona).
function cultureCategory(subtype: string): Category {
  switch (subtype) {
    case "muzeum":
      return "museum";
    case "galerie":
      return "gallery";
    case "divadlo":
      return "theatre";
    case "kino":
      return "cinema";
    case "koncertní sál":
    case "multifunkční sál":
      return "concert";
    case "kulturní institut":
    case "kulturní dům":
      return "museum"; // „culture" → reuse museum glyph
    case "literární kavárna":
      return "cafe_food";
    case "aréna":
      return "mall"; // velký areál → reuse mall/venue ikona
    default:
      return "museum";
  }
}

function normalizeCulture(f: AcCultureFeature): VenueFeature {
  const p = f.properties;
  const props: VenueProperties = {
    id: p.id,
    name: p.name,
    category: cultureCategory(p.subtype),
    cooling: "ac",
    typical_c: null,
    free_entry: null,
    opening_hours: null,
    address: p.address ?? null,
    source: p.source,
    note: null,
    tier: p.tier,
    subtype: p.subtype,
    web: p.web ?? null,
    bezbar: p.bezbar,
  };
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: f.geometry.coordinates },
    properties: props,
  };
}

function normalizeShop(f: AcShopFeature): VenueFeature {
  const p = f.properties;
  const props: VenueProperties = {
    id: p.id,
    name: p.name,
    category: "store", // drogerie i electronics → ikona „store"
    cooling: "ac",
    typical_c: null,
    free_entry: null,
    opening_hours: null,
    address: null,
    source: p.source,
    note: null,
    tier: p.tier,
    brand: p.brand ?? null,
    subtype: p.kind,
  };
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: f.geometry.coordinates },
    properties: props,
  };
}

function normalizeLibrary(f: LibraryFeature): VenueFeature {
  const p = f.properties;
  const open = computeOpenNow(p.opening_hours);
  const props: VenueProperties = {
    id: p.id,
    name: p.name,
    category: "library",
    cooling: "ac",
    typical_c: null,
    free_entry: null,
    opening_hours: null,
    address: p.address ?? null,
    source: p.source,
    note: null,
    tier: p.tier,
    openLabel: open.label,
    openState: open.state,
  };
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: f.geometry.coordinates },
    properties: props,
  };
}

// IPR KULTKKC knihovny okrajových MČ – jako knihovna (ac), ale bez otevírací doby.
function normalizeLibraryKkc(f: LibraryKkcFeature): VenueFeature {
  const p = f.properties;
  const props: VenueProperties = {
    id: p.id,
    name: p.name,
    category: "library",
    cooling: "ac",
    typical_c: null,
    free_entry: null,
    opening_hours: null,
    address: p.address ?? null,
    source: p.source,
    note: null,
    tier: p.tier,
  };
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: f.geometry.coordinates },
    properties: props,
  };
}

// ---------- USP headline (počet AC míst) ----------

function computeAcCount(o: {
  acAreas: AcAreaCollection | null;
  cultureTierA: number;
  shops: number;
  libraries: number;
  venuesShopAc: number;
}): number {
  const areas = o.acAreas ? o.acAreas.features.length : 0;
  return areas + o.cultureTierA + o.shops + o.libraries + o.venuesShopAc;
}

// České číslo s mezerou jako oddělovačem tisíců (1 286 → „1 286").
function formatCountCs(n: number): string {
  return n.toLocaleString("cs-CZ");
}

function renderUspBanner(count: number): void {
  const banner = document.getElementById("usp-banner");
  const headline = document.getElementById("usp-headline");
  if (!banner || !headline || count <= 0) return;
  headline.textContent = `❄ ${formatCountCs(count)} ${ui.usp.headlineSuffix}`;
  banner.hidden = false;
}

// ---------- AC budovy jako celé plochy (ac-areas) ----------

// Přidá ac-areas source + fill/outline/icon vrstvy. NAD zelenými areas, POD clustery.
// Volitelné – když dataset chybí (null), nepřidá se nic. Ikony se registrují PŘED
// icon vrstvou (jinak styleimagemissing).
async function initAcAreas(
  map: MlMap,
  state: MapState,
  acAreas: AcAreaCollection | null
): Promise<void> {
  if (!acAreas) return;

  map.addSource(AC_AREAS_SOURCE_ID, { type: "geojson", data: acAreas });

  const acColor = coolingColors["ac"]!;

  // Výplň – chladná AC plocha, zoom-tapered opacity (na detailu nepřebíjí body).
  map.addLayer({
    id: AC_AREAS_FILL_ID,
    type: "fill",
    source: AC_AREAS_SOURCE_ID,
    paint: {
      "fill-color": acColor,
      "fill-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        0.22,
        14,
        0.2,
        16,
        0.14,
      ],
    },
  });

  // Obrys s blur → měkký okraj „do ztracena".
  map.addLayer({
    id: AC_AREAS_OUTLINE_ID,
    type: "line",
    source: AC_AREAS_SOURCE_ID,
    paint: {
      "line-color": acColor,
      "line-blur": 3,
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 16, 4],
      "line-opacity": 0.45,
    },
  });

  // Velkou kategorickou ikonu v centroidu přidáme AŽ později (addAcAreasIconLayer),
  // aby v z-orderu seděla NAD venue-glow, ale POD clustery. Ikony zaregistrujeme teď.
  await registerAcAreaIcons(map);

  // Klik na výplň → popup AC budovy. (Klik na ikonu se naváže v addAcAreasIconLayer.)
  const onClick = (e: { features?: MapGeoJSONFeature[]; lngLat: { lng: number; lat: number } }): void => {
    const f = e.features?.[0];
    if (f) openAcAreaPopup(map, f, e.lngLat.lng, e.lngLat.lat);
  };
  map.on("click", AC_AREAS_ICON_ID, onClick);
  map.on("click", AC_AREAS_FILL_ID, onClick);
  for (const layer of [AC_AREAS_ICON_ID, AC_AREAS_FILL_ID]) {
    map.on("mouseenter", layer, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layer, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  // Počáteční viditelnost (fill/outline) dle „Klimatizace" chipu.
  applyAcAreasVisibility(map, state);
}

// Přidá symbol vrstvu s velkou ikonou AC budovy. Voláno AŽ po venue-glow a PŘED
// clusters-halo → sekvenčním append-em sedí ikona NAD venue-glow, ale POD clustery
// (přesně dle požadovaného z-orderu). Předpoklad: initAcAreas už proběhl (source
// existuje, ikony zaregistrované).
function addAcAreasIconLayer(map: MlMap, state: MapState): void {
  if (!map.getSource(AC_AREAS_SOURCE_ID)) return; // dataset chyběl → nic
  if (map.getLayer(AC_AREAS_ICON_ID)) return;
  map.addLayer({
    id: AC_AREAS_ICON_ID,
    type: "symbol",
    source: AC_AREAS_SOURCE_ID,
    layout: {
      "icon-image": [
        "match",
        ["get", "kind"],
        "mall",
        "icon-acarea-mall",
        "hypermarket",
        "icon-acarea-hypermarket",
        "department_store",
        "icon-acarea-department_store",
        "diy",
        "icon-acarea-diy",
        "ikea",
        "icon-acarea-ikea",
        "icon-acarea-mall",
      ],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-anchor": "center",
      // XL – větší než běžné body (celá budova = velký areál).
      "icon-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        0.4,
        14,
        0.7,
        16,
        1.0,
        18,
        1.15,
      ],
    },
  });
  // Po přidání srovnej viditelnost dle aktivního chipu.
  applyAcAreasVisibility(map, state);
}

// AC budovy se zobrazují, jen když je aktivní „ac" chip.
function applyAcAreasVisibility(map: MlMap, state: MapState): void {
  const visible = state.active.has("ac") ? "visible" : "none";
  for (const id of [AC_AREAS_FILL_ID, AC_AREAS_OUTLINE_ID, AC_AREAS_ICON_ID]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible);
  }
}

function openAcAreaPopup(
  map: MlMap,
  feature: MapGeoJSONFeature,
  lng: number,
  lat: number
): void {
  const p = feature.properties as Record<string, unknown>;
  const name = String(p["name"] ?? "");
  const kind = String(p["kind"] ?? "");
  const kindLabel = AC_AREA_KIND_LABEL[kind] ?? kind;
  const source = String(p["source"] ?? "");
  const acColor = coolingColors["ac"]!;

  const html = `
    <div class="popup popup-acarea">
      <span class="ac-badge ac-badge-a" style="--ac-color:${acColor}">${escapeHtml(ui.popup.acTierA)}</span>
      <h3>${escapeHtml(name)}</h3>
      <p class="acarea-note">${escapeHtml(ui.popup.acAreaNote)}</p>
      <dl><dt>${escapeHtml(ui.popup.kindLabel)}</dt><dd>${escapeHtml(kindLabel)}</dd></dl>
      <p class="overlay-source">${escapeHtml(ui.popup.sourceLabel)}: ${escapeHtml(source)}</p>
    </div>`;

  new maplibregl.Popup({ closeButton: true, maxWidth: "280px", focusAfterOpen: true })
    .setLngLat([lng, lat])
    .setHTML(html)
    .addTo(map);
}

// Plošné overlay vrstvy úplně dole (jen nad basemapem). Volitelné – graceful skip.
async function initAreas(map: MlMap, state: MapState): Promise<void> {
  const areas = await fetchAreas();
  if (!areas) return; // soubor chybí / nevalidní → vrstvy se nepřidají

  map.addSource(AREAS_SOURCE_ID, { type: "geojson", data: areas });

  // Výplň – sytější barevná plocha podle cooling (park = zóna, ne bod).
  // Vyšší kontrast (opacity ~0.22) + zoom-řízené ztlumení, ať na detailu nepřebíjí body.
  map.addLayer({
    id: "areas-fill",
    type: "fill",
    source: AREAS_SOURCE_ID,
    paint: {
      "fill-color": [
        "match",
        ["get", "cooling"],
        "shade",
        coolingColors["shade"]!,
        "water",
        coolingColors["water"]!,
        coolingColors["shade"]!,
      ],
      "fill-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        10,
        0.24,
        14,
        0.22,
        16,
        0.16,
      ],
    },
  });

  // Vnitřní měkká „glow" výplň podél okraje – druhý fill s blur efektem simulujeme
  // jako světlejší lem (line uvnitř). Zde jen sytější jádro výplně přes line s blur.
  // Obrys s blur → měkký okraj „vytrácející se do ztracena", crisper než dřív.
  map.addLayer({
    id: "areas-outline",
    type: "line",
    source: AREAS_SOURCE_ID,
    paint: {
      "line-color": [
        "match",
        ["get", "cooling"],
        "shade",
        coolingColors["shade"]!,
        "water",
        coolingColors["water"]!,
        coolingColors["shade"]!,
      ],
      "line-blur": 2,
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 16, 4],
      "line-opacity": 0.55,
    },
  });

  // NICE-TO-HAVE: DOM popisky největších parků/ploch (ne text-field – jen HTML Marker).
  // Pojmenuje hlavní zóny, aniž bychom riskovali glyph-fetch chybu. Jen ~14 největších
  // pojmenovaných ploch, ať to nezahltí mapu.
  addAreaLabels(map, state, areas.features);
}

// Spočítá přibližný centroid prvního prstence polygonu/multipolygonu.
function ringCentroid(coords: number[][]): [number, number] | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const pt of coords) {
    const x = pt[0];
    const y = pt[1];
    if (typeof x === "number" && typeof y === "number") {
      sx += x;
      sy += y;
      n++;
    }
  }
  if (n === 0) return null;
  return [sx / n, sy / n];
}

function areaCentroid(f: AreaFeature): [number, number] | null {
  const g = f.geometry;
  if (g.type === "Polygon") {
    const ring = g.coordinates[0];
    return ring ? ringCentroid(ring) : null;
  }
  // MultiPolygon: vezmi vnější prstenec prvního polygonu.
  const poly = g.coordinates[0];
  const ring = poly?.[0];
  return ring ? ringCentroid(ring) : null;
}

function addAreaLabels(
  map: MlMap,
  state: MapState,
  features: AreaFeature[]
): void {
  const named = features
    .filter((f) => f.properties.name.trim().length > 0)
    .sort((a, b) => b.properties.area_m2 - a.properties.area_m2)
    .slice(0, 14);

  for (const f of named) {
    const center = areaCentroid(f);
    if (!center) continue;
    const el = document.createElement("div");
    el.className =
      f.properties.cooling === "water" ? "area-label area-label-water" : "area-label";
    el.textContent = f.properties.name;
    el.setAttribute("aria-hidden", "true");
    el.dataset["cooling"] = f.properties.cooling; // pro filtr dle chipů (shade/water)
    const marker = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat(center)
      .addTo(map);
    state.areaLabels.push(marker);
  }
}

function clearAreaLabels(state: MapState): void {
  for (const m of state.areaLabels) m.remove();
  state.areaLabels = [];
}

function applyFilter(map: MlMap, state: MapState): void {
  // AC budovy (ac-areas) řídí „ac" chip.
  applyAcAreasVisibility(map, state);
  // Zelené plochy (parky/les = shade, vodní plochy = water) patří k chipům
  // „Stín a parky" / „Voda" – na startu (jen AC) jsou skryté.
  const areaFilter = [
    "in",
    ["get", "cooling"],
    ["literal", Array.from(state.active)],
  ] as ExpressionSpecification;
  for (const id of ["areas-fill", "areas-outline"]) {
    if (map.getLayer(id)) map.setFilter(id, areaFilter);
  }
  for (const m of state.areaLabels) {
    const el = m.getElement();
    const cooling = el.dataset["cooling"];
    el.style.display =
      cooling && state.active.has(cooling as Cooling) ? "" : "none";
  }
  // Filtrace na úrovni DAT sourcu (ne jen vrstvy bodů). Clustery agregují všechno,
  // co je v sourcu – takže aby respektovaly zaškrtnuté typy, musí se filtrovat samotná
  // data, ne jen layer bodů. Nic aktivního → prázdná data → žádné body ani clustery.
  const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  if (src && state.data) {
    const feats =
      state.active.size === 0
        ? []
        : state.data.features.filter((f) =>
            state.active.has(f.properties.cooling as Cooling)
          );
    src.setData({ type: "FeatureCollection", features: feats });
  }
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

  const acColor = coolingColors["ac"]!;

  // AC tier badge: A = autoritativně klimatizováno, B = vnitřní útočiště.
  const tier = p["tier"];
  let tierHtml = "";
  if (tier === "A") {
    tierHtml = `<span class="ac-badge ac-badge-a" style="--ac-color:${acColor}">${escapeHtml(ui.popup.acTierA)}</span>`;
  } else if (tier === "B") {
    tierHtml = `<span class="ac-badge ac-badge-b">${escapeHtml(ui.popup.acTierB)}</span>`;
  }

  // Knihovny: „Otevřeno teď · do HH:MM" (zeleně) / „Zavřeno · …" (ztlumeně).
  let openNowHtml = "";
  const openLabel = p["openLabel"];
  const openState = p["openState"];
  if (typeof openLabel === "string" && openLabel) {
    const cls = openState === "open" ? "open" : "closed";
    openNowHtml = `<p class="open-now ${cls}">${escapeHtml(openLabel)}</p>`;
  }

  // Kultura: subtype + bezbariérovost (♿).
  let subtypeHtml = "";
  const subtype = p["subtype"];
  if (typeof subtype === "string" && subtype && p["category"] !== "store") {
    subtypeHtml = `<span class="popup-subtype">${escapeHtml(subtype)}</span>`;
  }
  let bezbarHtml = "";
  if (p["bezbar"] === true) {
    bezbarHtml = `<span class="popup-bezbar" title="${escapeHtml(ui.popup.bezbar)}">♿ ${escapeHtml(ui.popup.bezbar)}</span>`;
  }

  // Prodejny: značka.
  let brandHtml = "";
  const brand = p["brand"];
  if (typeof brand === "string" && brand) {
    brandHtml = `<dl><dt>${escapeHtml(ui.popup.brandLabel)}</dt><dd>${escapeHtml(brand)}</dd></dl>`;
  }

  // Adresa (kultura/knihovny) + web (kultura).
  let addressHtml = "";
  const address = p["address"];
  if (typeof address === "string" && address) {
    addressHtml = `<p class="popup-address">${escapeHtml(address)}</p>`;
  }
  let webHtml = "";
  const web = p["web"];
  if (typeof web === "string" && web) {
    const href = web.startsWith("http") ? web : `https://${web}`;
    webHtml = `<a class="popup-web" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(web)}</a>`;
  }

  // Zdroj (jen u sloučených AC bodů, kde nese smysl – tier present).
  let sourceHtml = "";
  const source = p["source"];
  if (tier && typeof source === "string" && source) {
    sourceHtml = `<p class="overlay-source">${escapeHtml(ui.popup.sourceLabel)}: ${escapeHtml(source)}</p>`;
  }

  const html = `
    <div class="popup">
      <h3>${escapeHtml(name)}</h3>
      ${subtypeHtml}
      ${tierHtml}
      <span class="popup-cooling" style="--chip-accent:${dotColor}">
        <span class="popup-cooling-icon" style="color:${dotColor}" aria-hidden="true">${coolingIcon}</span>
        ${escapeHtml(ui.popup.coolingLabel)}: ${escapeHtml(coolingLabel)}
      </span>
      ${openNowHtml}
      ${bezbarHtml}
      ${openingHtml}
      ${freeHtml}
      ${brandHtml}
      ${addressHtml}
      ${webHtml}
      <a class="btn-navigate" href="${navUrl}" target="_blank" rel="noopener noreferrer">
        🧭 ${escapeHtml(ui.popup.navigate)}
      </a>
      ${sourceHtml}
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
  await initCivic(map);
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

async function initCivic(map: MlMap): Promise<void> {
  const data = await fetchCivic();
  if (!data) {
    console.warn("Klimatizované čekárny nedostupné – vrstva se nepřidá.");
    return;
  }
  map.addSource(CIVIC_SOURCE_ID, { type: "geojson", data });
  map.addLayer({
    id: CIVIC_LAYER_ID,
    type: "symbol",
    source: CIVIC_SOURCE_ID,
    layout: {
      visibility: "none", // default OFF
      "icon-image": "icon-civic",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-anchor": "bottom",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.34, 16, 0.56],
    },
  });

  map.on("click", CIVIC_LAYER_ID, (e) => {
    const feature = e.features?.[0];
    if (feature) openCivicPopup(map, feature);
  });
  map.on("mouseenter", CIVIC_LAYER_ID, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", CIVIC_LAYER_ID, () => {
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

function openCivicPopup(map: MlMap, feature: MapGeoJSONFeature): void {
  if (feature.geometry.type !== "Point") return;
  const [lon, lat] = feature.geometry.coordinates as [number, number];
  const p = feature.properties as Record<string, unknown>;
  const name = String(p["name"] ?? "");
  const address =
    typeof p["address"] === "string" && p["address"]
      ? String(p["address"])
      : null;
  const source = String(p["source"] ?? "");

  const addressHtml = address
    ? `<p class="popup-address">${escapeHtml(address)}</p>`
    : "";
  const html = `
    <div class="popup popup-overlay">
      <span class="overlay-kicker">${escapeHtml(ui.civic.toggle)}</span>
      <h3>${escapeHtml(name)}</h3>
      <p class="overlay-note">${escapeHtml(ui.civic.popupNote)}</p>
      ${addressHtml}
      <span class="ac-badge ac-badge-b">${escapeHtml(ui.popup.acTierB)}</span>
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
