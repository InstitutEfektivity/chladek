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

// Naměřená teplota – oficiální stanice ČHMÚ. Schéma public/data/temp-stations.geojson.
// klass: "pro" = profesionální stanice, "auto" = automatická.
export interface TempStationProperties {
  id: string;
  name: string;
  temp_c: number;
  measuredAt: string;
  klass: "pro" | "auto";
  source: "ČHMÚ";
}

export interface TempStationFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: TempStationProperties;
}

export interface TempStationCollection {
  type: "FeatureCollection";
  features: TempStationFeature[];
}

// Naměřená teplota – pouliční čidla (Golemio / CAMEA). Schéma public/data/temp-sensors.geojson.
// Na přímém slunci mohou číst víc než skutečná teplota vzduchu (poctivá poznámka v popupu).
export interface TempSensorProperties {
  id: string;
  name: string;
  temp_c: number;
  measuredAt: string;
  source: "Golemio / CAMEA";
}

export interface TempSensorFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: TempSensorProperties;
}

export interface TempSensorCollection {
  type: "FeatureCollection";
  features: TempSensorFeature[];
}

// Mlžítka / mlžící body (IPR Praha – Oázy chladu). Schéma public/data/mlzitka.geojson.
export interface MistProperties {
  id: string;
  name: string;
  note: string | null;
  source: "IPR Praha – Oázy chladu";
}

export interface MistFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: MistProperties;
}

export interface MistCollection {
  type: "FeatureCollection";
  features: MistFeature[];
}

// Stanice metra (PID / ROPID) – chládek pod zemí. Schéma public/data/metro.geojson.
// lines: "A" / "A, C" / "" (přestupní stanice mají víc linek).
export interface MetroProperties {
  id: string;
  name: string;
  lines: string;
  source: "PID / ROPID";
}

export interface MetroFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: MetroProperties;
}

export interface MetroCollection {
  type: "FeatureCollection";
  features: MetroFeature[];
}

// Plošný rozsah chladu (parky/stín + vodní plochy) – schéma public/data/areas.geojson
// produkované datovou pipeline. Polygon/MultiPolygon, soubor je volitelný (runtime fetch).
export interface AreaProperties {
  id: string;
  name: string;
  kind: string;
  cooling: "shade" | "water";
  area_m2: number;
}

export interface AreaFeature {
  type: "Feature";
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
  properties: AreaProperties;
}

export interface AreaCollection {
  type: "FeatureCollection";
  features: AreaFeature[];
}
