import type { MetroCollection } from "./types.ts";

// Stanice metra (PID / ROPID) – „chládek pod zemí". Statický dataset, jen lokální
// fetch z build snapshotu. Při jakémkoli selhání vracíme null → vrstva se nepřidá.
// Vzor (try/catch → null) mirroruje areas.ts.

function isMetroCollection(v: unknown): v is MetroCollection {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o["type"] === "FeatureCollection" && Array.isArray(o["features"]);
}

export async function fetchMetro(): Promise<MetroCollection | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/metro.geojson`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isMetroCollection(data) ? data : null;
  } catch {
    return null;
  }
}
