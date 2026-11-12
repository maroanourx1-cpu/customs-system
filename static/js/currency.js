/* INX — currency.js : أسعار العملات + محوّل (كل الحساب في المتصفح من أسعار مقابل USD) */
(function () {
  "use strict";
  var root = document.getElementById("fx");
  if (!root) return;

  var $ = function (id) { return document.getElementById(id); };
  var PIN = ["USD", "EUR", "GBP", "SAR", "AED", "KWD", "CNY", "TRY", "QAR", "JPY", "CHF", "CAD"];
  var CARDS = ["USD", "EUR", "GBP", "SAR", "AED", "KWD", "CNY", "TRY"];
  var QUICK = [["USD", "EGP"], ["EUR", "EGP"], ["EGP", "USD"], ["EGP", "EUR"], ["EUR", "USD"], ["GBP", "EGP"], ["SAR", "EGP"], ["AED", "EGP"]];
  // كود العملة -> كود الدولة (ملف العلم المحلي في static/flags). اللي مالوش علم بيظهر بحرفين.
  var FLAG = {};
  "AED:AE AFN:AF ALL:AL AMD:AM ANG:CW AOA:AO ARS:AR AUD:AU AWG:AW AZN:AZ BAM:BA BBD:BB BDT:BD BGN:BG BHD:BH BIF:BI BMD:BM BND:BN BOB:BO BRL:BR BSD:BS BTN:BT BWP:BW BYN:BY BZD:BZ CAD:CA CDF:CD CHF:CH CLP:CL CNY:CN COP:CO CRC:CR CUP:CU CVE:CV CZK:CZ DJF:DJ DKK:DK DOP:DO DZD:DZ EGP:EG ERN:ER ETB:ET EUR:EU FJD:FJ FKP:FK FOK:FO GBP:GB GEL:GE GGP:GG GHS:GH GIP:GI GMD:GM GNF:GN GTQ:GT GYD:GY HKD:HK HNL:HN HRK:HR HTG:HT HUF:HU IDR:ID ILS:IL IMP:IM INR:IN IQD:IQ IRR:IR ISK:IS JEP:JE JMD:JM JOD:JO JPY:JP KES:KE KGS:KG KHR:KH KID:KI KMF:KM KRW:KR KWD:KW KYD:KY KZT:KZ LAK:LA LBP:LB LKR:LK LRD:LR LSL:LS LYD:LY MAD:MA MDL:MD MGA:MG MKD:MK MMK:MM MNT:MN MOP:MO MRU:MR MUR:MU MVR:MV MWK:MW MXN:MX MYR:MY MZN:MZ NAD:NA NGN:NG NIO:NI NOK:NO NPR:NP NZD:NZ OMR:OM PAB:PA PEN:PE PGK:PG PHP:PH PKR:PK PLN:PL PYG:PY QAR:QA RON:RO RSD:RS RUB:RU RWF:RW SAR:SA SBD:SB SCR:SC SDG:SD SEK:SE SGD:SG SHP:SH SLE:SL SLL:SL SOS:SO SRD:SR SSP:SS STN:ST SYP:SY SZL:SZ THB:TH TJS:TJ TMT:TM TND:TN TOP:TO TRY:TR TTD:TT TVD:TV TWD:TW TZS:TZ UAH:UA UGX:UG USD:US UYU:UY UZS:UZ VES:VE VND:VN VUV:VU WST:WS XPF:PF YER:YE ZAR:ZA ZMW:ZM ZWL:ZW".split(" ").forEach(function (p) { var a = p.split(":"); FLAG[a[0]] = a[1].toLowerCase(); });
  var flagBase = (document.querySelector(".fx-conv") || {}).dataset ? document.querySelector(".fx-conv").dataset.flags : "/static/flags/";

  var amt = $("fxAmt"), ghost = $("fxGhost"), out = $("fxOut"), ghost2 = $("fxGhost2"), sub = $("fxSub"), sub2 = $("fxSub2");
  var pick = { f: $("pickFrom"), t: $("pickTo") }, box = { f: $("boxFrom"), t: $("boxTo") }, symEl = { f: $("symFrom"), t: $("symTo") };
  var pop = $("fxPop"), ps = $("fxPs"), pl = $("fxPl");
  var cards = $("fxCards"), body = $("fxBody"), filter = $("fxFilter"), errBox = $("fxErr"), stamp = $("fxStamp"), btnR = $("fxRefresh");
  var data = null, codes = [], names = null, st = { f: "USD", t: "EGP" }, src = "f", openFor = null, hl = -1;

  try { names = new Intl.DisplayNames(["ar"], { type: "currency" }); } catch (e) { names = null; }
  var OV = { EGP: "الجنيه المصري", GBP: "الجنيه البريطاني", USD: "الدولار الأمريكي", EUR: "اليورو", CAD: "الدولار الكندي", AUD: "الدولار الأسترالي",
    SAR: "الريال السعودي", AED: "الدرهم الإماراتي", KWD: "الدينار الكويتي", CNY: "اليوان الصيني", TRY: "الليرة التركية", QAR: "الريال القطري",
    JPY: "الين الياباني", CHF: "الفرنك السويسري" };
  var nameCache = {};
  function nameOf(c) {
    if (OV[c]) return OV[c];
    if (nameCache[c]) return nameCache[c];
    var n = c;
    try { n = (names && names.of(c)) || c; } catch (e) { n = c; }
    if (n !== c) {                       // نضيف "ال" للتعريف زي الأسماء الشائعة (دينار بحريني → الدينار البحريني)
      var w = n.split(" ");
      if (w.length <= 2 && w[0].indexOf("ال") !== 0) {
        w[0] = "ال" + w[0];
        if (w.length === 2 && /ي$|ية$/.test(w[1]) && w[1].indexOf("ال") !== 0) w[1] = "ال" + w[1];
        n = w.join(" ");
      }
    }
    return (nameCache[c] = n);
  }
  function symOf(c) {
    if (c === "EGP" || c === "GBP") return "£";
    try {
      var p = new Intl.NumberFormat("en", { style: "currency", currency: c, currencyDisplay: "narrowSymbol" }).formatToParts(1)
        .filter(function (x) { return x.type === "currency"; })[0];
      return p ? p.value : c;
    } catch (e) { return c; }
  }

  /* ---------- علم دائري ---------- */
  function flagEl(c) {
    var s = document.createElement("span"); s.className = "flag";
    function txt() { s.className = "flag txt"; s.textContent = c.slice(0, 2); }
    var cc = FLAG[c];
    if (!cc) { txt(); return s; }
    var im = new Image(); im.alt = ""; im.decoding = "async"; im.loading = "lazy";
    im.onerror = function () { im.remove(); txt(); };
    im.src = flagBase + cc + ".svg";
    s.appendChild(im);
    return s;
  }

  /* ---------- تنسيق الأرقام ---------- */
  function money(n) {
    if (!isFinite(n)) return "—";
    var a = Math.abs(n);
    if (a === 0) return "0";
    if (a >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  }
  function rate(n) {
    if (!isFinite(n)) return "—";
    if (n >= 100) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    return n.toLocaleString("en-US", { maximumSignificantDigits: 5 });
  }
  function parseAmount(s) {
    s = String(s || "")
      .replace(/[٠-٩]/g, function (d) { return d.charCodeAt(0) - 1632; })
      .replace(/[۰-۹]/g, function (d) { return d.charCodeAt(0) - 1776; })
      .replace(/[٫]/g, ".").replace(/[,٬،\s]/g, "");
    if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return NaN;
    return parseFloat(s);
  }

  /* ---------- الحساب ---------- */
  function cross(from, to) { return data.rates[to] / data.rates[from]; }          // 1 from = ? to
  function crossPrev(from, to) {
    var p = data.prev;
    return p && p[from] && p[to] ? p[to] / p[from] : null;
  }
  function changePct(from, to) {
    var now = cross(from, to), old = crossPrev(from, to);
    return old ? (now / old - 1) * 100 : null;
  }
  function chgEl(pct) {
    var s = document.createElement("span");
    if (pct === null) { s.className = "fx-chg flat"; s.textContent = "—"; return s; }
    var up = pct > 0.005, down = pct < -0.005;
    s.className = "fx-chg " + (up ? "up" : down ? "down" : "flat");
    s.textContent = (up ? "▲ +" : down ? "▼ " : "• ") + pct.toFixed(2) + "%";
    s.title = "التغير عن آخر يوم محفوظ قبل النهارده";
    return s;
  }

  /* ---------- المحوّل ---------- */
  function save() {
    try { localStorage.setItem("inx.fx", JSON.stringify({ a: amt.value.replace(/,/g, ""), f: st.f, t: st.t })); } catch (e) {}
  }
  function syncGhost() { ghost.textContent = amt.value || "0"; ghost2.textContent = out.value || "0"; }
  // أرقام فقط: بنحوّل الأرقام العربية لإنجليزي، ونسمح بنقطة عشرية واحدة، وأي حرف تاني بيتشال
  function digitsOnly(el) {
    var v = el.value, pos = el.selectionStart, outv = "", dot = false, removed = 0;
    for (var i = 0; i < v.length; i++) {
      var ch = v.charAt(i), code = ch.charCodeAt(0);
      if (code >= 1632 && code <= 1641) ch = String(code - 1632);
      else if (code >= 1776 && code <= 1785) ch = String(code - 1776);
      else if (ch === "٫") ch = ".";
      if (ch >= "0" && ch <= "9") outv += ch;
      else if (ch === "." && !dot) { outv += ch; dot = true; }
      else if (i < pos) removed++;
    }
    if (outv !== v) {
      el.value = outv;
      try { var np = Math.max(0, pos - removed); el.setSelectionRange(np, np); } catch (e) {}
    }
  }
  function convert() {
    if (!data) return;
    symEl.f.textContent = symOf(st.f); symEl.t.textContent = symOf(st.t);
    var r = cross(st.f, st.t);
    var a = src === "f" ? amt : out, b = src === "f" ? out : amt;      // a = الخانة اللي بتكتب فيها، b = الخانة التانية
    var v = parseAmount(a.value);
    if (isNaN(v)) { b.value = ""; }
    else b.value = money(src === "f" ? v * r : v / r);
    syncGhost();
    sub.textContent = "1 " + st.f + " = " + rate(r) + " " + st.t;
    sub2.textContent = "1 " + st.t + " = " + rate(1 / r) + " " + st.f;
    save();
  }
  function paintPick(k) {
    var b = pick[k], c = st[k];
    b.textContent = "";
    b.appendChild(flagEl(c));
    var t = document.createElement("span"); t.className = "pt";
    var bb = document.createElement("b"); bb.textContent = c;
    t.appendChild(bb); t.appendChild(document.createTextNode(" - " + nameOf(c)));
    b.appendChild(t);
    b.insertAdjacentHTML("beforeend", '<svg class="i" aria-hidden="true"><use href="#i-chevron"/></svg>');
    b.disabled = false;
  }
  function paintAll() { paintPick("f"); paintPick("t"); convert(); }
  function setPair(f, t, focus) {
    if (!data || !data.rates[f] || !data.rates[t]) return;
    st.f = f; st.t = t; paintAll();
    if (focus) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- قائمة اختيار العملة ---------- */
  function norm(s) { return String(s || "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").trim(); }
  function items() { return Array.prototype.slice.call(pl.querySelectorAll(".fx-it")); }
  function renderList() {
    var q = norm(ps.value), cur = st[openFor];
    var pinned = ["EGP"].concat(PIN).filter(function (c) { return data.rates[c]; });
    var rest = codes.filter(function (c) { return pinned.indexOf(c) < 0; });
    pl.textContent = ""; hl = -1;
    function match(c) { return !q || c.toLowerCase().indexOf(q) >= 0 || norm(nameOf(c)).indexOf(q) >= 0; }
    function group(title, list) {
      list = list.filter(match);
      if (!list.length) return 0;
      var g = document.createElement("div"); g.className = "fx-gt"; g.textContent = title; g.setAttribute("role", "presentation");
      pl.appendChild(g);
      list.forEach(function (c) {
        var it = document.createElement("div"); it.className = "fx-it" + (c === cur ? " sel" : "");
        it.setAttribute("role", "option"); it.setAttribute("aria-selected", c === cur ? "true" : "false"); it.dataset.c = c;
        it.appendChild(flagEl(c));
        var b = document.createElement("b"); b.textContent = c; it.appendChild(b);
        var n = document.createElement("span"); n.className = "n"; n.textContent = nameOf(c); it.appendChild(n);
        it.insertAdjacentHTML("beforeend", '<svg class="i" aria-hidden="true"><use href="#i-check"/></svg>');
        pl.appendChild(it);
      });
      return list.length;
    }
    var n = group("شائع", pinned) + group("جميع العملات", rest);
    if (!n) { var e = document.createElement("div"); e.className = "fx-none"; e.textContent = "مفيش عملة بالاسم ده"; pl.appendChild(e); }
    else if (q) setHl(0);
  }
  function setHl(i) {
    var its = items(); if (!its.length) return;
    hl = (i + its.length) % its.length;
    its.forEach(function (x, k) { x.classList.toggle("hl", k === hl); });
    its[hl].scrollIntoView({ block: "nearest" });
  }
  function openPick(k) {
    if (!data) return;
    if (openFor === k) { closePick(); return; }
    closePick();
    openFor = k;
    var bx = box[k];
    bx.classList.add("open"); pick[k].setAttribute("aria-expanded", "true");
    pop.classList.toggle("at-from", k === "f"); pop.classList.toggle("at-to", k === "t");
    pop.style.top = (bx.offsetTop + bx.offsetHeight + 6) + "px";
    ps.value = ""; renderList(); pop.hidden = false;
    var sel = pl.querySelector(".sel");
    if (sel) pl.scrollTop = Math.max(0, sel.offsetTop - pl.clientHeight / 2 + sel.offsetHeight / 2);
    ps.focus({ preventScroll: true });
  }
  function closePick(refocus) {
    if (!openFor) return;
    box[openFor].classList.remove("open"); pick[openFor].setAttribute("aria-expanded", "false");
    if (refocus) pick[openFor].focus();
    openFor = null; pop.hidden = true;
  }
  function choose(c) {
    if (!openFor || !c) return;
    var k = openFor, other = k === "f" ? "t" : "f";
    if (c === st[other]) st[other] = st[k];      // اختار نفس عملة الخانة التانية: بدّلهم
    st[k] = c;
    closePick(true); paintAll();
  }
  pick.f.addEventListener("click", function () { openPick("f"); });
  pick.t.addEventListener("click", function () { openPick("t"); });
  ps.addEventListener("input", renderList);
  ps.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHl(hl + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHl(hl - 1); }
    else if (e.key === "Enter") { e.preventDefault(); var its = items(); if (its[hl < 0 ? 0 : hl]) choose(its[hl < 0 ? 0 : hl].dataset.c); }
    else if (e.key === "Escape") { e.preventDefault(); closePick(true); }
    else if (e.key === "Tab") closePick();
  });
  pl.addEventListener("click", function (e) {
    var it = e.target.closest ? e.target.closest(".fx-it") : null;
    if (it) choose(it.dataset.c);
  });
  document.addEventListener("mousedown", function (e) {
    if (openFor && !pop.contains(e.target) && !pick[openFor].contains(e.target)) closePick();
  });

  /* ---------- الكروت ---------- */
  function renderCards() {
    cards.textContent = "";
    CARDS.forEach(function (c) {
      if (!data.rates[c] || !data.rates.EGP) return;
      var b = document.createElement("button");
      b.type = "button"; b.className = "fx-card";
      b.setAttribute("aria-label", "تحويل " + nameOf(c) + " إلى جنيه");
      var top = document.createElement("div"); top.className = "top";
      var code = document.createElement("span"); code.className = "fx-code"; code.textContent = c;
      var nm = document.createElement("span"); nm.className = "nm"; nm.textContent = nameOf(c);
      top.appendChild(flagEl(c)); top.appendChild(code); top.appendChild(nm);
      var val = document.createElement("div"); val.className = "val";
      val.textContent = rate(cross(c, "EGP"));
      var sm = document.createElement("small"); sm.textContent = "EGP"; val.appendChild(sm);
      var inv = document.createElement("div"); inv.className = "inv";
      inv.textContent = "1 EGP = " + rate(cross("EGP", c)) + " " + c;
      b.appendChild(top); b.appendChild(val); b.appendChild(inv);
      b.appendChild(chgEl(changePct(c, "EGP")));
      b.addEventListener("click", function () { setPair(c, "EGP", true); });
      cards.appendChild(b);
    });
  }

  /* ---------- الجدول ---------- */
  function renderTable() {
    var q = norm(filter.value);
    body.textContent = "";
    var list = codes.filter(function (c) { return c !== "EGP"; });
    var pinned = PIN.filter(function (c) { return list.indexOf(c) >= 0; });
    var rest = list.filter(function (c) { return pinned.indexOf(c) < 0; })
      .sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b), "ar"); });
    var shown = 0;
    pinned.concat(rest).forEach(function (c) {
      var n = nameOf(c);
      if (q && norm(n).indexOf(q) < 0 && c.toLowerCase().indexOf(q) < 0) return;
      var tr = document.createElement("tr");
      if (pinned.indexOf(c) >= 0) tr.className = "pin";
      function td(t, cls) { var d = document.createElement("td"); d.textContent = t; if (cls) d.className = cls; tr.appendChild(d); return d; }
      var first = td(n); first.insertBefore(flagEl(c), first.firstChild);
      td(c, "num");
      td(rate(cross(c, "EGP")), "num");
      td(rate(cross("EGP", c)), "num hide-sm");
      var tc = document.createElement("td"); tc.appendChild(chgEl(changePct(c, "EGP"))); tr.appendChild(tc);
      tr.addEventListener("click", function () { setPair(c, "EGP", true); });
      body.appendChild(tr); shown++;
    });
    if (!shown) {
      var tr = document.createElement("tr"), d = document.createElement("td");
      d.colSpan = 5; d.className = "fx-empty"; d.textContent = "مفيش عملة بالاسم ده";
      tr.appendChild(d); body.appendChild(tr);
    }
  }

  function renderQuick() {
    var qb = $("fxQuick"); qb.textContent = "";
    QUICK.forEach(function (p) {
      if (!data.rates[p[0]] || !data.rates[p[1]]) return;
      var b = document.createElement("button"); b.type = "button";
      b.textContent = p[0] + " → " + p[1];
      b.addEventListener("click", function () { setPair(p[0], p[1], false); });
      qb.appendChild(b);
    });
  }

  /* ---------- التحميل ---------- */
  function showErr(msg, kind) {
    errBox.className = "ip-status " + (kind || "err");
    errBox.textContent = msg; errBox.hidden = !msg;
  }
  function when(ts) {
    return new Date(ts * 1000).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function apply(j) {
    var first = !data;
    data = j;
    codes = Object.keys(j.rates).filter(function (c) { return j.rates[c] > 0; })
      .sort(function (a, b) { return a < b ? -1 : 1; });
    if (!j.rates.EGP) { showErr("الجنيه المصري غير متاح في بيانات المصدر حاليًا"); return; }
    if (first) {
      var s = {};
      try { s = JSON.parse(localStorage.getItem("inx.fx") || "{}"); } catch (e) {}
      st.f = j.rates[s.f] ? s.f : "USD";
      st.t = j.rates[s.t] ? s.t : "EGP";
      if (st.f === st.t) st.t = st.f === "EGP" ? "USD" : "EGP";
      if (s.a) amt.value = s.a;
      digitsOnly(amt); src = "f"; renderQuick();
    }
    renderCards(); renderTable(); paintAll();
    stamp.textContent = "آخر تحديث للأسعار: " + when(j.src_ts || j.fetched);
    $("fxSrc").textContent = j.source ? "المصدر: " + j.source + "." : "";
    showErr(j.stale ? "الأسعار المعروضة قديمة (آخر تحديث " + when(j.fetched) + ") لأن السيرفر مش قادر يوصل للمصدر حاليًا." : "", "warn");
  }
  function load(force) {
    btnR.classList.add("loading");
    return fetch(root.dataset.api + (force ? "?force=1" : ""), { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (o) {
        if (!o.ok) { showErr(o.j && o.j.error || "تعذّر جلب الأسعار"); if (!data) stamp.textContent = "غير متاح"; return; }
        apply(o.j);
        if (force && window.INX) window.INX.toast("تم تحديث الأسعار", "ok");
      })
      .catch(function () {
        showErr("تعذّر الاتصال بالسيرفر — تأكد من الاتصال وحاول مرة أخرى");
        if (!data) stamp.textContent = "غير متاح";
      })
      .then(function () { btnR.classList.remove("loading"); });
  }

  /* ---------- الأحداث ---------- */
  amt.addEventListener("input", function () { digitsOnly(amt); src = "f"; convert(); });
  out.addEventListener("input", function () { digitsOnly(out); src = "t"; convert(); });
  amt.addEventListener("focus", function () { amt.select(); });
  out.addEventListener("focus", function () { out.select(); });
  // الضغط على أي مكان فاضي في الخانة يفتح الكتابة
  [[box.f, amt], [box.t, out]].forEach(function (p) {
    p[0].addEventListener("mousedown", function (e) {
      if (e.target.closest && (e.target.closest(".fx-pick") || e.target === p[1])) return;
      e.preventDefault(); p[1].focus();
    });
  });
  $("fxSwap").addEventListener("click", function (e) {
    var f = st.f; st.f = st.t; st.t = f; src = "f"; paintAll();
    e.currentTarget.classList.toggle("spin");
  });
  filter.addEventListener("input", function () { if (data) renderTable(); });
  btnR.addEventListener("click", function () { load(true); });

  // skeleton للكروت لحد ما الأسعار توصل
  for (var i = 0; i < 4; i++) { var sk = document.createElement("div"); sk.className = "fx-skel"; cards.appendChild(sk); }

  load(false);
  setInterval(function () { if (!document.hidden) load(false); }, 10 * 60 * 1000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && data && Date.now() / 1000 - data.fetched > 900) load(false);
  });
})();
