import type { CivicCollection } from "./types.ts";

// Klimatizované čekárny (polikliniky) – „vnitřní útočiště" volně přístupné
// v ordinačních hodinách. Statický dataset, jen lokální fetch z build snapshotu.
// Při jakémkoli selhání vracíme null → vrstva se nepřidá.
// Vzor (try/catch → null) mirroruje mlzitka.ts / metro.ts.

function isCivicCollection(v: unknown): v is CivicCollection {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o["type"] === "FeatureCollection" && Array.isArray(o["features"]);
}

export async function fetchCivic(): Promise<CivicCollection | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/ac-civic.geojson`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isCivicCollection(data) ? data : null;
  } catch {
    return null;
  }
}

// IPR KULTKKC komunitní/kulturní centra (tier-B) – stejný civic shape.
export async function fetchCivicCentra(): Promise<CivicCollection | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/civic-centra.geojson`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isCivicCollection(data) ? data : null;
  } catch {
    return null;
  }
}
