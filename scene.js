// Stefan Paun portfolio: reveal, nav tone and the 3D event scene. No dependencies.
(function(){
  "use strict";
  document.documentElement.classList.add("js");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var C = {y:"#FFD23A", c:"#35D0FF", r:"#FF4D4D", ring:"#3A5A7A", bone:"#f5f5f7"};

  // reveal on scroll
  var rv = document.querySelectorAll(".rv");
  if(!reduce && "IntersectionObserver" in window){
    var io = new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); } }); }, {rootMargin:"0px 0px -12% 0px"});
    rv.forEach(function(el){ io.observe(el); });
  } else rv.forEach(function(el){ el.classList.add("in"); });


  // quick search: Cmd/Ctrl+K or the nav button opens a list of destinations
  var pal = document.getElementById("palette"), pq = document.getElementById("pq"), kbtn = document.getElementById("kbtn");
  if(pal && pal.showModal){
    var items = Array.prototype.slice.call(pal.querySelectorAll("li")), sel = 0;
    function shown(){ return items.filter(function(li){ return !li.hidden; }); }
    function mark(){ shown().forEach(function(li, i){ li.setAttribute("aria-selected", String(i === sel)); if(i === sel) pq.setAttribute("aria-activedescendant", li.id); }); }
    function openPal(){ pq.value = ""; items.forEach(function(li){ li.hidden = false; }); sel = 0; mark(); pal.showModal(); pq.focus(); }
    if(kbtn) kbtn.addEventListener("click", openPal);
    document.addEventListener("keydown", function(ev){
      if((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k"){ ev.preventDefault(); pal.open ? pal.close() : openPal(); }
    });
    pq.addEventListener("input", function(){
      var q = pq.value.trim().toLowerCase();
      items.forEach(function(li){ li.hidden = q && li.textContent.toLowerCase().indexOf(q) < 0; });
      sel = 0; mark();
    });
    pq.addEventListener("keydown", function(ev){
      var list = shown();
      if(ev.key === "ArrowDown"){ ev.preventDefault(); sel = Math.min(list.length - 1, sel + 1); mark(); }
      else if(ev.key === "ArrowUp"){ ev.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
      else if(ev.key === "Enter"){ ev.preventDefault(); var a = list[sel] && list[sel].querySelector("a"); if(a){ pal.close(); a.click(); } }
    });
    pal.addEventListener("click", function(ev){ if(ev.target === pal) pal.close(); if(ev.target.closest("a")) pal.close(); });
  }

  // for the people who open the console
  try {
    console.log("%cHallo!%c Diese Seite hat kein Framework und keine Abhängigkeiten. Der Code liegt offen: view-source oder scene.js. Agent-Board: https://github.com/Stefan-Paun/agent-board",
      "font:700 16px -apple-system,sans-serif;color:#FFD23A", "font:13px -apple-system,sans-serif;color:#a1a1a6");
  } catch(e){}

  // nav switches to the light material while it sits over the light band
  var nav = document.querySelector(".nav"), light = document.querySelector(".light");
  function navTone(){}
  if(light && "IntersectionObserver" in window){
    new IntersectionObserver(function(es){ nav.classList.toggle("on-light", es[0].isIntersecting); }, {rootMargin:"-26px 0px -" + Math.max(0, window.innerHeight - 27) + "px 0px"}).observe(light);
  }

  // --- the product: the event in 3D, turned by the scroll position through the scene ---
  // Same schematic geometry as the detector view on the main page; only the figures are data.
  var TRACKS = [
    {name:"Security", val:"6 TryHackMe-Räume, iPhone-Check", href:"#p-security", col:C.c, phi:-64, k:0, end:1.0, muon:true, dep:6, tl:.55},
    {name:"CC-Werkzeuge", val:"11 Prüfmuster vor jedem Commit", href:"#p-werkzeuge", col:C.y, phi:-8, k:.4, end:.66, dep:4, tl:-.7},
    {name:"Agent-Board", val:"74 Tests, Open Source", href:"https://stefan-paun.github.io/agent-board/?demo=1", ext:true, col:C.y, phi:-36, k:.75, end:.66, dep:74, tl:.35},
    {name:"Jarvis", val:"3.619 automatische Tests", href:"#p-jarvis", col:C.y, phi:22, k:-.45, end:.66, dep:3619, tl:-.3},
    {name:"GWB-Rallye", val:"273 Fragen", href:"#p-rallye", col:C.r, phi:34, k:.3, end:.84, jet:true, dep:273, tl:.8},
    {name:"Cyber-Rallye", val:"135 Fragen", href:"#p-rallye", col:C.r, phi:76, k:-.2, end:.84, jet:true, dep:135, tl:-.5}
  ];
  document.getElementById("cv-list").innerHTML = "";
  TRACKS.forEach(function(t){ var li = document.createElement("li"); li.textContent = t.name + ": " + t.val; document.getElementById("cv-list").appendChild(li); });
  var cv = document.getElementById("cv"), ctx = cv.getContext("2d");
  var scene = document.getElementById("scene"), caps = document.querySelectorAll(".cap");
  var W = 0, H = 0, dpr = 1, cx = 0, cy = 0, R = 0;
  var progress = reduce ? 1 : 0, t0 = 0, target = 0, shown = 0;
  var pitch = 0, yaw = 0, persp = 0, zoom = 1, sp = 0, cpch = 1, syw = 0, cyw = 1;

  function camera(){
    var a = Math.min(1, shown*1.7), e = a*a*(3 - 2*a);
    pitch = e*1.12;
    yaw = shown*1.15 - e*.25;
    sp = Math.sin(pitch); cpch = Math.cos(pitch); syw = Math.sin(yaw); cyw = Math.cos(yaw);
    persp = Math.min(1, Math.abs(sp)*1.6 + Math.abs(syw)*1.6) * .16;
    var ext = Math.max(Math.abs(cpch) + Math.abs(sp)*1.05, Math.abs(cyw) + Math.abs(syw)*1.05);
    zoom = 1/Math.max(1, ext*(1 + persp*1.1));
  }
  function P(x, y, z){
    var x1 = x*cyw - z*syw, z1 = x*syw + z*cyw;
    var y2 = y*cpch - z1*sp, z2 = y*sp + z1*cpch;
    var k = zoom/(1 - z2*persp);
    return [cx + x1*R*k, cy + y2*R*k, z2];
  }
  function depthA(z){ return .45 + .55*Math.max(0, Math.min(1, (z + 1.1)/2.2)); }

  var seed = 1024;
  function rnd(){ seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  var SOFT = [];
  for(var i=0;i<34;i++){ SOFT.push({phi:rnd()*360, k:(rnd()<.5?-1:1)*(2.2+rnd()*5), end:.18+rnd()*.3, col: rnd()<.55 ? C.y : (rnd()<.5 ? C.c : C.ring), tl:(rnd()-.5)*2.4}); }
  var EMC = [], HC = [];
  for(i=0;i<64;i++) EMC.push(.25 + rnd()*.5);
  for(i=0;i<32;i++) HC.push(rnd());

  function pt(t, s){
    var a = t.phi * Math.PI/180, k = t.k;
    if(Math.abs(k) < 1e-4) return [Math.cos(a)*s, Math.sin(a)*s];
    return [(Math.sin(a + k*s) - Math.sin(a))/k, -(Math.cos(a + k*s) - Math.cos(a))/k];
  }
  function pt3(t, s){ var q = pt(t, s); return P(q[0], q[1], s*(t.tl || 0)); }
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

  function arcPath(r, a0, a1, z, first){
    var n = Math.max(2, Math.ceil(Math.abs(a1 - a0)/.09));
    for(var j=0;j<=n;j++){
      var a = a0 + (a1 - a0)*j/n, q = P(Math.cos(a)*r, Math.sin(a)*r, z);
      if(first && j === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
    }
  }
  function ring(r, z){ ctx.beginPath(); arcPath(r, 0, Math.PI*2, z, true); ctx.closePath(); }
  function ringCells(r0, r1, n, gapDeg, stroke, fillFn){
    var g = gapDeg*Math.PI/180;
    for(var j=0;j<n;j++){
      var a0 = j/n*Math.PI*2 + g/2, a1 = (j+1)/n*Math.PI*2 - g/2;
      ctx.beginPath(); arcPath(r1, a0, a1, 0, true); arcPath(r0, a1, a0, 0, false); ctx.closePath();
      var f = fillFn && fillFn(j);
      if(f){ ctx.fillStyle = f; ctx.fill(); }
      ctx.strokeStyle = stroke; ctx.stroke();
    }
  }
  function barrel(r, L, stroke, alpha){
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = alpha*.9; ring(r, L); ctx.stroke();
    ctx.globalAlpha = alpha*.55; ring(r, -L); ctx.stroke();
    var best = [0, 0], bv = [-1, -1];
    for(var a=0;a<Math.PI*2;a+=.02){
      var p1 = P(Math.cos(a)*r, Math.sin(a)*r, L), p2 = P(Math.cos(a)*r, Math.sin(a)*r, -L);
      var d = Math.hypot(p1[0]-cx, p1[1]-cy) + Math.hypot(p2[0]-cx, p2[1]-cy);
      var side = ((p1[0]-cx)*(p2[1]-p1[1]) - (p1[1]-cy)*(p2[0]-p1[0])) > 0 ? 0 : 1;
      if(d > bv[side]){ bv[side] = d; best[side] = a; }
    }
    ctx.globalAlpha = alpha*.7;
    best.forEach(function(a){
      var p1 = P(Math.cos(a)*r, Math.sin(a)*r, L), p2 = P(Math.cos(a)*r, Math.sin(a)*r, -L);
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    });
  }
  function strokeTrack(t, len, col, base){
    if(len <= 0) return;
    var steps = Math.max(8, Math.ceil(len*(W < 520 ? 36 : 60))), run = 6, prev = P(0,0,0);
    ctx.strokeStyle = col;
    for(var s0=0;s0<steps;s0+=run){
      ctx.beginPath(); ctx.moveTo(prev[0], prev[1]);
      var last = prev;
      for(var j=s0+1;j<=Math.min(steps, s0+run);j++){ last = pt3(t, len*j/steps); ctx.lineTo(last[0], last[1]); }
      ctx.globalAlpha = base * depthA((prev[2] + last[2])/2);
      ctx.stroke();
      prev = last;
    }
  }
  function ease(x){ return x >= 1 ? 1 : 1 - Math.pow(1 - x, 3); }

  function layout(){
    var r = cv.getBoundingClientRect();
    // phones fire resizes while the address bar slides; only a real size change resets the canvas
    if(W && Math.abs(r.width - W) < 1 && Math.abs(r.height - H) < 1) return;
    W = r.width; H = r.height; dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth <= 760 ? 1.5 : 2);
    cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
    R = Math.min(W, H)/2 - 4; cx = W/2; cy = H/2;
    draw();
  }

  function draw(){
    if(!W) return;
    camera();
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,W,H);
    var p = ease(progress), tiltA = Math.min(1, persp/.16);
    ctx.lineWidth = 1;
    if(tiltA > 0){
      barrel(.99, 1.05, "rgba(110,140,175,.5)", tiltA*.8);
      barrel(.86, .9, "rgba(110,140,175,.42)", tiltA*.6);
      barrel(.53, .72, "rgba(110,140,175,.42)", tiltA*.55);
      var b0 = P(0,0,-1.3), b1 = P(0,0,1.3);
      ctx.globalAlpha = tiltA*.7; ctx.strokeStyle = C.ring; ctx.setLineDash([2,5]);
      ctx.beginPath(); ctx.moveTo(b0[0], b0[1]); ctx.lineTo(b1[0], b1[1]); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1 - tiltA*.35;
    ringCells(.9, .99, 12, 9, "rgba(58,90,122,.6)", function(){ return "rgba(34,50,68,.4)"; });
    ringCells(.7, .86, 32, 1.2, "rgba(40,58,78,1)", function(j){ return "rgba(34,50,68," + (.22 + HC[j]*.25).toFixed(2) + ")"; });
    ringCells(.56, .68, 64, .6, "rgba(40,58,78,.9)", function(j){ return "rgba(58,90,122," + (EMC[j]*.24).toFixed(2) + ")"; });
    for(var b=1;b<=6;b++){ ring(.08 + b*.068, 0); ctx.strokeStyle = b % 2 ? "rgba(58,90,122,.55)" : "rgba(34,50,68,.95)"; ctx.stroke(); }
    ringCells(.505, .53, 40, 3, "rgba(58,90,122,.65)", function(){ return "rgba(58,90,122,.28)"; });
    ctx.globalAlpha = 1; ring(.035, 0); ctx.strokeStyle = C.ring; ctx.stroke();

    SOFT.forEach(function(t){ strokeTrack(t, t.len*p, t.col, .3*Math.min(1, p*1.4)); });

    var dep = reduce ? 1 : Math.max(0, Math.min(1, (progress - .55)/.45));
    TRACKS.forEach(function(t){
      var e2 = pt(t, t.len), ang = Math.atan2(e2[1], e2[0]), z = t.len*t.tl;
      var blocks = Math.max(1, Math.round(Math.log10(t.dep + 1)*2));
      for(var q=0;q<blocks;q++){
        var r0 = .70 + q*.04, r1 = r0 + .034, sh = dep*blocks - q; if(sh <= 0) continue;
        var spread = (4.6 - q*.22)*Math.PI/180*Math.min(1, sh), zq = z*(r0/t.end);
        ctx.globalAlpha = depthA(P(Math.cos(ang)*r0, Math.sin(ang)*r0, zq)[2]);
        ctx.beginPath(); arcPath(r1, ang - spread, ang + spread, zq, true); arcPath(r0, ang + spread, ang - spread, zq, false); ctx.closePath();
        ctx.fillStyle = C.r; ctx.fill(); ctx.strokeStyle = "#000"; ctx.stroke();
      }
    });

    TRACKS.forEach(function(t, idx){
      var local = reduce ? 1 : ease(Math.max(0, Math.min(1, (progress - idx*.06)/.75)));
      var fa = faC[idx];
      ctx.lineWidth = 1.8 + hvC[idx]*.9;
      strokeTrack(t, t.len*local, t.col, fa);
      if(t.jet){
        ctx.lineWidth = 1;
        [-.06,.05,.1].forEach(function(dk, m){
          var c = {phi:t.phi + (m-1)*3.2, k:t.k + dk*6, end:t.end, tl:t.tl + (m-1)*.08};
          strokeTrack(c, lenTo(c, t.end*.98)*local, t.col, fa);
        });
      }
      t.proj = []; for(var pj=0;pj<=24;pj++) t.proj.push(pt3(t, t.len*local*pj/24));
      ctx.fillStyle = t.col;
      for(var b=1;b<=6;b++){
        var rr = .08 + b*.068; if(rr > t.end) break;
        var s = lenTo(t, rr); if(s > t.len*local) break;
        var q = pt3(t, s);
        ctx.globalAlpha = fa*depthA(q[2]);
        ctx.beginPath(); ctx.arc(q[0], q[1], 2.1, 0, Math.PI*2); ctx.fill();
      }
      if(t.muon && local >= 1){
        var a = t.phi*Math.PI/180;
        for(var h=0;h<5;h++){
          var r = .9 + h*.02, m3 = P(Math.cos(a)*r, Math.sin(a)*r, r*t.tl);
          ctx.globalAlpha = fa*depthA(m3[2]);
          ctx.beginPath(); ctx.arc(m3[0], m3[1], 2.3, 0, Math.PI*2); ctx.fill();
        }
      }
    });
    ctx.globalAlpha = 1;
    var v = P(0,0,0);
    ctx.beginPath(); ctx.arc(v[0], v[1], 3.4, 0, Math.PI*2); ctx.fillStyle = C.bone; ctx.fill();

    // project names at the track ends, faded in as the event turns
    var la = reduce ? 1 : Math.max(focus >= 0 ? 1 : 0, Math.min(1, (shown - .12)/.18)) * Math.min(1, progress);
    labels = [];
    if(la > 0){
      ctx.font = "600 " + (W < 420 ? 11 : 13) + "px -apple-system, BlinkMacSystemFont, 'SF Pro Text', Archivo, sans-serif";
      ctx.textBaseline = "middle";
      // place each name just past the calorimeter at its track's azimuth, then push apart names on the same side
      var lab = TRACKS.map(function(t){
        var e2 = pt(t, t.len), a = Math.atan2(e2[1], e2[0]), z = t.len*t.tl*(1.02/t.end);
        var q = P(Math.cos(a)*1.02, Math.sin(a)*1.02, z), dx = q[0] - v[0];
        return {i:TRACKS.indexOf(t), name:t.name, x:q[0] + (dx >= 0 ? 10 : -10), y:q[1], right:dx >= 0};
      });
      [true, false].forEach(function(side){
        var g = lab.filter(function(l){ return l.right === side; }).sort(function(a, b){ return a.y - b.y; });
        for(var i=1;i<g.length;i++){ if(g[i].y - g[i-1].y < 18) g[i].y = g[i-1].y + 18; }
      });
      ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = "#000";
      lab.forEach(function(l){
        ctx.textAlign = l.right ? "left" : "right";
        ctx.globalAlpha = la * (.35 + .65*(faC[l.i] - .18)/.82);
        var w = ctx.measureText(l.name).width;
        if(l.right && l.x + w > W - 4) l.x = W - 4 - w;
        if(!l.right && l.x - w < 4) l.x = 4 + w;
        labels.push({i:l.i, x0:l.right ? l.x : l.x - w, x1:l.right ? l.x + w : l.x, y:l.y});
        ctx.strokeText(l.name, l.x, l.y);
        ctx.fillStyle = "#f5f5f7";
        ctx.fillText(l.name, l.x, l.y);
      });
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
    }

    // tap and hint pulses: a ring that grows from the touched point and fades
    var now = performance.now();
    pulses = pulses.filter(function(u){ return now - u.t < 520 + (u.d || 0); });
    pulses.forEach(function(u){
      var a = (now - u.t - (u.d || 0))/520; if(a < 0) return;
      var e = 1 - Math.pow(1 - a, 3);
      ctx.globalAlpha = (1 - a)*.85; ctx.strokeStyle = u.c; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(u.x, u.y, 4 + 16*e, 0, Math.PI*2); ctx.stroke();
    });
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }

  // pick a track by its name or its line: dim the rest and show what it is
  var focus = -1, hov = -1, labels = [], pulses = [], hinted = false, capIdx = -1, pickAt = 0, byKey = false;
  var faC = TRACKS.map(function(){ return 1; }), hvC = TRACKS.map(function(){ return 0; });
  var pick = document.getElementById("pick"), live = document.getElementById("pick-live"), legend = document.querySelector(".legend");
  function hit(ev){
    var r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, best = -1, touch = ev.pointerType && ev.pointerType !== "mouse", bd = touch ? 28 : 18, lh = touch ? 16 : 12;
    labels.forEach(function(l){ if(x >= l.x0 - 6 && x <= l.x1 + 6 && Math.abs(y - l.y) < lh){ best = l.i; bd = 0; } });
    if(best < 0) TRACKS.forEach(function(t, i){ (t.proj || []).forEach(function(q){ var d = Math.hypot(q[0] - x, q[1] - y); if(d < bd){ bd = d; best = i; } }); });
    return best;
  }
  function showPick(i){
    focus = i;
    if(i < 0){
      pick.classList.remove("on"); live.textContent = "";
      if(pick.contains(document.activeElement)) cv.focus({preventScroll:true});
      kick(); return;
    }
    var t = TRACKS[i], a = pick.querySelector("a");
    pick.style.setProperty("--c", t.col);
    pick.querySelector("b").textContent = t.name;
    pick.querySelector(".v").textContent = t.val;
    a.href = t.href; a.textContent = t.ext ? "Live-Demo ansehen" : "Zum Projekt";
    if(t.ext){ a.target = "_blank"; a.rel = "noopener"; } else { a.removeAttribute("target"); a.removeAttribute("rel"); }
    var host = pick.parentNode.getBoundingClientRect(), r = cv.getBoundingClientRect();
    var lb = labels.filter(function(l){ return l.i === i; })[0] || {x0:W/2, x1:W/2, y:H/2};
    var px = r.left - host.left + (lb.x0 + lb.x1)/2 - 140, py = r.top - host.top + lb.y + 18;
    pick.style.left = Math.max(16, Math.min(host.width - pick.offsetWidth - 16, px)) + "px";
    pick.style.top = Math.max(60, Math.min(host.height - pick.offsetHeight - 120, py)) + "px";
    pick.style.transformOrigin = Math.max(0, Math.min(pick.offsetWidth, r.left - host.left + (lb.x0 + lb.x1)/2 - parseFloat(pick.style.left))) + "px 0";
    pick.classList.add("on"); pick.classList.toggle("kbd", byKey); byKey = false; pickAt = target;
    live.textContent = t.name + ": " + t.val;
    kick();
  }
  function labelPos(i){ var l = labels.filter(function(q){ return q.i === i; })[0]; return l ? {x:(l.right === false ? l.x0 : l.x0) - 8, y:l.y} : null; }
  cv.addEventListener("pointermove", function(ev){
    if(ev.pointerType !== "mouse") return;
    var i = hit(ev); cv.classList.toggle("hot", i >= 0);
    if(i !== hov){ hov = i; kick(); }
  });
  cv.addEventListener("pointerleave", function(){ if(hov >= 0){ hov = -1; kick(); } });
  cv.addEventListener("click", function(ev){
    var i = hit(ev);
    var r = cv.getBoundingClientRect();
    pulses.push({x:ev.clientX - r.left, y:ev.clientY - r.top, t:performance.now(), c:i >= 0 ? TRACKS[i].col : "rgba(161,161,166,.6)"});
    showPick(i === focus ? -1 : i);
  });
  // keyboard: arrows walk through the projects, Enter follows the card's link
  cv.addEventListener("keydown", function(ev){
    var n = TRACKS.length;
    if(ev.key === "ArrowRight" || ev.key === "ArrowDown"){ ev.preventDefault(); byKey = true; showPick((focus + 1) % n); }
    else if(ev.key === "ArrowLeft" || ev.key === "ArrowUp"){ ev.preventDefault(); byKey = true; showPick(focus <= 0 ? n - 1 : focus - 1); }
    else if(ev.key === "Enter" && focus >= 0){ ev.preventDefault(); pick.querySelector("a").click(); }
  });
  document.addEventListener("keydown", function(ev){ if(ev.key === "Escape" && focus >= 0) showPick(-1); });

  // scroll position through the pinned scene drives the camera and the captions
  var raf = 0;
  var sceneTop = 0, sceneSpan = 1;
  function measureScene(){ var r = scene.getBoundingClientRect(); sceneTop = r.top + window.scrollY; sceneSpan = Math.max(1, r.height - window.innerHeight); }
  function sceneP(){ return Math.max(0, Math.min(1, (window.scrollY - sceneTop)/sceneSpan)); }
  measureScene();
  window.addEventListener("resize", measureScene);
  window.addEventListener("load", measureScene);
  // captions switch at .36 and .68 with a little hysteresis, so they never flicker at a boundary
  function captions(p){
    var lo = [0, .36, .68], idx = capIdx < 0 ? 0 : capIdx;
    while(idx < 2 && p > lo[idx + 1] + .02) idx++;
    while(idx > 0 && p < lo[idx] - .02) idx--;
    if(idx === capIdx) return;
    capIdx = idx;
    caps.forEach(function(c, i){ c.classList.toggle("on", i === idx); });
  }
  function settle(arr, goalFn, k){
    var moving = false;
    for(var i=0;i<arr.length;i++){ var g = goalFn(i), d = g - arr[i]; if(Math.abs(d) > .004){ arr[i] += d*k; moving = true; } else arr[i] = g; }
    return moving;
  }
  var lastT = 0;
  function rate(k, dt){ return 1 - Math.pow(1 - k, dt/16.7); }
  function step(ts){
    raf = 0;
    if(document.hidden){ lastT = 0; return; }
    var dt = lastT ? Math.min(64, ts - lastT) : 16.7; lastT = ts;
    var d = target - shown;
    var stepV = d*rate(.14, dt), cap = .05*dt/16.7;
    shown = Math.abs(d) < .001 ? target : shown + Math.max(-cap, Math.min(cap, stepV));
    var m1 = settle(faC, function(i){ return focus < 0 || focus === i ? 1 : .18; }, rate(.2, dt));
    var m2 = settle(hvC, function(i){ return hov === i ? 1 : 0; }, rate(.3, dt));
    if(progress < 1.6) introStep(ts);
    if(sceneOn) draw();
    if(shown !== target || m1 || m2 || pulses.length || progress < 1.6) raf = requestAnimationFrame(step); else lastT = 0;
  }
  function kick(){ if(!raf) raf = requestAnimationFrame(step); }
  document.addEventListener("visibilitychange", function(){ if(!document.hidden) kick(); });
  var sceneOn = true, tick = 0;
  if("IntersectionObserver" in window){
    new IntersectionObserver(function(es){ sceneOn = es[0].isIntersecting; if(!sceneOn && focus >= 0) showPick(-1); }).observe(scene);
  }
  function onScroll(){
    if(reduce) return;
    if(!sceneOn){ target = sceneP(); return; }
    target = sceneP(); captions(target); legend.classList.toggle("on", target > .02);
    if(focus >= 0 && Math.abs(target - pickAt) > .12) showPick(-1);
    if(!hinted && focus < 0 && progress >= 1 && target > .05){
      var lp = labelPos(2);
      if(lp){ hinted = true; var tt = performance.now(); pulses.push({x:lp.x, y:lp.y, t:tt, c:"#f5f5f7"}, {x:lp.x, y:lp.y, t:tt, d:520, c:"#f5f5f7"}); }
    }
    kick();
  }
  window.addEventListener("scroll", function(){
    if(tick) return;
    tick = requestAnimationFrame(function(){ tick = 0; navTone(); onScroll(); });
  }, {passive:true});

  // the intro replay runs inside the same loop as the camera, so a frame is never drawn twice
  var introOn = false;
  function introStep(ts){
    if(!introOn) return;
    if(!t0) t0 = ts - progress/1.6*1300;
    progress = Math.min(1.6, (ts - t0)/1300*1.6);
  }
  document.addEventListener("visibilitychange", function(){ if(document.hidden) t0 = 0; });
  if(window.ResizeObserver){ new ResizeObserver(layout).observe(cv); } else { window.addEventListener("resize", layout); }
  layout();
  if(reduce){ caps.forEach(function(c){ c.classList.add("on"); }); draw(); }
  else {
    // start the replay once the render is on screen
    var started = false;
    var go = function(){ if(!started){ started = true; introOn = true; kick(); } };
    if("IntersectionObserver" in window){
      new IntersectionObserver(function(es, ob){ if(es[0].isIntersecting){ go(); ob.disconnect(); } }, {threshold:.15}).observe(cv);
    } else go();
    onScroll();
  }
})();
