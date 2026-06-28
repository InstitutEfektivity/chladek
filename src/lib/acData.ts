import type {
  AcCultureCollection,
  AcShopCollection,
  LibraryCollection,
  LibraryKkcCollection,
  AcAreaCollection,
  AcServiceCollection,
  LekarnaCollection,
} from "./types.ts";

// Fetch helpery pro nově sloučené AC datasety (ac-culture, ac-shops, libraries,
// ac-areas). Všechno jsou commitnuté lokální snapshoty → jen lokální fetch
// z ${BASE_URL}data/. Vzor (try/catch → null) mirroruje areas.ts / mlzitka.ts:
// při jakémkoli selhání vracíme null a volající vrstvu prostě nepřidá (graceful).

function isFeatureCollection(v: unknown): v is { features: unknown[] } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o["type"] === "FeatureCollection" && Array.isArray(o["features"]);
}

async function fetchLocal<T>(file: string): Promise<T | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${file}`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isFeatureCollection(data) ? (data as T) : null;
  } catch {
    return null;
  }
}

export function fetchAcCulture(): Promise<AcCultureCollection | null> {
  return fetchLocal<AcCultureCollection>("ac-culture.geojson");
}

export function fetchAcShops(): Promise<AcShopCollection | null> {
  return fetchLocal<AcShopCollection>("ac-shops.geojson");
}

export function fetchLibraries(): Promise<LibraryCollection | null> {
  return fetchLocal<LibraryCollection>("libraries.geojson");
}

// IPR KULTKKC knihovny okrajových MČ (net-new proti MKP, bez otevírací doby).
export function fetchLibrariesKkc(): Promise<LibraryKkcCollection | null> {
  return fetchLocal<LibraryKkcCollection>("libraries-kkc.geojson");
}

export function fetchAcAreas(): Promise<AcAreaCollection | null> {
  return fetchLocal<AcAreaCollection>("ac-areas.geojson");
}

// AC landmark budovy (velké kulturní/veřejné budovy jako plošný rozsah). Stejný
// AcArea shape (bez tier – nečteme ho u landmarků).
export function fetchAcLandmarks(): Promise<AcAreaCollection | null> {
  return fetchLocal<AcAreaCollection>("ac-landmarks.geojson");
}

// Klimatizované služby/provozovny jako body (supermarket, banka, fitness, hotel).
export function fetchAcServices(): Promise<AcServiceCollection | null> {
  return fetchLocal<AcServiceCollection>("ac-services.geojson");
}

// Lékárny (SÚKL – autoritativní registr, AC z titulu uchovávání léčiv).
export function fetchLekarny(): Promise<LekarnaCollection | null> {
  return fetchLocal<LekarnaCollection>("lekarny.geojson");
}
