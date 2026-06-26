// Sdílené typy pro datové struktury Chládku.

export type Cooling = "ac" | "natural" | "water" | "shade";

export type Category =
  | "library"
  | "museum"
  | "church"
  | "cinema"
  | "pool"
  | "fountain"
  | "mall"
  | "cafe_food"
  | "shop_ac"
  | "park";

export interface VenueProperties {
  id: string;
  name: string;
  category: Category;
  cooling: Cooling;
  typical_c: number | null;
  free_entry: boolean | null;
  opening_hours: string | null;
  address: string | null;
  source: string;
  note: string | null;
}

export interface VenueFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: VenueProperties;
}

export interface VenueCollection {
  type: "FeatureCollection";
  features: VenueFeature[];
}

export interface CurrentWeather {
  temperature: number;
  apparent: number;
}

// Živá výstraha ČHMÚ (SIVS) – schéma souboru public/data/heat-warning.json.
export interface HeatWarning {
  active: boolean;
  level: "Moderate" | "Severe" | "Extreme";
  headline: string;
  event: string;
  validFrom: string;
  validTo: string;
  updatedAt: string;
  source: string;
}

// Živá kvalita ovzduší + UV index (Open-Meteo Air Quality API).
export interface AirQuality {
  aqi: number;
  uvIndex: number;
  ozone: number;
  pm25: number;
}

// Měřená složka ovzduší na stanici (Golemio).
export interface AirComponent {
  type: string; // "NO2" | "PM10" | "PM2_5" | "O3" | "SO2" | …
  value: number;
}

// Stanice kvality ovzduší – schéma public/data/air-quality-stations.geojson
// (Golemio / Pražská datová platforma, hodinová aktualizace přes cron).
export interface AirStationProperties {
  id: string;
  name: string;
  district: string;
  aqIndex: number | null;
  aqLabel: string;
  aqColor: string;
  components: AirComponent[];
  updatedAt: string;
}

export interface AirStationFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: AirStationProperties;
}

export interface AirStationCollection {
  type: "FeatureCollection";
  features: AirStationFeature[];
}
