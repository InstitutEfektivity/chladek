import type { MistCollection } from "./types.ts";

// Mlžítka / mlžící body (IPR Praha – Oázy chladu). Statický dataset, jen lokální
// fetch z build snapshotu. Při jakémkoli selhání vracíme null → vrstva se nepřidá.
// Vzor (try/catch → null) mirroruje areas.ts.

function isMistCollection(v: unknown): v is MistCollection {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o["type"] === "FeatureCollection" && Array.isArray(o["features"]);
}

export async function fetchMlzitka(): Promise<MistCollection | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/mlzitka.geojson`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isMistCollection(data) ? data : null;
  } catch {
    return null;
  }
}
