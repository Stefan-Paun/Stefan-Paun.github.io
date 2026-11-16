/* ==========================================================================
   die.js – Signatur: "Decap" + lebender Die (SP-17)
   --------------------------------------------------------------------------
   Zeichnet in das Canvas von #chip eine Mikroskop-Aufnahme:
     Gehäuse (Epoxid-Deckel mit Lasermarke) -> Deckel wird weggeätzt ->
     Die mit fünf Funktionsblöcken, Metall-Lagen, Dünnschicht-Interferenz,
     Bonddrähten, Leadframe und Kupfer-Spuren von jedem Pin.

   Aufbau
     1. Geometrie messen (.chip-body, .pin) und Spuren berechnen (45°-Knicke)
     2. Statische Texturen einmal zeichnen (Canvas 2D):
          A  Die-Daten    R = Schichtdicke, G = Material (Metallanteil), B = Höhe
          C  Gehäuse      Kavität, Paddle, Leadframe-Finger, Dummy-Drähte
          L  Deckel       Epoxid + Lasermarkierung
          T0..T3          Abdeckung je Pin-Spur (je Kanal ein Pin; T3.b = Weg s)
     3. Fragment-Shader (WebGL 1) rechnet nur Licht: Interferenzfarbe aus
        Dicke x Lichtwinkel, Blinn-Glanz, Block-Hebung, Spuren, Deckel-Ätzfront.
        Ohne WebGL: Canvas-2D-Fallback (zwei vorgerechnete Beleuchtungen,
        die ineinander überblenden).
     4. Zustand mit Federn (Masse), gemeinsamer Takt (window.SPClock),
        schläft bei Ruhe / unsichtbar.

   Schnittstelle: hört auf document 'sp:pin' {pin, block, state}; feuert
   document 'sp:decap' {state:'done'}; setzt .chip.is-live nach dem ersten Frame.
   ========================================================================== */
(function () {
  'use strict';

  var chip = document.getElementById('chip');
  if (!chip) return;
  var canvasEl = chip.querySelector('.chip-canvas');
  var bodyEl = chip.querySelector('.chip-body');
  var pinEls = [].slice.call(chip.querySelectorAll('.pin'));
  if (!canvasEl || !bodyEl || !pinEls.length) return;

  var BLOCKS = ['agent', 'sec', 'oss', 'learn', 'vis'];
  var COPPER = [217, 119, 59];
  var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var coarse = !!(window.matchMedia && matchMedia('(hover: none)').matches);

  /* ---------- kleine Helfer ---------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function rgb(t, m, h) { return 'rgb(' + (t | 0) + ',' + (m | 0) + ',' + (h | 0) + ')'; }
  function now() { return performance.now(); }

  /* Feder mit Masse: x folgt t, z = Dämpfungsgrad (<1 = leichtes Überschwingen) */
  function Spring(k, z) { this.x = 0; this.v = 0; this.t = 0; this.k = k; this.c = 2 * Math.sqrt(k) * z; }
  Spring.prototype.step = function (s) {
    var n = Math.max(1, Math.ceil(s / 0.008)), h = s / n;
    for (var i = 0; i < n; i++) {
      this.v += ((this.t - this.x) * this.k - this.c * this.v) * h;
      this.x += this.v * h;
    }
  };
  Spring.prototype.rest = function () { return Math.abs(this.t - this.x) < 6e-4 && Math.abs(this.v) < 6e-3; };
  Spring.prototype.snap = function () { this.x = this.t; this.v = 0; };

  /* ---------- Zustand ---------- */
  var st = {
    lx: new Spring(14, 0.78), ly: new Spring(14, 0.78),   // Lampe (Offset, -1..1)
    pins: [], blocks: [], focus: new Spring(60, 0.9),
    active: -1, gotEvents: false,
    pulse: { px: 0, speed: 760, amp: 0, boost: false },
    decap: { phase: 'pending', t0: 0, thr: -0.3, done: false },
    visible: false, dirty: true, awake: false,
    drift: coarse && !reduced, tilt: false, userHold: 0, scrolled: false
  };
  var i;
  for (i = 0; i < 11; i++) st.pins.push(new Spring(70, 0.9));
  for (i = 0; i < 5; i++) st.blocks.push(new Spring(55, 0.8));
  st.lx.t = -0.22; st.ly.t = -0.26; st.lx.snap(); st.ly.snap();

  /* ======================================================================
     1. GEOMETRIE
     ====================================================================== */
  var DIE_BLOCKS = [ // Die-Einheiten (0..1); exit = Seite, an der die Routen einmünden
    { id: 'agent', name: 'AGENT CORE', x: .09, y: .09, w: .48, h: .42, exit: 0, ports: [.13, .5] },
    { id: 'sec', name: 'SEC ENGINE', x: .60, y: .09, w: .31, h: .37, exit: 2, ports: [.13, .43] },
    { id: 'oss', name: 'OSS I/O', x: .60, y: .49, w: .31, h: .17, exit: 2, ports: [.54, .62] },
    { id: 'learn', name: 'LEARN ROM', x: .09, y: .54, w: .36, h: .37, exit: 0, ports: [.6, .87] },
    { id: 'vis', name: 'VIS DSP', x: .48, y: .69, w: .43, h: .22, exit: 2, ports: [.74, .86] }
  ];
  var SLOTS = 9;
  function padT(k) { return .14 + .72 * k / (SLOTS - 1); }          // Pad-Tangente (Die-Einheiten)
  function fingT(k) { return .5 + (padT(k) - .5) * 1.07; }          // Finger leicht aufgefächert

  var G = null; // aktuelle Geometrie

  function measure() {
    var cr = chip.getBoundingClientRect(), br = bodyEl.getBoundingClientRect();
    var W = Math.round(cr.width), H = Math.round(cr.height);
    var s = Math.round(Math.min(br.width, br.height));
    if (W < 40 || H < 40 || s < 40) return null;
    var bx = Math.round(br.left - cr.left + (br.width - s) / 2), by = Math.round(br.top - cr.top + (br.height - s) / 2);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    while (W * H * dpr * dpr > 2.7e6 && dpr > 1) dpr -= 0.25;
    var rim = Math.round(s * .045), ds = Math.round(s * .62);
    var g = {
      W: W, H: H, dpr: dpr, b: { x: bx, y: by, s: s },
      cav: { x: bx + rim, y: by + rim, w: s - 2 * rim, h: s - 2 * rim }, rim: rim,
      die: { x: Math.round(bx + (s - ds) / 2), y: Math.round(by + (s - ds) / 2), s: ds }, pins: []
    };
    var list = false;
    pinEls.forEach(function (el, n) {
      var r = el.getBoundingClientRect();
      var p = {
        el: el, i: (parseInt(el.getAttribute('data-pin'), 10) || n + 1) - 1, block: el.getAttribute('data-block'),
        l: r.left - cr.left, t: r.top - cr.top, r: r.right - cr.left, b: r.bottom - cr.top
      };
      p.cx = (p.l + p.r) / 2; p.cy = (p.t + p.b) / 2;
      if (p.cx < 0 || p.cx > W || p.cy < 0 || p.cy > H) list = true;
      g.pins.push(p);
    });
    // Handy-Liste: liegt kein Pin links oder rechts neben dem Gehäuse, sind die Pins eine Liste unter dem Chip
    if (!list && !g.pins.some(function (p) { return p.cx < bx || p.cx > bx + s; })) list = true;
    g.list = list;
    // Seite je Pin: 0 links, 1 oben, 2 rechts, 3 unten (im Uhrzeigersinn)
    var sides = [[], [], [], []];
    g.pins.forEach(function (p) {
      if (list) p.side = p.i < 4 ? 0 : p.i < 7 ? 3 : 2;      // Handy: wie ein QFP gegen den Uhrzeigersinn
      else p.side = p.cx < bx ? 0 : p.cx > bx + s ? 2 : p.cy < by ? 1 : 3;
      sides[p.side].push(p);
    });
    sides.forEach(function (arr, sd) {
      if (list) arr.sort(function (a, b) { return sd === 2 ? b.i - a.i : a.i - b.i; });
      else arr.sort(function (a, b) { return (sd % 2 === 0 ? a.cy - b.cy : a.cx - b.cx) || a.i - b.i; });
      arr.forEach(function (p, j) { p.slot = clamp(Math.round((j + .5) * SLOTS / arr.length - .5), 0, SLOTS - 1); });
    });
    g.used = [{}, {}, {}, {}];
    g.pins.forEach(function (p) { g.used[p.side][p.slot] = true; });
    return g;
  }

  function dpt(g, ux, uy) { return [g.die.x + ux * g.die.s, g.die.y + uy * g.die.s]; }   // Die-Einheiten -> px
  function padUnit(sd, t) { return sd === 0 ? [.027, t] : sd === 1 ? [t, .027] : sd === 2 ? [.973, t] : [t, .973]; }

  /* Ecken mit 45°-Fasen abschrägen (Leiterbahn-Stil) */
  function chamfer(pts, r) {
    var out = [pts[0]];
    for (var k = 1; k < pts.length - 1; k++) {
      var a = pts[k - 1], b = pts[k], c = pts[k + 1];
      var l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (l1 < .01 || l2 < .01) continue;
      var rr = Math.min(r, l1 / 2.2, l2 / 2.2);
      out.push([b[0] + (a[0] - b[0]) / l1 * rr, b[1] + (a[1] - b[1]) / l1 * rr]);
      out.push([b[0] + (c[0] - b[0]) / l2 * rr, b[1] + (c[1] - b[1]) / l2 * rr]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function dedupe(pts) {
    var o = [pts[0]];
    for (var k = 1; k < pts.length; k++) {
      var q = o[o.length - 1];
      if (Math.abs(pts[k][0] - q[0]) + Math.abs(pts[k][1] - q[1]) > 1e-4) o.push(pts[k]);
    }
    return o;
  }

  /* Spur eines Pins: Außenspur -> Finger -> Bonddraht -> Routing auf dem Die */
  function buildTrace(g, p) {
    var b = g.b, s = b.s, sd = p.side, ds = g.die.s;
    // lokales Koordinatensystem je Seite: a wächst nach innen, v läuft entlang der Kante
    var fr = sd === 0 ? { sg: 1, ax: 0, edge: b.x } : sd === 2 ? { sg: -1, ax: 0, edge: b.x + s } :
      sd === 1 ? { sg: 1, ax: 1, edge: b.y } : { sg: -1, ax: 1, edge: b.y + s };
    function W(a, v) { return fr.ax === 0 ? [fr.sg * a, v] : [v, fr.sg * a]; }
    var aEdge = fr.sg * fr.edge, aCav = aEdge + g.rim;
    var dieInset = fr.ax === 0 ? g.die.x - b.x : g.die.y - b.y;
    var aTip = aEdge + dieInset - s * .06;
    var v1 = (fr.ax === 0 ? g.die.y : g.die.x) + fingT(p.slot) * ds;
    var a0, v0;
    if (g.list) { // Handy: Stummel vom Rand des Canvas
      // unten nur bis knapp unter das Gehäuse, damit keine Spur über die Pin-Liste läuft
      a0 = fr.sg * (sd === 0 ? 1 : sd === 2 ? g.W - 1 : sd === 1 ? 1 : Math.min(g.H - 1, b.y + s)); v0 = v1;
    } else {
      a0 = fr.sg * (sd === 0 ? p.r : sd === 2 ? p.l : sd === 1 ? p.b : p.t);
      v0 = fr.ax === 0 ? p.cy : p.cx;
    }
    var L = Math.max(6, aEdge - a0), dv = v1 - v0, adv = Math.abs(dv), outer;
    if (adv < 1) outer = [W(a0, v0), W(aCav, v1)];
    else if (adv <= L - 6) {
      var run1 = (L - adv) / 2;
      outer = [W(a0, v0), W(a0 + run1, v0), W(a0 + run1 + adv, v1), W(aCav, v1)];
    } else outer = [W(a0, v0), W(a0 + L * .12, v0), W(a0 + L * .92, v1), W(aCav, v1)];
    var tip = W(aTip, v1);
    var pad = padUnit(sd, padT(p.slot)), padW = dpt(g, pad[0], pad[1]);
    // Routing auf dem Die: Pad -> Kanal (Lane) -> Ring -> Block-Port
    var blk = DIE_BLOCKS[Math.max(0, BLOCKS.indexOf(p.block))];
    var lane = .049 + .0043 * (p.i % 9);
    function laneAt(side, t) { return side === 0 ? [lane, t] : side === 1 ? [t, lane] : side === 2 ? [1 - lane, t] : [t, 1 - lane]; }
    var corners = [[lane, lane], [1 - lane, lane], [1 - lane, 1 - lane], [lane, 1 - lane]];
    var pts = [pad], tpad = (sd % 2 === 0) ? pad[1] : pad[0];
    pts.push(laneAt(sd, tpad));
    var ex = blk.exit, steps = (ex - sd + 4) % 4, cur = sd;
    if (steps === 3) pts.push(corners[(sd + 3) % 4]);
    else for (var q = 0; q < steps; q++) { pts.push(corners[cur]); cur = (cur + 1) % 4; }
    var mates = g.pins.filter(function (o) { return o.block === p.block; }).sort(function (a, c) { return a.i - c.i; });
    var tp = blk.ports[0] + (blk.ports[1] - blk.ports[0]) * (mates.indexOf(p) + .5) / mates.length;
    pts.push(laneAt(ex, tp));
    pts.push(ex === 0 ? [blk.x + .012, tp] : [blk.x + blk.w - .012, tp]);
    var route = chamfer(dedupe(pts), Math.max(3, ds * .02)).map(function (u) { return dpt(g, u[0], u[1]); });
    var tw = clamp(s * .0048, 1.7, 2.7), fw = Math.max(5, s * .017), ww = Math.max(1, s * .0024), rw = Math.max(1, ds * .0042);
    var polys = [
      { pts: outer, w: tw }, { pts: [W(aCav, v1), tip], w: fw },
      { pts: [tip, padW], w: ww }, { pts: route, w: rw }
    ];
    var total = 0;
    polys.forEach(function (po) {
      po.s0 = total;
      for (var k = 1; k < po.pts.length; k++) total += Math.hypot(po.pts[k][0] - po.pts[k - 1][0], po.pts[k][1] - po.pts[k - 1][1]);
    });
    return { i: p.i, polys: polys, total: total, tip: tip, pad: padW, port: route[route.length - 1] };
  }

  /* ======================================================================
     2. STATISCHE TEXTUREN
     ====================================================================== */
  function mkCanvas(g, alpha) {
    var c = document.createElement('canvas');
    c.width = Math.round(g.W * g.dpr); c.height = Math.round(g.H * g.dpr);
    var x = c.getContext('2d', { alpha: !!alpha });
    if (!x) return null;                                       // kein Canvas 2D: Aufbau bricht ab, SVG bleibt
    x.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    return { c: c, x: x };
  }
  function noiseCanvas(n, seed, lo, hi, m, h) {
    var c = document.createElement('canvas'); c.width = c.height = n;
    var x = c.getContext('2d'), im = x.createImageData(n, n), r = rng(seed);
    for (var k = 0; k < n * n; k++) {
      im.data[k * 4] = lo + (hi - lo) * r(); im.data[k * 4 + 1] = m; im.data[k * 4 + 2] = h; im.data[k * 4 + 3] = 255;
    }
    x.putImageData(im, 0, 0); return c;
  }
  function setFont(x, spec, spacing, stretch) {
    x.font = spec;
    try { x.letterSpacing = spacing || '0px'; } catch (e) { }
    try { x.fontStretch = stretch || 'normal'; } catch (e) { }
  }
  var MONO = '"Martian Mono", ui-monospace, Menlo, monospace';

  /* ---- A: Die-Daten (R Dicke, G Material, B Höhe) ----
     Liefert Arbeitsschritte statt alles in einem Zug zu zeichnen: der Aufbau
     läuft so in kurzen Häppchen (siehe 4.), das Ergebnis bleibt Pixel für Pixel
     gleich (gleiche Reihenfolge, gleicher Zufallsstrom R). */
  function planA(g, o) {
    var x = o.x, S = g.die.s, R = rng(1717), steps = [];
    function fr(a, b, w, h, t, m, hh) { x.fillStyle = rgb(t, m, hh); x.fillRect(a, b, w, h); }
    function ln(x0, y0, x1, y1, w, t, m, hh) {
      x.strokeStyle = rgb(t, m, hh); x.lineWidth = w; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
    }
    var rh = clamp(S * .011, 2.4, 5.5), cw = rh * .66, u;
    steps.push(['A-grund', function () {
      x.fillStyle = '#000'; x.fillRect(0, 0, g.W, g.H);
      x.save(); x.translate(g.die.x, g.die.y);
      // Substrat/Passivierung mit großflächigen Dickenfeldern
      fr(0, 0, S, S, 96, 70, 40);
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(noiseCanvas(14, 5, 55, 150, 70, 40), 0, 0, S, S);
      x.globalAlpha = .35; x.drawImage(noiseCanvas(60, 9, 60, 130, 70, 40), 0, 0, S, S); x.globalAlpha = 1;
    }]);
    // Dummy-Fill in den Kanälen (zeilenweise in Bändern)
    var pf = Math.max(3.2, S * .0125), yy = S * .04, band = Math.ceil(S * .92 / pf / 4);
    function fillRows(n) {
      return function () {
        for (var r0 = 0; r0 < n && yy < S * .96; r0++, yy += pf) for (var xx = S * .04; xx < S * .96; xx += pf)
          if (R() < .72) fr(xx, yy, pf * .56, pf * .56, 120 + R() * 14, 190, 100);
      };
    }
    steps.push(['A-fill', fillRows(band)], ['A-fill', fillRows(band)], ['A-fill', fillRows(band)], ['A-fill', fillRows(1e9)]);
    // Standardzellen-Reihen (M1 horizontal, Versorgungsschienen, M2 vertikal)
    function cells(a, b, w, h, o2) {
      var step = o2.rh || rh, rows = Math.floor(h / step);
      for (var r = 0; r < rows; r++) {
        var y0 = b + r * step, x0 = a;
        while (x0 < a + w - 1) {
          var cwid = (o2.cw || cw) * [1, 1, 2, 2, 3, 4, 6][(R() * 7) | 0];
          if (x0 + cwid > a + w) cwid = a + w - x0;
          fr(x0 + .25, y0 + .35, Math.max(.5, cwid - .5), step - .7, o2.t0 + (R() - .5) * o2.tv * .22, 140 + R() * 80, 66 + R() * 30);
          if (R() < .6) fr(x0 + .4, y0 + step * (R() < .5 ? .3 : .62), Math.max(.5, cwid * (.5 + R() * .5) - .4), .55, 40, 235, 130);
          x0 += cwid;
        }
        if (r % 2 === 0) fr(a, y0 - .2, w, .75, o2.tr, 255, 172);
      }
      for (var n = 0; n < w / 2.1; n++) {
        var vx = a + R() * w, vy = b + R() * h * .9, vl = step * (2 + R() * 7);
        fr(vx, vy, .6, Math.min(vl, b + h - vy), 98, 240, 168);
      }
    }
    // SRAM-Gitter (Bitleitungen vertikal, Wortleitungen horizontal)
    function sram(a, b, w, h, t) {
      var cx = Math.max(2.6, rh * .85), cy = Math.max(2, rh * .62);
      fr(a, b, w, h, t, 80, 52);
      for (var xx2 = a + .4; xx2 < a + w - cx * .5; xx2 += cx)
        for (var yy2 = b + .4; yy2 < b + h - cy * .5; yy2 += cy) fr(xx2, yy2, cx * .62, cy * .6, t + 10 + R() * 4, 165, 80);
      for (var yy3 = b + cy * .8; yy3 < b + h; yy3 += cy) fr(a, yy3, w, .45, 92, 235, 135);
      for (var xx3 = a + cx * .3; xx3 < a + w; xx3 += cx) fr(xx3, b, .45, h, 46, 240, 150);
    }
    // Busse mit 45°-Enden
    function bus(x0, y0, len, n, t) {
      for (var k = 0; k < n; k++) {
        var yk = y0 + k * 1.7;
        x.strokeStyle = rgb(t, 252, 190); x.lineWidth = .9;
        x.beginPath(); x.moveTo(x0, yk); x.lineTo(x0 + len - (n - k) * 1.4, yk); x.lineTo(x0 + len, yk + (n - k) * 1.4); x.stroke();
      }
    }
    var fs = clamp(S * .0235, 6, 9.5);
    DIE_BLOCKS.forEach(function (b, bi) { steps.push(['A-' + b.id, function () {
      var bx0 = b.x * S, by0 = b.y * S, bw = b.w * S, bh = b.h * S, strip = fs * 1.9;
      // Grundfeld des Blocks: eigene Schichtdicke (= eigene Interferenzfarbe), Verlauf
      var gr = x.createLinearGradient(bx0, by0, bx0 + bw, by0 + bh);
      var tt = [[60, 130], [120, 70], [165, 105], [45, 105], [95, 170]][bi];
      gr.addColorStop(0, rgb(tt[0], 90, 50)); gr.addColorStop(1, rgb(tt[1], 90, 50));
      x.fillStyle = gr; x.fillRect(bx0, by0, bw, bh);
      var ix = bx0 + 2, iy = by0 + strip, iw = bw - 4, ih = bh - strip - 2;
      if (b.id === 'agent') {
        var sw = iw * .34;
        sram(ix, iy, sw, ih * .52, 58);
        cells(ix, iy + ih * .54, sw, ih * .46, { t0: 70, tv: 60, tr: 150 });
        cells(ix + sw + 2, iy, iw - sw - 2, ih, { t0: 85, tv: 90, tr: 150 });
        bus(ix + sw + 6, iy + 4, iw * .55, 7, 160);
        var hx = ix + iw * .66, hy = iy + ih * .5;           // Takt-H-Baum in oberster Lage
        ln(hx - iw * .18, hy, hx + iw * .18, hy, 1, 205, 255, 200);
        [-1, 1].forEach(function (sx) {
          ln(hx + sx * iw * .18, hy - ih * .26, hx + sx * iw * .18, hy + ih * .26, 1, 205, 255, 200);
          [-1, 1].forEach(function (sy) { ln(hx + sx * iw * .18 - iw * .08, hy + sy * ih * .26, hx + sx * iw * .18 + iw * .08, hy + sy * ih * .26, .9, 205, 255, 200); });
        });
      } else if (b.id === 'sec') {
        var sh = ih * .27;
        fr(ix, iy, iw, sh, 120, 100, 70);
        for (u = 0; u < sh - 1; u += 1.8)                    // aktive Abschirmung (Meander)
          ln(ix + 1, iy + u + .5, ix + iw - ((u / 1.8 | 0) % 2 ? 4 : 0) - 1, iy + u + .5, .7, 210, 255, 215);
        cells(ix, iy + sh + 2, iw, ih - sh - 2, { rh: rh * .85, cw: cw * .85, t0: 112, tv: 100, tr: 160 });
        for (u = 0; u < 3; u++) sram(ix + 3 + u * iw * .32, iy + ih * .62, iw * .26, ih * .22, 70 + u * 18);
      } else if (b.id === 'oss') {
        var cx0 = ix + iw * .22, cy0 = iy + ih * .5, rr = Math.min(iw * .2, ih * .46);   // Spiralinduktivität
        for (var tn = 0; tn < 3; tn++) {
          var r2 = rr - tn * rr * .26, c45 = r2 * .41;
          x.strokeStyle = rgb(215, 255, 225); x.lineWidth = Math.max(1, rr * .09);
          x.beginPath(); x.moveTo(cx0 - c45, cy0 - r2); x.lineTo(cx0 + c45, cy0 - r2); x.lineTo(cx0 + r2, cy0 - c45); x.lineTo(cx0 + r2, cy0 + c45);
          x.lineTo(cx0 + c45, cy0 + r2); x.lineTo(cx0 - c45, cy0 + r2); x.lineTo(cx0 - r2, cy0 + c45); x.lineTo(cx0 - r2, cy0 - c45); x.closePath(); x.stroke();
        }
        var qx = ix + iw * .5, qs = Math.min(ih * .36, iw * .09);                          // MIM-Kondensatoren
        for (var ca = 0; ca < 3; ca++) for (var cb = 0; cb < 2; cb++) {
          fr(qx + ca * (qs + 2), iy + 2 + cb * (qs + 2), qs, qs, 150 + ca * 18, 250, 175);
          fr(qx + ca * (qs + 2) + 1, iy + 3 + cb * (qs + 2), qs - 2, qs - 2, 88 + cb * 20, 190, 120);
        }
        for (u = 0; u < 7; u++) ln(qx, iy + ih * .7 + u * 1.4, qx + iw * .2 - (u % 2) * 3, iy + ih * .7 + u * 1.4, .8, 100, 140, 100);   // Widerstands-Serpentine
        cells(ix + iw * .78, iy, iw * .22, ih, { t0: 150, tv: 70, tr: 170 });
      } else if (b.id === 'learn') {
        var mw = (iw - 6) / 2, mh = (ih - strip * .6) / 3 - 2;
        for (var mc = 0; mc < 2; mc++) for (var mr = 0; mr < 3; mr++) sram(ix + mc * (mw + 6), iy + mr * (mh + 2), mw, mh, 36 + (mc + mr) * 16);
        for (u = 0; u < 2; u++) fr(ix + mw + .5 + u * 3, iy, 1.6, ih, 175, 220, 130);      // Dekoder-Streifen
      } else { // vis: Datenpfad aus Multiplizierer-Kacheln
        var tw2 = (iw - 6) / 3, th2 = (ih - 3) / 2;
        for (var vc = 0; vc < 3; vc++) for (var vr = 0; vr < 2; vr++) {
          var tx = ix + vc * (tw2 + 3), ty = iy + vr * (th2 + 3);
          fr(tx, ty, tw2, th2, 92 + vc * 14 + vr * 10, 110, 60);
          for (var sx2 = tx + 1; sx2 < tx + tw2 - 1; sx2 += 2.3) fr(sx2, ty + 1, 1.5, th2 - 2, 86 + R() * 14, 175 + R() * 20, 96);
          x.save(); x.beginPath(); x.rect(tx, ty, tw2, th2); x.clip();
          for (u = -th2; u < tw2; u += 4) ln(tx + u, ty + th2, tx + u + th2, ty, .55, 215, 245, 180);
          x.restore();
        }
      }
      // Rahmen (oberste Lage) und Beschriftung entlang der Blockkante
      x.strokeStyle = rgb(205, 255, 200); x.lineWidth = .9; x.strokeRect(bx0 + .5, by0 + .5, bw - 1, bh - 1);
      fr(bx0 + 1, by0 + 1, bw - 2, strip - 2, 110, 80, 50);
      setFont(x, '500 ' + fs + 'px ' + MONO, '0.12em');
      x.fillStyle = rgb(212, 255, 232); x.textBaseline = 'middle'; x.textAlign = 'left';
      x.fillText(b.name, bx0 + 4, by0 + strip * .52);
      var pn = g.pins.filter(function (q) { return q.block === b.id; }).map(function (q) { return q.i + 1; }).sort(function (a, c) { return a - c; });
      if (pn.length) {
        var lab = 'P' + pn[0] + (pn.length > 1 ? '-' + pn[pn.length - 1] : ''), lw = x.measureText(lab).width;
        x.fillText(lab, bx0 + bw - lw - 4, by0 + bh - fs * .7);
      }
    }]); });
    steps.push(['A-rest', function () {
    // Logo-Feld: SP-17, © 2026
    var lx = S * .47, ly = S * .54, lw2 = S * .11, lh = S * .12;
    fr(lx, ly, lw2, lh, 150, 90, 50);
    x.strokeStyle = rgb(205, 255, 200); x.lineWidth = .9; x.strokeRect(lx + .5, ly + .5, lw2 - 1, lh - 1);
    setFont(x, '700 ' + clamp(S * .025, 5.5, 11) + 'px ' + MONO, '0.02em');
    x.fillStyle = rgb(220, 255, 240); x.textBaseline = 'alphabetic';
    x.fillText('SP-17', lx + lw2 * .09, ly + lh * .46);
    setFont(x, '500 ' + clamp(S * .015, 4.5, 7) + 'px ' + MONO, '0.04em');
    x.fillText('© 2026', lx + lw2 * .09, ly + lh * .78);
    // Siegelring, Pads
    [.006, .012].forEach(function (a) { x.strokeStyle = rgb(210, 255, 205); x.lineWidth = 1.1; x.strokeRect(S * a, S * a, S * (1 - 2 * a), S * (1 - 2 * a)); });
    var ps = S * .03, k2, sd2;
    for (sd2 = 0; sd2 < 4; sd2++) for (k2 = 0; k2 < SLOTS; k2++) {
      var pu = padUnit(sd2, padT(k2)), px = pu[0] * S - ps / 2, py = pu[1] * S - ps / 2;
      fr(px, py, ps, ps, 218, 255, 232); fr(px + ps * .2, py + ps * .2, ps * .6, ps * .6, 70, 205, 215);
    }
    x.fillStyle = rgb(215, 255, 235); x.beginPath();                                       // Pin-1-Dreieck
    x.moveTo(S * .016, S * .016); x.lineTo(S * .05, S * .016); x.lineTo(S * .016, S * .05); x.fill();
    x.strokeStyle = rgb(10, 20, 6); x.lineWidth = 1.6; x.strokeRect(.8, .8, S - 1.6, S - 1.6);   // Die-Kante
    x.restore();
    }]);
    return steps;
  }

  /* ---- Gehäusepfad (Pin-1-Fase oben links) ---- */
  function bodyPath(x, b) {
    var c = b.s * .07, r = b.s * .022, X = b.x, Y = b.y, s = b.s;
    x.beginPath(); x.moveTo(X + c, Y); x.lineTo(X + s - r, Y); x.quadraticCurveTo(X + s, Y, X + s, Y + r);
    x.lineTo(X + s, Y + s - r); x.quadraticCurveTo(X + s, Y + s, X + s - r, Y + s); x.lineTo(X + r, Y + s);
    x.quadraticCurveTo(X, Y + s, X, Y + s - r); x.lineTo(X, Y + c); x.closePath();
  }

  /* ---- L: Deckel (Epoxid + Lasermarke) ---- */
  function planL(g, o) {
    var x = o.x, b = g.b, s = b.s, R = rng(4242), n;
    return [['L-grund', function () {
    x.clearRect(0, 0, g.W, g.H);
    bodyPath(x, b);
    var gr = x.createLinearGradient(b.x, b.y, b.x + s, b.y + s);
    gr.addColorStop(0, '#1c1f24'); gr.addColorStop(1, '#121418');
    x.fillStyle = gr; x.fill();
    x.save(); bodyPath(x, b); x.clip();
    for (n = 0; n < s * s / 38; n++) { // Füllstoff-Körnung
      x.fillStyle = R() < .5 ? 'rgba(255,255,255,' + (.02 + R() * .05) + ')' : 'rgba(0,0,0,' + (.1 + R() * .2) + ')';
      x.fillRect(b.x + R() * s, b.y + R() * s, 1 + (R() < .15 ? 1 : 0), 1);
    }
    }], ['L-marke', function () {
    var c = g.cav;
    x.strokeStyle = 'rgba(236,232,225,.07)'; x.lineWidth = 1; x.strokeRect(c.x + .5, c.y + .5, c.w - 1, c.h - 1);
    x.lineWidth = 1.5; x.strokeStyle = 'rgba(236,232,225,.13)';                            // Fasen-Kanten
    x.beginPath(); x.moveTo(b.x + s * .07, b.y + 1); x.lineTo(b.x + s - 2, b.y + 1); x.moveTo(b.x + 1, b.y + s * .07); x.lineTo(b.x + 1, b.y + s - 2); x.stroke();
    x.strokeStyle = 'rgba(0,0,0,.45)';
    x.beginPath(); x.moveTo(b.x + s - 1, b.y + 2); x.lineTo(b.x + s - 1, b.y + s - 1); x.lineTo(b.x + 2, b.y + s - 1); x.stroke();
    // Lasermarkierung
    var cx = b.x + s / 2, cy = b.y + s / 2;
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = 'rgba(198,192,181,.62)';
    setFont(x, '800 ' + Math.round(s * .17) + 'px Archivo, "Helvetica Neue", Arial, sans-serif', (s * .006) + 'px', 'expanded');
    x.fillText('SP-17', cx, cy - s * .03);
    setFont(x, '500 ' + Math.max(7, s * .027) + 'px ' + MONO, '0.34em');
    x.fillText('STEFAN PAUN', cx, cy + s * .09);
    x.textAlign = 'left'; x.fillText('© 2026', c.x + s * .045, c.y + c.h - s * .05);
    var m = 11, ms = Math.max(2, s * .0068), dx = c.x + c.w - s * .045 - m * ms, dy = c.y + c.h - s * .045 - m * ms;   // Data-Matrix-Attrappe
    for (var a = 0; a < m; a++) for (var bb = 0; bb < m; bb++) {
      var on = a === m - 1 || bb === m - 1 ? ((a + bb) % 2 === 0 || a === m - 1 && bb === m - 1) : (a === 0 || bb === 0 ? true : R() < .5);
      if (on) x.fillRect(dx + a * ms, dy + bb * ms, ms - .5, ms - .5);
    }
    x.fillStyle = 'rgba(20,22,26,.8)';                                                     // Rauheit der Lasermarke
    for (n = 0; n < s * s / 60; n++) x.fillRect(c.x + R() * c.w, c.y + R() * c.h, 1, 1);
    var pr = s * .016, px = b.x + s * .115, py = b.y + s * .115;                           // Pin-1-Mulde
    var rg = x.createRadialGradient(px - pr * .3, py - pr * .3, 0, px, py, pr * 1.2);
    rg.addColorStop(0, '#0a0b0d'); rg.addColorStop(1, '#2a2d33');
    x.fillStyle = rg; x.beginPath(); x.arc(px, py, pr, 0, 7); x.fill();
    x.strokeStyle = 'rgba(236,232,225,.22)'; x.lineWidth = 1; x.beginPath(); x.arc(px, py, pr, 0, 7); x.stroke();
    x.restore();
    }]];
  }

  /* ---- C: Gehäuse-Innenleben (Kavität, Paddle, Dummy-Finger/-Drähte) ---- */
  function drawC(g, o) {
    var x = o.x, b = g.b, c = g.cav, d = g.die, R = rng(31), n;
    x.clearRect(0, 0, g.W, g.H);
    x.fillStyle = '#0d0f12'; x.fillRect(c.x, c.y, c.w, c.h);
    for (n = 0; n < c.w * c.h / 90; n++) { x.fillStyle = 'rgba(255,255,255,' + R() * .04 + ')'; x.fillRect(c.x + R() * c.w, c.y + R() * c.h, 1, 1); }
    var pd = Math.round(b.s * .035);                                                       // Paddle
    x.fillStyle = '#24272c'; x.fillRect(d.x - pd, d.y - pd, d.s + 2 * pd, d.s + 2 * pd);
    x.strokeStyle = 'rgba(236,232,225,.16)'; x.lineWidth = 1; x.strokeRect(d.x - pd + .5, d.y - pd + .5, d.s + 2 * pd - 1, d.s + 2 * pd - 1);
    var fw = Math.max(5, b.s * .017), tipL = d.x - b.x - b.s * .06 - g.rim, sd, k, wires = [];
    for (sd = 0; sd < 4; sd++) for (k = 0; k < SLOTS; k++) {
      if (g.used[sd][k]) continue;                                                         // Dummy-Finger (nicht belegt)
      var v = (sd % 2 === 0 ? d.y : d.x) + fingT(k) * d.s, fx, fy, fW, fH;
      if (sd === 0) { fx = c.x; fy = v - fw / 2; fW = tipL; fH = fw; }
      else if (sd === 2) { fx = c.x + c.w - tipL; fy = v - fw / 2; fW = tipL; fH = fw; }
      else if (sd === 1) { fx = v - fw / 2; fy = c.y; fW = fw; fH = tipL; }
      else { fx = v - fw / 2; fy = c.y + c.h - tipL; fW = fw; fH = tipL; }
      x.fillStyle = '#4a4d52'; x.fillRect(fx, fy, fW, fH);
      x.fillStyle = 'rgba(236,232,225,.22)'; x.fillRect(fx, fy, sd % 2 === 0 ? fW : 1, sd % 2 === 0 ? 1 : fH);
      var tip = sd === 0 ? [c.x + tipL, v] : sd === 2 ? [c.x + c.w - tipL, v] : sd === 1 ? [v, c.y + tipL] : [v, c.y + c.h - tipL];
      var pu = padUnit(sd, padT(k)); wires.push([tip, dpt(g, pu[0], pu[1])]);
    }
    x.globalCompositeOperation = 'destination-out'; x.fillStyle = '#000'; x.fillRect(d.x, d.y, d.s, d.s);   // Fenster für den Die
    x.globalCompositeOperation = 'source-over';
    x.strokeStyle = 'rgba(160,156,148,.55)'; x.fillStyle = 'rgba(190,186,178,.7)'; x.lineWidth = Math.max(1, b.s * .0024);
    wires.forEach(function (w) {                                                           // Drähte liegen über dem Die
      x.beginPath(); x.moveTo(w[0][0], w[0][1]); x.lineTo(w[1][0], w[1][1]); x.stroke();
      x.beginPath(); x.arc(w[0][0], w[0][1], x.lineWidth * 1.7, 0, 7); x.fill();
      x.beginPath(); x.arc(w[1][0], w[1][1], x.lineWidth * 1.7, 0, 7); x.fill();
    });
  }

  /* ---- T0..T3: Abdeckung je Pin-Spur (je Kanal ein Pin), Weg-Gradient in T3.b ---- */
  function strokePoly(x, pts) {
    x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
    for (var k = 1; k < pts.length; k++) x.lineTo(pts[k][0], pts[k][1]);
    x.stroke();
  }
  function drawT(g, ts, traces, activeIdx) {
    ts.forEach(function (o) {
      o.x.globalCompositeOperation = 'source-over'; o.x.fillStyle = '#000'; o.x.fillRect(0, 0, g.W, g.H);
      o.x.globalCompositeOperation = 'lighter'; o.x.lineJoin = 'round'; o.x.lineCap = 'butt';
    });
    traces.forEach(function (tr) {
      var x = ts[Math.floor(tr.i / 3)].x, ch = tr.i % 3, col = ch === 0 ? 'rgb(255,0,0)' : ch === 1 ? 'rgb(0,255,0)' : 'rgb(0,0,255)';
      x.strokeStyle = col; x.fillStyle = col;
      tr.polys.forEach(function (po) { x.lineWidth = po.w; strokePoly(x, po.pts); });
      [tr.tip, tr.pad, tr.port].forEach(function (pt, q) { x.beginPath(); x.arc(pt[0], pt[1], q === 2 ? 1.8 : Math.max(1.6, tr.polys[2].w * 1.8), 0, 7); x.fill(); });
    });
    var x3 = ts[3].x, tr = traces[activeIdx];
    if (tr) { // Weg s der aktiven Spur als Blau-Wert (Puls-Position im Shader)
      tr.polys.forEach(function (po) {
        x3.lineWidth = po.w + 1.2;
        var acc = po.s0;
        for (var k = 1; k < po.pts.length; k++) {
          var a = po.pts[k - 1], b = po.pts[k], len = Math.hypot(b[0] - a[0], b[1] - a[1]), pcs = Math.max(1, Math.ceil(len / 3));
          for (var q = 0; q < pcs; q++) {
            var u0 = q / pcs, u1 = (q + 1) / pcs, sm = (acc + len * (u0 + u1) / 2) / tr.total;
            x3.strokeStyle = 'rgb(0,0,' + Math.round(clamp(sm, 0, 1) * 255) + ')';
            x3.beginPath(); x3.moveTo(a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0); x3.lineTo(a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1); x3.stroke();
          }
          acc += len;
        }
      });
    }
  }

  /* ======================================================================
     3. RENDERER: WebGL
     ====================================================================== */
  var VS = 'attribute vec2 a;varying vec2 v_uv;void main(){v_uv=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}';
  var FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
    'varying vec2 v_uv;',
    'uniform sampler2D u_A,u_C,u_L,u_T0,u_T1,u_T2,u_T3;',
    'uniform vec2 u_size,u_texel;',
    'uniform vec4 u_die,u_cav,u_blk[5];',
    'uniform float u_lift[5];',
    'uniform float u_focus,u_decap,u_pulsePx,u_pulseAmp,u_total;',
    'uniform vec3 u_light,u_b0,u_b1,u_b2,u_b3,u_a0,u_a1,u_a2,u_a3;',
    'float rm(vec2 p,vec4 r){vec2 q=step(r.xy,p)*step(p,r.xy+r.zw);return q.x*q.y;}',
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}',
    'float fbm(vec2 p){return .5*vn(p)+.3*vn(p*2.1+7.)+.2*vn(p*4.3+3.);}',
    'float lamp(vec2 p){vec3 d=vec3(u_light.xy-p,u_light.z);return u_light.z*u_light.z/dot(d,d);}',
    /* Die: Interferenzfarbe aus Schichtdicke x Lichtwinkel, Blinn-Glanz */
    'vec3 die(vec2 p,vec2 uv,float lift){',
    ' vec3 a=texture2D(u_A,uv).rgb;',
    ' float hl=texture2D(u_A,uv-vec2(u_texel.x,0.)).b,hr=texture2D(u_A,uv+vec2(u_texel.x,0.)).b;',
    ' float hu=texture2D(u_A,uv-vec2(0.,u_texel.y)).b,hd=texture2D(u_A,uv+vec2(0.,u_texel.y)).b;',
    ' vec3 n=normalize(vec3((hl-hr)*2.4,(hu-hd)*2.4,1.));',
    ' vec3 Lv=normalize(vec3(u_light.xy-p,u_light.z));',
    ' float ndl=dot(n,Lv),ci=clamp(ndl,0.,1.);',
    ' float d=70.+a.r*640.;',
    ' float ct=sqrt(max(1.-(1.-ci*ci)/2.1316,0.));',
    ' vec3 film=.5-.5*cos(6.28318*(2.92*d*ct)/vec3(650.,550.,460.));',
    ' film=mix(vec3(.58),film,(.8-.34*a.r)*(1.+.12*lift));',
    ' float M=a.g;',
    ' float lf=lamp(p);',
    ' vec3 c=film*(.18+.8*M)*(.22+.9*max(ndl,0.)*lf);',
    ' c=mix(vec3(dot(c,vec3(.33))),c,.9);',
    ' vec3 H=normalize(Lv+vec3(0.,0.,1.));',
    ' float nh=max(dot(n,H),0.);',
    ' c+=vec3(1.,.97,.92)*(pow(nh,70.)*.5+pow(nh,12.)*.07)*(.12+.88*M);',
    ' return c;}',
    'void main(){',
    ' vec2 uv=v_uv,p=uv*u_size;',
    ' float lf=lamp(p);',
    ' float lift=0.;',
    ' for(int i=0;i<5;i++){lift+=rm(p,u_blk[i])*u_lift[i];}',
    ' float fac=(1.-.5*u_focus*(1.-lift))*(1.+.25*lift);',
    ' vec4 under=vec4(0.);',
    ' if(rm(p,u_die)>.5){under=vec4(die(p,uv,lift)*fac,1.);}',
    ' vec4 c=texture2D(u_C,uv);',
    ' vec2 dq=min(p-u_cav.xy,u_cav.xy+u_cav.zw-p);',
    ' float ao=mix(.5,1.,smoothstep(0.,16.,min(dq.x,dq.y)));',
    ' c.rgb*=(.5+.85*lf)*ao;',
    ' under=c+(1.-c.a)*under;',
    /* Kupfer-Spuren */
    ' vec4 t0=texture2D(u_T0,uv),t1=texture2D(u_T1,uv),t2=texture2D(u_T2,uv),t3=texture2D(u_T3,uv);',
    ' float cov=dot(t0.rgb,vec3(1.))+dot(t1.rgb,vec3(1.))+dot(t2.rgb,vec3(1.))+t3.r+t3.g;',
    ' vec3 tcol=vec3(0.);float tcv=0.;',
    ' if(cov>.004){',
    '  float brt=(dot(t0.rgb,u_b0)+dot(t1.rgb,u_b1)+dot(t2.rgb,u_b2)+dot(t3.rg,u_b3.xy))/cov;',
    '  float act=dot(t0.rgb,u_a0)+dot(t1.rgb,u_a1)+dot(t2.rgb,u_a2)+dot(t3.rg,u_a3.xy);',
    '  vec3 col=vec3(.851,.467,.231)*(.66+.42*lf)*(1.-.32*u_focus*(1.-brt));',
    '  col=mix(col,vec3(1.,.76,.52)*(.9+.2*lf),brt);',
    '  if(act>.03&&u_pulseAmp>.01){float s=t3.b/act;float pf=exp(-pow((s*u_total-u_pulsePx)/16.,2.));col=mix(col,vec3(.95,.93,.89),pf*u_pulseAmp*clamp(act*1.6,0.,1.));}',
    '  float cv=clamp(cov,0.,1.);under=vec4(col,1.)*cv+under*(1.-cv);tcol=col;tcv=cv;',
    ' }',
    /* Deckel + Ätzfront */
    ' vec4 L=texture2D(u_L,uv);',
    ' float w=1.;',
    ' if(rm(p,u_cav)>.5){',
    '  if(u_decap>=1.9){w=0.;}else{',
    '   vec2 q=(p-u_cav.xy-u_cav.zw*.5)/(u_cav.zw*.5);',
    '   float m=pow(pow(abs(q.x),4.)+pow(abs(q.y),4.),.25);',
    '   float f=m*.9+(fbm(p*.045)-.5)*.34+(q.x+q.y)*.05;',
    '   float thr=u_decap;',
    '   w=smoothstep(thr-.005,thr+.005,f);',
    '   float fr=1.-smoothstep(0.,.07,f-thr);',
    '   float edge=1.-smoothstep(0.,.014,abs(f-thr));',
    '   L.rgb+=vec3(.20,.15,.11)*fr*L.a+vec3(.42,.31,.22)*edge*L.a*step(thr,f);',
    '   float res=1.-smoothstep(0.,.14,thr-f);',
    '   under.rgb=under.rgb*(1.-.7*res*(1.-w))+vec3(.06,.035,.02)*res*(1.-w);',
    '  }',
    ' }',
    ' L.rgb*=(.45+.9*lf);',
    ' vec4 Lw=L*w;',
    ' vec4 o=Lw+(1.-Lw.a)*under;',
    /* Anschlussbeine: außerhalb der Kavität liegen die Spuren über dem Gehäuserand (Label-Kasten -> Pin) */
    ' if(rm(p,u_cav)<.5&&tcv>0.){o=vec4(tcol,1.)*tcv+o*(1.-tcv);}',
    ' o.rgb+=(hash(p+1.7)-.5)/200.*o.a;',
    ' gl_FragColor=o;',
    '}'
  ].join('\n');

  /* Zweistufig: GLRenderer() legt den Kontext an und stößt das Übersetzen der
     Shader nur an; finish() holt das Ergebnis ab. Dazwischen zeichnet der Aufbau
     die Texturen, mit KHR_parallel_shader_compile übersetzt der GPU-Prozess
     währenddessen im Hintergrund, ohne den Hauptthread zu blockieren. */
  function GLRenderer(cv) {
    var gl, par, vs, fs, pr;
    try { gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true }); } catch (e) { }
    if (!gl) return null;
    function sh(t, src) { var s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    return {
      kind: 'webgl', pending: true,
      compile: function () {
        par = gl.getExtension('KHR_parallel_shader_compile');
        vs = sh(gl.VERTEX_SHADER, VS); fs = sh(gl.FRAGMENT_SHADER, FS);
        pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
      },
      ready: function () { return !par || !!gl.getProgramParameter(pr, par.COMPLETION_STATUS_KHR) || gl.isContextLost(); },
      finish: function () { return glFinish(cv, gl, pr, vs, fs); }
    };
  }
  function glFinish(cv, gl, pr, vs, fs) {
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
      [vs, fs].forEach(function (s) { if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn('die.js Shader:', gl.getShaderInfoLog(s)); });
      return { failed: true };
    }
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var al = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
    var U = {}, names = ['u_A', 'u_C', 'u_L', 'u_T0', 'u_T1', 'u_T2', 'u_T3'], tex = {};
    names.concat(['u_size', 'u_texel', 'u_die', 'u_cav', 'u_blk', 'u_lift', 'u_focus', 'u_decap', 'u_pulsePx', 'u_pulseAmp', 'u_total', 'u_light',
      'u_b0', 'u_b1', 'u_b2', 'u_b3', 'u_a0', 'u_a1', 'u_a2', 'u_a3']).forEach(function (n) { U[n] = gl.getUniformLocation(pr, n); });
    names.forEach(function (n, k) {
      var t = gl.createTexture(); tex[n] = t; gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(U[n], k);
    });
    gl.clearColor(0, 0, 0, 0);
    var lost = false;
    cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); lost = true; });
    cv.addEventListener('webglcontextrestored', function () { lost = false; document.dispatchEvent(new CustomEvent('sp:die-restore')); });
    return {
      kind: 'webgl',
      isLost: function () { return lost || gl.isContextLost(); },
      upload: function (name, src, premult) {
        gl.activeTexture(gl.TEXTURE0 + names.indexOf(name)); gl.bindTexture(gl.TEXTURE_2D, tex[name]);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!premult);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      },
      draw: function (g, s) {
        gl.viewport(0, 0, cv.width, cv.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(U.u_size, g.W, g.H); gl.uniform2f(U.u_texel, 1 / g.W, 1 / g.H);
        gl.uniform4f(U.u_die, g.die.x, g.die.y, g.die.s, g.die.s);
        gl.uniform4f(U.u_cav, g.cav.x, g.cav.y, g.cav.w, g.cav.h);
        var bl = [];
        DIE_BLOCKS.forEach(function (b) { bl.push(g.die.x + b.x * g.die.s, g.die.y + b.y * g.die.s, b.w * g.die.s, b.h * g.die.s); });
        gl.uniform4fv(U.u_blk, bl);
        gl.uniform1fv(U.u_lift, s.lift);
        gl.uniform1f(U.u_focus, s.focus); gl.uniform1f(U.u_decap, s.decap);
        gl.uniform1f(U.u_pulsePx, s.pulsePx); gl.uniform1f(U.u_pulseAmp, s.pulseAmp); gl.uniform1f(U.u_total, s.total);
        gl.uniform3f(U.u_light, s.light[0], s.light[1], s.light[2]);
        for (var k = 0; k < 4; k++) {
          gl.uniform3f(U['u_b' + k], s.pinB[k * 3], s.pinB[k * 3 + 1], s.pinB[k * 3 + 2]);
          gl.uniform3f(U['u_a' + k], s.pinA[k * 3], s.pinA[k * 3 + 1], s.pinA[k * 3 + 2]);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
  }

  /* ======================================================================
     3b. RENDERER: Canvas 2D (Fallback ohne WebGL)
     ====================================================================== */
  function Canvas2DRenderer(cv) {
    var x = cv.getContext('2d');
    if (!x) return null;
    var tex = {}, bakes = null;
    var LAMPS = [[.2, .25], [.8, .75]];
    /* CPU-Beleuchtung der Die-Daten für zwei feste Lampenpositionen, in Zeilenbändern
       (Arbeitsschritte für den gestückelten Aufbau). Ergebnis landet in out[0..1]. */
    function bakePlan(g, Ac, out) {
      var d = g.dpr, sx = Math.round(g.die.x * d), sy = Math.round(g.die.y * d), n = Math.round(g.die.s * d);
      var src = null, steps = [], BAND = 40;
      steps.push(['bake-lesen', function () { src = Ac.getContext('2d').getImageData(sx, sy, n, n).data; }]);
      LAMPS.forEach(function (lp, li) {
        var lamp = [g.b.x + g.b.s * lp[0], g.b.y + g.b.s * lp[1], g.b.s * .6], cv = null, ox = null, im = null;
        for (var y0 = 1; y0 < n - 1; y0 += BAND) (function (y0) {
          steps.push(['bake' + li, function () {
            if (!im) { cv = document.createElement('canvas'); cv.width = cv.height = n; ox = cv.getContext('2d'); im = ox.createImageData(n, n); }
            bakeRows(g, lamp, src, im.data, n, y0, Math.min(n - 1, y0 + BAND));
          }]);
        })(y0);
        steps.push(['bake' + li, function () { ox.putImageData(im, 0, 0); out[li] = cv; }]);
      });
      return steps;
    }
    function bakeRows(g, lamp, src, o, n, yA, yB) {
      var d = g.dpr, lz = lamp[2], lam = [650, 550, 460];
      for (var yy = yA; yy < yB; yy++) for (var xx = 1; xx < n - 1; xx++) {
        var k = (yy * n + xx) * 4, hl = src[k - 4 + 2], hr = src[k + 4 + 2], hu = src[k - n * 4 + 2], hd = src[k + n * 4 + 2];
        var nx = (hl - hr) / 255 * 2.4, ny = (hu - hd) / 255 * 2.4, il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        var lx = lamp[0] - (g.die.x + xx / d), ly = lamp[1] - (g.die.y + yy / d), ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
        var ndl = (nx * il * lx + ny * il * ly + il * lz) / ll, ci = clamp(ndl, 0, 1), T = src[k] / 255, M = src[k + 1] / 255;
        var ct = Math.sqrt(Math.max(1 - (1 - ci * ci) / 2.1316, 0)), dl = 2.92 * (70 + T * 640) * ct;
        var kk = (.2 + .8 * M) * (.26 + 1.05 * Math.max(ndl, 0) * lz * lz / (ll * ll)), cs = 1 - .45 * T;
        for (var ch = 0; ch < 3; ch++) {
          var f = .5 - .5 * Math.cos(6.28318 * dl / lam[ch]); f = .58 + (f - .58) * cs;
          o[k + ch] = clamp(f * kk * 255, 0, 255);
        }
        o[k + 3] = 255;
      }
    }
    function runAll(steps) { steps.forEach(function (st) { st[1](); }); }
    function holePath(g, p) {
      var c = g.cav, hw = c.w / 2 * p * 1.02, hh = c.h / 2 * p * 1.02, cx = c.x + c.w / 2, cy = c.y + c.h / 2, rr = Math.min(hw, hh) * .35 * (1 - p);
      x.moveTo(cx - hw + rr, cy - hh); x.arcTo(cx + hw, cy - hh, cx + hw, cy + hh, rr); x.arcTo(cx + hw, cy + hh, cx - hw, cy + hh, rr);
      x.arcTo(cx - hw, cy + hh, cx - hw, cy - hh, rr); x.arcTo(cx - hw, cy - hh, cx + hw, cy - hh, rr); x.closePath();
    }
    return {
      kind: '2d',
      isLost: function () { return false; },
      upload: function (name, src) { tex[name] = { c: src }; if (name === 'u_A') bakes = null; },
      plan: function (g, Ac, out) { return bakePlan(g, Ac, out); },
      setBakes: function (b) { bakes = b && b[0] && b[1] ? b : null; },
      draw: function (g, s, traces) {
        if (!bakes) { var b = []; runAll(bakePlan(g, tex.u_A.c, b)); bakes = b; }
        x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height);
        x.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
        var mix = clamp((s.lx + 1) / 2 * .6 + (s.ly + 1) / 2 * .4, 0, 1), d = g.die;
        x.imageSmoothingEnabled = true;
        x.globalAlpha = 1; x.drawImage(bakes[0], d.x, d.y, d.s, d.s);
        x.globalAlpha = mix; x.drawImage(bakes[1], d.x, d.y, d.s, d.s); x.globalAlpha = 1;
        DIE_BLOCKS.forEach(function (b, bi) { // Block heben / übrige abdunkeln
          var rx = d.x + b.x * d.s, ry = d.y + b.y * d.s;
          x.fillStyle = 'rgba(14,16,19,' + (.5 * s.focus * (1 - s.lift[bi])).toFixed(3) + ')'; x.fillRect(rx, ry, b.w * d.s, b.h * d.s);
          if (s.lift[bi] > .01) { x.fillStyle = 'rgba(236,232,225,' + (.1 * s.lift[bi]).toFixed(3) + ')'; x.fillRect(rx, ry, b.w * d.s, b.h * d.s); }
        });
        x.drawImage(tex.u_C.c, 0, 0, g.W, g.H);
        traces.forEach(function (tr, ti) {
          var br = s.pinBrightness[tr.i] || 0;
          x.strokeStyle = 'rgb(' + Math.round(COPPER[0] * (.72 + .28 * br) + 38 * br) + ',' + Math.round(COPPER[1] * (.72 + .28 * br) + 50 * br) + ',' + Math.round(COPPER[2] * (.72 + .28 * br) + 60 * br) + ')';
          x.lineJoin = 'round';
          tr.polys.forEach(function (po) { x.lineWidth = po.w; strokePoly(x, po.pts); });
          if (ti === s.activeIdx && s.pulseAmp > .05) { // Puls als helles Teilstück
            x.strokeStyle = 'rgba(240,236,228,' + Math.min(1, s.pulseAmp) + ')';
            tr.polys.forEach(function (po) {
              var acc = po.s0;
              for (var k = 1; k < po.pts.length; k++) {
                var a = po.pts[k - 1], b = po.pts[k], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
                if (acc + len > s.pulsePx - 14 && acc < s.pulsePx + 14) { x.lineWidth = po.w; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); }
                acc += len;
              }
            });
          }
        });
        var p = clamp((s.decap + .3) / 2.05, 0, 1);  // Deckel: Fenster wächst, Ätzkante als Haarlinie
        x.save(); x.beginPath(); x.rect(0, 0, g.W, g.H); if (p > 0) holePath(g, p);
        x.clip('evenodd'); x.drawImage(tex.u_L.c, 0, 0, g.W, g.H); x.restore();
        if (p > 0 && p < 1) { x.strokeStyle = 'rgba(236,232,225,.5)'; x.lineWidth = 1.5; x.beginPath(); holePath(g, p); x.stroke(); }
      }
    };
  }

  /* ======================================================================
     4. AUFBAU / NEUMESSEN
     ====================================================================== */
  var R = null, traces = [], Ts = null, texC = null, built = false;

  /* Der Aufbau ist eine Liste kleiner Arbeitsschritte [Name, Funktion]. Ein Lauf
     arbeitet höchstens BUDGET ms und gibt dann den Hauptthread frei (nächster
     Task über MessageChannel), damit Eingaben, Text und Layout nie länger als
     ein paar Millisekunden warten. Erst der letzte Schritt tauscht Geometrie
     und Texturen auf einmal aus; bis dahin bleibt das Alte (oder das SVG) stehen.
     Rückgabe eines Schritts: false = abbrechen (SVG bleibt), WAIT = später noch einmal. */
  var BUDGET = 6, WAIT = {}, job = 0;
  var yieldTask = (function () {
    if (typeof MessageChannel === 'undefined') return function (f) { setTimeout(f, 0); };
    var ch = new MessageChannel(), q = [];
    ch.port1.onmessage = function () { var f = q.shift(); if (f) f(); };
    return function (f) { q.push(f); ch.port2.postMessage(0); };
  })();

  function plan() {
    var c = {}, steps = [];
    function more(list) { steps.splice.apply(steps, [k + 1, 0].concat(list)); }
    var k = -1;
    steps.push(['messen', function () {
      c.g = measure();
      if (!c.g) return false;
      c.traces = c.g.pins.map(function (p) { return buildTrace(c.g, p); }).sort(function (a, b) { return a.i - b.i; });
    }]);
    // Kontext erst nach den Die-Daten anlegen: beim Laden ist der GPU-Prozess beschäftigt,
    // getContext() wartet dann synchron auf ihn (kalt gemessen: früh 10–33 ms, später meist 5–21 ms)
    var mkR = ['renderer', function () {
      if (R) return;
      var cs = getComputedStyle(canvasEl);
      if (cs.position === 'static') canvasEl.style.cssText += ';position:absolute;left:0;top:0;width:100%;height:100%';
      canvasEl.style.pointerEvents = 'none';
      R = GLRenderer(canvasEl) || Canvas2DRenderer(canvasEl);
      if (!R) return false;
    }, true];
    var compile = ['shader-start', function () { if (R.compile) { R.compile(); R.compile = null; } }, true];
    // Leinwände erst anlegen, wenn sie gebraucht werden (jede kostet beim ersten Mal Zeit im GPU-Prozess)
    function ok() { for (var q = 0; q < arguments.length; q++) if (!arguments[q]) return false; return true; }
    steps.push(['leinwand', function () {
      c.A = mkCanvas(c.g, false);
      if (!ok(c.A)) return false;
      more(planA(c.g, c.A).concat([['leinwand', function () {
        c.C = mkCanvas(c.g, true); c.L = mkCanvas(c.g, true);
        if (!ok(c.C, c.L)) return false;
        // Shader übersetzen parallel, während C und L gezeichnet werden
        more([mkR, compile, ['C', function () { drawC(c.g, c.C); }]].concat(planL(c.g, c.L), [['leinwand', function () {
          c.Ts = [0, 1, 2, 3].map(function () { return mkCanvas(c.g, false); });
          if (!ok(c.Ts[0], c.Ts[1], c.Ts[2], c.Ts[3])) return false;
        }]]));
      }]]));
    }]);
    steps.push(['shader', function () {
      if (!R.pending) return;
      if (!R.ready()) return WAIT;
      var f = R.finish();
      if (f && !f.failed) { R = f; return; }
      // Canvas ist an WebGL gebunden: durch frisches Element ersetzen, dann Canvas 2D
      var fresh = canvasEl.cloneNode(false); canvasEl.parentNode.replaceChild(fresh, canvasEl); canvasEl = fresh;
      R = Canvas2DRenderer(canvasEl);
      if (!R) return false;
    }]);
    steps.push(['vorbelichten', function () {
      if (R.kind === '2d') { c.bakes = []; more(R.plan(c.g, c.A.c, c.bakes)); }
    }]);
    function swap() {
      G = c.g; traces = c.traces; Ts = c.Ts; texC = { A: c.A, C: c.C, L: c.L };
      canvasEl.width = Math.round(G.W * G.dpr); canvasEl.height = Math.round(G.H * G.dpr);
      drawT(G, Ts, traces, c.act = activeTrace());
    }
    function show() {
      if (R.setBakes) R.setBakes(c.bakes);
      st.dirty = true; built = true;
      if (activeTrace() !== c.act) refreshT();                 // Pin hat während des Hochladens gewechselt
      render(); wake();
    }
    steps.push(['tauschen', function () {
      if (built) { swap(); uploadAll(); show(); return; }      // Neuaufbau: alles auf einmal, nie Alt und Neu gemischt
      // Erstaufbau: es läuft noch nichts, Hochladen darf sich auf mehrere Tasks verteilen
      swap();
      more([['hochladen', function () { R.upload('u_A', texC.A.c, false); }, true],
        ['hochladen', function () { R.upload('u_C', texC.C.c, true); R.upload('u_L', texC.L.c, true); }, true],
        ['hochladen', function () { for (var k = 0; k < 4; k++) R.upload('u_T' + k, Ts[k].c, false); }, true],
        ['zeigen', show, true]]);
    }, true]);
    return { steps: steps, at: function (i) { k = i; } };
  }

  function startBuild() {
    var my = ++job, p = plan(), i = 0;
    function run() {
      if (my !== job) return;                                  // neuerer Aufbau hat übernommen
      var t0 = now();
      var n = 0;
      while (i < p.steps.length) {
        var solo = p.steps[i][2];                              // teurer Schritt: bekommt einen eigenen Task
        if (solo && n) break;
        p.at(i);
        var r = p.steps[i][1]();
        if (r === false) { job++; return; }                    // weder WebGL noch 2D: Fallback-SVG bleibt
        if (r === WAIT) { setTimeout(run, 16); return; }       // Shader noch nicht fertig übersetzt
        i++; n++;
        if (solo || now() - t0 >= BUDGET) break;
      }
      if (i < p.steps.length) yieldTask(run);
    }
    yieldTask(run);
  }
  function uploadAll() {
    R.upload('u_A', texC.A.c, false); R.upload('u_C', texC.C.c, true); R.upload('u_L', texC.L.c, true);
    for (var k = 0; k < 4; k++) R.upload('u_T' + k, Ts[k].c, false);
    st.dirty = true;
  }
  function activeTrace() { var k = -1; traces.forEach(function (t, q) { if (t.i === st.active) k = q; }); return k; }
  function refreshT() {
    if (!built) return;
    drawT(G, Ts, traces, activeTrace());
    if (R.kind === 'webgl') R.upload('u_T3', Ts[3].c, false);
    st.dirty = true;
  }

  /* ======================================================================
     5. ZUSTAND -> UNIFORMS, SCHLEIFE
     ====================================================================== */
  var clock = window.SPClock || (function () { // eigener Takt mit gleicher Signatur
    var subs = [], raf = 0, lastT = 0;
    function loop(t) {
      raf = 0; var dt = lastT ? t - lastT : 16; lastT = t;
      subs.slice().forEach(function (f) { f(t, dt); });
      if (subs.length) raf = requestAnimationFrame(loop); else lastT = 0;
    }
    return {
      on: function (f) { if (subs.indexOf(f) < 0) subs.push(f); if (!raf) raf = requestAnimationFrame(loop); },
      off: function (f) { var k = subs.indexOf(f); if (k >= 0) subs.splice(k, 1); },
      now: now
    };
  })();

  var last = 0, acc = 0, firstFrame = false, doneFired = false, fontsOk = false;
  var HOLD = 350, ETCH = 1800;                                // Deckel steht 0,35 s, dann 1,8 s Ätzfront (Exponential-Ease)

  function easeOutExpo(x) { return x >= 1 ? 1 : (1 - Math.pow(2, -5 * x)) / (1 - Math.pow(2, -5)); }

  function uniforms() {
    var s = st, b = G.b, ai = activeTrace(), tr = traces[ai];
    var o = { lx: s.lx.x, ly: s.ly.x, activeIdx: ai };
    o.light = [b.x + b.s / 2 + s.lx.x * b.s * .62, b.y + b.s / 2 + s.ly.x * b.s * .62, b.s * .6];
    o.lift = s.blocks.map(function (q) { return clamp(q.x, 0, 1.3); });
    o.focus = clamp(s.focus.x, 0, 1);
    o.decap = s.decap.thr;
    o.total = tr ? tr.total : 1; o.pulsePx = s.pulse.px; o.pulseAmp = tr ? s.pulse.amp : 0;
    o.pinB = []; o.pinA = []; o.pinBrightness = [];
    for (var k = 0; k < 12; k++) { o.pinB.push(0); o.pinA.push(0); }
    traces.forEach(function (t) {
      var v = clamp(s.pins[t.i].x, 0, 1); o.pinB[t.i] = v; o.pinBrightness[t.i] = v; o.pinA[t.i] = t.i === s.active ? 1 : 0;
    });
    return o;
  }

  function render() {
    if (!built || !R || R.isLost()) return;
    R.draw(G, uniforms(), traces);
    st.dirty = false;
    if (!firstFrame) {
      firstFrame = true; chip.classList.add('is-live');
      if (st.decap.done) fireDone();                           // Reduced Motion: sofort offen
    }
  }

  function busy() {
    var s = st, k;
    if (!s.decap.done) return true;
    if (s.drift && !s.scrolled && !s.tilt && now() > s.userHold) return true;
    if (s.active >= 0 && !reduced) return true;
    if (s.pulse.amp > .01) return true;
    if (!s.lx.rest() || !s.ly.rest() || !s.focus.rest()) return true;
    for (k = 0; k < 11; k++) if (!s.pins[k].rest()) return true;
    for (k = 0; k < 5; k++) if (!s.blocks[k].rest()) return true;
    return false;
  }

  function tick(t, dt) {
    var tn = now();
    if (!(dt > 0)) dt = tn - last;
    last = tn; dt = Math.min(dt, 50);
    var sec = dt / 1000, s = st, d = s.decap;
    if (!built || !s.visible) { sleep(); return; }
    if (!d.done) {                                             // Decap-Intro
      if (d.phase === 'pending') { d.phase = 'run'; d.t0 = tn; }
      var p = clamp((tn - d.t0 - HOLD) / ETCH, 0, 1);
      d.thr = -0.3 + easeOutExpo(p) * 2.05;
      if (p >= 1) { d.thr = 2; d.done = true; fireDone(); }
      s.dirty = true;
    }
    // Eigenbewegung der Lampe: nur Touch ohne Neigungssensor, hält beim Scrollen/Berühren an
    var drifting = s.drift && !s.tilt && !s.scrolled && tn > s.userHold && d.done;
    if (drifting) {
      s.lx.t = .5 * Math.sin(tn * .00029) + .22 * Math.sin(tn * .00071 + 1);
      s.ly.t = .46 * Math.cos(tn * .00021 + 1) + .18 * Math.sin(tn * .00057);
    }
    s.lx.step(sec); s.ly.step(sec); s.focus.step(sec);
    s.pins.forEach(function (q) { q.step(sec); });
    s.blocks.forEach(function (q) { q.step(sec); });
    var pu = s.pulse;                                          // Puls: Pin -> Block, Pause, von vorn
    if (s.active >= 0 && !reduced) {
      var tr = traces[activeTrace()];
      pu.px += pu.speed * (pu.boost ? 3 : 1) * sec;
      pu.amp = Math.min(1, pu.amp + sec * 6);
      if (pu.px > (tr ? tr.total : 300) + 260) { pu.px = -40; pu.boost = false; }
    } else pu.amp = Math.max(0, pu.amp - sec * 8);
    acc += dt;
    var driftOnly = drifting && s.active < 0 && !s.dirty;
    if (busy() || s.dirty) {
      if (!(driftOnly && acc < 30)) { render(); acc = 0; }     // Eigenbewegung höchstens ~30 fps
    }
    if (!busy()) { render(); sleep(); }
  }
  function wake() {
    if (st.awake || !st.visible || !built) return;
    st.awake = true; last = now(); clock.on(tick);
  }
  function sleep() { if (!st.awake) return; st.awake = false; clock.off(tick); }

  function fireDone() {
    if (doneFired) return; doneFired = true;
    document.dispatchEvent(new CustomEvent('sp:decap', { detail: { state: 'done' } }));
  }

  /* ---------- Pin-Ereignisse (sheet.js ist Quelle der Wahrheit) ---------- */
  function setPin(pin, block, state) {
    var idx = pin - 1, bi = BLOCKS.indexOf(block);
    if (idx < 0 || idx > 10) return;
    if (bi < 0 && pinEls[idx]) bi = BLOCKS.indexOf(pinEls[idx].getAttribute('data-block'));
    if (state === 'enter') {
      if (st.active >= 0 && st.active !== idx) st.pins[st.active].t = 0;
      st.active = idx; st.pins[idx].t = 1; st.focus.t = 1;
      st.blocks.forEach(function (q, k) { q.t = k === bi ? 1 : 0; });
      st.pulse.px = -40; st.pulse.boost = false;
      if (reduced) { st.pulse.amp = 0; st.pins[idx].snap(); st.focus.snap(); st.blocks.forEach(function (q) { q.snap(); }); }
      refreshT();
    } else if (state === 'leave') {
      if (st.active !== idx) return;
      st.pins[idx].t = 0; st.focus.t = 0; st.blocks.forEach(function (q) { q.t = 0; });
      st.active = -1;
      if (reduced) { st.pins[idx].snap(); st.focus.snap(); st.blocks.forEach(function (q) { q.snap(); }); }
      refreshT();
    } else if (state === 'select') {
      if (st.active !== idx) setPin(pin, block, 'enter');
      if (!reduced) { st.pulse.px = -40; st.pulse.boost = true; if (bi >= 0) st.blocks[bi].v += 5; }
    }
    st.dirty = true; wake();
  }
  document.addEventListener('sp:pin', function (e) {
    var dd = e.detail || {}; st.gotEvents = true;
    if (typeof dd.pin === 'number') setPin(dd.pin, dd.block, dd.state);
  });
  function direct(state) { // Rückfall direkt am Pin, solange sheet.js keine Ereignisse schickt
    return function (e) {
      if (st.gotEvents) return;
      var a = e.target.closest && e.target.closest('.pin'); if (!a) return;
      setPin(parseInt(a.getAttribute('data-pin'), 10), a.getAttribute('data-block'), state);
    };
  }
  chip.addEventListener('pointerover', direct('enter')); chip.addEventListener('pointerout', direct('leave'));
  chip.addEventListener('focusin', direct('enter')); chip.addEventListener('focusout', direct('leave'));

  /* ---------- Mikroskop-Lampe: Zeiger / Neigung ---------- */
  var DEF = [-.22, -.26];
  window.addEventListener('pointermove', function (e) {
    if (reduced || !built) return;
    if (e.pointerType === 'touch') st.userHold = now() + 3500;
    var cr = chip.getBoundingClientRect(), b = G.b;
    var rx = (e.clientX - (cr.left + b.x + b.s / 2)) / b.s, ry = (e.clientY - (cr.top + b.y + b.s / 2)) / b.s;
    var over = Math.max(Math.abs(rx), Math.abs(ry)) - .75;     // Abstand jenseits des Chips: Lampe kehrt sanft zurück
    var wgt = clamp(1 - over / .7, 0, 1); wgt = wgt * wgt * (3 - 2 * wgt);
    st.lx.t = DEF[0] + (clamp(rx, -.9, .9) * 1.15 - DEF[0]) * wgt;
    st.ly.t = DEF[1] + (clamp(ry, -.9, .9) * 1.15 - DEF[1]) * wgt;
    st.dirty = true; wake();
  }, { passive: true });
  // Neigung nur, wenn ohne Berechtigungsdialog verfügbar (nicht iOS)
  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== 'function' && coarse && !reduced) {
    window.addEventListener('deviceorientation', function (e) {
      if (e.gamma == null || e.beta == null) return;
      st.tilt = true;
      st.lx.t = clamp(e.gamma / 28, -1, 1) * .8; st.ly.t = clamp((e.beta - 48) / 28, -1, 1) * .8;
      st.dirty = true; wake();
    }, { passive: true });
  }
  window.addEventListener('scroll', function () {
    var was = st.scrolled; st.scrolled = (window.pageYOffset || 0) > 30;
    if (was && !st.scrolled) wake();
  }, { passive: true });

  /* ---------- Sichtbarkeit, Größe, Start ---------- */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) {
      st.visible = en[en.length - 1].isIntersecting;
      if (st.visible) { st.dirty = true; wake(); } else sleep();
    }, { threshold: 0.05 }).observe(chip);
  } else st.visible = true;
  document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(); });

  var rebuildT = 0;
  function requestRebuild(delay) {
    clearTimeout(rebuildT);
    rebuildT = setTimeout(startBuild, delay);
  }
  var roSize = '';                                             // erster Rückruf meldet nur die Ausgangsgröße: kein zweiter Aufbau
  if ('ResizeObserver' in window) new ResizeObserver(function (en) {
    var r = en[en.length - 1].contentRect, k = Math.round(r.width) + 'x' + Math.round(r.height);
    if (k === roSize) return;
    roSize = k;
    if (fontsOk) requestRebuild(built ? 140 : 0);
  }).observe(chip);
  document.addEventListener('sp:die-restore', function () { R = null; built = false; requestRebuild(0); });

  function boot() { // Schriften abwarten (Lasermarke, Beschriftung), höchstens 1,2 s
    var fonts = document.fonts, done = false;
    function fin() { if (done) return; done = true; fontsOk = true; requestRebuild(0); }
    if (!fonts || !fonts.load) return fin();
    setTimeout(fin, 1200);
    Promise.all([fonts.load('800 40px Archivo'), fonts.load('500 10px "Martian Mono"')]).then(fin, fin);
  }
  if (reduced) { st.decap.thr = 2; st.decap.done = true; st.decap.phase = 'run'; }
  boot();
  // Wird der Chip lange nicht sichtbar: Intro trotzdem als abgeschlossen melden
  setTimeout(function () { if (!st.decap.done && !st.visible) { st.decap.thr = 2; st.decap.done = true; fireDone(); } }, 4000);
})();
