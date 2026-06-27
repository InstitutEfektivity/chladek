import { aboutHero, aboutSections, ui } from "../content/site.ts";
import { escapeHtml } from "../lib/geo.ts";
import { fetchLiveAcCount, AC_COUNT_FALLBACK } from "../lib/acCount.ts";

// Stránka „O projektu" – think-tank narativ IE nad otevřenými daty.
export function renderAboutView(root: HTMLElement): () => void {
  const sectionsHtml = aboutSections
    .map((s) => {
      const leadHtml = s.lead
        ? `<p class="about-lead">${escapeHtml(s.lead)}</p>`
        : "";
      const quoteHtml = s.pullquote
        ? `<blockquote class="about-quote"><p>${escapeHtml(s.pullquote)}</p></blockquote>`
        : "";
      return `
      <section class="about-section" id="${escapeHtml(s.id)}" aria-labelledby="h-${escapeHtml(s.id)}">
        <h2 id="h-${escapeHtml(s.id)}">${escapeHtml(s.heading)}</h2>
        ${leadHtml}
        ${s.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
        ${quoteHtml}
      </section>`;
    })
    .join("\n");

  const tpl = `
    <div class="about-view">
      <header class="about-hero">
        <div class="about-hero-inner">
          <h1>${escapeHtml(aboutHero.title)}</h1>
          <p>${escapeHtml(aboutHero.subtitle)}</p>
          <a class="btn about-hero-cta" href="#/">${escapeHtml(aboutHero.cta)}</a>
        </div>
      </header>
      <article class="about-body">
        ${sectionsHtml}
        <a class="btn btn-primary about-cta" href="#/">← Zpět na mapu</a>
      </article>
      ${renderFooter()}
    </div>
  `;

  // Počet AC míst v textu není natvrdo – dosadí se {{acCount}} z dat (jinak by se
  // rozcházel s mapou). Okamžitě fallback, pak přepíšeme živou hodnotou.
  const apply = (n: number): string =>
    tpl.replaceAll("{{acCount}}", n.toLocaleString("cs-CZ"));

  root.innerHTML = apply(AC_COUNT_FALLBACK);
  let disposed = false;
  void fetchLiveAcCount().then((n) => {
    if (!disposed) root.innerHTML = apply(n);
  });
  return () => {
    disposed = true;
  };
}

export function renderFooter(): string {
  return `
    <footer class="site-footer">
      <div class="footer-inner">
        <span class="footer-byline">
          <img src="${import.meta.env.BASE_URL}ie-logo.svg" alt="Logo Institutu efektivity" />
          ${escapeHtml(ui.footer.byline)}
        </span>
        <nav class="footer-links" aria-label="Odkazy v patičce">
          <a href="https://institutefektivity.cz" target="_blank" rel="noopener noreferrer">${escapeHtml(ui.footer.links.ie)}</a>
          <a href="https://github.com/InstitutEfektivity/chladek" target="_blank" rel="noopener noreferrer">${escapeHtml(ui.footer.links.source)}</a>
        </nav>
        <p class="footer-note">${escapeHtml(ui.footer.note)}</p>
      </div>
    </footer>
  `;
}
