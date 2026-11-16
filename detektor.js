// Detektor-Ansicht. Ausgelagert aus detektor.html für die Content-Security-Policy.
(function(){
  "use strict";
  var C = {y:"#FFD23A", c:"#35D0FF", r:"#FF4D4D", steel:"#223244", ring:"#3A5A7A", text:"#A7B3C2", bone:"#E8ECF1", vac:"#0B0F14"};
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Real facts only. Geometry (phi, k) is schematic.
  var TRACKS = [
    {id:"security", name:"IPHONE-CHECK", kind:"Security", col:C.c, line:"Eigenes iPhone auf Spyware geprüft", val:"6.630 Indikatoren", phi:-64, k:0, end:1.0, muon:true,
      title:"iPhone-Check", text:"Mein eigenes iPhone mit dem Amnesty-Toolkit gegen 6.630 öffentliche Spyware-Indikatoren abgeglichen, keine gefunden. Das ist kein Beweis.",
      dep:6630, kv:[["Typ","Security"],["Stand","geprüft am 28.10.2026"],["Indikatoren","6.630"],["Treffer","keine bekannten"]], log:"#security"},
    {id:"werkzeuge", name:"CC-WERKZEUGE", kind:"KI-Agent", col:C.y, line:"Wächter, Mods und Skills für Claude Code", val:"2 Mods", phi:-8, k:.4, end:.66,
      title:"Claude-Code-Werkzeuge", text:"Ein Open-Source-Wächter für Commits und Pushes, ein Cockpit für offene Pull Requests und Skills für wiederkehrende Abläufe.",
      dep:4, kv:[["Typ","KI-Agent"],["Stand","Wächter öffentlich, Rest privat"],["Mods","2"],["Skills","2"]], log:"#werkzeuge"},
    {id:"agent-board", name:"AGENT-BOARD", kind:"KI-Agent", col:C.y, line:"Live-Ansicht für Claude-Code-Agents, v1.6.0", val:"290+ Tests", phi:-36, k:.75, end:.66,
      title:"Agent-Board", text:"Pixel-Art-Ansicht, in der jeder Claude-Code-Agent als Figur in den Raum seines Werkzeugs geht.",
      dep:299, kv:[["Typ","KI-Agent"],["Stand","öffentlich, v1.6.0"],["Tests","über 290"],["Sprachen","Englisch, Deutsch, Spanisch"]], log:"#agent-board", href:"https://stefanpaun.page/agent-board/?demo=1", hrefText:"Live-Demo öffnen"},
    {id:"jarvis", name:"JARVIS", kind:"KI-Agent", col:C.y, line:"Sprachassistent für Mac und Windows", val:"3.600+ Tests", phi:22, k:-.45, end:.66,
      title:"Jarvis", text:"Sprachassistent mit Stimme, Werkzeugen, verschlüsselten Daten und nächtlichen Tests in der Cloud.",
      dep:3600, kv:[["Typ","KI-Agent"],["Stand","im Einsatz, privat"],["Tests","über 3.600"],["Systeme","macOS, Windows"]], log:"#jarvis"}
  ];
  var byId = {}; TRACKS.forEach(function(t){ byId[t.id] = t; });

  // --- readout list ---
  var list = document.getElementById("trackList");
  var detail = document.getElementById("detail");
  TRACKS.forEach(function(t){
    var li = document.createElement("li");
    var b = document.createElement("button");
    b.type = "button"; b.dataset.id = t.id; b.setAttribute("aria-pressed","false");
    b.innerHTML = '<span class="dot"></span><span class="tname"><b></b><i></i></span><span class="tval num"></span>';
    b.querySelector(".dot").style.setProperty("--c", t.col);
    b.querySelector("b").textContent = t.name;
    b.querySelector("i").textContent = t.kind;
    b.querySelector(".tval").textContent = t.val;
    b.addEventListener("click", function(){ select(t.id, true); });
    b.addEventListener("mouseenter", function(){ hover(t.id); });
    b.addEventListener("mouseleave", function(){ hover(null); });
    li.appendChild(b); list.appendChild(li);
  });

  // --- tags beside the detector ---
  var tagBox = document.getElementById("tags");
  TRACKS.forEach(function(t){
    var b = document.createElement("button");
    b.type = "button"; b.className = "tag"; b.dataset.id = t.id; b.style.setProperty("--c", t.col);
    b.innerHTML = "<b></b><span></span><em></em>";
    b.querySelector("b").textContent = t.name;
    b.querySelector("span").textContent = t.line;
    b.querySelector("em").textContent = t.val;
    b.setAttribute("aria-label", t.name + ", " + t.line + ", " + t.val + ". Spur auswählen");
    b.addEventListener("click", function(){ select(sel === t.id ? null : t.id, true); });
    b.addEventListener("mouseenter", function(){ hover(t.id); });
    b.addEventListener("mouseleave", function(){ hover(null); });
    tagBox.appendChild(b);
  });

  var sel = null, hov = null;
  function focusId(){ return hov || sel; }

  function renderDetail(){
    var t = sel && byId[sel];
    list.hidden = !!t; detail.hidden = !t;
    list.querySelectorAll("button").forEach(function(b){ b.setAttribute("aria-pressed", String(b.dataset.id === sel)); });
    tagBox.querySelectorAll(".tag").forEach(function(b){
      var f = focusId();
      b.classList.toggle("faded", !!f && b.dataset.id !== f);
    });
    if(!t){ detail.innerHTML = ""; return; }
    var h = '<button class="back" type="button"><svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true"><path d="M5 1 L1 5 L5 9 M1 5 H13" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>Alle Spuren</button>';
    h += '<h2></h2><p class="txt"></p><dl class="kv num"></dl><a class="more"></a>';
    detail.innerHTML = h;
    detail.querySelector("h2").textContent = t.title;
    detail.querySelector("h2").style.color = t.col;
    detail.querySelector(".txt").textContent = t.text;
    var dl = detail.querySelector("dl");
    t.kv.forEach(function(p){ var dt=document.createElement("dt"); dt.textContent=p[0]; var dd=document.createElement("dd"); dd.textContent=p[1]; dl.appendChild(dt); dl.appendChild(dd); });
    var a = detail.querySelector("a.more");
    if(t.href){ a.href = t.href; a.target = "_blank"; a.rel = "noopener"; a.textContent = t.hrefText; }
    else { a.href = t.log; a.textContent = "Im Ereignis-Log ansehen"; }
    detail.querySelector(".back").addEventListener("click", function(){ select(null, true); var f = list.querySelector('button[data-id="'+t.id+'"]'); if(f) f.focus(); });
  }

  function select(id, fromUser){
    sel = id;
    renderDetail(); draw();
    if(fromUser){
      try { history.replaceState(null, "", id ? "#t-" + id : location.pathname + location.search); } catch(e){}
      if(id){ var back = detail.querySelector(".back"); if(back) back.focus({preventScroll:true}); }
    }
  }
  function hover(id){ if(hov === id) return; hov = id; renderDetail(); draw(); }

  // --- canvas: the event in 3D ---
  // The beam runs along z. At rest the camera looks down the beam (the classic end view);
  // scrolling tilts it toward a side view so the helices open up along the beam axis,
  // and a mouse drag orbits freely. Depth is shown with opacity only.
  var stage = document.getElementById("stage");
  var cv = document.getElementById("cv");
  var ctx = cv.getContext("2d");
  var W = 0, H = 0, dpr = 1, cx = 0, cy = 0, R = 0, wide = true;
  var progress = reduce ? 1 : 0, t0 = 0;

  // camera: scroll tilt (0..1) plus drag offsets, eased toward their targets
  var cam = {tilt:0, dy:0, dp:0}, goal = {tilt:0, dy:0, dp:0};
  var MAXP = 1.08, MAXY = .42;
  var pitch = 0, yaw = 0, persp = 0, zoom = 1, sp = 0, cpch = 1, syw = 0, cyw = 1;

  function camera(){
    pitch = Math.max(-1.45, Math.min(1.45, cam.tilt*MAXP + cam.dp));
    yaw = cam.tilt*MAXY + cam.dy;
    sp = Math.sin(pitch); cpch = Math.cos(pitch); syw = Math.sin(yaw); cyw = Math.cos(yaw);
    // perspective fades in with the tilt so the end view stays a true cross-section
    persp = Math.min(1, Math.abs(sp)*1.6 + Math.abs(syw)*1.6) * .16;
    // keep the whole barrel (half-length 1.05) inside the stage
    var ext = Math.max(Math.abs(cpch) + Math.abs(sp)*1.05, Math.abs(cyw) + Math.abs(syw)*1.05);
    zoom = 1/Math.max(1, ext*(1 + persp*1.1));
  }
  // world (x right, y down, z toward the viewer at rest) -> [sx, sy, depth -1..1]
  function P(x, y, z){
    var x1 = x*cyw - z*syw, z1 = x*syw + z*cyw;
    var y2 = y*cpch - z1*sp, z2 = y*sp + z1*cpch;
    var k = zoom/(1 - z2*persp);
    return [cx + x1*R*k, cy + y2*R*k, z2];
  }
  function depthA(z){ return .5 + .5*Math.max(0, Math.min(1, (z + 1.1)/2.2)); }
  function moved(){ return persp > 0; }

  // deterministic soft tracks (decoration)
  var seed = 1024;
  function rnd(){ seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  var SOFT = [];
  for(var i=0;i<34;i++){ SOFT.push({phi:rnd()*360, k:(rnd()<.5?-1:1)*(2.2+rnd()*5), end:.18+rnd()*.3, col: rnd()<.55 ? C.y : (rnd()<.5 ? C.c : C.ring), tl:(rnd()-.5)*2.4}); }
  var EMC = [], HC = [];
  for(i=0;i<64;i++) EMC.push(.25 + rnd()*.5);
  for(i=0;i<32;i++) HC.push(rnd());
  // dip of each real track along the beam (schematic, like phi and k)
  var DIP = {"security":.55, "werkzeuge":-.7, "agent-board":.35, "jarvis":-.3};
  TRACKS.forEach(function(t){ t.tl = DIP[t.id] || 0; });

  // helix: transverse circle through the vertex, z grows linearly with path length
  function pt(t, s){
    var a = t.phi * Math.PI/180, k = t.k;
    if(Math.abs(k) < 1e-4) return [Math.cos(a)*s, Math.sin(a)*s];
    return [(Math.sin(a + k*s) - Math.sin(a))/k, -(Math.cos(a + k*s) - Math.cos(a))/k];
  }
  function pt3(t, s){ var q = pt(t, s); return P(q[0], q[1], s*(t.tl || 0)); }
  // path length until transverse radius r
  function lenTo(t, r){
    var lo = 0, hi = 4;
    for(var j=0;j<40;j++){ var m=(lo+hi)/2, p=pt(t,m); if(Math.hypot(p[0],p[1]) < r) lo=m; else hi=m; }
    return lo;
  }
  TRACKS.forEach(function(t){ t.len = lenTo(t, t.end); });
  SOFT.forEach(function(t){
    var maxR = 0, s = 0, best = 0;
    for(s=0;s<Math.PI*2/Math.abs(t.k);s+=.01){ var p=pt(t,s), r=Math.hypot(p[0],p[1]); if(r>maxR){maxR=r;best=s;} if(r>t.end) break; }
    t.len = Math.min(s, best + (Math.PI/Math.abs(t.k))*.6);
  });

  function layout(){
    var rect = stage.getBoundingClientRect();
    W = rect.width; H = rect.height; dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
    wide = window.innerWidth > 760;
    if(wide){
      var tagW = Math.min(220, Math.max(150, W*.24));
      R = Math.min((W - tagW - 36)/2, H/2 - 8);
      cx = R + 4; cy = H/2;
    } else {
      R = Math.min(W, H)/2 - 6; cx = W/2; cy = H/2;
    }
    placeTags();
    draw();
  }

  function endPoint(t){ return pt3(t, t.len); }

  function placeTags(){
    if(!wide) return;
    var tags = tagBox.querySelectorAll(".tag");
    var n = tags.length, top = H*.1, bottom = H*.9;
    tags.forEach(function(el, i){
      var y = top + (bottom - top) * (i/(n-1));
      el.style.top = y + "px";
      TRACKS[i].tagY = y;
      TRACKS[i].tagX = W - el.offsetWidth;
    });
  }

  function ease(x){ return x >= 1 ? 1 : 1 - Math.pow(2, -10*x); }

  // polyline helpers in world space
  function arcPath(r, a0, a1, z, first){
    var n = Math.max(2, Math.ceil(Math.abs(a1 - a0)/.09));
    for(var j=0;j<=n;j++){
      var a = a0 + (a1 - a0)*j/n, q = P(Math.cos(a)*r, Math.sin(a)*r, z);
      if(first && j === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
    }
  }
  function ring(r, z){ ctx.beginPath(); arcPath(r, 0, Math.PI*2, z, true); ctx.closePath(); }
  function ringCells(r0, r1, n, gapDeg, stroke, fillFn, z){
    z = z || 0;
    var g = gapDeg*Math.PI/180;
    for(var j=0;j<n;j++){
      var a0 = j/n*Math.PI*2 + g/2, a1 = (j+1)/n*Math.PI*2 - g/2;
      ctx.beginPath(); arcPath(r1, a0, a1, z, true); arcPath(r0, a1, a0, z, false); ctx.closePath();
      var f = fillFn && fillFn(j);
      if(f){ ctx.fillStyle = f; ctx.fill(); }
      ctx.strokeStyle = stroke; ctx.stroke();
    }
  }
  // a barrel seen from outside: both end rings plus the two silhouette lines
  function barrel(r, L, stroke, alpha){
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = alpha * .9; ring(r, L); ctx.stroke();
    ctx.globalAlpha = alpha * .55; ring(r, -L); ctx.stroke();
    // silhouette: where the surface normal is perpendicular to the view direction
    var best = [0, 0], bv = [-1, -1];
    for(var a=0;a<Math.PI*2;a+=.02){
      var p1 = P(Math.cos(a)*r, Math.sin(a)*r, L), p2 = P(Math.cos(a)*r, Math.sin(a)*r, -L);
      var d = Math.hypot(p1[0]-cx, p1[1]-cy) + Math.hypot(p2[0]-cx, p2[1]-cy);
      var side = ((p1[0]-cx)*(p2[1]-p1[1]) - (p1[1]-cy)*(p2[0]-p1[0])) > 0 ? 0 : 1;
      if(d > bv[side]){ bv[side] = d; best[side] = a; }
    }
    ctx.globalAlpha = alpha * .7;
    best.forEach(function(a){
      var p1 = P(Math.cos(a)*r, Math.sin(a)*r, L), p2 = P(Math.cos(a)*r, Math.sin(a)*r, -L);
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    });
  }

  function draw(){
    if(!W) return;
    camera();
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,W,H);
    var f = focusId();
    var p = ease(progress);
    var tiltA = Math.min(1, persp/.16);
    ctx.lineWidth = 1;

    // barrels along the beam fade in as the camera leaves the end view
    if(tiltA > 0){
      barrel(.99, 1.05, "rgba(58,90,122,.55)", tiltA*.8);
      barrel(.86, .9, "rgba(58,90,122,.5)", tiltA*.6);
      barrel(.53, .72, "rgba(58,90,122,.5)", tiltA*.55);
      // beam line
      var b0 = P(0,0,-1.3), b1 = P(0,0,1.3);
      ctx.globalAlpha = tiltA*.7; ctx.strokeStyle = C.ring; ctx.setLineDash([2,5]);
      ctx.beginPath(); ctx.moveTo(b0[0], b0[1]); ctx.lineTo(b1[0], b1[1]); ctx.stroke(); ctx.setLineDash([]);
    }

    // the cross-section through the vertex
    ctx.globalAlpha = 1 - tiltA*.35;
    ringCells(.9, .99, 12, 9, "rgba(58,90,122,.55)", function(){ return "rgba(34,50,68,.35)"; });
    ringCells(.925, .955, 12, 9, "rgba(58,90,122,.35)");
    ringCells(.7, .86, 32, 1.2, "rgba(34,50,68,1)", function(j){ return "rgba(34,50,68," + (.2 + HC[j]*.25).toFixed(2) + ")"; });
    ringCells(.56, .68, 64, .6, "rgba(34,50,68,.9)", function(j){ return "rgba(58,90,122," + (EMC[j]*.22).toFixed(2) + ")"; });
    for(var b=1;b<=6;b++){
      ring(.08 + b*.068, 0);
      ctx.strokeStyle = b % 2 ? "rgba(58,90,122,.5)" : "rgba(34,50,68,.9)"; ctx.stroke();
    }
    ringCells(.505, .53, 40, 3, "rgba(58,90,122,.6)", function(){ return "rgba(58,90,122,.25)"; });
    ctx.globalAlpha = 1;
    ring(.035, 0); ctx.strokeStyle = C.ring; ctx.stroke();

    // soft tracks
    ctx.lineWidth = 1;
    SOFT.forEach(function(t){
      ctx.globalAlpha = (f ? .08 : .32) * Math.min(1, p*1.4);
      strokeTrack(t, t.len * p, t.col);
    });

    // calorimeter deposits, at the depth where each track arrives
    var dep = reduce ? 1 : Math.max(0, Math.min(1, (progress - .55)/.45));
    TRACKS.forEach(function(t){
      var e2 = pt(t, t.len), ang = Math.atan2(e2[1], e2[0]), z = t.len*t.tl;
      var on = !f || f === t.id;
      var blocks = Math.max(1, Math.round(Math.log10(t.dep + 1) * 2));
      for(var q=0;q<blocks;q++){
        var r0 = .70 + q*.04, r1 = r0 + .034;
        var shown = dep*blocks - q; if(shown <= 0) continue;
        var spread = (4.6 - q*.22) * Math.PI/180 * Math.min(1, shown);
        var zq = z * (r0/t.end);
        ctx.globalAlpha = (on ? 1 : .15) * depthA(P(Math.cos(ang)*r0, Math.sin(ang)*r0, zq)[2]);
        ctx.beginPath(); arcPath(r1, ang - spread, ang + spread, zq, true); arcPath(r0, ang + spread, ang - spread, zq, false); ctx.closePath();
        ctx.fillStyle = C.r; ctx.fill();
        ctx.strokeStyle = C.vac; ctx.lineWidth = 1; ctx.stroke();
      }
    });

    // main tracks
    TRACKS.forEach(function(t, idx){
      var on = !f || f === t.id;
      var local = reduce ? 1 : ease(Math.max(0, Math.min(1, (progress - idx*.06)/(.75))));
      var base = on ? 1 : .16;
      ctx.globalAlpha = base;
      ctx.lineWidth = f === t.id ? 2.4 : 1.6;
      strokeTrack(t, t.len*local, t.col, base);
      if(t.jet){
        ctx.lineWidth = 1;
        [-.06,.05,.1].forEach(function(dk, m){
          var c = {phi:t.phi + (m-1)*3.2, k:t.k + dk*6, end:t.end, tl:t.tl + (m-1)*.08};
          strokeTrack(c, lenTo(c, t.end*.98)*local, t.col, base);
        });
      }
      // hits on the tracker barrels
      ctx.fillStyle = t.col;
      for(var b=1;b<=6;b++){
        var rr = .08 + b*.068; if(rr > t.end) break;
        var s = lenTo(t, rr); if(s > t.len*local) break;
        var q = pt3(t, s);
        ctx.globalAlpha = base * depthA(q[2]);
        ctx.beginPath(); ctx.arc(q[0], q[1], f === t.id ? 2.6 : 1.9, 0, Math.PI*2); ctx.fill();
      }
      // muon: 5 hits in the chambers = 5 rooms done
      if(t.muon && local >= 1){
        var a = t.phi*Math.PI/180;
        for(var h=0;h<5;h++){
          var r = .9 + h*.02, m3 = P(Math.cos(a)*r, Math.sin(a)*r, r*t.tl);
          ctx.globalAlpha = base * depthA(m3[2]);
          ctx.beginPath(); ctx.arc(m3[0], m3[1], 2.2, 0, Math.PI*2); ctx.fill();
        }
      }
      // cache the projected path for picking
      t.proj = [];
      for(var j=0;j<=40;j++){ var pp = pt3(t, t.len*j/40); t.proj.push(pp); }
      // leader line to its tag
      if(wide && t.tagY != null && local >= 1){
        var e = endPoint(t);
        var lx = t.tagX - 6;
        ctx.globalAlpha = on ? (f === t.id ? .95 : .55) : .12;
        ctx.strokeStyle = f === t.id ? t.col : C.ring;
        ctx.lineWidth = 1;
        ctx.setLineDash(t.muon ? [4,4] : []);
        var elbowX = Math.max(e[0] + 14, cx + R*zoom*1.05 + 10);
        ctx.beginPath(); ctx.moveTo(e[0], e[1]); ctx.lineTo(elbowX, t.tagY); ctx.lineTo(lx, t.tagY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = f === t.id ? t.col : C.ring;
        ctx.beginPath(); ctx.arc(lx, t.tagY, 2.2, 0, Math.PI*2); ctx.fill();
      }
    });

    // vertex
    ctx.globalAlpha = 1;
    var v = P(0,0,0);
    ctx.beginPath(); ctx.arc(v[0], v[1], 3.2, 0, Math.PI*2); ctx.fillStyle = C.bone; ctx.fill();
  }

  // strokes in short runs so the far part of a helix fades back
  function strokeTrack(t, len, col, base){
    if(len <= 0) return;
    var a0 = base == null ? ctx.globalAlpha : base;
    var steps = Math.max(8, Math.ceil(len*60));
    var prev = P(0,0,0);
    ctx.strokeStyle = col;
    if(!moved()){
      ctx.beginPath(); ctx.moveTo(prev[0], prev[1]);
      for(var j=1;j<=steps;j++){ var q = pt3(t, len*j/steps); ctx.lineTo(q[0], q[1]); }
      ctx.stroke(); return;
    }
    var run = 6;
    for(var s0=0;s0<steps;s0+=run){
      ctx.beginPath(); ctx.moveTo(prev[0], prev[1]);
      var last = prev;
      for(var j2=s0+1;j2<=Math.min(steps, s0+run);j2++){ last = pt3(t, len*j2/steps); ctx.lineTo(last[0], last[1]); }
      ctx.globalAlpha = a0 * depthA((prev[2] + last[2])/2);
      ctx.stroke();
      prev = last;
    }
    ctx.globalAlpha = a0;
  }

  // pointer picking on the projected tracks
  function pick(ev){
    var rect = cv.getBoundingClientRect(), x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    var best = null, bd = 16;
    TRACKS.forEach(function(t){
      (t.proj || []).forEach(function(q){ var d = Math.hypot(q[0] - x, q[1] - y); if(d < bd){ bd = d; best = t.id; } });
    });
    return best;
  }

  // camera easing: runs only while the camera is catching up, then stops
  var camRaf = 0;
  function camStep(){
    var done = true;
    ["tilt","dy","dp"].forEach(function(k){
      var d = goal[k] - cam[k];
      if(Math.abs(d) > .0008){ cam[k] += d*.16; done = false; } else cam[k] = goal[k];
    });
    draw();
    camRaf = done ? 0 : requestAnimationFrame(camStep);
  }
  function nudge(){ if(!camRaf) camRaf = requestAnimationFrame(camStep); }

  // scroll tilts from end view to side view while the hero leaves the screen
  function onScroll(){
    if(reduce) return;
    var span = Math.max(240, stage.getBoundingClientRect().height*.85);
    var t = Math.max(0, Math.min(1, window.scrollY / span));
    goal.tilt = t; nudge();
  }
  window.addEventListener("scroll", onScroll, {passive:true});

  // drag to orbit (mouse and pen; touch keeps scrolling the page)
  var drag = null, dragged = false;
  cv.addEventListener("pointerdown", function(ev){
    if(ev.pointerType === "touch") return;
    drag = {x:ev.clientX, y:ev.clientY, dy:goal.dy, dp:goal.dp}; dragged = false;
    cv.setPointerCapture(ev.pointerId);
  });
  cv.addEventListener("pointermove", function(ev){
    if(drag){
      var mx = ev.clientX - drag.x, my = ev.clientY - drag.y;
      if(!dragged && Math.hypot(mx, my) > 4){ dragged = true; cv.classList.add("orbiting"); hover(null); xh.classList.remove("on"); }
      if(dragged){
        goal.dy = drag.dy + mx*.008;
        goal.dp = Math.max(-1.4, Math.min(1.4, drag.dp + my*.008));
        if(reduce){ cam.dy = goal.dy; cam.dp = goal.dp; draw(); } else nudge();
        return;
      }
    }
    if(ev.pointerType === "mouse"){ var id = pick(ev); cv.style.cursor = id ? "pointer" : ""; hover(id); aim(ev); }
  });
  // crosshair with a cursor readout in detector coordinates (azimuth and transverse radius)
  var xh = document.getElementById("xh"), xv = xh.querySelector(".xv"), xz = xh.querySelector(".xz"), xb = xh.querySelector("b");
  function aim(ev){
    var rect = cv.getBoundingClientRect(), x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    var v = P(0,0,0), dx = (x - v[0])/(R*zoom), dy = (y - v[1])/(R*zoom), r = Math.hypot(dx, dy);
    if(r > 1.08 || drag){ xh.classList.remove("on"); return; }
    var phi = (Math.atan2(-dy, dx)*180/Math.PI + 360) % 360;
    xv.style.transform = "translateX(" + x + "px)"; xz.style.transform = "translateY(" + y + "px)";
    xb.textContent = "\u03c6 " + ("00" + phi.toFixed(1)).slice(-5) + "\u00b0  r " + r.toFixed(2);
    var bx = x + 14, by = y + 14;
    if(bx + xb.offsetWidth > W) bx = x - 14 - xb.offsetWidth;
    if(by + xb.offsetHeight > H) by = y - 14 - xb.offsetHeight;
    xb.style.transform = "translate(" + bx + "px," + by + "px)";
    xh.classList.add("on");
  }
  cv.addEventListener("mouseleave", function(){ xh.classList.remove("on"); });
  function endDrag(){ drag = null; cv.classList.remove("orbiting"); }
  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", endDrag);
  cv.addEventListener("pointerleave", function(){ if(!drag) hover(null); });
  cv.addEventListener("dblclick", function(){ goal.dy = 0; goal.dp = 0; if(reduce){ cam.dy = 0; cam.dp = 0; draw(); } else nudge(); });
  cv.addEventListener("click", function(ev){
    if(dragged){ dragged = false; return; }
    var id = pick(ev);
    select(id && id !== sel ? id : null, true);
    if(!wide && id){ document.getElementById("readout").scrollIntoView({behavior: reduce ? "auto" : "smooth", block:"nearest"}); }
  });
  document.addEventListener("keydown", function(ev){ if(ev.key === "Escape" && sel){ select(null, true); } });

  // replay once on load
  function run(ts){
    if(!t0) t0 = ts;
    progress = Math.min(1.6, (ts - t0)/1400);
    draw();
    if(progress < 1.6) requestAnimationFrame(run); else { progress = 1.6; draw(); }
  }

  if(window.ResizeObserver){ new ResizeObserver(layout).observe(stage); } else { window.addEventListener("resize", layout); }
  layout();
  var start = function(){ if(!reduce) requestAnimationFrame(run); else draw(); onScroll(); };
  if(document.fonts && document.fonts.ready){ document.fonts.ready.then(function(){ placeTags(); start(); }); } else start();

  var m = /^#t-([a-z-]+)$/.exec(location.hash);
  if(m && byId[m[1]]) select(m[1], false);

  // beam through the method layers
  var beam = document.getElementById("beam");
  if(beam && !reduce && "IntersectionObserver" in window){
    beam.style.transform = "scaleX(.04)";
    var vert = window.innerWidth <= 760;
    if(vert){ beam.style.transform = "scaleY(.04)"; beam.style.transformOrigin = "center top"; }
    beam.style.transition = "transform 1.2s cubic-bezier(.16,1,.3,1)";
    new IntersectionObserver(function(es, ob){ es.forEach(function(e){ if(e.isIntersecting){ beam.style.transform = "none"; ob.disconnect(); } }); }, {threshold:.4}).observe(beam.parentNode);
  }

  // run header: a yellow beam along its bottom rule follows the scroll, and the nav marks the section in view
  var runBar = document.querySelector(".run"), runRaf = 0;
  function runBeam(){
    runRaf = 0;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    runBar.style.setProperty("--run", max > 0 ? Math.min(1, window.scrollY/max).toFixed(4) : 0);
  }
  window.addEventListener("scroll", function(){ if(!runRaf) runRaf = requestAnimationFrame(runBeam); }, {passive:true});
  runBeam();
  var navLinks = document.querySelectorAll(".run nav a");
  if("IntersectionObserver" in window){
    var seen = {};
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ seen[e.target.id] = e.isIntersecting; });
      var cur = null;
      navLinks.forEach(function(a){ var id = a.getAttribute("href").slice(1); if(seen[id] && !cur) cur = id; });
      navLinks.forEach(function(a){ if(a.getAttribute("href") === "#" + cur) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
    }, {rootMargin:"-45% 0px -50% 0px"});
    navLinks.forEach(function(a){ var el = document.getElementById(a.getAttribute("href").slice(1)); if(el) spy.observe(el); });
  }

  // sections rise in once as they enter (visible by default without JS)
  document.documentElement.classList.add("js");
  var rvs = document.querySelectorAll(".rv");
  if(!reduce && "IntersectionObserver" in window){
    var rio = new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add("in"); rio.unobserve(e.target); } }); }, {rootMargin:"0px 0px -10% 0px"});
    rvs.forEach(function(el){ if(el.getBoundingClientRect().top < window.innerHeight) el.classList.add("in"); else rio.observe(el); });
  } else rvs.forEach(function(el){ el.classList.add("in"); });

  // Vienna clock
  var clock = document.getElementById("clock");
  function tick(){ try { clock.textContent = new Intl.DateTimeFormat("de-AT",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Vienna"}).format(new Date()); } catch(e){} }
  tick(); setInterval(tick, 20000);
})();
