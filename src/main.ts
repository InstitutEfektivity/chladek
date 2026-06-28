import "./styles.css";
import { site, ui } from "./content/site.ts";
import { renderMapView } from "./views/mapView.ts";
import { renderAboutView } from "./views/aboutView.ts";
import { maybeShowIntro } from "./lib/intro.ts";

type Route = "map" | "about";

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "/o-projektu") return "about";
  return "map";
}

// Cleanup callback z aktivního view (uvolní mapu apod.).
let teardown: (() => void) | null = null;

function buildShell(): { header: HTMLElement; main: HTMLElement } {
  const app = document.getElementById("app");
  if (!app) throw new Error("Chybí #app");

  app.innerHTML = `
    <div class="app-shell">
      <header class="site-header">
        <a class="brand" href="#/" aria-label="${escapeAttr(site.name)} – domů">
          <img src="${import.meta.env.BASE_URL}favicon.svg" alt="" aria-hidden="true" />
          <span>${escapeAttr(site.name)}</span>
          <span class="tagline">${escapeAttr(site.tagline)}</span>
        </a>
        <div class="header-right">
          <a class="header-ie" href="https://institutefektivity.cz" target="_blank" rel="noopener noreferrer">${escapeAttr(ui.header.ie)} ↗</a>
          <nav class="nav" aria-label="Hlavní navigace">
            <a href="#/" data-route="map">${escapeAttr(ui.nav.map)}</a>
            <a href="#/o-projektu" data-route="about">${escapeAttr(ui.nav.about)}</a>
          </nav>
        </div>
      </header>
      <main class="site-main" id="main" tabindex="-1"></main>
    </div>
  `;

  const header = app.querySelector<HTMLElement>(".site-header")!;
  const main = app.querySelector<HTMLElement>(".site-main")!;
  return { header, main };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

let shell: { header: HTMLElement; main: HTMLElement } | null = null;

function render(): void {
  if (!shell) shell = buildShell();
  const route = parseRoute();

  // Aktivní stav navigace.
  shell.header.querySelectorAll<HTMLAnchorElement>(".nav a").forEach((a) => {
    if (a.dataset["route"] === route) {
      a.setAttribute("aria-current", "page");
    } else {
      a.removeAttribute("aria-current");
    }
  });

  // Teardown předchozího view.
  if (teardown) {
    teardown();
    teardown = null;
  }

  if (route === "about") {
    document.title = `${ui.nav.about} – ${site.name}`;
    teardown = renderAboutView(shell.main);
    shell.main.scrollTop = 0;
  } else {
    document.title = `${site.name} – ${site.tagline}`;
    teardown = renderMapView(shell.main);
  }
}

window.addEventListener("hashchange", render);
render();

// Úvodní popup při prvním spuštění (jen jednou, viz localStorage flag).
maybeShowIntro();
