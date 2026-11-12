/* INX — fx.js : خلفية شبكة متحركة + ظهور تدريجي + عدّاد أرقام + ripple */
(function () {
  "use strict";
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- network canvas ---------- */
  var cv = document.getElementById("bgnet");
  if (cv && cv.getContext) {
    var ctx = cv.getContext("2d"), W = 0, H = 0, dpr = 1, nodes = [], rgb = "15,157,138", mx = -999, my = -999, run = true;
    var login = cv.classList.contains("loginnet");
    function readColor() { var v = getComputedStyle(cv).getPropertyValue("--net").trim(); if (v) rgb = v; }
    function size() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.max(18, Math.min(70, Math.round(W * H / 24000)));
      nodes = [];
      for (var i = 0; i < n; i++) nodes.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35, r: 1.4 + Math.random() * 1.6, p: Math.random() * 6.28 });
    }
    function frame(t) {
      ctx.clearRect(0, 0, W, H);
      var a = login ? 1.6 : 1, L = 150, i, j, p, q, dx, dy, d;
      for (i = 0; i < nodes.length; i++) {
        p = nodes[i];
        if (!reduce) { p.x += p.vx; p.y += p.vy; }
        if (p.x < -10) p.x = W + 10; else if (p.x > W + 10) p.x = -10;
        if (p.y < -10) p.y = H + 10; else if (p.y > H + 10) p.y = -10;
        dx = p.x - mx; dy = p.y - my; d = dx * dx + dy * dy;
        if (d < 14000 && d > 1) { var f = (1 - d / 14000) * .6; p.x += dx / Math.sqrt(d) * f; p.y += dy / Math.sqrt(d) * f; }
      }
      for (i = 0; i < nodes.length; i++) {
        p = nodes[i];
        for (j = i + 1; j < nodes.length; j++) {
          q = nodes[j]; dx = p.x - q.x; dy = p.y - q.y; d = dx * dx + dy * dy;
          if (d < L * L) {
            ctx.strokeStyle = "rgba(" + rgb + "," + ((1 - Math.sqrt(d) / L) * .22 * a).toFixed(3) + ")";
            ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
        }
      }
      for (i = 0; i < nodes.length; i++) {
        p = nodes[i];
        var g = .35 + .25 * Math.sin(t / 900 + p.p);
        ctx.fillStyle = "rgba(" + rgb + "," + (g * a).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
      if (run && !reduce) requestAnimationFrame(frame);
    }
    size(); readColor(); requestAnimationFrame(frame);
    var rt; addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(size, 150); });
    addEventListener("pointermove", function (e) { mx = e.clientX; my = e.clientY; }, { passive: true });
    document.addEventListener("visibilitychange", function () { run = !document.hidden; if (run && !reduce) requestAnimationFrame(frame); });
    new MutationObserver(readColor).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  /* ---------- reveal on scroll ---------- */
  if (!reduce && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: .06 });
    var k = 0;
    document.querySelectorAll(".content .card, .content .stat, .content .hero, .content .tablewrap").forEach(function (el) {
      if (el.closest(".xl")) return;
      el.style.setProperty("--d", Math.min(k++ % 8, 7) * 55 + "ms");
      el.classList.add("rv"); io.observe(el);
    });
  }

  /* ---------- count-up for dashboard numbers ---------- */
  if (!reduce) document.querySelectorAll(".stat b").forEach(function (b) {
    var txt = b.textContent.trim();
    if (!/^\d{1,7}$/.test(txt)) return;
    var end = parseInt(txt, 10), t0 = null;
    if (end < 2) return;
    (function step(ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min((ts - t0) / 900, 1), e = 1 - Math.pow(1 - k, 3);
      b.textContent = Math.round(end * e);
      if (k < 1) requestAnimationFrame(step); else b.textContent = txt;
    })(performance.now());
  });

  /* ---------- button ripple ---------- */
  document.addEventListener("pointerdown", function (e) {
    var b = e.target.closest && e.target.closest(".btn");
    if (!b || reduce) return;
    var r = b.getBoundingClientRect(), s = Math.max(r.width, r.height), sp = document.createElement("span");
    sp.className = "ripple"; sp.style.cssText = "width:" + s + "px;height:" + s + "px;left:" + (e.clientX - r.left - s / 2) + "px;top:" + (e.clientY - r.top - s / 2) + "px";
    b.appendChild(sp); setTimeout(function () { sp.remove(); }, 650);
  });
})();
