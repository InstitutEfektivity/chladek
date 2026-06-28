import { ui } from "../content/site.ts";
import { escapeHtml } from "./geo.ts";

// Úvodní popup při prvním spuštění – stručně co/proč/kdo + že jde o ukázku pro
// Prahu. Marketing pro IE + nastavení očekávání. Zobrazí se jen jednou
// (localStorage flag); selže-li localStorage (privátní režim), ukáže se vždy.
const FLAG = "chladek_intro_v1";

export function maybeShowIntro(): void {
  let seen = false;
  try {
    seen = localStorage.getItem(FLAG) === "1";
  } catch {
    seen = false;
  }
  if (!seen) showIntro();
}

function showIntro(): void {
  const i = ui.intro;
  const overlay = document.createElement("div");
  overlay.className = "intro-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "intro-title");
  overlay.innerHTML = `
    <div class="intro-card" role="document">
      <button type="button" class="intro-close" aria-label="${escapeHtml(i.closeAria)}">×</button>
      <span class="intro-eyebrow">❄ ${escapeHtml(i.eyebrow)}</span>
      <h2 id="intro-title">${escapeHtml(i.title)}</h2>
      <p class="intro-body">${escapeHtml(i.body)}</p>
      <p class="intro-disclaimer">${escapeHtml(i.disclaimer)}</p>
      <div class="intro-actions">
        <button type="button" class="btn btn-primary intro-primary">${escapeHtml(i.primary)}</button>
        <a class="btn btn-ghost" href="#/o-projektu">${escapeHtml(i.about)}</a>
        <a class="btn btn-ghost" href="https://institutefektivity.cz" target="_blank" rel="noopener noreferrer">${escapeHtml(i.ie)}</a>
      </div>
    </div>`;

  const close = (): void => {
    try {
      localStorage.setItem(FLAG, "1");
    } catch {
      /* ignore – privátní režim */
    }
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".intro-close")?.addEventListener("click", close);
  overlay.querySelector(".intro-primary")?.addEventListener("click", close);
  // Odkazy (O projektu / IE) taky označí úvod za viděný a zavřou ho.
  overlay
    .querySelectorAll(".intro-actions a")
    .forEach((a) => a.addEventListener("click", close));
  document.addEventListener("keydown", onKey);

  document.body.appendChild(overlay);
  overlay.querySelector<HTMLButtonElement>(".intro-primary")?.focus();
}
