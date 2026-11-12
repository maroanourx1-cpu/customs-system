/* INX — core.js : سلوك الواجهة المشترك (قائمة، بحث سريع، تأكيد، إشعارات، حركة) */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var root = document.documentElement, body = document.body;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isMobile = function () { return window.innerWidth <= 900; };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }

  /* ---------- theme ---------- */
  $$("[data-theme-toggle]").forEach(function (b) {
    b.addEventListener("click", function () {
      var t = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = t; store("theme", t);
    });
  });

  /* ---------- sidebar: rail on desktop, drawer on mobile ---------- */
  function closeDrawer() { body.classList.remove("menu-open"); }
  $$("[data-menu]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (isMobile()) { body.classList.toggle("menu-open"); return; }
      var rail = root.classList.toggle("nav-rail");
      store("inx.nav", rail ? "rail" : "full");
    });
  });
  var scrim = $(".scrim");
  if (scrim) scrim.addEventListener("click", closeDrawer);
  window.addEventListener("resize", function () { if (!isMobile()) closeDrawer(); });

  /* tooltip for the collapsed rail */
  var tip = document.createElement("div"); tip.className = "tip"; document.body.appendChild(tip);
  $$(".sidebar a").forEach(function (a) {
    a.addEventListener("mouseenter", function () {
      if (!root.classList.contains("nav-rail") || isMobile()) return;
      var r = a.getBoundingClientRect(), l = a.querySelector(".lbl");
      tip.textContent = l ? l.textContent.trim() : "";
      var rtl = getComputedStyle(root).direction === "rtl";
      tip.style.top = (r.top + r.height / 2 - 16) + "px";
      tip.style.left = ""; tip.style.right = "";
      if (rtl) tip.style.right = (window.innerWidth - r.left + 10) + "px"; else tip.style.left = (r.right + 10) + "px";
      tip.classList.add("on");
    });
    a.addEventListener("mouseleave", function () { tip.classList.remove("on"); });
  });

  /* optimistic active state + fast nav feedback */
  $$(".sidebar a:not(.out), .bottombar a").forEach(function (a) {
    a.addEventListener("click", function () {
      if (a.target || !a.getAttribute("href")) return;
      var href = a.getAttribute("href");
      $$(".sidebar a.active, .bottombar a.active").forEach(function (x) { x.classList.remove("active"); });
      $$('.sidebar a[href="' + href + '"], .bottombar a[href="' + href + '"]').forEach(function (x) { x.classList.add("active"); });
      closeDrawer();
    });
  });

  /* ---------- popovers (user menu) ---------- */
  $$("[data-pop]").forEach(function (btn) {
    var pop = document.getElementById(btn.dataset.pop);
    if (!pop) return;
    btn.addEventListener("click", function (e) { e.stopPropagation(); pop.classList.toggle("open"); });
    document.addEventListener("click", function (e) { if (!pop.contains(e.target)) pop.classList.remove("open"); });
  });

  /* ---------- toasts ---------- */
  var toastBox = $(".toasts");
  function toast(msg, type) {
    if (!toastBox) return;
    var t = document.createElement("div");
    t.className = "toast " + (type || "ok");
    t.innerHTML = '<svg class="i"><use href="#i-' + (type === "error" ? "alert" : type === "info" ? "bell" : "check") + '"/></svg><span></span><i class="tbar"></i>';
    t.querySelector("span").textContent = msg;
    toastBox.appendChild(t); wire(t, 0);
  }
  function wire(t, i) {
    function close() { t.classList.add("out"); setTimeout(function () { t.remove(); }, 260); }
    t.addEventListener("click", close); setTimeout(close, 4200 + i * 400);
  }
  $$(".toast").forEach(function (t, i) { wire(t, i); });

  /* ---------- confirm modal (replaces window.confirm) ---------- */
  var cm = document.createElement("div");
  cm.className = "modal confirm"; cm.setAttribute("role", "alertdialog"); cm.setAttribute("aria-modal", "true");
  cm.innerHTML = '<div class="box"><div class="cico"><svg class="i"><use href="#i-alert"/></svg></div><h3>تأكيد الإجراء</h3><p></p>' +
    '<div class="cbtn"><button type="button" class="btn red" data-ok>نعم، متابعة</button><button type="button" class="btn light" data-no>إلغاء</button></div></div>';
  document.body.appendChild(cm);
  var cmDone = null;
  function askConfirm(msg, okLabel) {
    return new Promise(function (res) {
      cm.querySelector("p").textContent = msg;
      cm.querySelector("[data-ok]").textContent = okLabel || "نعم، متابعة";
      cm.classList.add("open"); cmDone = res;
      setTimeout(function () { cm.querySelector("[data-no]").focus(); }, 30);
    });
  }
  function closeConfirm(v) { cm.classList.remove("open"); if (cmDone) { cmDone(v); cmDone = null; } }
  cm.querySelector("[data-ok]").addEventListener("click", function () { closeConfirm(true); });
  cm.querySelector("[data-no]").addEventListener("click", function () { closeConfirm(false); });
  cm.addEventListener("mousedown", function (e) { if (e.target === cm) closeConfirm(false); });
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (!f.dataset || !f.dataset.confirm || f.dataset.ok === "1") return;
    e.preventDefault(); e.stopImmediatePropagation();
    askConfirm(f.dataset.confirm).then(function (ok) {
      if (!ok) return;
      f.dataset.ok = "1";
      if (f.requestSubmit) f.requestSubmit(); else f.submit();
    });
  }, true);

  /* ---------- top progress bar + loading buttons ---------- */
  var bar = $("#nprog");
  function start() { if (bar) { bar.style.opacity = 1; bar.style.width = "78%"; } }
  function reset() { if (bar) { bar.style.opacity = 0; bar.style.width = 0; } }
  window.addEventListener("pageshow", function () { reset(); $$(".btn.loading").forEach(function (b) { b.classList.remove("loading"); }); });
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || a.hasAttribute("download")) return;
    var h = a.getAttribute("href");
    if (!h || h.charAt(0) === "#" || h.indexOf("javascript") === 0 || a.origin !== location.origin) return;
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

  /* ---------- small niceties ---------- */
  $$("[data-eye]").forEach(function (b) {
    b.addEventListener("click", function () {
      var i = b.parentNode.querySelector("input");
      i.type = i.type === "password" ? "text" : "password";
      b.style.color = i.type === "text" ? "#2563eb" : "";
    });
  });
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
  $$("[data-stagger]").forEach(function (p) {
    Array.prototype.forEach.call(p.children, function (c, i) {
      c.style.animation = "rowIn .3s cubic-bezier(.2,.8,.2,1) both"; c.style.animationDelay = Math.min(i * 35, 300) + "ms";
    });
  });
  $$(".tablewrap tr").forEach(function (tr, i) {
    if (tr.querySelector("td") && i < 16) { tr.style.setProperty("--i", i); tr.classList.add("rowin"); }
  });
  $$(".stepper .step").forEach(function (s, i) { s.style.setProperty("--i", i); });
  $$(".legend div").forEach(function (d, i) { d.style.animationDelay = (250 + i * 80) + "ms"; });
  $$("[data-count]").forEach(function (el) {
    var to = parseInt(el.dataset.count, 10) || 0;
    if (reduce || !to) { el.textContent = to; return; }
    var t0 = performance.now(), d = 650;
    (function f(t) {
      var p = Math.min((t - t0) / d, 1);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(f);
    })(t0);
  });
  /* click anywhere on a table row to open it */
  document.addEventListener("click", function (e) {
    var tr = e.target.closest && e.target.closest("tr[data-href]");
    if (!tr || e.target.closest("a,button,input,select,label,form")) return;
    start(); location.href = tr.dataset.href;
  });

  /* ---------- tabs ---------- */
  $$("[data-tabs]").forEach(function (box) {
    var btns = $$("[data-tab]", box), panes = $$("[data-pane]");
    function show(id, push) {
      btns.forEach(function (b) { b.classList.toggle("on", b.dataset.tab === id); });
      panes.forEach(function (p) { p.hidden = p.dataset.pane !== id; });
      if (push) history.replaceState(null, "", "#" + id);
    }
    btns.forEach(function (b) { b.addEventListener("click", function () { show(b.dataset.tab, true); }); });
    var h = location.hash.slice(1);
    show(btns.some(function (b) { return b.dataset.tab === h; }) ? h : btns[0].dataset.tab);
  });

  /* ---------- collapsible filter panel ---------- */
  $$("[data-toggle-filters]").forEach(function (b) {
    var p = document.getElementById(b.dataset.toggleFilters);
    if (!p) return;
    b.addEventListener("click", function () { p.classList.toggle("open"); store("inx.filters", p.classList.contains("open") ? "1" : "0"); });
  });

  /* ---------- scroll-spy for in-page sub navigation ---------- */
  var sub = $(".subnav");
  if (sub && "IntersectionObserver" in window) {
    var links = $$("a[href^='#']", sub), map = {};
    links.forEach(function (a) { var el = document.getElementById(a.getAttribute("href").slice(1)); if (el) map[el.id] = a; });
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (l) { l.classList.remove("on"); });
        var a = map[en.target.id]; if (a) { a.classList.add("on"); a.scrollIntoView({ block: "nearest", inline: "center" }); }
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    Object.keys(map).forEach(function (id) { io.observe(document.getElementById(id)); });
  }

  /* ---------- command palette (Ctrl/⌘ + K) ---------- */
  var pal = $("#palette");
  if (pal) {
    var pin = $("input", pal), plist = $(".plist", pal), items = [], sel = 0, remote = [], timer = null, seq = 0;
    var base = [];
    try { base = JSON.parse(document.getElementById("palette-data").textContent); } catch (e) {}
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    function norm(s) { return String(s).toLowerCase().replace(/[\u064b-\u065f]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه"); }
    function render() {
      var q = norm(pin.value.trim());
      var local = base.filter(function (b) { return !q || norm(b.label).indexOf(q) > -1; });
      items = local.concat(remote);
      if (!items.length) { plist.innerHTML = '<div class="none">لا توجد نتائج</div>'; return; }
      var html = "", last = "";
      items.forEach(function (it, i) {
        var g = it.group || "الشحنات";
        if (g !== last) { html += '<div class="pg">' + esc(g) + "</div>"; last = g; }
        html += '<a class="pi' + (i === sel ? " on" : "") + '" href="' + esc(it.url) + '" data-i="' + i + '"><svg class="i"><use href="#i-' + (it.icon || "ship") + '"/></svg><span>' + esc(it.label) + "</span>" + (it.sub ? "<small>" + esc(it.sub) + "</small>" : "") + "</a>";
      });
      plist.innerHTML = html;
      var on = $(".pi.on", plist); if (on) on.scrollIntoView({ block: "nearest" });
    }
    function openPal() { pal.classList.add("open"); pin.value = ""; sel = 0; remote = []; render(); setTimeout(function () { pin.focus(); }, 20); closeDrawer(); }
    function closePal() { pal.classList.remove("open"); }
    window.INX = window.INX || {}; window.INX.openPalette = openPal;
    $$("[data-palette]").forEach(function (b) { b.addEventListener("click", openPal); });
    pal.addEventListener("mousedown", function (e) { if (e.target === pal) closePal(); });
    pin.addEventListener("input", function () {
      sel = 0; render(); clearTimeout(timer);
      var q = pin.value.trim();
      if (q.length < 2) { remote = []; return; }
      var my = ++seq;
      timer = setTimeout(function () {
        fetch(pal.dataset.search + "?q=" + encodeURIComponent(q), { credentials: "same-origin" })
          .then(function (r) { return r.ok ? r.json() : []; })
          .then(function (d) { if (my !== seq) return; remote = d.map(function (x) { x.group = "الشحنات"; x.icon = "ship"; return x; }); render(); }).catch(function () {});
      }, 160);
    });
    pin.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
      else if (e.key === "Enter") { e.preventDefault(); var it = items[sel]; if (it) { start(); location.href = it.url; } }
    });
    plist.addEventListener("mousemove", function (e) {
      var a = e.target.closest(".pi"); if (!a) return; var i = +a.dataset.i; if (i !== sel) { sel = i; $$(".pi", plist).forEach(function (x, n) { x.classList.toggle("on", n === i); }); }
    });
    plist.addEventListener("click", function () { start(); });
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); pal.classList.contains("open") ? closePal() : openPal(); }
      else if (e.key === "Escape") { closePal(); closeConfirm(false); closeDrawer(); }
    });
  } else {
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeConfirm(false); closeDrawer(); } });
  }
  /* "/" focuses the page search box */
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) {
      var q = $("input[name=q]") || $("input[name=client]");
      if (q) { e.preventDefault(); q.focus(); }
    }
  });

  /* ---------- live notifications (orders + chat badges) ---------- */
  (function () {
    var url = body.dataset.notify;
    if (!url) return;
    var alarm = $("#alarm"), txt = $("#alarmText"), link = $("#alarmLink"), mute = $("#alarmMute");
    var baseTitle = document.title, muted = false, ctx = null, beepTimer = null;
    muted = store("alarmMute") === "1";
    if (body.dataset.sound === "0") muted = true;
    var showBadges = body.dataset.badges !== "0";
    var pollMs = Math.min(Math.max(parseInt(body.dataset.poll, 10) || 7, 3), 60) * 1000;
    function paintMute() { if (mute) mute.textContent = muted ? "🔕" : "🔔"; }
    paintMute();
    if (mute) mute.addEventListener("click", function () { muted = !muted; store("alarmMute", muted ? "1" : "0"); paintMute(); });
    function unlock() { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === "suspended") ctx.resume(); } catch (e) {} }
    ["click", "keydown", "touchstart"].forEach(function (ev) { document.addEventListener(ev, unlock, { once: true }); });
    function beep() {
      if (muted || !ctx || ctx.state !== "running") return;
      [880, 1175].forEach(function (f, i) {
        var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.22;
        o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.start(t); o.stop(t + 0.22);
      });
    }
    function setNb(name, n) {
      $$('[data-nb="' + name + '"]').forEach(function (el) {
        var was = el.textContent; el.textContent = n; el.hidden = !n || !showBadges;
        if (n && String(n) !== was) { el.classList.remove("pop-in"); void el.offsetWidth; el.classList.add("pop-in"); }
      });
    }
    var lastUnread = -1;
    function apply(d) {
      setNb("chat", d.chat); setNb("orders_open", d.orders_open);
      var n = d.orders_unread || 0;
      if (alarm) {
        alarm.hidden = !n;
        if (n) {
          var it = (d.items || [])[0];
          txt.textContent = n === 1 && it ? "أمر جديد من " + it.frm + " (شحنة " + it.number + "): " + it.title : "تنبيه: لديك " + n + " أوامر جديدة لم تفتحها بعد";
          link.href = n === 1 && it ? it.url : link.href.split("?")[0];
          if (n > lastUnread) beep();
          if (!beepTimer) beepTimer = setInterval(beep, 12000);
        } else if (beepTimer) { clearInterval(beepTimer); beepTimer = null; }
      }
      lastUnread = n;
      var total = (d.chat || 0) + n;
      document.title = (total ? "(" + total + ") " : "") + baseTitle;
    }
    function tick() {
      if (document.hidden && lastUnread >= 0) return;
      fetch(url, { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d) apply(d); }).catch(function () {});
    }
    tick(); setInterval(tick, pollMs);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
  })();

  window.INX = window.INX || {};
  window.INX.toast = toast; window.INX.confirm = askConfirm; window.INX.progress = { start: start, reset: reset };
})();

/* القوائم المنسدلة متعددة الاختيار (.msel): عدّاد المختار + قفل عند الضغط خارجها */
(function () {
  function upd(d) {
    var c = d.querySelectorAll("input:checked"), l = d.querySelector(".ml"), m = d.querySelector(".mc");
    if (!l || !m) return;
    m.hidden = !c.length; m.textContent = c.length;
    l.textContent = !c.length ? (d.dataset.ph || "اختر…") : Array.prototype.map.call(c, function (x) { return x.value; }).join("، ");
  }
  document.addEventListener("change", function (e) { var d = e.target.closest && e.target.closest(".msel"); if (d) upd(d); });
  document.addEventListener("click", function (e) {
    Array.prototype.forEach.call(document.querySelectorAll(".msel[open]"), function (d) { if (!d.contains(e.target)) d.removeAttribute("open"); });
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") Array.prototype.forEach.call(document.querySelectorAll(".msel[open]"), function (d) { d.removeAttribute("open"); }); });
})();
window.addEventListener("afterprint", function () { document.body.classList.remove("print-info"); });
