(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var root = document.documentElement;

  /* theme toggle */
  $$("[data-theme-toggle]").forEach(function (b) {
    b.addEventListener("click", function () {
      var t = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = t;
      try { localStorage.setItem("theme", t); } catch (e) {}
    });
  });

  /* mobile drawer */
  $$("[data-menu]").forEach(function (b) {
    b.addEventListener("click", function () { document.body.classList.toggle("menu-open"); });
  });
  var ov = $(".overlay");
  if (ov) ov.addEventListener("click", function () { document.body.classList.remove("menu-open"); });

  /* stagger children & table rows */
  $$("[data-stagger]").forEach(function (p) {
    Array.prototype.forEach.call(p.children, function (c, i) {
      c.style.setProperty("--i", i);
      c.style.animation = "rowIn .55s cubic-bezier(.22,1,.36,1) both";
      c.style.animationDelay = (i * 70) + "ms";
    });
  });
  $$(".tablewrap tr").forEach(function (tr, i) {
    if (tr.querySelector("td")) { tr.style.setProperty("--i", Math.min(i, 14)); tr.classList.add("rowin"); }
  });
  $$(".stepper .step").forEach(function (s, i) { s.style.setProperty("--i", i); });
  $$(".legend div").forEach(function (d, i) { d.style.animationDelay = (400 + i * 120) + "ms"; });

  /* count-up numbers */
  $$("[data-count]").forEach(function (el) {
    var to = parseInt(el.dataset.count, 10) || 0;
    if (reduce || !to) { el.textContent = to; return; }
    var t0 = performance.now(), d = 1000;
    (function f(t) {
      var p = Math.min((t - t0) / d, 1);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(f);
    })(t0);
  });

  /* toasts */
  $$(".toast").forEach(function (t, i) {
    function close() { t.classList.add("out"); setTimeout(function () { t.remove(); }, 420); }
    t.addEventListener("click", close);
    setTimeout(close, 4500 + i * 500);
  });

  /* top progress bar */
  var bar = $("#nprog");
  function start() { if (bar) { bar.style.opacity = 1; bar.style.width = "75%"; } }
  function reset() { if (bar) { bar.style.opacity = 0; bar.style.width = 0; } }
  window.addEventListener("pageshow", function () {
    reset();
    $$(".btn.loading").forEach(function (b) { b.classList.remove("loading"); });
  });
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || a.hasAttribute("download")) return;
    var h = a.getAttribute("href");
    if (!h || h.charAt(0) === "#" || h.indexOf("javascript") === 0) return;
    if (a.origin !== location.origin) return;
    if (/\/(download|export)|\/backup\//.test(a.pathname)) return;
    start();
  });
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (e.defaultPrevented || f.hasAttribute("data-noload")) return;
    start();
    var b = f.querySelector("button:not([type=button]), input[type=submit]");
    if (b) setTimeout(function () { b.classList.add("loading"); }, 0);
  });

  /* password eye */
  $$("[data-eye]").forEach(function (b) {
    b.addEventListener("click", function () {
      var i = b.parentNode.querySelector("input");
      i.type = i.type === "password" ? "text" : "password";
      b.style.color = i.type === "text" ? "#1d6bff" : "";
    });
  });

  /* dropzone */
  $$(".dropzone").forEach(function (z) {
    var inp = $("input[type=file]", z), names = $(".names", z), label = $(".dz-label", z);
    ["dragenter", "dragover"].forEach(function (ev) { z.addEventListener(ev, function () { z.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { z.addEventListener(ev, function () { z.classList.remove("over"); }); });
    inp.addEventListener("change", function () {
      var n = Array.prototype.map.call(inp.files, function (f) { return f.name; });
      if (names) names.textContent = n.join(" ، ");
      if (label && n.length) label.textContent = n.length + " ملف جاهز للرفع";
    });
  });

  /* "/" focuses the search box */
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      var q = $("input[name=q]") || $("input[name=client]");
      if (q) { e.preventDefault(); q.focus(); }
    }
    if (e.key === "Escape") document.body.classList.remove("menu-open");
  });
})();
