import type { HeatWarning } from "./types.ts";

// Živá ČHMÚ (SIVS) výstraha. Priorita zdrojů:
//  1) raw GitHub (cron Action ji aktualizuje každých ~30 min → živé bez redeploye)
//  2) lokální build snapshot (${BASE_URL}data/heat-warning.json)
// Při selhání obou vrací null → volající spadne na odvození z teploty.
const RAW_URL =
  "https://raw.githubusercontent.com/InstitutEfektivity/chladek/main/public/data/heat-warning.json";

function isHeatWarning(v: unknown): v is HeatWarning {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o["active"] === "boolean" && typeof o["headline"] === "string";
}

async function fetchJson(url: string): Promise<HeatWarning | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isHeatWarning(data) ? data : null;
  } catch {
    return null;
  }
}

export async function fetchHeatWarning(): Promise<HeatWarning | null> {
  // 1) raw GitHub – cache-bust přes ?t=
  const raw = await fetchJson(`${RAW_URL}?t=${Date.now()}`);
  if (raw) return raw;

  // 2) lokální build snapshot
  const local = await fetchJson(`${import.meta.env.BASE_URL}data/heat-warning.json`);
  if (local) return local;

  return null;
}
