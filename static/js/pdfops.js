/* INX — pdfops.js : تبويبات صفحة «تحويل PDF» + دمج وفصل ملفات PDF (المعالجة على السيرفر عبر pypdf) */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var root = $("#pt"); if (!root) return;
  var CSRF = root.dataset.csrf, MAX_TOTAL = 29 * 1024 * 1024, MAX_FILES = 30;

  function toast(m, t) { if (window.INX && window.INX.toast) window.INX.toast(m, t || "ok"); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function size(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB"; }
  function isPdf(f) { return /pdf/i.test(f.type) || /\.pdf$/i.test(f.name); }
  function setStatus(el, msg, err) { el.hidden = !msg; el.textContent = msg || ""; el.classList.toggle("err", !!err); }
  function hasFiles(e) { return !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") > -1); }
  function baseName(n) { return String(n || "").replace(/\.[^.]+$/, ""); }
  function safeName(n, def) { n = (n || "").replace(/[\\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().replace(/\.(pdf|zip)$/i, ""); return n || def; }

  /* ---------- التبويبات (مع حفظ التبويب في الرابط #merge / #split) ---------- */
  var tabs = $$(".pt-tab", root.parentNode);
  function showTab(k) {
    if (!$("#pn-" + k)) k = "img";
    tabs.forEach(function (t) { var on = t.dataset.tab === k; t.classList.toggle("on", on); t.setAttribute("aria-selected", on); });
    $$(".pt-panel", root).forEach(function (p) { p.hidden = p.id !== "pn-" + k; });
  }
  tabs.forEach(function (t) { t.addEventListener("click", function () { showTab(t.dataset.tab); history.replaceState(null, "", "#" + t.dataset.tab); }); });
  showTab((location.hash || "").slice(1));
  window.addEventListener("hashchange", function () { showTab((location.hash || "").slice(1)); });

  /* ---------- إرسال للسيرفر وتنزيل النتيجة ---------- */
  function post(url, fd, statusEl, btn, fallbackName) {
    fd.append("csrf", CSRF);
    btn.disabled = true; btn.classList.add("loading"); setStatus(statusEl, "جاري المعالجة…");
    return fetch(url, { method: "POST", body: fd, credentials: "same-origin" }).then(function (r) {
      var ct = r.headers.get("Content-Type") || "";
      if (!r.ok || /json/.test(ct)) {
        return r.text().then(function (txt) {
          var msg = ""; try { msg = JSON.parse(txt).error; } catch (e) {}
          if (r.status === 413) msg = "حجم الملفات أكبر من الحد المسموح (30MB)";
          throw new Error(msg || "حصل خطأ أثناء المعالجة (" + r.status + ")");
        });
      }
      return r.blob().then(function (b) { return { blob: b, zip: /zip/.test(ct) }; });
    }).then(function (res) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(res.blob); a.download = fallbackName + (res.zip ? ".zip" : ".pdf");
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      setStatus(statusEl, "تم إنشاء الملف (" + size(res.blob.size) + ") وتحميله على جهازك ✓"); toast("تم تحميل الملف");
      return true;
    }).catch(function (e) {
      setStatus(statusEl, e.message || "تعذّر إتمام العملية", true); return false;
    }).then(function (ok) { btn.classList.remove("loading"); btn.disabled = false; return ok; });
  }

  /* ---------- قائمة قابلة لإعادة الترتيب ---------- */
  function sortable(listEl, arr, onChange) {
    var dragId = null;
    function idx(id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i; return -1; }
    function move(from, to) { if (from < 0 || to < 0 || to >= arr.length || from === to) return; arr.splice(to, 0, arr.splice(from, 1)[0]); onChange(); }
    listEl.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-a]"); if (!b) return;
      var id = +b.closest(".pt-row").dataset.id, i = idx(id), a = b.dataset.a;
      if (a === "up") move(i, i - 1); else if (a === "down") move(i, i + 1);
      else if (a === "del") { arr.splice(i, 1); onChange(); }
    });
    listEl.addEventListener("dragstart", function (e) { var t = e.target.closest(".pt-row"); if (!t) return; dragId = +t.dataset.id; t.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", "x"); } catch (er) {} });
    listEl.addEventListener("dragend", function () { dragId = null; onChange(); });
    listEl.addEventListener("dragover", function (e) { if (dragId === null) return; e.preventDefault(); $$(".over", listEl).forEach(function (x) { x.classList.remove("over"); }); var t = e.target.closest(".pt-row"); if (t) t.classList.add("over"); });
    listEl.addEventListener("drop", function (e) { if (dragId === null) return; e.preventDefault(); var t = e.target.closest(".pt-row"); if (t) move(idx(dragId), idx(+t.dataset.id)); dragId = null; });
  }

  /* ---------- الدمج ---------- */
  (function () {
    var drop = $("#mgDrop"), inp = $("#mgFile"), list = $("#mgList"), go = $("#mgGo"), clr = $("#mgClear"), cnt = $("#mgCount"), st = $("#mgStatus"), nm = $("#mgName");
    var files = [], uid = 0;
    function render() {
      list.innerHTML = files.map(function (f, i) {
        return '<div class="pt-row" draggable="true" data-id="' + f.id + '"><span class="pg">' + (i + 1) + '</span><span class="nm" title="' + esc(f.file.name) + '">' + esc(f.file.name) + '</span><span class="sz">' + size(f.file.size) + '</span>' +
          '<button type="button" data-a="up" title="لأعلى"' + (i === 0 ? " disabled" : "") + '>▲</button><button type="button" data-a="down" title="لأسفل"' + (i === files.length - 1 ? " disabled" : "") + '>▼</button><button type="button" class="del" data-a="del" title="حذف">✕</button></div>';
      }).join("");
      var tot = files.reduce(function (s, f) { return s + f.file.size; }, 0);
      cnt.textContent = files.length ? files.length + " ملف · " + size(tot) : "لم يتم اختيار ملفات بعد";
      go.disabled = files.length < 2; clr.disabled = !files.length;
    }
    function add(list_) {
      var bad = 0;
      Array.prototype.slice.call(list_).forEach(function (f) { if (!isPdf(f) || files.length >= MAX_FILES) { bad++; return; } files.push({ id: ++uid, file: f }); });
      if (bad) toast("تم تجاهل " + bad + " ملف (مش PDF أو تعدّيت " + MAX_FILES + " ملف)", "error");
      setStatus(st, ""); render();
    }
    sortable(list, files, render);
    inp.addEventListener("change", function () { add(inp.files); inp.value = ""; });
    clr.addEventListener("click", function () { files.length = 0; setStatus(st, ""); render(); });
    go.addEventListener("click", function () {
      var tot = files.reduce(function (s, f) { return s + f.file.size; }, 0);
      if (tot > MAX_TOTAL) { setStatus(st, "إجمالي حجم الملفات " + size(tot) + " أكبر من الحد المسموح (30MB). ادمج على دفعات.", true); return; }
      var fd = new FormData(); files.forEach(function (f) { fd.append("files", f.file, f.file.name); });
      post(root.dataset.merge, fd, st, go, safeName(nm.value, "merged"));
    });
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { if (hasFiles(e)) drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove("over"); }); });
    window.addEventListener("dragover", function (e) { if (drop.offsetParent !== null && hasFiles(e)) e.preventDefault(); });
    window.addEventListener("drop", function (e) { if (drop.offsetParent === null || !hasFiles(e)) return; e.preventDefault(); add(e.dataTransfer.files); });
    render();
  })();

  /* ---------- الفصل ---------- */
  (function () {
    var drop = $("#spDrop"), inp = $("#spFile"), info = $("#spInfo"), opts = $("#spOpts"), go = $("#spGo"), st = $("#spStatus"),
        ranges = $("#spRanges"), rbox = $("#spRangeBox"), hint = $("#spHint"), nm = $("#spName"), file = null, pages = 0;
    function mode() { return ($("input[name=spMode]:checked") || {}).value || "extract"; }
    function syncMode() {
      var m = mode(); rbox.hidden = m === "each";
      hint.textContent = m === "each" ? "هيطلع " + pages + " ملف (صفحة لكل ملف) داخل ZIP." : "اكتب الصفحات مفصولة بفواصل، وشرطة للنطاق. مثال: 1-3, 5, 8-";
    }
    $$("input[name=spMode]").forEach(function (r) { r.addEventListener("change", syncMode); });
    function reset() { file = null; pages = 0; info.innerHTML = ""; opts.hidden = true; setStatus(st, ""); }
    function pick(f) {
      if (!f) return;
      if (!isPdf(f)) { toast("لازم تختار ملف PDF", "error"); return; }
      if (f.size > MAX_TOTAL) { setStatus(st, "الملف أكبر من الحد المسموح (30MB)", true); return; }
      reset(); file = f; setStatus(st, "جاري قراءة الملف…");
      var fd = new FormData(); fd.append("file", f, f.name); fd.append("csrf", CSRF);
      fetch(root.dataset.info, { method: "POST", body: fd, credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) throw new Error(j.error || "تعذّرت قراءة الملف");
        pages = j.pages; setStatus(st, "");
        info.innerHTML = '<div class="pt-row" style="cursor:default"><span class="nm" title="' + esc(f.name) + '">' + esc(f.name) + '</span><span class="sz">' + pages + ' صفحة · ' + size(f.size) + '</span><button type="button" class="del" title="إزالة" id="spDel">✕</button></div>';
        $("#spDel").addEventListener("click", reset);
        opts.hidden = false; ranges.placeholder = "1-" + Math.min(pages, 3) + (pages > 4 ? ", 5" : ""); syncMode();
      }).catch(function (e) { reset(); setStatus(st, e.message || "تعذّرت قراءة الملف", true); });
    }
    inp.addEventListener("change", function () { pick(inp.files[0]); inp.value = ""; });
    go.addEventListener("click", function () {
      if (!file) return;
      var m = mode(), fd = new FormData();
      if (m !== "each" && !ranges.value.trim()) { setStatus(st, "اكتب أرقام الصفحات المطلوبة، مثال: 1-3, 5, 8-10", true); ranges.focus(); return; }
      fd.append("file", file, file.name); fd.append("mode", m); fd.append("ranges", ranges.value);
      var base = safeName(nm.value, baseName(file.name) || "document"); fd.append("name", base);
      post(root.dataset.split, fd, st, go, base);
    });
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { if (hasFiles(e)) drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove("over"); }); });
    window.addEventListener("dragover", function (e) { if (drop.offsetParent !== null && hasFiles(e)) e.preventDefault(); });
    window.addEventListener("drop", function (e) { if (drop.offsetParent === null || !hasFiles(e)) return; e.preventDefault(); pick(e.dataTransfer.files[0]); });
  })();
})();
