// Umzug 17.11.2026: Die Projekt-Repos haben englische Namen bekommen, damit ändern sich ihre
// GitHub-Pages-Pfade. Alte Links leiten hierher und weiter, Unterpfad, Query und Hash bleiben.
(function () {
  var neu = { '/resonanz/': '/resonance/', '/stapelwerk/': '/stackworks/' };
  var pfad = location.pathname;
  if (pfad === '/resonanz' || pfad === '/stapelwerk') pfad += '/';
  for (var alt in neu) {
    if (pfad.indexOf(alt) === 0) {
      location.replace(neu[alt] + pfad.slice(alt.length) + location.search + location.hash);
      return;
    }
  }
})();
