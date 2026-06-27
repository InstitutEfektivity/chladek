import type { Map as MlMap } from "maplibre-gl";
import type { Cooling, Category } from "./types.ts";
import { coolingColors, categoryColor, acAreaColor } from "./mapStyle.ts";

// Ikonografie chládek-bodů. Dependency-free: každý marker je inline SVG vykreslený
// jako rastr (HTMLImageElement) přes map.addImage().
//
// POZOR – proč rastrová ikona, ne textová vrstva:
//  MapLibre symbol vrstvy s `text-field` potřebují externí glyphy; jejich fetch
//  ve workeru selhával a označoval celé geojson tiles jako errored (bílá mapa).
//  Ikona přes `icon-image` + map.addImage() je ale obyčejný RASTR (HTMLImageElement),
//  ne glyph – funguje spolehlivě. Proto stavíme SVG → data URI → <img> → addImage.
//
// ITERACE 1 (vizuální overhaul): místo teardrop-pinu podle COOLINGU vykreslujeme
// premiový „squircle" badge podle KATEGORIE – velká, app-like ikona s bílým glyphem,
// vertikálním gradientem chladné barvy, bílým vnitřním obrysem, měkkým stínem a
// spodním hrotem („notch") zakotveným do souřadnice. Cíl: na první pohled „CO a KDE".

// ---------- Glyphy kategorií (bílá, viewBox 0..24, kreslíme do středu badge) ----------
//
// Každý glyph je seznam SVG <path>. `fill` = vyplněný tvar, `stroke` = obrys (linka).
// Mícháme oba styly – některé tvary čtou líp jako silueta (taška, strom), jiné jako linka.

interface Glyph {
  // path data v 0..24 souřadnicích
  paths: string[];
  // true = vyplnit bílou, false = bílý obrys (stroke)
  filled: boolean;
  // tloušťka obrysu (jen pro filled=false)
  strokeWidth?: number;
}

// Glyph per kategorie. Čistý, instantně čitelný.
const CATEGORY_GLYPHS: Record<Category, Glyph> = {
  // Obchoďák → nákupní taška.
  mall: {
    filled: false,
    strokeWidth: 1.9,
    paths: [
      "M5.5 8.5h13l-1 12.5a1.5 1.5 0 0 1-1.5 1.4H8a1.5 1.5 0 0 1-1.5-1.4z",
      "M8.5 8.5V7a3.5 3.5 0 0 1 7 0v1.5",
    ],
  },
  // Knihovna → otevřená kniha.
  library: {
    filled: false,
    strokeWidth: 1.9,
    paths: [
      "M12 6.2C10 4.7 7.4 4.4 4.5 4.8v12.6c2.9-.4 5.5-.1 7.5 1.4 2-1.5 4.6-1.8 7.5-1.4V4.8C16.6 4.4 14 4.7 12 6.2z",
      "M12 6.2v12",
    ],
  },
  // Muzeum → antické sloupy / pediment.
  museum: {
    filled: false,
    strokeWidth: 1.8,
    paths: [
      "M3.5 9.5 12 4l8.5 5.5",
      "M5 9.5v8M9 9.5v8M15 9.5v8M19 9.5v8",
      "M3.5 20h17",
    ],
  },
  // Kino → klapka / film.
  cinema: {
    filled: false,
    strokeWidth: 1.8,
    paths: [
      "M4 10.5h16v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z",
      "M4 10.5 5.4 6.2l3.2.7-1.4 4.3M9.2 11.2 10.6 6.9l3.2.7-1.4 4.3M14.4 11.2 15.8 6.9l3.2.7-1.4 4.3",
    ],
  },
  // Bazén → vlnky.
  pool: {
    filled: false,
    strokeWidth: 2.1,
    paths: [
      "M3 9.5c1.8 0 1.8 1.6 3.6 1.6S8.4 9.5 10.2 9.5 12 11.1 13.8 11.1 15.6 9.5 17.4 9.5 19.2 11.1 21 11.1",
      "M3 14.5c1.8 0 1.8 1.6 3.6 1.6s1.8-1.6 3.6-1.6 1.8 1.6 3.6 1.6 1.8-1.6 3.6-1.6 1.8 1.6 3.6 1.6",
      "M3 19.5c1.8 0 1.8 1.6 3.6 1.6s1.8-1.6 3.6-1.6 1.8 1.6 3.6 1.6 1.8-1.6 3.6-1.6 1.8 1.6 3.6 1.6",
    ],
  },
  // Kašna / fontána → kapka vody.
  fountain: {
    filled: true,
    paths: ["M12 2.5c3.4 4.2 6 7.6 6 10.8a6 6 0 0 1-12 0c0-3.2 2.6-6.6 6-10.8z"],
  },
  // Kostel → zaoblený oblouk / portál (chladný kamenný interiér).
  church: {
    filled: false,
    strokeWidth: 2,
    paths: [
      "M12 2.5v4M9.5 4.5h5",
      "M5 21V12a7 7 0 0 1 14 0v9M5 21h14M10 21v-5a2 2 0 0 1 4 0v5",
    ],
  },
  // Park → strom.
  park: {
    filled: true,
    paths: [
      "M12 2.5c-3 0-5.2 2.3-5.2 5 0 .5.07 1 .2 1.4A4.3 4.3 0 0 0 8 17h2.6v4.5h2.8V17H16a4.3 4.3 0 0 0 .8-8.1c.13-.45.2-.92.2-1.4 0-2.7-2.2-5-5-5z",
    ],
  },
  // AC obchod / místo s klimatizací → vločka.
  shop_ac: {
    filled: false,
    strokeWidth: 2,
    paths: [
      "M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8 20.2 7.2",
      "M12 5.3 9.9 3.2M12 5.3l2.1-2.1M12 18.7l-2.1 2.1M12 18.7l2.1 2.1",
      "M5.6 8.8 5 5.9l2.9.6M18.4 15.2l.6 2.9-2.9-.6M18.4 8.8l.6-2.9-2.9.6M5.6 15.2 5 18.1l2.9-.6",
    ],
  },
  // Kavárna / občerstvení (klimatizované) → hrnek s vločkou.
  cafe_food: {
    filled: false,
    strokeWidth: 1.9,
    paths: [
      "M5 9.5h11v5.5a4.5 4.5 0 0 1-4.5 4.5H9.5A4.5 4.5 0 0 1 5 15z",
      "M16 11h1.8a2.3 2.3 0 0 1 0 4.6H16",
      "M8.6 3.6 7.8 5.6M11.6 3.6l-.8 2M14.6 3.6l-.8 2",
    ],
  },
  // Divadlo → divadelní masky / opona (zde: masky komedie/tragédie zjednodušeně
  // jako oblouk opony se dvěma „oponami"). Čteme jako jeviště s oponou.
  theatre: {
    filled: false,
    strokeWidth: 1.9,
    paths: [
      "M4 5h16",
      "M6 5c0 6 .5 9-2 12 3 .5 5-1 5-4V5",
      "M18 5c0 6-.5 9 2 12-3 .5-5-1-5-4V5",
    ],
  },
  // Koncertní / multifunkční sál → hudební nota.
  concert: {
    filled: false,
    strokeWidth: 1.9,
    paths: [
      "M9 18V5l10-2v13",
      "M9 8l10-2",
    ],
  },
  // Galerie → obraz v rámu (rám + horský motiv + slunce).
  gallery: {
    filled: false,
    strokeWidth: 1.8,
    paths: [
      "M4 5h16v14H4z",
      "M4 16l4.5-5 3.5 3.5L15.5 10 20 15",
      "M8.7 9.3a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0z",
    ],
  },
  // Klimatizovaná prodejna → výloha / pult s markýzou.
  store: {
    filled: false,
    strokeWidth: 1.8,
    paths: [
      "M4 9.5 5.2 5h13.6L20 9.5",
      "M4 9.5h16a2.4 2.4 0 0 1-4.8 0 2.4 2.4 0 0 1-4.8 0 2.4 2.4 0 0 1-4.8 0A2.4 2.4 0 0 1 4 9.5z",
      "M5.5 11.5V20h13v-8.5",
      "M9.5 20v-4.5h5V20",
    ],
  },
};

// ---------- Glyphy AC-budov (ac-areas symbol vrstva) ----------
// Velké XL ikony do centroidu polygonu. Sdílejí squircle badge renderer.
const AC_AREA_GLYPHS: Record<string, Glyph> = {
  // Obchoďák → nákupní taška (reuse mall glyph).
  mall: CATEGORY_GLYPHS.mall,
  // Obchodní dům → reuse taška.
  department_store: CATEGORY_GLYPHS.mall,
  // Hypermarket → nákupní vozík.
  hypermarket: {
    filled: false,
    strokeWidth: 1.9,
    paths: [
      "M3 4h2l2.2 11.2a1.5 1.5 0 0 0 1.5 1.2h7.6a1.5 1.5 0 0 0 1.5-1.2L20.5 7H6",
    ],
  },
  // DIY / hobby market → klíč + šroubovák (nářadí).
  diy: {
    filled: false,
    strokeWidth: 1.9,
    paths: [
      "M14.5 6.5a3.5 3.5 0 0 0-4.6 4.3L3.5 17.2 6.3 20l6.4-6.4a3.5 3.5 0 0 0 4.3-4.6l-2.2 2.2-1.9-.5-.5-1.9z",
      "M5 17.5 8 20",
    ],
  },
  // IKEA → reuse taška (obchoďák/nábytek).
  ikea: CATEGORY_GLYPHS.mall,
};

const AC_AREA_KINDS = [
  "mall",
  "hypermarket",
  "department_store",
  "diy",
  "ikea",
] as const;

function acAreaIconId(kind: string): string {
  return `icon-acarea-${kind}`;
}

// ---------- Cooling glyphy (chipy + popupy) ----------
// Pro filtrační chipy a popupy potřebujeme glyph podle COOLINGU (4 typy), ne kategorie.
const COOLING_GLYPHS: Record<Cooling, Glyph> = {
  // Voda = kapka.
  water: {
    filled: true,
    paths: ["M12 2.5c3.4 4.2 6 7.6 6 10.8a6 6 0 0 1-12 0c0-3.2 2.6-6.6 6-10.8z"],
  },
  // AC = vločka.
  ac: CATEGORY_GLYPHS.shop_ac,
  // Přirozený chlad = oblouk.
  natural: CATEGORY_GLYPHS.church,
  // Stín a parky = strom.
  shade: CATEGORY_GLYPHS.park,
};

const CATEGORIES: Category[] = [
  "mall",
  "library",
  "museum",
  "cinema",
  "pool",
  "fountain",
  "church",
  "park",
  "shop_ac",
  "cafe_food",
  "theatre",
  "concert",
  "gallery",
  "store",
];

function venueIconId(category: Category): string {
  return `icon-${category}`;
}

// ---------- Squircle badge renderer ----------
//
// Premiový marker: zaoblený superellipse („squircle", ~22 % radius) s vertikálním
// gradientem chladné barvy, bílým vnitřním obrysem, měkkým stínem a spodním hrotem
// (notch) zakotveným do souřadnice. Base canvas 128×148 px, addImage pixelRatio 2
// → ostré i ve velkém měřítku.

const BADGE_W = 128;
const BADGE_H = 148; // 128 badge + 20 hrot
const RADIUS = 30; // ~22 % z 132 → app-like squircle

// Zesvětlí hex barvu směrem k bílé (amount 0..1) – pro horní okraj gradientu.
function lighten(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to2(mix(r))}${to2(mix(g))}${to2(mix(b))}`;
}

// Ztmaví hex barvu (amount 0..1) – pro spodní okraj gradientu.
function darken(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c * (1 - amount));
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to2(mix(r))}${to2(mix(g))}${to2(mix(b))}`;
}

function glyphMarkup(glyph: Glyph): string {
  const attrs = glyph.filled
    ? `fill="#ffffff" stroke="none"`
    : `fill="none" stroke="#ffffff" stroke-width="${glyph.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round"`;
  const paths = glyph.paths.map((d) => `<path d="${d}"/>`).join("");
  return `<g ${attrs}>${paths}</g>`;
}

// Postaví SVG squircle badge dané chladné barvy s daným glyphem.
function badgeSvg(color: string, glyph: Glyph, uid: string): string {
  const top = lighten(color, 0.28);
  const bottom = darken(color, 0.1);
  const stroke = darken(color, 0.22);

  // Glyph kreslíme do středu badge (badge střed = 64,64), škálujeme 0..24 → ~62 px.
  // translate na (64 - 31, 64 - 31) = (33,33) a scale 2.6 (24*2.6 ≈ 62).
  const gScale = 2.6;
  const gOff = 64 - (24 * gScale) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE_W}" height="${BADGE_H}" viewBox="0 0 ${BADGE_W} ${BADGE_H}">
  <defs>
    <linearGradient id="g${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
    <filter id="sh${uid}" x="-40%" y="-40%" width="180%" height="200%">
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#0d2c42" flood-opacity="0.34"/>
    </filter>
  </defs>
  <g filter="url(#sh${uid})">
    <path d="M64 142 L50 116 H78 Z" fill="${bottom}"/>
    <rect x="6" y="6" width="116" height="116" rx="${RADIUS}" ry="${RADIUS}" fill="url(#g${uid})" stroke="${stroke}" stroke-width="2.5"/>
    <rect x="6" y="6" width="116" height="116" rx="${RADIUS}" ry="${RADIUS}" fill="none" stroke="#ffffff" stroke-width="4" stroke-opacity="0.92"/>
    <rect x="14" y="12" width="100" height="52" rx="${RADIUS - 8}" ry="${RADIUS - 8}" fill="#ffffff" fill-opacity="0.14"/>
  </g>
  <g transform="translate(${gOff} ${gOff}) scale(${gScale})">
    ${glyphMarkup(glyph)}
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

// Zaregistruje všechny ikony chládek-bodů (icon-<category>) do mapy.
// Pre-registrace MUSÍ proběhnout PŘED přidáním symbol vrstvy, která je odkazuje,
// jinak vyletí styleimagemissing. Awaitujeme všechny obrázky před returnem.
export async function registerVenueIcons(map: MlMap): Promise<void> {
  await Promise.all(
    CATEGORIES.map(async (category) => {
      const id = venueIconId(category);
      if (map.hasImage(id)) return;
      const color = categoryColor[category] ?? coolingColors["ac"]!;
      const glyph = CATEGORY_GLYPHS[category];
      const img = await loadSvgImage(badgeSvg(color, glyph, category));
      // Druhá kontrola: mezi awaitem mohl obrázek doplnit jiný běh.
      if (!map.hasImage(id)) {
        // pixelRatio 2 → base 128 px se vykreslí jako ~64 px @ icon-size 1.
        map.addImage(id, img, { pixelRatio: 2 });
      }
    })
  );
}

// Zaregistruje ikony AC-budov (icon-acarea-<kind>) pro symbol vrstvu nad ac-areas
// polygony. Stejný squircle badge renderer, barvy z acAreaColor. MUSÍ proběhnout
// PŘED přidáním ac-areas-icon vrstvy (jinak styleimagemissing).
export async function registerAcAreaIcons(map: MlMap): Promise<void> {
  await Promise.all(
    AC_AREA_KINDS.map(async (kind) => {
      const id = acAreaIconId(kind);
      if (map.hasImage(id)) return;
      const color = acAreaColor[kind] ?? coolingColors["ac"]!;
      const glyph = AC_AREA_GLYPHS[kind];
      if (!glyph) return;
      const img = await loadSvgImage(badgeSvg(color, glyph, `acarea-${kind}`));
      if (!map.hasImage(id)) {
        map.addImage(id, img, { pixelRatio: 2 });
      }
    })
  );
}

// ---------- Overlay ikony (mlžítka, metro) ----------
// Stejný princip (squircle badge), ale samostatné barvy, ať jsou overlaye odlišitelné.

// Mlžítko → sprchové „kropítko" + kapičky, vodní modrá.
const MIST_GLYPH: Glyph = {
  filled: false,
  strokeWidth: 1.9,
  paths: [
    "M5 13h14",
    "M12 13V8.5A2.5 2.5 0 0 1 14.5 6H18",
  ],
};
const MIST_DOTS = `<g fill="#ffffff">
  <circle cx="9" cy="17" r="1.4"/><circle cx="12" cy="19" r="1.6"/><circle cx="15" cy="17" r="1.4"/>
  <circle cx="10.5" cy="21.5" r="1.2"/><circle cx="13.5" cy="21.5" r="1.2"/>
</g>`;

// Metro → bílý kruh s červeným „M" roundelem (PID).
function metroBadgeSvg(): string {
  const fill = "#E2231A"; // PID červená
  const top = lighten(fill, 0.18);
  const bottom = darken(fill, 0.1);
  const stroke = darken(fill, 0.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE_W}" height="${BADGE_H}" viewBox="0 0 ${BADGE_W} ${BADGE_H}">
  <defs>
    <linearGradient id="gmetro" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
    <filter id="shmetro" x="-40%" y="-40%" width="180%" height="200%">
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#0d2c42" flood-opacity="0.34"/>
    </filter>
  </defs>
  <g filter="url(#shmetro)">
    <path d="M64 142 L50 116 H78 Z" fill="${bottom}"/>
    <rect x="6" y="6" width="116" height="116" rx="${RADIUS}" ry="${RADIUS}" fill="url(#gmetro)" stroke="${stroke}" stroke-width="2.5"/>
    <rect x="6" y="6" width="116" height="116" rx="${RADIUS}" ry="${RADIUS}" fill="none" stroke="#ffffff" stroke-width="4" stroke-opacity="0.92"/>
  </g>
  <circle cx="64" cy="64" r="36" fill="#ffffff"/>
  <path d="M44 84V44l20 24 20-24v40" fill="none" stroke="${fill}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function mistBadgeSvg(): string {
  const color = coolingColors["water"]!;
  const top = lighten(color, 0.26);
  const bottom = darken(color, 0.1);
  const stroke = darken(color, 0.22);
  const gScale = 2.6;
  const gOff = 64 - (24 * gScale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE_W}" height="${BADGE_H}" viewBox="0 0 ${BADGE_W} ${BADGE_H}">
  <defs>
    <linearGradient id="gmist" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
    <filter id="shmist" x="-40%" y="-40%" width="180%" height="200%">
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#0d2c42" flood-opacity="0.34"/>
    </filter>
  </defs>
  <g filter="url(#shmist)">
    <path d="M64 142 L50 116 H78 Z" fill="${bottom}"/>
    <rect x="6" y="6" width="116" height="116" rx="${RADIUS}" ry="${RADIUS}" fill="url(#gmist)" stroke="${stroke}" stroke-width="2.5"/>
    <rect x="6" y="6" width="116" height="116" rx="${RADIUS}" ry="${RADIUS}" fill="none" stroke="#ffffff" stroke-width="4" stroke-opacity="0.92"/>
  </g>
  <g transform="translate(${gOff} ${gOff}) scale(${gScale})">
    ${glyphMarkup(MIST_GLYPH)}
    ${MIST_DOTS}
  </g>
</svg>`;
}

// Klimatizovaná veřejná budova (poliklinika / komunitní / kulturní centrum) →
// bílá „instituce" se sloupy (střecha + 3 sloupy + základna) na pinu v AC barvě.
// Neutrální symbol „veřejná budova", sedí na ordinace i centra.
const CIVIC_GLYPH: Glyph = {
  filled: true,
  paths: [
    "M12 3.5 3.5 9.2V11h17V9.2L12 3.5z",
    "M3.5 19.2h17V21h-17z",
    "M5.2 11.4h2.2v7.2H5.2zM10.9 11.4h2.2v7.2h-2.2zM16.6 11.4h2.2v7.2h-2.2z",
  ],
};

function civicBadgeSvg(): string {
  const color = coolingColors["ac"]!;
  const top = lighten(color, 0.26);
  const bottom = darken(color, 0.1);
  const stroke = darken(color, 0.22);
  const gScale = 2.6;
  const gOff = 64 - (24 * gScale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE_W}" height="${BADGE_H}" viewBox="0 0 ${BADGE_W} ${BADGE_H}">
  <defs>
    <linearGradient id="gcivic" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
    <filter id="shcivic" x="-40%" y="-40%" width="180%" height="200%">
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#0d2c42" flood-opacity="0.34"/>
    </filter>
  </defs>
  <g filter="url(#shcivic)">
    <path d="M64 142 L50 116 H78 Z" fill="${bottom}"/>
    <rect x="6" y="6" width="116" height="116" rx="${RADIUS}" ry="${RADIUS}" fill="url(#gcivic)" stroke="${stroke}" stroke-width="2.5"/>
    <rect x="6" y="6" width="116" height="116" rx="${RADIUS}" ry="${RADIUS}" fill="none" stroke="#ffffff" stroke-width="4" stroke-opacity="0.92"/>
  </g>
  <g transform="translate(${gOff} ${gOff}) scale(${gScale})">
    ${glyphMarkup(CIVIC_GLYPH)}
  </g>
</svg>`;
}

// Zaregistruje overlay ikony (mlžítka, metro, čekárny). Jako u registerVenueIcons:
// musí proběhnout PŘED symbol vrstvou, která je odkazuje. Awaitujeme všechny obrázky.
export async function registerOverlayIcons(map: MlMap): Promise<void> {
  const entries: { id: string; svg: string }[] = [
    { id: "icon-mist", svg: mistBadgeSvg() },
    { id: "icon-metro", svg: metroBadgeSvg() },
    { id: "icon-civic", svg: civicBadgeSvg() },
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
  const glyph = COOLING_GLYPHS[cooling];
  const attrs = glyph.filled
    ? `fill="currentColor" stroke="none"`
    : `fill="none" stroke="currentColor" stroke-width="${glyph.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round"`;
  const paths = glyph.paths.map((d) => `<path d="${d}"/>`).join("");
  return `<svg class="chip-glyph" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"><g ${attrs}>${paths}</g></svg>`;
}
