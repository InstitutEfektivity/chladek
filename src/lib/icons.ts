import type { Map as MlMap } from "maplibre-gl";
import type { Cooling } from "./types.ts";
import { coolingColors } from "./mapStyle.ts";

// Ikonografie chládek-bodů. Dependency-free: každý glyph je inline SVG path,
// vykreslený na barevný teardrop pin v barvě cooling (coolingColors z mapStyle.ts).
//
// POZOR – proč rastrová ikona, ne textová vrstva:
//  MapLibre symbol vrstvy s `text-field` potřebují externí glyphy; jejich fetch
//  ve workeru selhával a označoval celé geojson tiles jako errored (bílá mapa).
//  Ikona přes `icon-image` + map.addImage() je ale obyčejný RASTR (HTMLImageElement),
//  ne glyph – funguje spolehlivě. Proto stavíme SVG → data URI → <img> → addImage.

// Bílé glyphy (cesta v lokálním 0..24 viewBoxu, vykreslíme do středu pinu).
// water = kapka, ac = vločka, natural = chladný oblouk/průchod, shade = strom.
const GLYPH_PATHS: Record<Cooling, string> = {
  // Kapka vody.
  water:
    "M12 2.5c3.4 4.2 6 7.6 6 10.8a6 6 0 0 1-12 0c0-3.2 2.6-6.6 6-10.8z",
  // Vločka (sněhová) – tři osy + drobné větvičky.
  ac:
    "M12 2v20M3.34 7l17.32 10M3.34 17 20.66 7M12 5l-2.4-2.4M12 5l2.4-2.4M12 19l-2.4 2.4M12 19l2.4 2.4M5.6 8.4 4.8 5.1 8.1 5.9M18.4 15.6l.8 3.3-3.3-.8M18.4 8.4l.8-3.3-3.3.8M5.6 15.6l-.8 3.3 3.3-.8",
  // Chladný kamenný oblouk / průchod (kostelní chládek).
  natural:
    "M4 21V10a8 8 0 0 1 16 0v11M4 21h16M9 21v-7a3 3 0 0 1 6 0v7",
  // Strom (stín).
  shade:
    "M12 2.5c-3 0-5.2 2.3-5.2 5 0 .5.07 1 .2 1.4A4.3 4.3 0 0 0 8 17h2.6v4.5h2.8V17H16a4.3 4.3 0 0 0 .8-8.1c.13-.45.2-.92.2-1.4 0-2.7-2.2-5-5-5z",
};

// Některé glyphy mají smysl jako vyplněné tvary (kapka, oblouk, strom),
// vločka jen jako linka. Řídí, jestli path renderujeme fill vs stroke.
const GLYPH_FILLED: Record<Cooling, boolean> = {
  water: true,
  ac: false,
  natural: false,
  shade: true,
};

const ICON_IDS: Cooling[] = ["water", "ac", "natural", "shade"];

function iconId(cooling: Cooling): string {
  return `icon-${cooling}`;
}

// Teardrop pin 44×56: barevný špendlík se špičkou dolů, bílý glyph uvnitř kruhové
// hlavičky. Bílý obrys + měkký stín, aby bod „vyskočil" na světlém podkladu.
function pinSvg(cooling: Cooling): string {
  const fill = coolingColors[cooling] ?? "#16405e";
  const filled = GLYPH_FILLED[cooling];
  const glyph = GLYPH_PATHS[cooling];

  // Glyph je v 0..24 souřadnicích; vsadíme ho do hlavičky pinu (střed 22,22, ~24 px).
  const glyphAttrs = filled
    ? `fill="#ffffff" stroke="none"`
    : `fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="56" viewBox="0 0 44 56">
  <defs>
    <filter id="s" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="#0f2d43" flood-opacity="0.35"/>
    </filter>
  </defs>
  <path filter="url(#s)" d="M22 3C12.6 3 5 10.5 5 19.8c0 11.4 13.1 24.6 16 31.6.5 1.2 1.6 1.2 2 0 2.9-7 16-20.2 16-31.6C39 10.5 31.4 3 22 3z" fill="${fill}" stroke="#ffffff" stroke-width="2.5"/>
  <circle cx="22" cy="20" r="13.5" fill="rgba(255,255,255,0.16)"/>
  <g transform="translate(10 8) scale(1)" ${glyphAttrs}>
    <path d="${glyph}"/>
  </g>
</svg>`;
}

// Načte jeden SVG data-URI jako HTMLImageElement (await onload).
function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("icon image failed to load"));
    // btoa zvládne jen Latin1; SVG je čisté ASCII (žádná diakritika) → bezpečné.
    img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
  });
}

// Zaregistruje všechny ikony chládek-bodů (icon-<cooling>) do mapy.
// Pre-registrace MUSÍ proběhnout PŘED přidáním symbol vrstvy, která je odkazuje,
// jinak vyletí styleimagemissing. Awaitujeme všechny obrázky před returnem.
export async function registerVenueIcons(map: MlMap): Promise<void> {
  await Promise.all(
    ICON_IDS.map(async (cooling) => {
      const id = iconId(cooling);
      if (map.hasImage(id)) return;
      const img = await loadSvgImage(pinSvg(cooling));
      // Druhá kontrola: mezi awaitem mohl obrázek doplnit jiný běh.
      if (!map.hasImage(id)) {
        map.addImage(id, img, { pixelRatio: 2 });
      }
    })
  );
}

// ---------- Overlay ikony (mlžítka, metro) ----------
// Stejný princip jako chládek-body: SVG → data URI → <img> → map.addImage (rastr,
// ne glyph). Tvar pinu i barvy jsou ale samostatné, ať jsou overlaye odlišitelné.

// Mlžítko: vodně-modrý pin se sprchovým „kropítkem" + kapičkami.
function mistPinSvg(): string {
  const fill = "#2A86C9"; // vodní modrá (cool-water)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="56" viewBox="0 0 44 56">
  <defs>
    <filter id="ms" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="#0f2d43" flood-opacity="0.35"/>
    </filter>
  </defs>
  <path filter="url(#ms)" d="M22 3C12.6 3 5 10.5 5 19.8c0 11.4 13.1 24.6 16 31.6.5 1.2 1.6 1.2 2 0 2.9-7 16-20.2 16-31.6C39 10.5 31.4 3 22 3z" fill="${fill}" stroke="#ffffff" stroke-width="2.5"/>
  <circle cx="22" cy="20" r="13.5" fill="rgba(255,255,255,0.16)"/>
  <g fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13.5 15.5h17"/>
    <path d="M22 15.5v-3.2a2.6 2.6 0 0 1 2.6-2.6h2.4"/>
  </g>
  <g fill="#ffffff">
    <circle cx="16" cy="22" r="1.5"/>
    <circle cx="22" cy="24" r="1.7"/>
    <circle cx="28" cy="22" r="1.5"/>
    <circle cx="19" cy="27.5" r="1.3"/>
    <circle cx="25" cy="27.5" r="1.3"/>
  </g>
</svg>`;
}

// Metro: kruhový roundel PID v červené #E2231A s bílým „M" – rastr, ne font glyph.
function metroPinSvg(): string {
  const fill = "#E2231A"; // PID červená
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="56" viewBox="0 0 44 56">
  <defs>
    <filter id="me" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="#0f2d43" flood-opacity="0.35"/>
    </filter>
  </defs>
  <path filter="url(#me)" d="M22 3C12.6 3 5 10.5 5 19.8c0 11.4 13.1 24.6 16 31.6.5 1.2 1.6 1.2 2 0 2.9-7 16-20.2 16-31.6C39 10.5 31.4 3 22 3z" fill="${fill}" stroke="#ffffff" stroke-width="2.5"/>
  <circle cx="22" cy="20" r="13" fill="#ffffff"/>
  <path d="M14.5 27V13l7.5 9 7.5-9v14" fill="none" stroke="${fill}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

// Zaregistruje overlay ikony (mlžítka, metro). Jako u registerVenueIcons:
// musí proběhnout PŘED symbol vrstvou, která je odkazuje. Awaitujeme všechny obrázky.
export async function registerOverlayIcons(map: MlMap): Promise<void> {
  const entries: { id: string; svg: string }[] = [
    { id: "icon-mist", svg: mistPinSvg() },
    { id: "icon-metro", svg: metroPinSvg() },
  ];
  await Promise.all(
    entries.map(async ({ id, svg }) => {
      if (map.hasImage(id)) return;
      const img = await loadSvgImage(svg);
      if (!map.hasImage(id)) {
        map.addImage(id, img, { pixelRatio: 2 });
      }
    })
  );
}

// Malé inline monochrome SVG pro chipy a popupy – používá currentColor,
// takže barvu řídí CSS (color). 1em × 1em, zarovná se s textem.
export function chipIconSvg(cooling: Cooling): string {
  const filled = GLYPH_FILLED[cooling];
  const glyph = GLYPH_PATHS[cooling];
  const attrs = filled
    ? `fill="currentColor" stroke="none"`
    : `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  return `<svg class="chip-glyph" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"><g ${attrs}><path d="${glyph}"/></g></svg>`;
}
