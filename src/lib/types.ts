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
  | "park"
  // Nově sloučené AC-bodové kategorie (ac-culture, ac-shops)
  | "theatre" // divadlo
  | "concert" // koncertní / multifunkční sál
  | "gallery" // galerie
  | "store"; // klimatizovaná prodejna (drogerie / electronics)

// AC „tier": A = autoritativně klimatizováno, B = vnitřní útočiště (pravděpodobně chladné).
export type AcTier = "A" | "B";

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
  // ---- Volitelná pole z nově sloučených AC datasetů (ac-culture/ac-shops/libraries) ----
  // Přítomná jen u sloučených AC bodů; u původních venues bodů zůstávají undefined.
  tier?: AcTier; // A / B (autorita klimatizace)
  subtype?: string; // ac-culture subtype (muzeum, divadlo, galerie, …) – pro popup
  web?: string | null; // ac-culture web
  bezbar?: boolean; // ac-culture bezbariérovost (♿)
  brand?: string | null; // ac-shops brand
  openLabel?: string; // libraries – předpočítaný „Otevřeno teď · do HH:MM" / „Zavřeno · …"
  openState?: "open" | "closed"; // libraries – stav pro barevné odlišení v popupu
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

// Klimatizované čekárny (polikliniky) – volně přístupná vnitřní útočiště v ordinačních
// hodinách. Schéma public/data/ac-civic.geojson. tier vždy "B" (vnitřní útočiště).
export interface CivicProperties {
  id: string;
  name: string;
  type: string;
  address: string | null;
  cooling: "ac";
  tier: "B";
  source: string;
}

export interface CivicFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: CivicProperties;
}

export interface CivicCollection {
  type: "FeatureCollection";
  features: CivicFeature[];
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

// ---------- Nově sloučené AC datasety ----------

// Kulturní zařízení s klimatizací (IPR Praha – ÚAP). Schéma public/data/ac-culture.geojson.
// subtype ∈ {galerie, muzeum, divadlo, kino, koncertní sál, multifunkční sál,
//            kulturní institut, kulturní dům, aréna, literární kavárna}.
export interface AcCultureProperties {
  id: string;
  name: string;
  subtype: string;
  typ_uap: string;
  cooling: "ac";
  tier: AcTier;
  address: string | null;
  web: string | null;
  bezbar: boolean;
  source: string;
}

export interface AcCultureFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: AcCultureProperties;
}

export interface AcCultureCollection {
  type: "FeatureCollection";
  features: AcCultureFeature[];
}

// Klimatizované prodejny (drogerie / electronics). Schéma public/data/ac-shops.geojson.
export interface AcShopProperties {
  id: string;
  name: string;
  brand: string | null;
  kind: "drogerie" | "electronics";
  cooling: "ac";
  tier: AcTier;
  source: string;
}

export interface AcShopFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: AcShopProperties;
}

export interface AcShopCollection {
  type: "FeatureCollection";
  features: AcShopFeature[];
}

// Otevírací řádek knihovny (Golemio / Městská knihovna v Praze).
export interface LibraryOpeningRow {
  day_of_week: string; // "Monday" … "Sunday"
  opens: string; // "HH:MM"
  closes: string; // "HH:MM"
  description?: string;
  is_default: boolean;
  valid_from: string | null; // ISO datum nebo null
  valid_through: string | null;
  type: string;
}

// Knihovny. Schéma public/data/libraries.geojson.
export interface LibraryProperties {
  id: string;
  name: string;
  address: string | null;
  opening_hours: LibraryOpeningRow[];
  cooling: "ac";
  tier: AcTier;
  source: string;
}

export interface LibraryFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: LibraryProperties;
}

export interface LibraryCollection {
  type: "FeatureCollection";
  features: LibraryFeature[];
}

// AC budovy jako celé plochy (obchoďáky, hypermarkety, DIY, IKEA, obchodní domy).
// Schéma public/data/ac-areas.geojson – Polygon/MultiPolygon.
export type AcAreaKind =
  | "mall"
  | "hypermarket"
  | "diy"
  | "ikea"
  | "department_store";

export interface AcAreaProperties {
  id: string;
  name: string;
  kind: AcAreaKind;
  cooling: "ac";
  tier: AcTier;
  area_m2: number;
  source: string;
}

export interface AcAreaFeature {
  type: "Feature";
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
  properties: AcAreaProperties;
}

export interface AcAreaCollection {
  type: "FeatureCollection";
  features: AcAreaFeature[];
}
