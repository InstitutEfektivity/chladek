import type { StyleSpecification } from "maplibre-gl";

// Basemap bez API klíče: raster CARTO Positron (light).
// Bez externích glyphů – nepoužíváme symbol/textové vrstvy (glyph fetch ve workeru
// selhával a označoval geojson tiles jako errored, takže se nevykreslily ani kruhy).
export const baseStyle: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap přispěvatelé © CARTO",
    },
  },
  layers: [
    {
      id: "carto-base",
      type: "raster",
      source: "carto",
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

// Barvy bodů podle typu ochlazení (match s CSS tokeny).
export const coolingColors: Record<string, string> = {
  ac: "#19B8CE",
  water: "#2A86C9",
  natural: "#16405E",
  shade: "#6FBF73",
};
