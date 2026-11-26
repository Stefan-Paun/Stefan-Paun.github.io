// Zeigt die angefragte Adresse (nur als Text). Englische Fassung, wenn die Adresse unter /en/ lag. Ohne JavaScript bleibt alles deutsch.
document.getElementById("addr").textContent = location.pathname;
if (/^\/en(\/|$)/.test(location.pathname)) {
  document.documentElement.lang = "en";
  document.title = "404 · Pin not connected · Stefan Paun";
  document.querySelector('meta[name="description"]').content = "This address does not exist on stefanpaun.page. Go to the home page with all of Stefan Paun's projects.";
  for (const el of document.querySelectorAll("[data-en]")) {
    if (el.hasAttribute("aria-label")) el.setAttribute("aria-label", el.dataset.en);
    else el.textContent = el.dataset.en;
  }
  document.querySelector(".btn-p").href = "/en/";
  document.querySelector(".btn-s").href = "/en/#projekte";
  document.getElementById("f-imp").href = "/en/legal-notice.html";
  document.getElementById("f-ds").href = "/en/privacy.html";
}
