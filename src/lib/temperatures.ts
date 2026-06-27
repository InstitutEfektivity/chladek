import type {
  TempStationCollection,
  TempSensorCollection,
} from "./types.ts";

// Živá NAMĚŘENÁ teplota vzduchu po Praze. Dva zdroje:
//  - temp-stations.geojson  → oficiální stanice ČHMÚ (měřená teplota vzduchu)
//  - temp-sensors.geojson    → pouliční čidla (Golemio / CAMEA, na slunci čtou víc)
//
// Priorita zdrojů (stejný vzor jako airStations.ts / heatWarning.ts):
//  1) raw GitHub (cron Action soubor aktualizuje → živé bez redeploye), cache-bust
//  2) lokální build snapshot (${BASE_URL}data/<file>)
// Při selhání obou vrací null → vrstva se prostě nepřidá (graceful).

const RAW_BASE =
  "https://raw.githubusercontent.com/InstitutEfektivity/chladek/main/public/data";

function isFeatureCollection(v: unknown): v is { features: unknown[] } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o["type"] === "FeatureCollection" && Array.isArray(o["features"]);
}

async function fetchGeojson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isFeatureCollection(data) ? (data as T) : null;
  } catch {
    return null;
  }
}

async function fetchWithFallback<T>(file: string): Promise<T | null> {
  // 1) raw GitHub – cache-bust přes ?t=
  const raw = await fetchGeojson<T>(`${RAW_BASE}/${file}?t=${Date.now()}`);
  if (raw) return raw;

  // 2) lokální build snapshot
  const local = await fetchGeojson<T>(`${import.meta.env.BASE_URL}data/${file}`);
  if (local) return local;

  return null;
}

export function fetchTempStations(): Promise<TempStationCollection | null> {
  return fetchWithFallback<TempStationCollection>("temp-stations.geojson");
}

export function fetchTempSensors(): Promise<TempSensorCollection | null> {
  return fetchWithFallback<TempSensorCollection>("temp-sensors.geojson");
}

// Teplotní barevná škála chladno → horko. Pill na mapě i kontrastní badge.
//  <22   teal     #2BB7C4
//  22–25.9 zelená  #7FC97F
//  26–29.9 žlutá   #F2C14E
//  30–33.9 oranžová #F08A3C
//  >=34   červená  #E0552E
export function tempColor(c: number): string {
  if (!Number.isFinite(c)) return "#7A8A93";
  if (c < 22) return "#2BB7C4";
  if (c < 26) return "#7FC97F";
  if (c < 30) return "#F2C14E";
  if (c < 34) return "#F08A3C";
  return "#E0552E";
}
