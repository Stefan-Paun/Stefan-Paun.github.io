/* SP-17 Datenblatt: gemeinsamer Takt, Taktwelle, ballistische Zähler, Pin-Ereignisse,
   Scroll-Spy (Seite/Pin im Kopfband), Raster-Schnitte, Befehlspalette. Ohne Bibliotheken. */
(function () {
  "use strict";

  /* ---------- SPClock: ein einziger rAF-Loop für alles ---------- */
  var subs = [], raf = 0, last = 0;
  function frame(ts) {
    raf = 0;
    if (document.hidden || !subs.length) { last = 0; return; }
    var dt = last ? Math.min(64, ts - last) : 16.7;
    last = ts;
    var list = subs.slice();
    for (var i = 0; i < list.length; i++) list[i](ts, dt);
    if (subs.length) raf = requestAnimationFrame(frame); else last = 0;
  }
  function wake() { if (!raf && subs.length && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }
  function now() { return performance.now(); }
  now.valueOf = now; /* funktioniert als Funktion und als Zahl */
  var SPClock = window.SPClock = {
    on: function (fn) { if (subs.indexOf(fn) < 0) subs.push(fn); wake(); },
    off: function (fn) { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); },
    now: now
  };
  document.addEventListener("visibilitychange", function () { if (!document.hidden) wake(); });

  var EN = document.documentElement.lang === "en"; /* Texte im JS: Deutsch (Standard) oder Englisch */
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var band = $("#topband"), BAND_H = 0;   /* Höhe erst lesen, wenn das erste Bild steht (siehe afterFirstFrame) */
  function bandH() { if (!BAND_H) BAND_H = band ? band.offsetHeight : 48; return BAND_H; }

  /* Start ohne erzwungenes Layout: Liest das Skript beim Auswerten Maße (offsetHeight,
     getBoundingClientRect), muss der Browser das erste Layout der ganzen Seite sofort
     und mitten im Skript rechnen (gemessen 100–200 ms bei 4x CPU). Alles, was Maße
     braucht, läuft deshalb erst im Task nach dem ersten Bild; dann ist das Layout fertig. */
  function afterFirstFrame(fn) {
    var done = false;
    function go() { if (!done) { done = true; fn(); } }
    if (document.hidden) { setTimeout(go, 0); return; }
    /* Erstes Bild über die Paint-Timing-Meldung (eigener Task, nicht im Bild-Task selbst),
       sonst über requestAnimationFrame */
    var po = null, T = window.PerformanceObserver;
    if (T && (T.supportedEntryTypes || []).indexOf("paint") >= 0) {
      try {
        po = new T(function () { po.disconnect(); setTimeout(go, 0); });
        po.observe({ type: "paint", buffered: true });
      } catch (e) { po = null; }
    }
    if (!po && window.requestAnimationFrame) requestAnimationFrame(function () { setTimeout(go, 0); });
    setTimeout(go, 3000); /* Notnagel, falls keine Meldung kommt */
  }

  /* ---------- Taktwelle im Kopfband: Phase folgt dem Scroll mit Masse und Dämpfung ---------- */
  var clkPath = $("#clk-path");
  var PERIOD = 44, W = 600, HI = 5, LO = 19;
  function wavePath(phase) {
    var half = PERIOD / 2, off = ((phase % PERIOD) + PERIOD) % PERIOD;
    var lvl = off < half ? 0 : 1; /* 0 = tief */
    var d = "M0," + (lvl ? HI : LO), x = -(off % half) + half;
    if (off >= half) x = PERIOD - off;
    else x = half - off;
    while (x < W) { d += "H" + x.toFixed(1); lvl ^= 1; d += "V" + (lvl ? HI : LO); x += half; }
    return d + "H" + W;
  }
  var wPhase = 0, wVel = 0, wTarget = 0, wOn = false;
  function waveTick(ts, dt) {
    var s = Math.min(dt, 50) / 1000, k = 70, c = 2 * 0.62 * Math.sqrt(k);
    var steps = Math.ceil(s / 0.008), h = s / steps;
    for (var i = 0; i < steps; i++) { wVel += (k * (wTarget - wPhase) - c * wVel) * h; wPhase += wVel * h; }
    clkPath.setAttribute("d", wavePath(wPhase));
    if (Math.abs(wTarget - wPhase) < 0.05 && Math.abs(wVel) < 0.2) {
      wPhase = wTarget; wVel = 0; clkPath.setAttribute("d", wavePath(wPhase));
      SPClock.off(waveTick); wOn = false;
    }
  }
  function waveTo(y) {
    if (!clkPath) return;
    wTarget = y * 0.28;
    if (reduce) { wPhase = wTarget; clkPath.setAttribute("d", wavePath(wPhase)); return; }
    if (!wOn) { wOn = true; SPClock.on(waveTick); }
  }

  /* ---------- Scroll-Spy: Seite x/y und Pin im Kopfband ---------- */
  var pages = $$("[data-page]"), rdPage = $("#rd-page"), rdPin = $("#rd-pin");
  var curPage = 0, curPin = "";
  var pinEls = $$(".pin");
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function spy() {
    var y = bandH() + innerHeight * 0.35, hit = pages[0];
    for (var i = 0; i < pages.length; i++) { if (pages[i].getBoundingClientRect().top <= y) hit = pages[i]; else break; }
    /* am Seitenende immer die letzte Seite */
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) hit = pages[pages.length - 1];
    var pg = +hit.getAttribute("data-page"), pin = hit.getAttribute("data-pin") || "";
    if (pg !== curPage) {
      curPage = pg; if (rdPage) rdPage.textContent = pad2(pg);
      pages.forEach(function (p) { p.classList.toggle("is-on", p === hit); });
    }
    if (pin !== curPin) {
      curPin = pin; if (rdPin) rdPin.textContent = pin ? pad2(+pin) : "—";
      pinEls.forEach(function (a) {
        var on = a.getAttribute("data-pin") === pin;
        a.classList.toggle("is-here", on);
        if (on) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current");
      });
      document.dispatchEvent(new CustomEvent("sp:here", { detail: { pin: pin ? +pin : 0 } }));
    }
  }
  var tick = false, ready = false;
  function onScroll() {
    waveTo(scrollY);
    if (ready && !tick) { tick = true; requestAnimationFrame(function () { tick = false; spy(); }); }
  }
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", function () { BAND_H = 0; if (ready) spy(); });
  afterFirstFrame(function () {
    /* scrollY braucht ebenfalls ein fertiges Layout */
    if (clkPath && !wOn) { wPhase = wTarget = scrollY * 0.28; clkPath.setAttribute("d", wavePath(wPhase)); }
    ready = true; spy();
  });

  /* ---------- Ballistische Zähler: Feder mit Masse, kritisch gedämpft (nie über den echten Wert), nie linear ---------- */
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, EN ? "," : "."); }
  var counters = [], cOn = false;
  function counterTick(ts, dt) {
    var s = Math.min(dt, 50) / 1000, k = 70, c = 2 * 1.0 * Math.sqrt(k);
    var steps = Math.ceil(s / 0.008), h = s / steps, alive = false;
    counters.forEach(function (o) {
      if (o.done) return;
      for (var i = 0; i < steps; i++) { o.v += (k * (o.t - o.x) - c * o.v) * h; o.x += o.v * h; if (o.x > o.t) { o.x = o.t; o.v = 0; } }
      if (Math.abs(o.t - o.x) < Math.max(0.35, o.t * 0.0004) && Math.abs(o.v) < o.t * 0.02 + 0.4) { o.done = true; o.el.classList.remove("counting"); o.el.removeAttribute("data-shown"); }
      else { alive = true; o.el.setAttribute("data-shown", fmt(Math.max(0, Math.round(o.x)))); }
    });
    if (!alive) { SPClock.off(counterTick); cOn = false; }
  }
  function startCounter(el) {
    var t = +el.getAttribute("data-count");
    if (reduce || !t) return;
    /* Der echte Wert bleibt als Text im DOM (Suchmaschinen, Kopieren, Screenreader);
       hochgezählt wird nur eine Überlagerung per CSS (::after mit attr(data-shown)). */
    el.style.display = "inline-block";
    counters.push({ el: el, t: t, x: 0, v: 0, done: false });
    el.setAttribute("data-shown", "0"); el.classList.add("counting");
    if (!cOn) { cOn = true; SPClock.on(counterTick); }
  }
  var countEls = $$("[data-count]"), counted = new WeakSet();
  function visibleNow(el) { var r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }
  function armCounters() {
    if (!("IntersectionObserver" in window) || reduce) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting && !counted.has(e.target)) { counted.add(e.target); io.unobserve(e.target); startCounter(e.target); }
      });
    }, { threshold: 0.6 });
    countEls.forEach(function (el) { io.observe(el); });
  }
  armCounters();

  /* ---------- Raster-Schnitte: ein Muster, hart in Stufen, kein Fade ----------
     Nichts wird vorab versteckt: Abschnitte stehen fertig im HTML und sind ohne Scrollen sichtbar
     (auch für Suchmaschinen und sehr hohe Fenster). Der Schnitt startet erst, kurz bevor ein Abschnitt
     von unten ins Fenster kommt, und ist nach 0,56 s vorbei. Bewegung ist nur Zugabe. */
  (function () {
    if (reduce || !("IntersectionObserver" in window)) return;
    afterFirstFrame(function () {
    var els = $$("[data-wipe]").filter(function (el) { return el.getBoundingClientRect().top > innerHeight; });
    if (!els.length) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target; io.unobserve(el);
        /* nur schneiden, wenn der Abschnitt von unten kommt (nicht nach einem Sprung mitten hinein) */
        if (e.boundingClientRect.top < innerHeight * 0.5) return;
        el.classList.add("cut");
        el.addEventListener("animationend", function f(ev) { if (ev.target !== el) return; el.classList.remove("cut"); el.removeEventListener("animationend", f); });
      });
    }, { rootMargin: "0px 0px 12% 0px" });
    els.forEach(function (el) { io.observe(el); });
    });
  })();

  /* ---------- Kompakte Projekte: am Desktop Kennwerte gleich offen, am Handy zugeklappt ---------- */
  (function () {
    if (!window.matchMedia) return;
    var mq = matchMedia("(min-width: 900px)"), more = $$(".ds--compact .more");
    function apply() { more.forEach(function (d) { d.open = mq.matches; }); }
    apply();
    if (mq.addEventListener) mq.addEventListener("change", apply);
  })();

  /* ---------- Pins: Hover/Fokus/Klick -> sp:pin ---------- */
  var pinState = {};
  function firePin(a, state) {
    var n = a.getAttribute("data-pin");
    if (state !== "select") { if (pinState[n] === state) return; pinState[n] = state; }
    document.dispatchEvent(new CustomEvent("sp:pin", { detail: { pin: +a.getAttribute("data-pin"), block: a.getAttribute("data-block"), state: state } }));
  }
  pinEls.forEach(function (a) {
    a.addEventListener("pointerenter", function () { a.classList.add("is-on"); firePin(a, "enter"); });
    a.addEventListener("pointerleave", function () { if (document.activeElement !== a) { a.classList.remove("is-on"); firePin(a, "leave"); } });
    a.addEventListener("focus", function () { a.classList.add("is-on"); firePin(a, "enter"); });
    a.addEventListener("blur", function () { a.classList.remove("is-on"); firePin(a, "leave"); });
    a.addEventListener("click", function () {
      firePin(a, "select");
      var t = document.getElementById((a.getAttribute("href") || "").slice(1));
      if (t) setTimeout(function () { try { t.focus({ preventScroll: true }); } catch (e) {} }, 0);
    });
  });

  /* ---------- Befehlspalette (Cmd/Strg+K) ---------- */
  var pal = $("#palette"), pq = $("#pq"), kbtn = $("#kbtn");
  if (pal && pal.showModal) {
    var items = $$("li", pal), sel = 0;
    var shown = function () { return items.filter(function (li) { return !li.hidden; }); };
    var mark = function () { shown().forEach(function (li, i) { li.setAttribute("aria-selected", String(i === sel)); if (i === sel) pq.setAttribute("aria-activedescendant", li.id); }); };
    var openPal = function () { pq.value = ""; items.forEach(function (li) { li.hidden = false; }); sel = 0; mark(); pal.showModal(); pq.focus(); };
    if (kbtn) kbtn.addEventListener("click", openPal);
    document.addEventListener("keydown", function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); pal.open ? pal.close() : openPal(); }
    });
    pq.addEventListener("input", function () {
      var q = pq.value.trim().toLowerCase();
      items.forEach(function (li) { li.hidden = q && li.textContent.toLowerCase().indexOf(q) < 0; });
      sel = 0; mark();
    });
    pq.addEventListener("keydown", function (ev) {
      var list = shown();
      if (ev.key === "ArrowDown") { ev.preventDefault(); sel = Math.min(list.length - 1, sel + 1); mark(); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
      else if (ev.key === "Enter") { ev.preventDefault(); var a = list[sel] && list[sel].querySelector("a"); if (a) { pal.close(); a.click(); } }
    });
    pal.addEventListener("click", function (ev) { if (ev.target === pal) pal.close(); if (ev.target.closest("a")) pal.close(); });
  }

  /* ---------- Live-Fakten von GitHub (ohne Token, 10 Min. Cache, still bei Fehler) ---------- */
  (function () {
    var box = $("#ab-live"); if (!box || !window.fetch) return;
    var KEY = "ab-live-v1";
    function ago(iso) {
      var m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
      if (m < 60) return EN ? m + " min ago" : "vor " + m + " Min.";
      var h = Math.round(m / 60); if (h < 48) return EN ? h + " h ago" : "vor " + h + " Std.";
      return EN ? Math.round(h / 24) + " days ago" : "vor " + Math.round(h / 24) + " Tagen";
    }
    function show(x) {
      var parts = [(EN ? "Last updated " : "Zuletzt aktualisiert ") + ago(x.pushed)];
      if (x.tag) parts.push((EN ? "latest release " : "neuestes Release ") + x.tag);
      if (x.open) parts.push(x.open + (EN ? " open issues and PRs" : " offene Issues und PRs"));
      $(".live-t", box).textContent = parts.join(" · ");
      box.title = EN ? "Live from the GitHub API" : "Live von der GitHub-API"; box.hidden = false;
    }
    try { var c = JSON.parse(sessionStorage.getItem(KEY) || "null"); if (c && Date.now() - c.t < 600000) { show(c); return; } } catch (e) {}
    var api = "https://api.github.com/repos/Stefan-Paun/agent-board";
    Promise.all([fetch(api).then(function (r) { return r.ok ? r.json() : Promise.reject(); }),
                 fetch(api + "/releases/latest").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })])
      .then(function (res) {
        var x = { t: Date.now(), pushed: res[0].pushed_at, open: res[0].open_issues_count, tag: res[1].tag_name || "" };
        if (!x.pushed) return;
        try { sessionStorage.setItem(KEY, JSON.stringify(x)); } catch (e) {}
        show(x);
      }).catch(function () {});
  })();
})();
