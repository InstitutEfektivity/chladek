import type { AreaCollection } from "./types.ts";

// Plošné overlay vrstvy (stín parků, vodní plochy) – prostorový rozsah chladu,
// ne bod. Soubor produkuje datová pipeline; v době buildu nemusí existovat
// (runtime fetch). Při jakémkoli selhání vracíme null → vrstvy se prostě nepřidají.
//
// Vzor (try/catch → null) mirroruje airStations.ts / weather fallbacky.

function isAreaCollection(v: unknown): v is AreaCollection {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o["type"] === "FeatureCollection" && Array.isArray(o["features"]);
}

export async function fetchAreas(): Promise<AreaCollection | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/areas.geojson`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isAreaCollection(data) ? data : null;
  } catch {
    return null;
  }
}
