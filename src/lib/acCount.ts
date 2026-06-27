import {
  fetchAcAreas,
  fetchAcCulture,
  fetchAcShops,
  fetchLibraries,
  fetchLibrariesKkc,
} from "./acData.ts";

// Živý počet klimatizovaných veřejných míst (USP headline), spočítaný z dat.
// Stejná skladba jako computeAcCount v mapView: ac-areas + ac-culture (tier A) +
// ac-shops + knihovny (MKP + KULTKKC) + venues shop_ac + venues kryté AC bazény.
// Slouží stránce „o projektu", aby číslo nebylo natvrdo (jinak se rozchází s mapou).

// Fallback pro okamžitý render (přepíše se živou hodnotou; drží se i při selhání fetiche).
export const AC_COUNT_FALLBACK = 969;

async function countVenuesAc(): Promise<{ shopAc: number; pools: number }> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/venues.geojson`);
    if (!res.ok) return { shopAc: 0, pools: 0 };
    const data = (await res.json()) as {
      features?: { properties?: { category?: string; cooling?: string } }[];
    };
    let shopAc = 0;
    let pools = 0;
    for (const f of data.features ?? []) {
      const p = f.properties ?? {};
      if (p.category === "shop_ac") shopAc++;
      else if (p.category === "pool" && p.cooling === "ac") pools++;
    }
    return { shopAc, pools };
  } catch {
    return { shopAc: 0, pools: 0 };
  }
}

export async function fetchLiveAcCount(): Promise<number> {
  const [areas, culture, shops, libs, libsKkc, venuesAc] = await Promise.all([
    fetchAcAreas(),
    fetchAcCulture(),
    fetchAcShops(),
    fetchLibraries(),
    fetchLibrariesKkc(),
    countVenuesAc(),
  ]);

  const areasN = areas ? areas.features.length : 0;
  const cultureTierA = culture
    ? culture.features.filter((f) => f.properties.tier === "A").length
    : 0;
  const shopsN = shops ? shops.features.length : 0;
  const libsN = libs ? libs.features.length : 0;
  const libsKkcN = libsKkc ? libsKkc.features.length : 0;

  const total =
    areasN +
    cultureTierA +
    shopsN +
    libsN +
    libsKkcN +
    venuesAc.shopAc +
    venuesAc.pools;

  // Když se nepodařilo nic načíst (total 0), radši fallback než nula.
  return total > 0 ? total : AC_COUNT_FALLBACK;
}
