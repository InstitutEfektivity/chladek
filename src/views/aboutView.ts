import { aboutHero, aboutSections, ui } from "../content/site.ts";
import { escapeHtml } from "../lib/geo.ts";
import { fetchLiveAcCount, AC_COUNT_FALLBACK } from "../lib/acCount.ts";

// Stránka „O projektu" – think-tank narativ IE nad otevřenými daty + newsletter.
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
          <div class="about-hero-cta-row">
            <a class="btn about-hero-cta" href="#/">${escapeHtml(aboutHero.cta)}</a>
            <a class="btn about-hero-ie" href="https://institutefektivity.cz" target="_blank" rel="noopener noreferrer">institutefektivity.cz →</a>
          </div>
        </div>
      </header>
      <article class="about-body">
        ${sectionsHtml}
        ${renderIeCta()}
        ${renderNewsletter()}
        <a class="btn btn-primary about-cta" href="#/">← Zpět na mapu</a>
      </article>
      ${renderFooter()}
    </div>
  `;

  // Počet AC míst v textu není natvrdo – dosadí se {{acCount}} z dat (jinak by se
  // rozcházel s mapou). Okamžitě fallback, pak přepíšeme živou hodnotou. Po každém
  // renderu (innerHTML přepis) musíme znovu navázat handler newsletteru.
  const apply = (n: number): string =>
    tpl.replaceAll("{{acCount}}", n.toLocaleString("cs-CZ"));
  const render = (n: number): void => {
    root.innerHTML = apply(n);
    wireNewsletter(root);
    wireScrollLinks(root);
  };

  render(AC_COUNT_FALLBACK);
  let disposed = false;
  void fetchLiveAcCount().then((n) => {
    if (!disposed) render(n);
  });
  return () => {
    disposed = true;
  };
}

// IE prezentační CTA – víc odkazů na institutefektivity.cz (think-tank pitch).
function renderIeCta(): string {
  return `
    <section class="about-section about-ie-cta" aria-label="Institut efektivity">
      <div class="ie-cta-card">
        <h2>Líbí se vám Chládek? Tohle děláme.</h2>
        <p>Institut efektivity staví praktické nástroje nad otevřenými daty a radí veřejným institucím, jak s daty pracovat tak, aby byly k užitku – od auditu dostupnosti dat přes datovou architekturu po konkrétní aplikace.</p>
        <div class="ie-cta-links">
          <a class="btn btn-primary" href="https://institutefektivity.cz" target="_blank" rel="noopener noreferrer">Navštívit institutefektivity.cz →</a>
          <a class="btn btn-ghost" href="https://institutefektivity.cz" target="_blank" rel="noopener noreferrer">Co Institut dělá</a>
          <a class="btn btn-ghost" href="#/o-projektu" data-scroll-to="newsletter">Odebírat newsletter</a>
        </div>
      </div>
    </section>`;
}

// Newsletter (interní služba double opt-in + interní služba přes /api/subscribe – jako mandaty).
function renderNewsletter(): string {
  const n = ui.newsletter;
  return `
    <section class="about-section about-newsletter" id="newsletter" aria-labelledby="h-newsletter">
      <div class="nl-card">
        <div class="nl-intro">
          <span class="nl-eyebrow">✉ ${escapeHtml(n.eyebrow)}</span>
          <h2 id="h-newsletter">${escapeHtml(n.title)}</h2>
          <p>${escapeHtml(n.subtitle)}</p>
        </div>
        <form class="nl-form" id="newsletter-form" novalidate>
          <div class="nl-field">
            <label class="nl-label" for="nl-email">${escapeHtml(n.email)}</label>
            <input class="nl-input" id="nl-email" name="email" type="email" required
              placeholder="${escapeHtml(n.emailPlaceholder)}" autocomplete="email" />
          </div>
          <div class="nl-field">
            <label class="nl-label" for="nl-name">${escapeHtml(n.name)}</label>
            <input class="nl-input" id="nl-name" name="name" type="text" autocomplete="name" />
          </div>
          <label class="nl-consent">
            <input type="checkbox" id="nl-consent" />
            <span>${escapeHtml(n.consent)}</span>
          </label>
          <button class="btn btn-primary nl-submit" type="submit">${escapeHtml(n.submit)}</button>
          <p class="nl-status" id="nl-status" role="status" aria-live="polite"></p>
        </form>
      </div>
    </section>`;
}

// Odkazy „Odebírat newsletter" vedou na #/o-projektu (kvůli hash routeru), ale
// když už jsme na about stránce, jen plynule odscrollují k formuláři.
function wireScrollLinks(root: HTMLElement): void {
  root.querySelectorAll<HTMLAnchorElement>("[data-scroll-to]").forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.dataset["scrollTo"];
      const target = id ? root.querySelector(`#${id}`) : null;
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

function wireNewsletter(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>("#newsletter-form");
  if (!form) return;
  const n = ui.newsletter;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const emailEl = root.querySelector<HTMLInputElement>("#nl-email");
    const nameEl = root.querySelector<HTMLInputElement>("#nl-name");
    const consentEl = root.querySelector<HTMLInputElement>("#nl-consent");
    const status = root.querySelector<HTMLElement>("#nl-status");
    const btn = form.querySelector<HTMLButtonElement>(".nl-submit");
    if (!emailEl || !consentEl || !status || !btn) return;

    const email = emailEl.value.trim();
    const name = nameEl ? nameEl.value.trim() : "";
    const consent = consentEl.checked;
    if (!email) return;
    if (!consent) {
      status.textContent = n.consentRequired;
      status.className = "nl-status error";
      return;
    }

    btn.disabled = true;
    status.className = "nl-status";
    status.textContent = n.submitting;
    void (async () => {
      try {
        const res = await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name, consent, source: "chladek-mapa" }),
        });
        if (res.ok) {
          status.textContent = n.success;
          status.className = "nl-status success";
          form.reset();
        } else {
          const body: { error?: string } = await res.json().catch(() => ({}));
          status.textContent = body.error || n.error;
          status.className = "nl-status error";
        }
      } catch {
        status.textContent = n.error;
        status.className = "nl-status error";
      } finally {
        btn.disabled = false;
      }
    })();
  });
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
          <a href="https://institutefektivity.cz" target="_blank" rel="noopener noreferrer">${escapeHtml(ui.footer.links.ieProjects)}</a>
          <a href="#/o-projektu" data-scroll-to="newsletter">${escapeHtml(ui.footer.links.newsletter)}</a>
          <a href="https://github.com/InstitutEfektivity/chladek" target="_blank" rel="noopener noreferrer">${escapeHtml(ui.footer.links.source)}</a>
        </nav>
        <p class="footer-note">${escapeHtml(ui.footer.note)}</p>
      </div>
    </footer>
  `;
}
