import type { CurrentWeather } from "./types.ts";

// Živá venkovní teplota z Open-Meteo (bez klíče, CORS OK).
const PRAGUE = { lat: 50.08, lon: 14.43 };

const ENDPOINT =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${PRAGUE.lat}&longitude=${PRAGUE.lon}` +
  `&current=temperature_2m,apparent_temperature&timezone=Europe%2FPrague`;

export async function fetchCurrentWeather(): Promise<CurrentWeather> {
  const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data: unknown = await res.json();

  const current =
    typeof data === "object" && data !== null && "current" in data
      ? (data as { current: Record<string, unknown> }).current
      : undefined;

  const temperature = Number(current?.["temperature_2m"]);
  const apparent = Number(current?.["apparent_temperature"]);

  if (!Number.isFinite(temperature)) {
    throw new Error("Open-Meteo: chybí temperature_2m");
  }
  return {
    temperature,
    apparent: Number.isFinite(apparent) ? apparent : temperature,
  };
}
