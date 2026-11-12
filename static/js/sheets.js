/* INX — sheets.js : واجهة جدول Excel (شبكة افتراضية + تحديد + تحرير + تنسيق + حفظ تلقائي) */
(function () {
  "use strict";
  var X = window.XLF;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var root = $("#xl");
  if (!root || !X) return;

  var RH = 26, HDR_H = 26, HDR_W = 50, DEF_W = 110, MIN_W = 36, MAX_ROWS = 5000, MAX_COLS = 100;
  var RO = root.dataset.readonly === "1";
  var book = JSON.parse($("#wbdata").textContent);
  var version = parseInt(root.dataset.version, 10) || 1;
  var wrap = $("#xlWrap"), inner = $("#xlInner"), colhead = $("#xlCols"), frozenBox = $("#xlFrozen"), rowsBox = $("#xlRows"),
      selBox = $("#xlSel"), actBox = $("#xlAct"), fillH = $("#xlFill"), ed = $("#xlEd"), fx = $("#xlFx"), nameBox = $("#xlName"),
      stat = $("#xlStat"), statusEl = $("#xlSave"), titleEl = $("#xlTitle"), tabsEl = $("#xlTabs"), hint = $("#xlHint"), menu = $("#xlMenu"), pal = $("#xlPal");

  /* ---------- state ---------- */
  var cur = Math.min(book.active || 0, book.sheets.length - 1);
  var act = { r: 0, c: 0 }, ext = { r: 0, c: 0 };
  var editing = null;           // {mode:"enter"|"edit", r, c, orig}
  var ctx = null, colX = [], totalW = 0;
  var clip = null, undoSt = [], redoSt = [], txn = null;
  var win = { a: -1, b: -1, c0: -1, c1: -1 };
  var dirty = false, saving = false, saveTimer = null, state = "saved";

  function S() { return book.sheets[cur]; }
  /* اتجاه الورقة: عربي (من اليمين لليسار) هو الافتراضي */
  function rtl() { return S().rtl !== 0; }
  function sgn() { return rtl() ? -1 : 1; }
  function side() { return rtl() ? "right:" : "left:"; }
  function getSx() { return rtl() ? Math.abs(wrap.scrollLeft) : wrap.scrollLeft; }
  function setSx(v) { wrap.scrollLeft = rtl() ? -v : v; }
  function cellAt(r, c) { return S().cells[X.refOf(r, c)]; }
  function clone(o) { return o ? JSON.parse(JSON.stringify(o)) : o; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function colW(c) { var w = S().colw[c]; return w ? w : DEF_W; }
  function invalidate() { ctx = X.makeCtx(book); }
  function val(r, c) { if (!ctx) invalidate(); return X.evaluate(ctx, cur, r, c); }
  function sel() { return { r1: Math.min(act.r, ext.r), r2: Math.max(act.r, ext.r), c1: Math.min(act.c, ext.c), c2: Math.max(act.c, ext.c) }; }

  /* ---------- layout ---------- */
  function metrics() {
    var sh = S(), x = 0; colX = [];
    for (var c = 0; c < sh.cols; c++) { colX.push(x); x += colW(c); }
    totalW = x;
    root.classList.toggle("rtl", rtl());
    var rb = $('[data-act="rtl"]', root); if (rb) rb.classList.toggle("on", rtl());
    inner.style.width = (HDR_W + totalW + 60) + "px";
    inner.style.height = (HDR_H + sh.rows * RH + 40) + "px";
    colhead.style.width = (HDR_W + totalW) + "px";
    var h = '<div class="xl-corner" id="xlCorner"></div>';
    for (c = 0; c < sh.cols; c++) h += '<div class="xl-ch" data-c="' + c + '" style="' + side() + (HDR_W + colX[c]) + "px;width:" + colW(c) + 'px">' + X.colLetter(c) + '<i class="xl-rz" data-c="' + c + '"></i></div>';
    colhead.innerHTML = h;
    frozenBox.style.display = sh.freeze ? "block" : "none";
    frozenBox.style.width = (HDR_W + totalW) + "px";
    win.a = -1;
    renderRows(true);
    drawSel();
  }
  function colAtX(x) { // x نسبةً لبداية الأعمدة
    var lo = 0, hi = colX.length - 1;
    while (lo < hi) { var m = (lo + hi + 1) >> 1; if (colX[m] <= x) lo = m; else hi = m - 1; }
    return lo;
  }
  function visibleRange() {
    var sh = S(), top = wrap.scrollTop, h = wrap.clientHeight, left = getSx(), w = wrap.clientWidth;
    var a = Math.max(0, Math.floor((top - HDR_H) / RH) - 8), b = Math.min(sh.rows - 1, Math.ceil((top + h - HDR_H) / RH) + 8);
    var c0 = Math.max(0, colAtX(Math.max(0, left - HDR_W)) - 2), c1 = Math.min(sh.cols - 1, colAtX(Math.max(0, left + w - HDR_W)) + 2);
    return { a: a, b: b, c0: c0, c1: c1 };
  }
  function cellHtml(r, c) {
    var cell = cellAt(r, c), st = (cell && cell.s) || {}, v = cell && cell.r !== undefined && cell.r !== "" ? val(r, c) : null;
    var txt = X.format(v, st.nf), cls = "xl-c", sty = side() + (HDR_W + colX[c]) + "px;width:" + colW(c) + "px;";
    if (typeof v === "number") cls += " num"; else if (X.isErr(v)) cls += " err"; else if (typeof v === "boolean") cls += " bool";
    if (st.b) sty += "font-weight:800;"; if (st.i) sty += "font-style:italic;";
    if (st.al) sty += "text-align:" + { l: "left", c: "center", r: "right" }[st.al] + ";";
    if (st.bg) sty += "background:" + st.bg + ";"; if (st.fg) sty += "color:" + st.fg + ";";
    if (st.bd) cls += " bd";
    return '<div class="' + cls + '" dir="auto" style="' + sty + '">' + esc(txt) + "</div>";
  }
  function rowHtml(r, frozen) {
    var h = '<div class="xl-row' + (frozen ? " fz" : "") + '" data-r="' + r + '" style="' + (frozen ? "" : "top:" + (HDR_H + r * RH) + "px;") + 'width:' + (HDR_W + totalW) + 'px"><div class="xl-rh" data-r="' + r + '">' + (r + 1) + "</div>";
    for (var c = win.c0; c <= win.c1; c++) h += cellHtml(r, c);
    return h + "</div>";
  }
  function renderRows(force) {
    var v = visibleRange();
    if (!force && v.a === win.a && v.b === win.b && v.c0 === win.c0 && v.c1 === win.c1) return;
    win = v; if (!ctx) invalidate();
    var h = "", sh = S();
    for (var r = v.a; r <= v.b; r++) { if (sh.freeze && r === 0) continue; h += rowHtml(r, false); }
    rowsBox.innerHTML = h;
    frozenBox.innerHTML = sh.freeze ? rowHtml(0, true) : "";
    updateStats();
  }
  function refresh() { invalidate(); renderRows(true); updateStats(); }

  /* ---------- selection drawing ---------- */
  function rect(r1, c1, r2, c2) {
    return { l: HDR_W + colX[c1], t: HDR_H + r1 * RH, w: colX[c2] + colW(c2) - colX[c1], h: (r2 - r1 + 1) * RH };
  }
  function drawSel() {
    var s = sel(), R = rect(s.r1, s.c1, s.r2, s.c2), A = rect(act.r, act.c, act.r, act.c);
    var single = s.r1 === s.r2 && s.c1 === s.c2;
    selBox.style.cssText = side() + R.l + "px;top:" + R.t + "px;width:" + R.w + "px;height:" + R.h + "px;display:" + (single ? "none" : "block");
    actBox.style.cssText = side() + A.l + "px;top:" + A.t + "px;width:" + A.w + "px;height:" + A.h + "px";
    fillH.style.cssText = side() + (R.l + R.w - 5) + "px;top:" + (R.t + R.h - 5) + "px;display:" + (RO ? "none" : "block");
    nameBox.value = single ? X.refOf(act.r, act.c) : X.refOf(s.r1, s.c1) + ":" + X.refOf(s.r2, s.c2);
    if (!editing) { var c = cellAt(act.r, act.c); fx.value = c && c.r !== undefined ? c.r : ""; }
    syncTools(); updateStats();
    $$(".xl-ch.on, .xl-rh.on", root).forEach(function (e) { e.classList.remove("on"); });
    for (var cc = s.c1; cc <= s.c2 && cc - s.c1 < 120; cc++) { var e = $('.xl-ch[data-c="' + cc + '"]', colhead); if (e) e.classList.add("on"); }
    for (var rr = s.r1; rr <= s.r2 && rr - s.r1 < 200; rr++) { var e2 = $('.xl-rh[data-r="' + rr + '"]', root); if (e2) e2.classList.add("on"); }
  }
  function ensureVisible(r, c) {
    var sh = S(), top = HDR_H + r * RH + (sh.freeze && r > 0 ? RH : 0), bot = HDR_H + (r + 1) * RH, l = HDR_W + colX[c], rr = l + colW(c);
    var vt = wrap.scrollTop + HDR_H + (sh.freeze ? RH : 0), vb = wrap.scrollTop + wrap.clientHeight - 14;
    if (top < vt) wrap.scrollTop = top - HDR_H - (sh.freeze ? RH : 0); else if (bot > vb) wrap.scrollTop = bot - wrap.clientHeight + 16;
    var sx = getSx(), vl = sx + HDR_W, vr = sx + wrap.clientWidth - 14;
    if (l < vl) setSx(l - HDR_W); else if (rr > vr) setSx(rr - wrap.clientWidth + 16);
  }
  function setAct(r, c, extend, noScroll) {
    var sh = S();
    if (r >= sh.rows && sh.rows < MAX_ROWS && !extend) { growRows(Math.min(50, MAX_ROWS - sh.rows)); }
    r = Math.max(0, Math.min(r, sh.rows - 1)); c = Math.max(0, Math.min(c, sh.cols - 1));
    if (extend) { ext = { r: r, c: c }; } else { act = { r: r, c: c }; ext = { r: r, c: c }; }
    if (!noScroll) ensureVisible(extend ? ext.r : r, extend ? ext.c : c);
    renderRows(); drawSel();
  }
  function growRows(n) { S().rows += n; metrics(); markDirty(); }

  /* ---------- history ---------- */
  function begin() { txn = { sh: cur, ch: {}, snap: null }; }
  function put(ref, cell) {
    var sh = S(); if (!(ref in txn.ch)) txn.ch[ref] = [clone(sh.cells[ref] || null), null];
    if (cell && (cell.r !== undefined && cell.r !== "" || (cell.s && Object.keys(cell.s).length))) sh.cells[ref] = cell; else delete sh.cells[ref];
  }
  function end() {
    var t = txn; txn = null; if (!t) return;
    if (t.snap) { t.snap[1] = clone(pick(S())); undoSt.push(t); }
    else {
      var any = false;
      Object.keys(t.ch).forEach(function (ref) { var a = clone(S().cells[ref] || null); t.ch[ref][1] = a; if (JSON.stringify(a) !== JSON.stringify(t.ch[ref][0])) any = true; else delete t.ch[ref]; });
      if (!any) return; undoSt.push(t);
    }
    if (undoSt.length > 60) undoSt.shift(); redoSt = []; markDirty(); refresh(); syncTools();
  }
  function pick(sh) { return { rows: sh.rows, cols: sh.cols, cells: sh.cells, colw: sh.colw, freeze: sh.freeze }; }
  function snapshot() { txn = { sh: cur, ch: {}, snap: [clone(pick(S())), null] }; }
  function applyHist(t, dir) {
    if (t.sh !== cur) { cur = t.sh; buildTabs(); }
    var sh = S();
    if (t.snap) { var p = clone(t.snap[dir]); sh.rows = p.rows; sh.cols = p.cols; sh.cells = p.cells; sh.colw = p.colw; sh.freeze = p.freeze; }
    else Object.keys(t.ch).forEach(function (ref) { var v = clone(t.ch[ref][dir]); if (v) sh.cells[ref] = v; else delete sh.cells[ref]; });
    markDirty(); invalidate(); metrics(); syncTools();
  }
  function undo() { if (editing) return; var t = undoSt.pop(); if (!t) return; applyHist(t, 0); redoSt.push(t); }
  function redo() { if (editing) return; var t = redoSt.pop(); if (!t) return; applyHist(t, 1); undoSt.push(t); }

  /* ---------- cell edit ---------- */
  function setRaw(r, c, text) {
    var ref = X.refOf(r, c), old = S().cells[ref], cell = old ? clone(old) : {};
    text = String(text);
    if (text === "") delete cell.r; else cell.r = text;
    put(ref, cell);
  }
  function editRect() { var A = rect(act.r, act.c, act.r, act.c); return A; }
  function startEdit(mode, init) {
    if (RO || editing) return;
    var c = cellAt(act.r, act.c), raw = c && c.r !== undefined ? c.r : "";
    editing = { mode: mode, r: act.r, c: act.c, orig: raw };
    var A = editRect();
    ed.classList.add("on");
    ed.style.cssText = side() + A.l + "px;top:" + A.t + "px;min-width:" + A.w + "px;height:" + A.h + "px";
    ed.value = init !== undefined ? init : raw; fx.value = ed.value;
    sizeEd(); ed.focus();
    if (init === undefined) ed.setSelectionRange(ed.value.length, ed.value.length);
    hintUpdate();
  }
  function sizeEd() { ed.style.width = "auto"; ed.style.width = Math.max(ed.scrollWidth + 12, parseInt(ed.style.minWidth, 10) || 0) + "px"; }
  function commit(dr, dc) {
    if (!editing) return;
    var e = editing; editing = null; ed.classList.remove("on"); hint.hidden = true;
    var text = ed.value; ed.value = "";
    if (text !== e.orig) { begin(); setRaw(e.r, e.c, text); end(); }
    wrap.focus({ preventScroll: true }); ed.focus({ preventScroll: true });
    if (dr || dc) setAct(act.r + dr, act.c + dc); else drawSel();
  }
  function cancel() {
    if (!editing) return; editing = null; ed.classList.remove("on"); ed.value = ""; hint.hidden = true;
    ed.focus({ preventScroll: true }); drawSel();
  }
  ed.addEventListener("input", function () {
    if (RO) { ed.value = ""; return; }
    if (!editing) startEdit("enter", ed.value);
    fx.value = ed.value; sizeEd(); hintUpdate();
  });
  fx.addEventListener("focus", function () { if (!RO && !editing) { startEdit("edit"); fx.focus(); } });
  fx.addEventListener("input", function () { if (editing) { ed.value = fx.value; sizeEd(); hintUpdate(); } });
  fx.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); commit(1, 0); } else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
  fx.readOnly = RO;

  /* function-name hints */
  function hintUpdate() {
    var t = ed.value, m = /([A-Za-z]{1,12})$/.exec(t.slice(0, ed.selectionStart || t.length));
    if (!editing || t.charAt(0) !== "=" || !m) { hint.hidden = true; return; }
    var q = m[1].toUpperCase(), list = X.FN_NAMES.filter(function (f) { return f.indexOf(q) === 0 && f !== q; }).sort(function (a, b) { return a.length - b.length || (a < b ? -1 : 1); }).slice(0, 6);
    if (!list.length) { hint.hidden = true; return; }
    hint.innerHTML = list.map(function (f, i) { return '<button type="button" class="' + (i ? "" : "on") + '" data-f="' + f + '">' + f + "</button>"; }).join("") + "<small>Tab للإكمال</small>";
    var A = editRect(); hint.style.left = hint.style.right = ""; hint.style[rtl() ? "right" : "left"] = A.l + "px"; hint.style.top = (A.t + A.h + 2) + "px"; hint.hidden = false; hint._q = q;
  }
  function acceptHint(f) {
    var pos = ed.selectionStart, t = ed.value, m = /([A-Za-z]{1,12})$/.exec(t.slice(0, pos));
    ed.value = t.slice(0, pos - m[1].length) + f + "(" + t.slice(pos); var p = pos - m[1].length + f.length + 1; ed.setSelectionRange(p, p);
    fx.value = ed.value; hint.hidden = true; sizeEd();
  }
  hint.addEventListener("mousedown", function (e) { var b = e.target.closest("button"); if (b) { e.preventDefault(); acceptHint(b.dataset.f); ed.focus(); } });

  /* ---------- clipboard ---------- */
  function tsvOf(s) {
    var rows = [];
    for (var r = s.r1; r <= s.r2; r++) { var row = []; for (var c = s.c1; c <= s.c2; c++) { var cell = cellAt(r, c), v = cell && cell.r !== undefined && cell.r !== "" ? val(r, c) : null; var t = X.format(v, cell && cell.s && cell.s.nf); row.push(/[\t\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t); } rows.push(row.join("\t")); }
    return rows.join("\n");
  }
  function copySel(cut, e) {
    var s = sel(), cells = [];
    for (var r = s.r1; r <= s.r2; r++) { var row = []; for (var c = s.c1; c <= s.c2; c++) row.push(clone(cellAt(r, c) || null)); cells.push(row); }
    clip = { cells: cells, r0: s.r1, c0: s.c1, cut: !!cut, sh: cur, text: tsvOf(s) };
    if (e && e.clipboardData) { e.clipboardData.setData("text/plain", clip.text); e.preventDefault(); }
    else if (navigator.clipboard) navigator.clipboard.writeText(clip.text).catch(function () {});
    if (cut && !RO) { begin(); for (var rr = s.r1; rr <= s.r2; rr++) for (var cc = s.c1; cc <= s.c2; cc++) put(X.refOf(rr, cc), null); end(); }
    toast(cut ? "تم القص" : "تم النسخ");
  }
  function parseTsv(t) {
    var rows = [], row = [], f = "", q = false, i = 0;
    for (; i < t.length; i++) {
      var ch = t.charAt(i);
      if (q) { if (ch === '"') { if (t.charAt(i + 1) === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"' && f === "") q = true;
      else if (ch === "\t") { row.push(f); f = ""; }
      else if (ch === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
      else if (ch !== "\r") f += ch;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function pasteText(text) {
    if (RO) return;
    var s = sel(), r0 = s.r1, c0 = s.c1;
    begin();
    if (clip && clip.text.replace(/\r/g, "") === text.replace(/\r/g, "").replace(/\n$/, "")) {
      var h = clip.cells.length, w = clip.cells[0].length;
      var tr = (s.r2 - s.r1 + 1 > h || s.c2 - s.c1 + 1 > w) ? s.r2 - s.r1 + 1 : h, tc = (s.r2 - s.r1 + 1 > h || s.c2 - s.c1 + 1 > w) ? s.c2 - s.c1 + 1 : w;
      for (var i = 0; i < tr; i++) for (var j = 0; j < tc; j++) {
        var src = clip.cells[i % h][j % w], rr = r0 + i, cc = c0 + j; if (rr >= S().rows || cc >= S().cols) continue;
        var nc = src ? clone(src) : null;
        if (nc && nc.r && String(nc.r).charAt(0) === "=") nc.r = X.shiftRel(nc.r, rr - (clip.r0 + (i % h)), cc - (clip.c0 + (j % w)));
        put(X.refOf(rr, cc), nc);
      }
      if (clip.cut) { clip = null; }
      ext = { r: Math.min(r0 + tr - 1, S().rows - 1), c: Math.min(c0 + tc - 1, S().cols - 1) };
    } else {
      var rows = parseTsv(text.replace(/\n$/, ""));
      if (r0 + rows.length > S().rows) { S().rows = Math.min(MAX_ROWS, r0 + rows.length + 20); }
      rows.forEach(function (row, i) { row.forEach(function (v, j) { if (r0 + i < S().rows && c0 + j < S().cols) { var old = cellAt(r0 + i, c0 + j), nc = old ? clone(old) : {}; if (v === "") delete nc.r; else nc.r = v; put(X.refOf(r0 + i, c0 + j), nc); } }); });
      ext = { r: Math.min(r0 + rows.length - 1, S().rows - 1), c: Math.min(c0 + (rows[0] || []).length - 1, S().cols - 1) };
    }
    end(); metrics(); drawSel();
  }

  /* ---------- fill / series ---------- */
  function fill(s, tr, tc) {
    if (RO) return; var down = tr > s.r2, up = tr < s.r1, right = tc > s.c2, left = tc < s.c1;
    begin();
    if (down || up) {
      var n = s.r2 - s.r1 + 1;
      for (var c = s.c1; c <= s.c2; c++) {
        var src = []; for (var r = s.r1; r <= s.r2; r++) src.push(cellAt(r, c));
        var nums = src.map(function (x) { return x && X.parseNum(x.r); }), series = n >= 2 && nums.every(function (x) { return typeof x === "number"; });
        var step = series ? (nums[n - 1] - nums[0]) / (n - 1) : 0;
        var from = down ? s.r2 + 1 : tr, to = down ? tr : s.r1 - 1;
        for (var rr = from; rr <= to; rr++) {
          var k = down ? rr - s.r1 : s.r2 - rr, sc = src[((k % n) + n) % n], nc = sc ? clone(sc) : null;
          if (nc && series && !down) nc.r = String(nums[0] - step * (s.r1 - rr));
          else if (nc && series) nc.r = String(nums[0] + step * (rr - s.r1));
          else if (nc && nc.r && String(nc.r).charAt(0) === "=") nc.r = X.shiftRel(nc.r, rr - (s.r1 + (((k % n) + n) % n)), 0);
          put(X.refOf(rr, c), nc);
        }
      }
    } else if (right || left) {
      var m = s.c2 - s.c1 + 1;
      for (var r2 = s.r1; r2 <= s.r2; r2++) {
        var src2 = []; for (var c2 = s.c1; c2 <= s.c2; c2++) src2.push(cellAt(r2, c2));
        var nums2 = src2.map(function (x) { return x && X.parseNum(x.r); }), ser = m >= 2 && nums2.every(function (x) { return typeof x === "number"; });
        var st = ser ? (nums2[m - 1] - nums2[0]) / (m - 1) : 0, f2 = right ? s.c2 + 1 : tc, t2 = right ? tc : s.c1 - 1;
        for (var cc = f2; cc <= t2; cc++) {
          var kk = right ? cc - s.c1 : s.c2 - cc, sc2 = src2[((kk % m) + m) % m], n2 = sc2 ? clone(sc2) : null;
          if (n2 && ser) n2.r = String(nums2[0] + st * (right ? cc - s.c1 : -(s.c1 - cc)));
          else if (n2 && n2.r && String(n2.r).charAt(0) === "=") n2.r = X.shiftRel(n2.r, 0, cc - (s.c1 + (((kk % m) + m) % m)));
          put(X.refOf(r2, cc), n2);
        }
      }
    }
    end();
    if (down || up) { act = { r: Math.min(s.r1, tr), c: s.c1 }; ext = { r: Math.max(s.r2, tr), c: s.c2 }; }
    else { act = { r: s.r1, c: Math.min(s.c1, tc) }; ext = { r: s.r2, c: Math.max(s.c2, tc) }; }
    drawSel();
  }
  function fillDirection(dir) { var s = sel(); if (dir === "d") { if (s.r1 === s.r2) return; var a = { r1: s.r1, r2: s.r1, c1: s.c1, c2: s.c2 }; fillSimple(a, s.r2, null); } else { if (s.c1 === s.c2) return; fillSimple({ r1: s.r1, r2: s.r2, c1: s.c1, c2: s.c1 }, null, s.c2); } }
  function fillSimple(a, tr, tc) {
    begin();
    if (tr !== null) for (var c = a.c1; c <= a.c2; c++) { var sc = cellAt(a.r1, c); for (var r = a.r1 + 1; r <= tr; r++) { var nc = sc ? clone(sc) : null; if (nc && nc.r && String(nc.r).charAt(0) === "=") nc.r = X.shiftRel(nc.r, r - a.r1, 0); put(X.refOf(r, c), nc); } }
    else for (var r2 = a.r1; r2 <= a.r2; r2++) { var s2 = cellAt(r2, a.c1); for (var c2 = a.c1 + 1; c2 <= tc; c2++) { var n2 = s2 ? clone(s2) : null; if (n2 && n2.r && String(n2.r).charAt(0) === "=") n2.r = X.shiftRel(n2.r, 0, c2 - a.c1); put(X.refOf(r2, c2), n2); } }
    end();
  }

  /* ---------- formatting ---------- */
  function applyStyle(fn) {
    if (RO) return; var s = sel(); begin();
    for (var r = s.r1; r <= s.r2; r++) for (var c = s.c1; c <= s.c2; c++) {
      var ref = X.refOf(r, c), old = S().cells[ref], cell = old ? clone(old) : {}; cell.s = cell.s || {}; fn(cell.s, cell);
      Object.keys(cell.s).forEach(function (k) { if (!cell.s[k]) delete cell.s[k]; });
      put(ref, cell);
    }
    end();
  }
  function toggle(key) { var c = cellAt(act.r, act.c), on = c && c.s && c.s[key]; applyStyle(function (st) { st[key] = on ? 0 : 1; }); }
  function syncTools() {
    var c = cellAt(act.r, act.c), st = (c && c.s) || {};
    $$("[data-fmt]", root).forEach(function (b) {
      var k = b.dataset.fmt, v = b.dataset.val;
      b.classList.toggle("on", k === "al" ? st.al === v : !!st[k]);
    });
    var nf = $("#xlNf"); if (nf) nf.value = st.nf || "";
    $("#xlUndo").disabled = !undoSt.length; $("#xlRedo").disabled = !redoSt.length;
    var sw = $("#xlFgSw"), sb = $("#xlBgSw"); if (sw) sw.style.background = st.fg || "#000"; if (sb) sb.style.background = st.bg || "transparent";
    $("[data-act=freeze]", root).classList.toggle("on", !!S().freeze);
  }

  /* ---------- structure ---------- */
  function remapSheet(axis, at, delta) {
    var sh = S(), name = sh.name, out = {};
    Object.keys(sh.cells).forEach(function (ref) {
      var m = /^([A-Z]+)(\d+)$/.exec(ref), c = X.colIndex(m[1]), r = +m[2] - 1, i = axis === "r" ? r : c, k = -delta;
      if (delta < 0 && i >= at && i < at + k) return;
      if (i >= at) i += delta;
      var nr = axis === "r" ? i : r, nc = axis === "c" ? i : c;
      out[X.refOf(nr, nc)] = sh.cells[ref];
    });
    sh.cells = out;
    book.sheets.forEach(function (s2) {
      Object.keys(s2.cells).forEach(function (ref) { var cl = s2.cells[ref]; if (cl.r && String(cl.r).charAt(0) === "=") cl.r = X.adjust(cl.r, s2.name, name, axis, at, delta); });
    });
    if (axis === "r") sh.rows = Math.max(1, Math.min(MAX_ROWS, sh.rows + delta));
    else {
      sh.cols = Math.max(1, Math.min(MAX_COLS, sh.cols + delta));
      var cw = {}; Object.keys(sh.colw).forEach(function (k) { k = +k; if (delta < 0 && k >= at && k < at - delta) return; cw[k >= at ? k + delta : k] = sh.colw[k]; }); sh.colw = cw;
    }
  }
  function structure(axis, where, count) {
    if (RO) return; var s = sel(), n = count || (axis === "r" ? s.r2 - s.r1 + 1 : s.c2 - s.c1 + 1), at;
    if (where === "del") at = axis === "r" ? s.r1 : s.c1; else at = where === "before" ? (axis === "r" ? s.r1 : s.c1) : (axis === "r" ? s.r2 + 1 : s.c2 + 1);
    var delta = where === "del" ? -n : n;
    if (axis === "r" && S().rows + delta > MAX_ROWS || axis === "c" && S().cols + delta > MAX_COLS) return toast("وصلت للحد الأقصى", "error");
    snapshot(); remapSheet(axis, at, delta); end(); invalidate(); metrics(); drawSel();
  }
  function sortSel(asc) {
    if (RO) return; var s = sel(), sh = S(), c = act.c, r1, r2, c1, c2;
    if (s.r2 > s.r1) { r1 = s.r1; r2 = s.r2; c1 = s.c1; c2 = s.c2; }
    else {
      var last = -1; Object.keys(sh.cells).forEach(function (ref) { var m = /^([A-Z]+)(\d+)$/.exec(ref); if (sh.cells[ref].r !== undefined && sh.cells[ref].r !== "") last = Math.max(last, +m[2] - 1); });
      r1 = sh.freeze ? 1 : 0; r2 = last; c1 = 0; c2 = sh.cols - 1;
    }
    if (r2 <= r1) return;
    var rows = []; for (var r = r1; r <= r2; r++) rows.push(r);
    var keys = {}; rows.forEach(function (r) { keys[r] = val(r, c); });
    rows.sort(function (a, b) {
      var x = keys[a], y = keys[b], ex = x === null || x === "", ey = y === null || y === "";
      if (ex || ey) return ex && ey ? a - b : ex ? 1 : -1;
      var d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ar", { numeric: true });
      return (asc ? d : -d) || a - b;
    });
    snapshot();
    var old = {}; rows.forEach(function (r) { for (var cc = c1; cc <= c2; cc++) { var ref = X.refOf(r, cc); if (sh.cells[ref]) old[ref] = sh.cells[ref]; } });
    rows.forEach(function (r) { for (var cc = c1; cc <= c2; cc++) delete sh.cells[X.refOf(r, cc)]; });
    rows.forEach(function (from, i) {
      var to = r1 + i; for (var cc = c1; cc <= c2; cc++) { var cl = old[X.refOf(from, cc)]; if (!cl) continue; cl = clone(cl); if (cl.r && String(cl.r).charAt(0) === "=") cl.r = X.shiftRel(cl.r, to - from, 0); sh.cells[X.refOf(to, cc)] = cl; }
    });
    end(); toast("تم الترتيب " + (asc ? "تصاعديًا" : "تنازليًا"));
  }
  function autoSum() {
    if (RO) return; var s = sel(), tr, tc, rng;
    if (s.r1 === s.r2 && s.c1 === s.c2) {
      var r = s.r1 - 1; while (r >= 0 && typeof val(r, s.c1) === "number") r--;
      if (r === s.r1 - 1) { var c = s.c1 - 1; while (c >= 0 && typeof val(s.r1, c) === "number") c--; if (c === s.c1 - 1) return toast("اختر عمودًا أو صفًا من الأرقام أولًا", "info"); rng = X.refOf(s.r1, c + 1) + ":" + X.refOf(s.r1, s.c1 - 1); }
      else rng = X.refOf(r + 1, s.c1) + ":" + X.refOf(s.r1 - 1, s.c1);
      tr = s.r1; tc = s.c1;
    } else if (s.c1 === s.c2 || s.r2 - s.r1 >= s.c2 - s.c1) { rng = X.refOf(s.r1, s.c1) + ":" + X.refOf(s.r2, s.c1); tr = s.r2 + 1; tc = s.c1; }
    else { rng = X.refOf(s.r1, s.c1) + ":" + X.refOf(s.r1, s.c2); tr = s.r1; tc = s.c2 + 1; }
    begin(); setRaw(tr, tc, "=SUM(" + rng + ")"); end(); act = ext = { r: tr, c: tc }; ext = { r: tr, c: tc }; drawSel();
  }
  function clearSel(styles) {
    if (RO) return; var s = sel(); begin();
    for (var r = s.r1; r <= s.r2; r++) for (var c = s.c1; c <= s.c2; c++) { var ref = X.refOf(r, c), old = S().cells[ref]; if (!old) continue; var n = clone(old); if (styles) delete n.s; else delete n.r; put(ref, n); }
    end();
  }

  /* ---------- statistics ---------- */
  function updateStats() {
    var s = sel(), n = 0, sum = 0, cnt = 0;
    if ((s.r2 - s.r1 + 1) * (s.c2 - s.c1 + 1) > 50000) { stat.textContent = ""; return; }
    for (var r = s.r1; r <= s.r2; r++) for (var c = s.c1; c <= s.c2; c++) { var cl = cellAt(r, c); if (!cl || cl.r === undefined || cl.r === "") continue; cnt++; var v = val(r, c); if (typeof v === "number") { n++; sum += v; } }
    stat.innerHTML = cnt > 1 || n ? (n ? "<b>المجموع:</b> " + X.format(+sum.toFixed(8), "n2") + " &nbsp; <b>المتوسط:</b> " + X.format(+(sum / n).toFixed(8), "n2") + " &nbsp; " : "") + "<b>العدد:</b> " + cnt : "";
  }

  /* ---------- pointer interaction ---------- */
  function pointCell(e) {
    var b = inner.getBoundingClientRect(), x = (rtl() ? b.right - e.clientX : e.clientX - b.left) - HDR_W, y = e.clientY - b.top - HDR_H;
    var r = Math.max(0, Math.min(S().rows - 1, Math.floor(y / RH))), c = x < 0 ? 0 : colAtX(x);
    if (x > totalW) c = S().cols - 1;
    return { r: r, c: c };
  }
  var drag = null;
  function insertRefMode() {
    if (!editing || ed.value.charAt(0) !== "=") return false;
    var p = ed.selectionStart, prev = ed.value.slice(0, p).replace(/\s+$/, "").slice(-1);
    return prev === "" ? false : /[=+\-*\/^&<>(,;:]/.test(prev) || (editing.refAt && editing.refAt.end === p);
  }
  wrap.addEventListener("mousedown", function (e) {
    if (e.button === 2) { var pc0 = pointCell(e); var s0 = sel(); if (!(pc0.r >= s0.r1 && pc0.r <= s0.r2 && pc0.c >= s0.c1 && pc0.c <= s0.c2) && !e.target.closest(".xl-ch,.xl-rh")) setAct(pc0.r, pc0.c, false, true); return; }
    if (e.button !== 0) return;
    hideMenus();
    var t = e.target;
    if (t.classList.contains("xl-rz")) { e.preventDefault(); drag = { kind: "rz", c: +t.dataset.c, x0: e.clientX, w0: colW(+t.dataset.c) }; return; }
    if (t === fillH) { e.preventDefault(); drag = { kind: "fill", s: sel() }; return; }
    var ch = t.closest(".xl-ch"), rh = t.closest(".xl-rh"), corner = t.closest(".xl-corner");
    if (editing && !insertRefMode() && !(ch || rh)) commit(0, 0); else if (editing && (ch || rh || corner)) commit(0, 0);
    if (ch) { e.preventDefault(); var c = +ch.dataset.c; if (e.shiftKey) { ext = { r: S().rows - 1, c: c }; } else { act = { r: 0, c: c }; ext = { r: S().rows - 1, c: c }; } drag = { kind: "col", c0: act.c }; drawSel(); ed.focus({ preventScroll: true }); return; }
    if (rh) { e.preventDefault(); var r = +rh.dataset.r; if (e.shiftKey) { ext = { r: r, c: S().cols - 1 }; } else { act = { r: r, c: 0 }; ext = { r: r, c: S().cols - 1 }; } drag = { kind: "row", r0: act.r }; drawSel(); ed.focus({ preventScroll: true }); return; }
    if (corner) { e.preventDefault(); act = { r: 0, c: 0 }; ext = { r: S().rows - 1, c: S().cols - 1 }; drawSel(); return; }
    if (t === ed) return;
    var wbb = wrap.getBoundingClientRect(); if (e.clientX < wbb.left + wrap.clientLeft || e.clientX > wbb.left + wrap.clientLeft + wrap.clientWidth || e.clientY > wbb.top + wrap.clientHeight) return;
    e.preventDefault();
    var pc = pointCell(e);
    if (editing && insertRefMode()) { // انقر لإدراج مرجع في المعادلة
      var txt = X.refOf(pc.r, pc.c), p = editing.refAt && editing.refAt.end === ed.selectionStart ? editing.refAt.start : ed.selectionStart;
      var endp = editing.refAt && editing.refAt.end === ed.selectionStart ? editing.refAt.end : ed.selectionStart;
      ed.value = ed.value.slice(0, p) + txt + ed.value.slice(endp); var np = p + txt.length; ed.setSelectionRange(np, np);
      editing.refAt = { start: p, end: np, a: pc }; fx.value = ed.value; drag = { kind: "ref" }; ed.focus(); sizeEd(); return;
    }
    if (e.shiftKey) setAct(pc.r, pc.c, true, true); else setAct(pc.r, pc.c, false, true);
    drag = { kind: "sel" }; ed.focus({ preventScroll: true });
  });
  document.addEventListener("mousemove", function (e) {
    if (!drag) return;
    if (drag.kind === "rz") { var w = Math.max(MIN_W, drag.w0 + (rtl() ? drag.x0 - e.clientX : e.clientX - drag.x0)); S().colw[drag.c] = Math.round(w); if (!drag.raf) drag.raf = requestAnimationFrame(function () { drag && (drag.raf = 0); metrics(); }); return; }
    var pc = pointCell(e);
    if (drag.kind === "sel") { if (pc.r !== ext.r || pc.c !== ext.c) setAct(pc.r, pc.c, true, true); autoScroll(e); }
    else if (drag.kind === "col") { ext = { r: S().rows - 1, c: pc.c }; drawSel(); }
    else if (drag.kind === "row") { ext = { r: pc.r, c: S().cols - 1 }; drawSel(); }
    else if (drag.kind === "fill") { drag.to = pc; var s = drag.s, R = rect(s.r1, s.c1, Math.max(s.r2, pc.r), Math.max(s.c2, pc.c)); selBox.style.display = "block"; selBox.style.width = R.w + "px"; selBox.style.height = R.h + "px"; selBox.classList.add("fillp"); }
    else if (drag.kind === "ref" && editing && editing.refAt) {
      var a = editing.refAt.a, txt = pc.r === a.r && pc.c === a.c ? X.refOf(a.r, a.c) : X.refOf(Math.min(a.r, pc.r), Math.min(a.c, pc.c)) + ":" + X.refOf(Math.max(a.r, pc.r), Math.max(a.c, pc.c));
      var st = editing.refAt.start; ed.value = ed.value.slice(0, st) + txt + ed.value.slice(editing.refAt.end); editing.refAt.end = st + txt.length; ed.setSelectionRange(editing.refAt.end, editing.refAt.end); fx.value = ed.value; sizeEd();
    }
  });
  document.addEventListener("mouseup", function () {
    if (!drag) return;
    if (drag.kind === "rz") { markDirty(); }
    if (drag.kind === "fill") { selBox.classList.remove("fillp"); if (drag.to) { var s = drag.s, to = drag.to; var dr = Math.max(to.r - s.r2, s.r1 - to.r), dc = Math.max(to.c - s.c2, s.c1 - to.c); if (dr >= dc && (to.r > s.r2 || to.r < s.r1)) fill(s, to.r, s.c2); else if (to.c > s.c2 || to.c < s.c1) fill(s, s.r2, to.c); else drawSel(); } else drawSel(); }
    drag = null; ed.focus({ preventScroll: true });
  });
  function autoScroll(e) {
    var b = wrap.getBoundingClientRect(), dx = rtl() ? (e.clientX < b.left + 20 ? -30 : e.clientX > b.right - HDR_W - 10 ? 30 : 0) : (e.clientX < b.left + HDR_W + 10 ? -30 : e.clientX > b.right - 20 ? 30 : 0), dy = e.clientY < b.top + HDR_H + 10 ? -30 : e.clientY > b.bottom - 20 ? 30 : 0;
    if (dx || dy) { wrap.scrollLeft += dx; wrap.scrollTop += dy; }
  }
  wrap.addEventListener("dblclick", function (e) {
    if (e.target.classList.contains("xl-rz")) { autofit(+e.target.dataset.c); return; }
    if (e.target.closest(".xl-ch,.xl-rh,.xl-corner")) return;
    var pc = pointCell(e); setAct(pc.r, pc.c, false, true); startEdit("edit");
  });
  function autofit(c) {
    var cv = autofit.cv || (autofit.cv = document.createElement("canvas").getContext("2d")); cv.font = "14px Cairo, Tahoma, sans-serif";
    var w = cv.measureText(X.colLetter(c)).width, sh = S();
    Object.keys(sh.cells).forEach(function (ref) { var m = /^([A-Z]+)(\d+)$/.exec(ref); if (X.colIndex(m[1]) !== c) return; var t = X.format(val(+m[2] - 1, c), sh.cells[ref].s && sh.cells[ref].s.nf); w = Math.max(w, cv.measureText(t).width * (sh.cells[ref].s && sh.cells[ref].s.b ? 1.1 : 1)); });
    sh.colw[c] = Math.round(Math.max(MIN_W, Math.min(420, w + 22))); metrics(); markDirty();
  }
  wrap.addEventListener("scroll", function () { if (!wrap._raf) wrap._raf = requestAnimationFrame(function () { wrap._raf = 0; renderRows(); }); });
  wrap.addEventListener("contextmenu", function (e) {
    e.preventDefault(); var items = [
      ["قص", "cut"], ["نسخ", "copy"], ["لصق", "paste"], "-",
      ["إدراج صف أعلى", "rowb"], ["إدراج صف أسفل", "rowa"], ["إدراج عمود قبل", "colb"], ["إدراج عمود بعد", "cola"], "-",
      ["حذف الصف", "rowd"], ["حذف العمود", "cold"], "-", ["مسح المحتوى", "clr"], ["مسح التنسيق", "clrs"]];
    showMenu(items, e.clientX, e.clientY, function (k) {
      ({ cut: function () { copySel(true); }, copy: function () { copySel(false); }, paste: function () { if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(pasteText).catch(function () { toast("استخدم Ctrl+V للصق", "info"); }); else toast("استخدم Ctrl+V للصق", "info"); },
        rowb: function () { structure("r", "before"); }, rowa: function () { structure("r", "after"); }, colb: function () { structure("c", "before"); }, cola: function () { structure("c", "after"); },
        rowd: function () { structure("r", "del"); }, cold: function () { structure("c", "del"); }, clr: function () { clearSel(false); }, clrs: function () { clearSel(true); } })[k]();
    });
  });

  /* ---------- menus ---------- */
  function showMenu(items, x, y, fn) {
    menu.innerHTML = items.map(function (it) { return it === "-" ? "<hr>" : '<button type="button" data-k="' + it[1] + '"' + (RO && /^(cut|paste|row|col|clr)/.test(it[1]) ? " disabled" : "") + ">" + it[0] + "</button>"; }).join("");
    menu.hidden = false; menu._fn = fn;
    var w = menu.offsetWidth, h = menu.offsetHeight; menu.style.left = Math.min(x, window.innerWidth - w - 8) + "px"; menu.style.top = Math.min(y, window.innerHeight - h - 8) + "px";
  }
  menu.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b || b.disabled) return; var f = menu._fn; hideMenus(); f && f(b.dataset.k); ed.focus({ preventScroll: true }); });
  function hideMenus() { menu.hidden = true; pal.hidden = true; }
  document.addEventListener("mousedown", function (e) { if (!menu.contains(e.target) && !pal.contains(e.target) && !e.target.closest("[data-palette-btn]")) hideMenus(); });

  var COLORS = ["#000000", "#434343", "#666666", "#999999", "#cccccc", "#ffffff", "#e5484d", "#ff7a59", "#f59e0b", "#ffd43b", "#2ecc71", "#12a150", "#00b4ff", "#1d6bff", "#7b6dff", "#c026d3", "#fde2e4", "#ffe8cc", "#fff3bf", "#d3f9d8", "#d0ebff", "#e5dbff"];
  function showPalette(btn, key) {
    pal.innerHTML = COLORS.map(function (c) { return '<i data-c="' + c + '" style="background:' + c + '" title="' + c + '"></i>'; }).join("") + '<button type="button" data-c="">بدون لون</button><label class="xl-custom">مخصص<input type="color" value="#1d6bff"></label>';
    var b = btn.getBoundingClientRect(); pal.hidden = false; pal.style.top = (b.bottom + 6) + "px"; pal.style.left = Math.min(b.left, window.innerWidth - pal.offsetWidth - 8) + "px"; pal._key = key;
  }
  pal.addEventListener("click", function (e) {
    var t = e.target.closest("[data-c]"); if (!t) return; var c = t.dataset.c, k = pal._key; hideMenus();
    applyStyle(function (st) { st[k] = c || 0; });
  });
  pal.addEventListener("input", function (e) { if (e.target.type === "color") { var k = pal._key, c = e.target.value; applyStyle(function (st) { st[k] = c; }); } });

  /* ---------- keyboard ---------- */
  ed.addEventListener("keydown", function (e) {
    var k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (editing) {
      if (k === "Tab" && !hint.hidden) { e.preventDefault(); var b = $("button.on", hint); if (b) acceptHint(b.dataset.f); return; }
      if (k === "Enter" && !e.altKey) { e.preventDefault(); commit(e.shiftKey ? -1 : 1, 0); return; }
      if (k === "Enter" && e.altKey) { e.preventDefault(); var p = ed.selectionStart; ed.value = ed.value.slice(0, p) + "\n" + ed.value.slice(ed.selectionEnd); ed.setSelectionRange(p + 1, p + 1); fx.value = ed.value; return; }
      if (k === "Tab") { e.preventDefault(); commit(0, e.shiftKey ? -1 : 1); return; }
      if (k === "Escape") { e.preventDefault(); cancel(); return; }
      if (editing.mode === "enter" && /^Arrow/.test(k) && !ctrl && !(ed.value.charAt(0) === "=" && insertRefMode())) {
        e.preventDefault(); var d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -sgn()], ArrowRight: [0, sgn()] }[k]; commit(d[0], d[1]); return;
      }
      if (k === "F4" && ed.value.charAt(0) === "=") { e.preventDefault(); toggleAbs(); return; }
      return;
    }
    if (ctrl) {
      var low = k.toLowerCase();
      if (low === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (low === "y") { e.preventDefault(); redo(); return; }
      if (low === "b") { e.preventDefault(); toggle("b"); return; }
      if (low === "i") { e.preventDefault(); toggle("i"); return; }
      if (low === "s") { e.preventDefault(); save(true); return; }
      if (low === "a") { e.preventDefault(); act = { r: 0, c: 0 }; ext = { r: S().rows - 1, c: S().cols - 1 }; drawSel(); return; }
      if (low === "d") { e.preventDefault(); fillDirection("d"); return; }
      if (low === "r") { e.preventDefault(); fillDirection("r"); return; }
      if (low === "f") { e.preventDefault(); openFind(); return; }
      if (/^Arrow/.test(k)) { e.preventDefault(); jump(k, e.shiftKey); return; }
      if (k === "Home") { e.preventDefault(); setAct(0, 0, e.shiftKey); return; }
      return;
    }
    var shift = e.shiftKey;
    switch (k) {
      case "ArrowUp": e.preventDefault(); move(-1, 0, shift); return;
      case "ArrowDown": e.preventDefault(); move(1, 0, shift); return;
      case "ArrowLeft": e.preventDefault(); move(0, -sgn(), shift); return;
      case "ArrowRight": e.preventDefault(); move(0, sgn(), shift); return;
      case "Tab": e.preventDefault(); setAct(act.r, act.c + (shift ? -1 : 1)); return;
      case "Enter": e.preventDefault(); if (!shift && !RO && false) startEdit("edit"); setAct(act.r + (shift ? -1 : 1), act.c); return;
      case "F2": e.preventDefault(); startEdit("edit"); return;
      case "Delete": case "Backspace": e.preventDefault(); clearSel(false); return;
      case "Home": e.preventDefault(); setAct(act.r, 0, shift); return;
      case "End": e.preventDefault(); setAct(act.r, S().cols - 1, shift); return;
      case "PageDown": e.preventDefault(); var pg = Math.floor(wrap.clientHeight / RH) - 2; move(pg, 0, shift); return;
      case "PageUp": e.preventDefault(); var pg2 = Math.floor(wrap.clientHeight / RH) - 2; move(-pg2, 0, shift); return;
      case "Escape": clip = null; return;
    }
  });
  function move(dr, dc, extend) { var b = extend ? ext : act; setAct(b.r + dr, b.c + dc, extend); }
  function jump(k, extend) {
    var sh = S(), b = extend ? ext : act, r = b.r, c = b.c, dr = k === "ArrowDown" ? 1 : k === "ArrowUp" ? -1 : 0, dc = k === "ArrowRight" ? sgn() : k === "ArrowLeft" ? -sgn() : 0;
    function has(r, c) { var x = cellAt(r, c); return x && x.r !== undefined && x.r !== ""; }
    var startFilled = has(r, c), nextFilled = has(r + dr, c + dc);
    var lim = 0;
    do { var nr = r + dr, nc = c + dc; if (nr < 0 || nc < 0 || nr >= sh.rows || nc >= sh.cols) break; r = nr; c = nc; lim++; }
    while (lim < 20000 && (startFilled && nextFilled ? has(r + dr, c + dc) : !has(r, c)) && r + dr >= 0 && c + dc >= 0 && r + dr < sh.rows && c + dc < sh.cols);
    setAct(r, c, extend);
  }
  function toggleAbs() {
    var p = ed.selectionStart, t = ed.value, m = /(\$?[A-Za-z]{1,3}\$?\d+)(?!.*(\$?[A-Za-z]{1,3}\$?\d+))/.exec(t.slice(0, p)); if (!m) return;
    var ref = m[1], mm = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(ref), a = mm[1] && mm[3] ? "" : !mm[1] && !mm[3] ? "$$" : mm[3] ? "c" : "r", n;
    var col = mm[2], row = mm[4]; n = a === "" ? col + row : a === "$$" ? "$" + col + "$" + row : a === "c" ? "$" + col + row : col + "$" + row;
    ed.value = t.slice(0, m.index) + n + t.slice(m.index + ref.length); fx.value = ed.value;
  }
  ed.addEventListener("paste", function (e) {
    if (editing) return; e.preventDefault();
    var t = (e.clipboardData || window.clipboardData).getData("text"); if (t) pasteText(t);
  });
  ed.addEventListener("copy", function (e) { if (!editing) copySel(false, e); });
  ed.addEventListener("cut", function (e) { if (!editing) copySel(true, e); });
  ed.addEventListener("blur", function () { /* يبقى التحرير مفتوحًا عند الضغط على شريط الأدوات */ });
  wrap.addEventListener("focus", function () { ed.focus({ preventScroll: true }); });

  /* ---------- find ---------- */
  var findBar = $("#xlFind"), findIn = $("#xlFindIn"), findCnt = $("#xlFindCnt"), found = [], fi = -1;
  function openFind() { findBar.hidden = false; findIn.focus(); findIn.select(); }
  function runFind(dir) {
    var q = findIn.value.trim().toLowerCase(); if (!q) { findCnt.textContent = ""; return; }
    found = []; var sh = S();
    Object.keys(sh.cells).forEach(function (ref) { var m = /^([A-Z]+)(\d+)$/.exec(ref), r = +m[2] - 1, c = X.colIndex(m[1]); if (X.format(val(r, c), sh.cells[ref].s && sh.cells[ref].s.nf).toLowerCase().indexOf(q) > -1 || String(sh.cells[ref].r).toLowerCase().indexOf(q) > -1) found.push([r, c]); });
    found.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (!found.length) { findCnt.textContent = "لا نتائج"; return; }
    fi = dir ? (fi + dir + found.length) % found.length : 0; findCnt.textContent = (fi + 1) + " / " + found.length;
    setAct(found[fi][0], found[fi][1]);
  }
  findIn.addEventListener("input", function () { fi = -1; runFind(0); });
  findIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); runFind(e.shiftKey ? -1 : 1); } else if (e.key === "Escape") { findBar.hidden = true; ed.focus(); } });
  $("#xlFindNext").addEventListener("click", function () { runFind(1); });
  $("#xlFindPrev").addEventListener("click", function () { runFind(-1); });
  $("#xlFindX").addEventListener("click", function () { findBar.hidden = true; ed.focus(); });

  /* ---------- name box ---------- */
  nameBox.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault(); var m = /^([A-Za-z]{1,3})(\d+)(?::([A-Za-z]{1,3})(\d+))?$/.exec(nameBox.value.trim());
      if (m) { act = { r: Math.min(+m[2] - 1, S().rows - 1), c: Math.min(X.colIndex(m[1]), S().cols - 1) }; ext = m[3] ? { r: Math.min(+m[4] - 1, S().rows - 1), c: Math.min(X.colIndex(m[3]), S().cols - 1) } : { r: act.r, c: act.c }; ensureVisible(act.r, act.c); renderRows(); drawSel(); }
      ed.focus();
    }
  });
  nameBox.addEventListener("focus", function () { nameBox.select(); });

  /* ---------- toolbar ---------- */
  var ACTS = {
    undo: undo, redo: redo, bold: function () { toggle("b"); }, italic: function () { toggle("i"); }, border: function () { toggle("bd"); },
    sum: autoSum, asc: function () { sortSel(true); }, desc: function () { sortSel(false); }, find: openFind,
    freeze: function () { if (RO) return; snapshot(); S().freeze = S().freeze ? 0 : 1; end(); metrics(); },
    rowadd: function () { structure("r", "after"); }, coladd: function () { structure("c", "after"); }, rowdel: function () { structure("r", "del"); }, coldel: function () { structure("c", "del"); },
    more: function () { growRows(Math.min(100, MAX_ROWS - S().rows)); },
    fg: function (b) { showPalette(b, "fg"); }, bg: function (b) { showPalette(b, "bg"); },
    rtl: function () { if (RO) return; S().rtl = rtl() ? 0 : 1; wrap.scrollLeft = 0; metrics(); markDirty(); },
    print: printSheet,
    csv: exportCsv, xlsx: function () { save(true).then(function (ok) { if (ok) location.href = root.dataset.export; }); }, save: function () { save(true); }
  };
  root.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]"); if (b && !b.disabled) { e.preventDefault(); ACTS[b.dataset.act](b); if (b.dataset.act !== "fg" && b.dataset.act !== "bg") ed.focus({ preventScroll: true }); return; }
    var f = e.target.closest("[data-fmt]"); if (f && !f.disabled) { var k = f.dataset.fmt; if (k === "al") { var cur2 = cellAt(act.r, act.c); var same = cur2 && cur2.s && cur2.s.al === f.dataset.val; applyStyle(function (st) { st.al = same ? 0 : f.dataset.val; }); } else toggle(k); ed.focus({ preventScroll: true }); }
  });
  $("#xlNf").addEventListener("change", function (e) { var v = e.target.value; applyStyle(function (st) { st.nf = v || 0; }); ed.focus({ preventScroll: true }); });

  /* ---------- sheet tabs ---------- */
  function buildTabs() {
    tabsEl.innerHTML = book.sheets.map(function (s, i) { return '<button type="button" class="xl-tab' + (i === cur ? " on" : "") + '" data-i="' + i + '">' + esc(s.name) + "</button>"; }).join("") + (RO ? "" : '<button type="button" class="xl-tab add" data-add title="ورقة جديدة">+</button>');
  }
  function uniqueName(base) { var n = base, k = 2, names = book.sheets.map(function (s) { return s.name.toLowerCase(); }); while (names.indexOf(n.toLowerCase()) > -1) n = base + " " + k++; return n; }
  function switchTo(i) { if (editing) commit(0, 0); cur = i; act = { r: 0, c: 0 }; ext = { r: 0, c: 0 }; wrap.scrollTop = wrap.scrollLeft = 0; undoSt = undoSt; invalidate(); buildTabs(); metrics(); drawSel(); markDirty(true); }
  tabsEl.addEventListener("click", function (e) {
    var t = e.target.closest(".xl-tab"); if (!t) return;
    if (t.hasAttribute("data-add")) { if (RO || book.sheets.length >= 40) return; book.sheets.push({ name: uniqueName("Sheet" + (book.sheets.length + 1)), rows: 100, cols: 26, cells: {}, colw: {}, freeze: 0, rtl: 1 }); switchTo(book.sheets.length - 1); markDirty(); return; }
    switchTo(+t.dataset.i);
  });
  tabsEl.addEventListener("dblclick", function (e) { var t = e.target.closest(".xl-tab:not(.add)"); if (t && !RO) renameTab(+t.dataset.i); });
  tabsEl.addEventListener("contextmenu", function (e) {
    var t = e.target.closest(".xl-tab:not(.add)"); if (!t) return; e.preventDefault(); var i = +t.dataset.i;
    showMenu([["إعادة تسمية", "ren"], ["نسخ الورقة", "dup"], ["حذف الورقة", "del"]], e.clientX, e.clientY - 90, function (k) {
      if (RO) return;
      if (k === "ren") renameTab(i);
      else if (k === "dup") { var c = clone(book.sheets[i]); c.name = uniqueName(c.name + " نسخة"); book.sheets.splice(i + 1, 0, c); switchTo(i + 1); markDirty(); }
      else if (k === "del") { if (book.sheets.length < 2) return toast("لازم تفضل ورقة واحدة على الأقل", "error"); window.INX.confirm("حذف الورقة «" + book.sheets[i].name + "» نهائيًا؟").then(function (ok) { if (!ok) return; book.sheets.splice(i, 1); undoSt = []; redoSt = []; switchTo(Math.min(i, book.sheets.length - 1)); markDirty(); }); }
    });
  });
  function renameTab(i) {
    var btn = $('.xl-tab[data-i="' + i + '"]', tabsEl), old = book.sheets[i].name, inp = document.createElement("input");
    inp.className = "xl-tabin"; inp.value = old; btn.replaceWith(inp); inp.focus(); inp.select();
    function done(ok) {
      var n = inp.value.trim().replace(/[\[\]\*\?\/\\:]/g, "-").slice(0, 40);
      if (ok && n && n !== old && !book.sheets.some(function (s, k) { return k !== i && s.name.toLowerCase() === n.toLowerCase(); })) {
        book.sheets.forEach(function (s) { Object.keys(s.cells).forEach(function (ref) { var cl = s.cells[ref]; if (cl.r && String(cl.r).charAt(0) === "=") cl.r = cl.r.replace(new RegExp("(^|[^A-Za-z0-9_.\\u0600-\\u06FF])(?:'" + old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "'|" + old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")!", "g"), function (_, p) { return p + (/[^A-Za-z0-9_.]/.test(n) ? "'" + n + "'" : n) + "!"; }); }); });
        book.sheets[i].name = n; markDirty(); invalidate();
      }
      buildTabs(); refresh();
    }
    inp.addEventListener("blur", function () { done(true); });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } else if (e.key === "Escape") { inp.value = old; inp.blur(); } });
  }

  /* ---------- طباعة الورقة (تُبنى من القيم المحسوبة، فتشمل كل الصفوف مش الظاهر بس) ---------- */
  function printSheet() {
    if (editing) commit(0, 0);
    var sh = S(), maxR = 0, maxC = 0;
    Object.keys(sh.cells).forEach(function (ref) {
      var m = /^([A-Z]+)(\d+)$/.exec(ref), cl = sh.cells[ref], s = cl.s || {};
      if (!((cl.r !== undefined && cl.r !== "") || s.bg || s.bd)) return;
      maxR = Math.max(maxR, +m[2]); maxC = Math.max(maxC, X.colIndex(m[1]) + 1);
    });
    if (!maxR) { toast("الورقة فاضية — مفيش حاجة تتطبع", "error"); return; }
    var dir = rtl() ? "rtl" : "ltr", total = 0, cg = "", c, r;
    for (c = 0; c < maxC; c++) { cg += '<col style="width:' + colW(c) + 'px">'; total += colW(c); }
    function tr(r) {
      var h = "<tr>";
      for (var c = 0; c < maxC; c++) {
        var cl = cellAt(r, c), st = (cl && cl.s) || {}, v = cl && cl.r !== undefined && cl.r !== "" ? val(r, c) : null, sty = "";
        var txt = X.format(v, st.nf);
        if (typeof v === "number") sty += "text-align:right;direction:ltr;";
        else if (typeof v === "boolean" || X.isErr(v)) sty += "text-align:center;";
        if (st.al) sty += "text-align:" + { l: "left", c: "center", r: "right" }[st.al] + ";";
        if (st.b) sty += "font-weight:800;"; if (st.i) sty += "font-style:italic;";
        if (st.bg) sty += "background:" + st.bg + ";"; if (st.fg) sty += "color:" + st.fg + ";";
        if (st.bd) sty += "border:1.5px solid #333;";
        h += '<td dir="auto" style="' + sty + '">' + esc(txt).replace(/\n/g, "<br>") + "</td>";
      }
      return h + "</tr>";
    }
    var head = "", body = "";
    for (r = 0; r < maxR; r++) { if (sh.freeze && r === 0 && maxR > 1) head = "<thead>" + tr(0) + "</thead>"; else body += tr(r); }
    var land = total > 700, avail = land ? 1040 : 710, zoom = total > avail ? (avail / total) : 1;
    var title = esc((titleEl.value || "") + (book.sheets.length > 1 ? " — " + sh.name : ""));
    var html = '<!doctype html><html lang="ar" dir="' + dir + '"><head><meta charset="utf-8"><title>' + title + '</title><style>' +
      '@page{size:A4 ' + (land ? "landscape" : "portrait") + ';margin:10mm}' +
      '*{box-sizing:border-box}body{margin:0;font-family:Cairo,"Segoe UI",Tahoma,Arial,sans-serif;font-size:13px;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      'h1{font-size:16px;margin:0 0 2px}.meta{font-size:11px;color:#555;margin:0 0 8px}' +
      'table{border-collapse:collapse;table-layout:fixed;width:' + total + 'px;zoom:' + zoom + '}' +
      'td{text-align:' + (rtl() ? 'right' : 'left') + ';border:1px solid #9aa4b5;padding:3px 6px;height:24px;overflow:hidden;word-break:break-word;vertical-align:middle}' +
      'thead td{background:#e8eefb;font-weight:800}tr{page-break-inside:avoid}thead{display:table-header-group}' +
      '</style></head><body><h1>' + title + '</h1><div class="meta">' + new Date().toLocaleDateString("ar-EG") + '</div>' +
      '<table><colgroup>' + cg + "</colgroup>" + head + "<tbody>" + body + "</tbody></table></body></html>";
    var fr = document.createElement("iframe");
    fr.setAttribute("aria-hidden", "true"); fr.style.cssText = "position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(fr);
    var d = fr.contentWindow.document; d.open(); d.write(html); d.close();
    setTimeout(function () { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { toast("تعذّرت الطباعة من المتصفح", "error"); } }, 300);
    setTimeout(function () { fr.remove(); }, 120000);
  }
  document.addEventListener("keydown", function (e) { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") { e.preventDefault(); printSheet(); } });

  /* ---------- export csv (client side: يطبع القيم المحسوبة) ---------- */
  function exportCsv() {
    var sh = S(), maxR = 0, maxC = 0;
    Object.keys(sh.cells).forEach(function (ref) { var m = /^([A-Z]+)(\d+)$/.exec(ref); if (sh.cells[ref].r === undefined || sh.cells[ref].r === "") return; maxR = Math.max(maxR, +m[2]); maxC = Math.max(maxC, X.colIndex(m[1]) + 1); });
    var lines = [];
    for (var r = 0; r < maxR; r++) { var row = []; for (var c = 0; c < maxC; c++) { var cl = cellAt(r, c), v = cl && cl.r !== undefined && cl.r !== "" ? val(r, c) : null, t = v === null ? "" : (typeof v === "number" ? String(+v.toPrecision(12)) : X.format(v)); row.push(/[",\n;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t); } lines.push(row.join(",")); }
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = (titleEl.value || "sheet") + " - " + sh.name + ".csv"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- saving ---------- */
  var LBL = { saved: "تم الحفظ ✓", dirty: "تعديلات غير محفوظة…", saving: "جاري الحفظ…", error: "تعذّر الحفظ — أعد المحاولة", conflict: "تعارض في الحفظ" };
  function paintState() { statusEl.textContent = RO ? "عرض فقط" : LBL[state]; statusEl.dataset.state = RO ? "ro" : state; }
  function markDirty(silent) { if (RO) return; dirty = true; state = "dirty"; paintState(); clearTimeout(saveTimer); saveTimer = setTimeout(function () { save(false); }, 1400); }
  function payload(force) {
    book.active = cur; var fd = new FormData();
    fd.append("csrf", root.dataset.csrf); fd.append("data", JSON.stringify(book)); fd.append("version", version); fd.append("title", titleEl.value);
    if (force) fd.append("force", "1"); return fd;
  }
  function save(manual, force) {
    if (RO) return Promise.resolve(true);
    if (editing) commit(0, 0);
    if (saving) return new Promise(function (res) { setTimeout(function () { res(save(manual, force)); }, 400); });
    if (!dirty && !force) { if (manual) toast("لا توجد تعديلات جديدة", "info"); return Promise.resolve(true); }
    clearTimeout(saveTimer); saving = true; state = "saving"; paintState();
    return fetch(root.dataset.save, { method: "POST", body: payload(force), credentials: "same-origin" })
      .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (x) {
        saving = false;
        if (x.j.ok) { version = x.j.version; dirty = false; state = "saved"; paintState(); if (manual) toast("تم حفظ الجدول"); return true; }
        if (x.s === 409) { state = "conflict"; paintState(); conflictDialog(x.j); return false; }
        state = "error"; paintState(); toast(x.j.error || "تعذّر الحفظ", "error"); return false;
      })
      .catch(function () { saving = false; state = "error"; paintState(); toast("انقطع الاتصال أو انتهت الجلسة — سجّل الدخول وأعد المحاولة", "error"); return false; });
  }
  function conflictDialog(j) {
    window.INX.confirm("الجدول اتعدّل من «" + (j.by || "مستخدم آخر") + "» (" + (j.at || "") + ") وانت شغال عليه.\nاضغط «نعم» لاستبدال نسخته بتعديلاتك، أو «إلغاء» لإعادة تحميل آخر نسخة (تعديلاتك هتضيع).", "استبدال بنسختي").then(function (ok) {
      if (ok) { version = j.version; save(true, true); } else { dirty = false; location.reload(); }
    });
  }
  titleEl.addEventListener("input", function () { markDirty(); });
  titleEl.readOnly = RO;
  titleEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ed.focus(); } });
  window.addEventListener("pagehide", function () { if (dirty && !RO && navigator.sendBeacon) { try { navigator.sendBeacon(root.dataset.save, payload(false)); } catch (e) {} } });
  window.addEventListener("beforeunload", function (e) { if (dirty && (state === "error" || state === "conflict")) { e.preventDefault(); e.returnValue = ""; } });

  function toast(m, t) { window.INX && window.INX.toast(m, t || "ok"); }

  /* ---------- go ---------- */
  invalidate(); buildTabs(); metrics(); paintState();
  if (RO) root.classList.add("ro");
  setTimeout(function () { ed.focus({ preventScroll: true }); }, 50);
  window.addEventListener("resize", function () { renderRows(true); });
  window.XLUI = { book: book, setRaw: function (ref, t) { var m = /^([A-Z]+)(\d+)$/.exec(ref); begin(); setRaw(+m[2] - 1, X.colIndex(m[1]), t); end(); }, val: val, act: function (r, c) { setAct(r, c); }, save: save, undo: undo, S: S };
})();
