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
