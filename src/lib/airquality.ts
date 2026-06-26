import type { AirQuality } from "./types.ts";

// Živá kvalita ovzduší + UV index z Open-Meteo Air Quality API
// (bez klíče, CORS OK). Za horka roste přízemní ozon → kvalita ovzduší
// a UV jsou relevantní zdravotní rozměr služby.
const PRAGUE = { lat: 50.08, lon: 14.43 };

const ENDPOINT =
  `https://air-quality-api.open-meteo.com/v1/air-quality` +
  `?latitude=${PRAGUE.lat}&longitude=${PRAGUE.lon}` +
  `&current=european_aqi,uv_index,ozone,pm2_5&timezone=Europe%2FPrague`;

export async function fetchAirQuality(): Promise<AirQuality> {
  const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Open-Meteo AQ HTTP ${res.status}`);
  const data: unknown = await res.json();

  const current =
    typeof data === "object" && data !== null && "current" in data
      ? (data as { current: Record<string, unknown> }).current
      : undefined;

  const aqi = Number(current?.["european_aqi"]);
  const uvIndex = Number(current?.["uv_index"]);
  const ozone = Number(current?.["ozone"]);
  const pm25 = Number(current?.["pm2_5"]);

  if (!Number.isFinite(aqi) && !Number.isFinite(uvIndex)) {
    throw new Error("Open-Meteo AQ: chybí european_aqi i uv_index");
  }

  return {
    aqi: Number.isFinite(aqi) ? aqi : NaN,
    uvIndex: Number.isFinite(uvIndex) ? uvIndex : NaN,
    ozone: Number.isFinite(ozone) ? ozone : NaN,
    pm25: Number.isFinite(pm25) ? pm25 : NaN,
  };
}

// UV index → slovní stupeň + barva.
export function uvCategory(uv: number): { label: string; color: string } {
  if (uv <= 2) return { label: "nízký", color: "#6fbf73" };
  if (uv <= 5) return { label: "střední", color: "#f0c000" };
  if (uv <= 7) return { label: "vysoký", color: "#f4794e" };
  if (uv <= 10) return { label: "velmi vysoký", color: "#d64545" };
  return { label: "extrémní", color: "#8b3a9e" };
}

// European AQI → slovní stupeň + barva.
export function aqiCategory(aqi: number): { label: string; color: string } {
  if (aqi <= 20) return { label: "výborná", color: "#6fbf73" };
  if (aqi <= 40) return { label: "dobrá", color: "#8fce5a" };
  if (aqi <= 60) return { label: "přijatelná", color: "#f0c000" };
  if (aqi <= 80) return { label: "zhoršená", color: "#f4794e" };
  if (aqi <= 100) return { label: "špatná", color: "#d64545" };
  return { label: "velmi špatná", color: "#8b3a9e" };
}
