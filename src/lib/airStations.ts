import type { AirStationCollection } from "./types.ts";

// Živá vrstva stanic kvality ovzduší (Golemio / Pražská datová platforma).
// Priorita zdrojů – stejný vzor jako u ČHMÚ výstrahy:
//  1) raw GitHub (cron Action soubor aktualizuje hodinově → živé bez redeploye)
//  2) lokální build snapshot (${BASE_URL}data/air-quality-stations.geojson)
// Při selhání obou vrací null → vrstva se prostě nepřidá (graceful).
const RAW_URL =
  "https://raw.githubusercontent.com/InstitutEfektivity/chladek/main/public/data/air-quality-stations.geojson";

function isAirStationCollection(v: unknown): v is AirStationCollection {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o["type"] === "FeatureCollection" && Array.isArray(o["features"]);
}

async function fetchGeojson(url: string): Promise<AirStationCollection | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isAirStationCollection(data) ? data : null;
  } catch {
    return null;
  }
}

export async function fetchAirStations(): Promise<AirStationCollection | null> {
  // 1) raw GitHub – cache-bust přes ?t=
  const raw = await fetchGeojson(`${RAW_URL}?t=${Date.now()}`);
  if (raw) return raw;

  // 2) lokální build snapshot
  const local = await fetchGeojson(
    `${import.meta.env.BASE_URL}data/air-quality-stations.geojson`
  );
  if (local) return local;

  return null;
}
