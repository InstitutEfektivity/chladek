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
// Vibrantní, ale soudržná chladná paleta. „natural" zesvětlené z původní
// #16405E na sytější tyrkysovou, aby bílý glyph na badge dobře četl.
export const coolingColors: Record<string, string> = {
  ac: "#0FB5CE", // tyrkysová (klimatizace)
  water: "#2C7DE0", // sytě modrá (voda)
  natural: "#1C7E8C", // hluboká tyrkysová (přirozený chlad – zesvětleno kvůli čitelnosti glyphu)
  shade: "#3FA85C", // svěží zelená (stín a parky)
};

// Barvy markerů podle KATEGORIE. Každá kategorie spadá pod jeden cooling, ale
// drobně laděné odstíny v rámci skupiny dělají mapu pestřejší a čitelnější
// (na první pohled odlišíš obchoďák od muzea, kašnu od bazénu). Vše zůstává
// v soudržné chladné paletě (žádné teplé barvy mimo heat-accent).
export const categoryColor: Record<string, string> = {
  // AC skupina (tyrkysové odstíny)
  mall: "#0FB5CE",
  museum: "#1899C4",
  library: "#15A5C8",
  cinema: "#2D7FB8",
  shop_ac: "#0FB5CE",
  cafe_food: "#2BA6BE",
  // Voda (modré odstíny)
  pool: "#2C7DE0",
  fountain: "#2C9BE0",
  // Přirozený chlad
  church: "#1C7E8C",
  // Stín a parky
  park: "#3FA85C",
};
