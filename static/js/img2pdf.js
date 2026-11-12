/* INX — img2pdf.js : تحويل الصور إلى PDF بالكامل داخل المتصفح (بدون رفع للسيرفر وبدون مكتبات خارجية) */
(function (root) {
  "use strict";

  /* ---------- كاتب PDF بسيط: كل صفحة = صورة JPEG واحدة ---------- */
  // pages: [{ w, h, x, y, dw, dh, iw, ih, jpeg:Uint8Array }]  (الأبعاد بوحدة point)
  function buildPdf(pages) {
    var enc = new TextEncoder(), parts = [], len = 0, offs = [];
    function push(x) { if (typeof x === "string") x = enc.encode(x); parts.push(x); len += x.length; }
    function n2(v) { return (+v).toFixed(2); }
    var n = pages.length, kids = [];
    for (var i = 0; i < n; i++) kids.push((3 + 3 * i) + " 0 R");
    push("%PDF-1.4\n"); push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
    offs[1] = len; push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    offs[2] = len; push("2 0 obj\n<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + n + " >>\nendobj\n");
    for (i = 0; i < n; i++) {
      var p = pages[i], po = 3 + 3 * i, co = po + 1, io = po + 2;
      var content = "q\n" + n2(p.dw) + " 0 0 " + n2(p.dh) + " " + n2(p.x) + " " + n2(p.y) + " cm\n/Im0 Do\nQ\n";
      offs[po] = len;
      push(po + " 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + n2(p.w) + " " + n2(p.h) + "] /Resources << /XObject << /Im0 " + io + " 0 R >> >> /Contents " + co + " 0 R >>\nendobj\n");
      offs[co] = len;
      push(co + " 0 obj\n<< /Length " + content.length + " >>\nstream\n" + content + "endstream\nendobj\n");
      offs[io] = len;
      push(io + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + p.iw + " /Height " + p.ih + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + p.jpeg.length + " >>\nstream\n");
      push(p.jpeg); push("\nendstream\nendobj\n");
    }
    var total = 3 + 3 * n, xref = len, x = "xref\n0 " + total + "\n0000000000 65535 f \n";
    for (i = 1; i < total; i++) x += ("0000000000" + offs[i]).slice(-10) + " 00000 n \n";
    push(x + "trailer\n<< /Size " + total + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
    return new Blob(parts, { type: "application/pdf" });
  }

  // تخطيط الصفحة: size = a4 | fit ، orient = auto | p | l ، m = الهامش بالـ point
  function layout(iw, ih, size, orient, m) {
    var A4L = 841.89, A4S = 595.28, W, H, x, y, dw, dh, s;
    if (size === "fit") {
      s = A4L / Math.max(iw, ih); dw = iw * s; dh = ih * s;
      W = dw + 2 * m; H = dh + 2 * m; x = m; y = m;
    } else {
      var land = orient === "l" || (orient !== "p" && iw > ih);
      W = land ? A4L : A4S; H = land ? A4S : A4L;
      s = Math.min((W - 2 * m) / iw, (H - 2 * m) / ih); dw = iw * s; dh = ih * s;
      x = (W - dw) / 2; y = (H - dh) / 2;
    }
    return { w: W, h: H, x: x, y: y, dw: dw, dh: dh };
  }

  root.INXPDF = { buildPdf: buildPdf, layout: layout };
  if (typeof module !== "undefined" && module.exports) module.exports = root.INXPDF;
  if (typeof document === "undefined") return;

  /* ---------- الواجهة ---------- */
  var $ = function (s) { return document.querySelector(s); };
  var drop = $("#ipDrop"), fileIn = $("#ipFile"), grid = $("#ipGrid"), goBtn = $("#ipGo"), clearBtn = $("#ipClear"),
      countEl = $("#ipCount"), statusEl = $("#ipStatus"), nameIn = $("#ipName");
  if (!grid) return;
  var MAX_FILES = 100, MAX_BYTES = 40 * 1024 * 1024;
  var QUAL = { high: { cap: 3000, q: 0.92 }, med: { cap: 2200, q: 0.8 }, low: { cap: 1600, q: 0.65 } };
  var items = [], uid = 0, busy = false, dragId = null;

  function toast(m, t) { if (window.INX && window.INX.toast) window.INX.toast(m, t || "ok"); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function status(msg, err) { statusEl.hidden = !msg; statusEl.textContent = msg || ""; statusEl.classList.toggle("err", !!err); }

  function addFiles(list) {
    var skipped = 0;
    Array.prototype.slice.call(list).forEach(function (f) {
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name)) { skipped++; return; }
      if (f.size > MAX_BYTES || items.length >= MAX_FILES) { skipped++; return; }
      items.push({ id: ++uid, file: f, url: URL.createObjectURL(f), rot: 0 });
    });
    if (skipped) toast("تم تجاهل " + skipped + " ملف (مش صورة، أو كبير زيادة، أو تعدّيت " + MAX_FILES + " صورة)", "error");
    render();
  }

  function render() {
    grid.innerHTML = items.map(function (it, i) {
      return '<div class="ip-tile" draggable="true" data-id="' + it.id + '"><span class="pg">' + (i + 1) + '</span>' +
        '<div class="ip-th"><img src="' + it.url + '" alt="" style="transform:rotate(' + it.rot + 'deg)' + (it.rot % 180 ? ";max-width:140px;max-height:140px" : "") + '"></div>' +
        '<div class="ip-nm" title="' + esc(it.file.name) + '">' + esc(it.file.name) + '</div>' +
        '<div class="ip-act">' +
        '<button type="button" data-a="prev" title="تقديم (قبل)"' + (i === 0 ? " disabled" : "") + '>→</button>' +
        '<button type="button" data-a="rot" title="تدوير 90°">↻</button>' +
        '<button type="button" data-a="del" class="del" title="حذف">✕</button>' +
        '<button type="button" data-a="next" title="تأخير (بعد)"' + (i === items.length - 1 ? " disabled" : "") + '>←</button>' +
        "</div></div>";
    }).join("");
    countEl.textContent = items.length ? items.length + " صورة = " + items.length + " صفحة PDF" : "لم يتم اختيار صور بعد";
    goBtn.disabled = clearBtn.disabled = busy || !items.length;
  }

  function idx(id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return i; return -1; }
  function moveTo(from, to) { if (from < 0 || to < 0 || to >= items.length || from === to) return; items.splice(to, 0, items.splice(from, 1)[0]); render(); }

  grid.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-a]"); if (!b || busy) return;
    var id = +b.closest(".ip-tile").dataset.id, i = idx(id), a = b.dataset.a;
    if (a === "prev") moveTo(i, i - 1);
    else if (a === "next") moveTo(i, i + 1);
    else if (a === "rot") { items[i].rot = (items[i].rot + 90) % 360; render(); }
    else if (a === "del") { URL.revokeObjectURL(items[i].url); items.splice(i, 1); render(); }
  });
  // سحب وإفلات لإعادة الترتيب
  grid.addEventListener("dragstart", function (e) { var t = e.target.closest(".ip-tile"); if (!t) return; dragId = +t.dataset.id; t.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", "x"); } catch (er) {} });
  grid.addEventListener("dragend", function () { dragId = null; render(); });
  grid.addEventListener("dragover", function (e) { if (dragId === null) return; e.preventDefault(); var t = e.target.closest(".ip-tile"); Array.prototype.forEach.call(grid.querySelectorAll(".over"), function (x) { x.classList.remove("over"); }); if (t) t.classList.add("over"); });
  grid.addEventListener("drop", function (e) { if (dragId === null) return; e.preventDefault(); var t = e.target.closest(".ip-tile"); if (t) moveTo(idx(dragId), idx(+t.dataset.id)); dragId = null; });

  fileIn.addEventListener("change", function () { addFiles(fileIn.files); fileIn.value = ""; });
  function hasFiles(e) { return !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") > -1); }
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { if (hasFiles(e)) drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove("over"); }); });
  // إسقاط الملفات في أي مكان بالصفحة يضيفها (ويمنع المتصفح من فتح الصورة بدل إضافتها)
  function active() { return drop.offsetParent !== null; }
  window.addEventListener("dragover", function (e) { if (active() && hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", function (e) { if (!active() || !hasFiles(e)) return; e.preventDefault(); if (!busy) addFiles(e.dataTransfer.files); });
  document.addEventListener("paste", function (e) {
    if (drop.offsetParent === null) return;
    var fs = []; Array.prototype.forEach.call((e.clipboardData && e.clipboardData.items) || [], function (it) { if (it.kind === "file" && /^image\//.test(it.type)) { var f = it.getAsFile(); if (f) fs.push(f); } });
    if (fs.length) { e.preventDefault(); addFiles(fs); }
  });
  clearBtn.addEventListener("click", function () { if (busy) return; items.forEach(function (it) { URL.revokeObjectURL(it.url); }); items = []; status(""); render(); });

  /* ---------- تحويل صورة -> JPEG (مع التدوير وتصغير الأبعاد الكبيرة) ---------- */
  function loadImg(url) {
    return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { rej(new Error("decode")); }; im.src = url; });
  }
  function toJpeg(it, qual) {
    return loadImg(it.url).then(function (im) {
      var sw = im.naturalWidth, sh = im.naturalHeight, turn = it.rot % 180 !== 0;
      var cw = turn ? sh : sw, ch = turn ? sw : sh, k = Math.min(1, qual.cap / Math.max(cw, ch));
      cw = Math.max(1, Math.round(cw * k)); ch = Math.max(1, Math.round(ch * k));
      var cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
      var cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cw, ch);
      cx.translate(cw / 2, ch / 2); cx.rotate(it.rot * Math.PI / 180);
      var dw = (turn ? ch : cw), dh = (turn ? cw : ch);
      cx.drawImage(im, -dw / 2, -dh / 2, dw, dh);
      return new Promise(function (res, rej) {
        cv.toBlob(function (b) { if (!b) return rej(new Error("encode")); b.arrayBuffer().then(function (buf) { res({ jpeg: new Uint8Array(buf), iw: cw, ih: ch }); }); }, "image/jpeg", qual.q);
      });
    });
  }

  function fileName() {
    var n = (nameIn.value || "").replace(/[\\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
    if (!n) { var d = new Date(); n = "images-" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + "-" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0"); }
    return n.replace(/\.pdf$/i, "") + ".pdf";
  }

  goBtn.addEventListener("click", function () {
    if (busy || !items.length) return;
    busy = true; render(); goBtn.classList.add("loading");
    var qual = QUAL[$("#ipQ").value] || QUAL.med, size = $("#ipSize").value, orient = $("#ipOri").value, m = +$("#ipMar").value || 0;
    var pages = [], chain = Promise.resolve(), failed = null, snapshot = items.slice();
    snapshot.forEach(function (it, i) {
      chain = chain.then(function () {
        if (failed) return;
        status("جاري تجهيز الصفحة " + (i + 1) + " من " + snapshot.length + "…");
        return toJpeg(it, qual).then(function (r) {
          var L = layout(r.iw, r.ih, size, orient, m);
          pages.push({ w: L.w, h: L.h, x: L.x, y: L.y, dw: L.dw, dh: L.dh, iw: r.iw, ih: r.ih, jpeg: r.jpeg });
        }, function () { failed = it.file.name; });
      });
    });
    chain.then(function () {
      if (failed) { status("تعذّر قراءة الصورة «" + failed + "» — جرّب صيغة JPG أو PNG (ملفات HEIC مش مدعومة في كل المتصفحات).", true); return; }
      var blob = buildPdf(pages), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = fileName(); document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      status("تم إنشاء الملف (" + (blob.size / 1048576).toFixed(2) + " MB) وتحميله على جهازك ✓");
      toast("تم تحميل ملف PDF");
    }).catch(function () { status("حصل خطأ أثناء إنشاء الملف. جرّب جودة أقل أو عدد صور أقل.", true); })
      .then(function () { busy = false; goBtn.classList.remove("loading"); render(); });
  });

  render();
})(typeof window !== "undefined" ? window : globalThis);
