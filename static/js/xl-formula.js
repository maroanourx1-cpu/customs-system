/* INX — xl-formula.js : محرك المعادلات لجداول Excel (بدون أي مكتبات خارجية)
   - تحليل المعادلات (Parser) + حساب القيم مع كشف الدوران (#CIRC!)
   - دوال Excel الشائعة + مراجع بين الأوراق (Sheet2!A1)
   - تحويل المراجع عند النسخ / إدراج / حذف الصفوف والأعمدة                           */
(function (root) {
  "use strict";

  /* ---------- helpers ---------- */
  function colLetter(i) { var s = ""; i++; while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
  function colIndex(s) { var n = 0; s = s.toUpperCase(); for (var i = 0; i < s.length; i++) n = n * 26 + s.charCodeAt(i) - 64; return n - 1; }
  function refOf(r, c) { return colLetter(c) + (r + 1); }
  function toLatin(s) {
    return String(s).replace(/[٠-٩]/g, function (d) { return "٠١٢٣٤٥٦٧٨٩".indexOf(d); }).replace(/[۰-۹]/g, function (d) { return "۰۱۲۳۴۵۶۷۸۹".indexOf(d); });
  }
  function parseNum(raw) {
    var t = toLatin(String(raw)).trim();
    if (!t) return null;
    var pct = t.charAt(t.length - 1) === "%";
    if (pct) t = t.slice(0, -1).trim();
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
    if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
    var v = parseFloat(t);
    return pct ? v / 100 : v;
  }
  function XlErr(code) { this.code = code; }
  XlErr.prototype.toString = function () { return this.code; };
  var E = function (c) { return new XlErr(c); };
  function isErr(v) { return v instanceof XlErr; }

  /* ---------- lexer ---------- */
  var RE_REF = /(?:(?:'([^']+)'|([A-Za-z_\u0600-\u06FF][A-Za-z0-9_.\u0600-\u06FF]*))!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?/y;
  var RE_NUM = /(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
  var RE_ID = /[A-Za-z_\u0600-\u06FF][A-Za-z0-9_.\u0600-\u06FF]*/y;
  var RE_ERR = /#(?:REF!|NAME\?|VALUE!|DIV\/0!|N\/A|CIRC!|NUM!)/y;
  var RE_OP = /<=|>=|<>|[=<>+\-*\/^&%(),;:]/y;
  var WORD = /[A-Za-z0-9_.$\u0600-\u06FF]/;

  function match(re, s, i) { re.lastIndex = i; return re.exec(s); }

  function lex(src) {
    var out = [], i = 0, n = src.length, m, ch;
    while (i < n) {
      ch = src.charAt(i);
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"') {
        var j = i + 1, str = "";
        while (j < n) {
          if (src.charAt(j) === '"') { if (src.charAt(j + 1) === '"') { str += '"'; j += 2; continue; } break; }
          str += src.charAt(j++);
        }
        if (j >= n) throw E("#VALUE!");
        out.push({ t: "str", v: str }); i = j + 1; continue;
      }
      if (ch === "#") { m = match(RE_ERR, src, i); if (m) { out.push({ t: "err", v: m[0] }); i += m[0].length; continue; } throw E("#NAME?"); }
      m = match(RE_REF, src, i);
      if (m && !WORD.test(i > 0 ? src.charAt(i - 1) : "") && !/[A-Za-z0-9_(]/.test(src.charAt(i + m[0].length) || "")) {
        out.push({ t: m[10] ? "range" : "ref", sheet: m[1] || m[2] || null,
          ac1: !!m[3], c1: colIndex(m[4]), ar1: !!m[5], r1: +m[6] - 1,
          ac2: !!m[7], c2: m[8] ? colIndex(m[8]) : 0, ar2: !!m[9], r2: m[10] ? +m[10] - 1 : 0 });
        i += m[0].length; continue;
      }
      m = match(RE_NUM, src, i);
      if (m) { out.push({ t: "num", v: parseFloat(m[0]) }); i += m[0].length; continue; }
      m = match(RE_ID, src, i);
      if (m) { out.push({ t: "id", v: m[0] }); i += m[0].length; continue; }
      m = match(RE_OP, src, i);
      if (m) { out.push({ t: "op", v: m[0] === ";" ? "," : m[0] }); i += m[0].length; continue; }
      throw E("#NAME?");
    }
    return out;
  }

  /* ---------- parser (precedence climbing) ---------- */
  function parse(src) {
    var tk = lex(src), p = 0;
    function peek() { return tk[p]; }
    function isOp(v) { var t = tk[p]; return t && t.t === "op" && t.v === v; }
    function next() { return tk[p++]; }
    function expr() { return cmp(); }
    function cmp() {
      var a = cat();
      while (peek() && peek().t === "op" && /^(=|<>|<=|>=|<|>)$/.test(peek().v)) { var op = next().v; a = { k: "bin", op: op, a: a, b: cat() }; }
      return a;
    }
    function cat() { var a = add(); while (isOp("&")) { next(); a = { k: "bin", op: "&", a: a, b: add() }; } return a; }
    function add() { var a = mul(); while (isOp("+") || isOp("-")) { var op = next().v; a = { k: "bin", op: op, a: a, b: mul() }; } return a; }
    function mul() { var a = pow(); while (isOp("*") || isOp("/")) { var op = next().v; a = { k: "bin", op: op, a: a, b: pow() }; } return a; }
    function pow() { var a = unary(); while (isOp("^")) { next(); a = { k: "bin", op: "^", a: a, b: unary() }; } return a; }
    function unary() {
      if (isOp("-")) { next(); return { k: "neg", a: unary() }; }
      if (isOp("+")) { next(); return unary(); }
      var a = prim();
      while (isOp("%")) { next(); a = { k: "pct", a: a }; }
      return a;
    }
    function prim() {
      var t = next();
      if (!t) throw E("#VALUE!");
      if (t.t === "num") return { k: "num", v: t.v };
      if (t.t === "str") return { k: "str", v: t.v };
      if (t.t === "err") return { k: "err", v: t.v };
      if (t.t === "ref") return { k: "ref", sheet: t.sheet, r: t.r1, c: t.c1 };
      if (t.t === "range") return { k: "range", sheet: t.sheet, r1: Math.min(t.r1, t.r2), c1: Math.min(t.c1, t.c2), r2: Math.max(t.r1, t.r2), c2: Math.max(t.c1, t.c2) };
      if (t.t === "op" && t.v === "(") { var e = expr(); if (!isOp(")")) throw E("#VALUE!"); next(); return e; }
      if (t.t === "id") {
        var up = t.v.toUpperCase();
        if (isOp("(")) {
          next();
          var args = [];
          if (isOp(")")) { next(); return { k: "fn", name: up, args: args }; }
          for (;;) {
            if (isOp(",")) args.push({ k: "blank" }); else args.push(expr());
            if (isOp(",")) { next(); if (isOp(")")) { args.push({ k: "blank" }); next(); break; } continue; }
            if (isOp(")")) { next(); break; }
            throw E("#VALUE!");
          }
          return { k: "fn", name: up, args: args };
        }
        if (up === "TRUE") return { k: "bool", v: true };
        if (up === "FALSE") return { k: "bool", v: false };
        throw E("#NAME?");
      }
      throw E("#VALUE!");
    }
    var tree = expr();
    if (p < tk.length) throw E("#VALUE!");
    return tree;
  }

  /* ---------- evaluation ---------- */
  var astCache = {};
  function compile(f) {
    var hit = astCache[f];
    if (hit) return hit;
    var ast;
    try { ast = parse(f.charAt(0) === "=" ? f.slice(1) : f); } catch (e) { ast = { k: "err", v: isErr(e) ? e.code : "#NAME?" }; }
    return (astCache[f] = ast);
  }

  /* ctx: { sheets:[{name,cells,...}], cur: index }  — يحتفظ بالكاش داخل ctx.cache */
  function makeCtx(book) { return { book: book, cache: {}, busy: {} }; }
  function sheetIdx(ctx, name, cur) {
    if (!name) return cur;
    var n = name.toLowerCase();
    for (var i = 0; i < ctx.book.sheets.length; i++) if (ctx.book.sheets[i].name.toLowerCase() === n) return i;
    return -1;
  }
  function cellValue(ctx, si, r, c) {
    var key = si + "|" + r + "|" + c;
    if (key in ctx.cache) return ctx.cache[key];
    var sh = ctx.book.sheets[si], cell = sh && sh.cells[refOf(r, c)], v;
    if (!cell || cell.r === undefined || cell.r === "") v = null;
    else {
      var raw = String(cell.r);
      if (raw.charAt(0) === "=" && raw.length > 1) {
        if (ctx.busy[key]) return E("#CIRC!");
        ctx.busy[key] = 1;
        try { v = evalNode(compile(raw), ctx, si); } catch (e) { v = isErr(e) ? e : E("#VALUE!"); }
        delete ctx.busy[key];
        if (v && v.__range) v = v.get(0, 0);
        if (v === undefined) v = null;
      } else if (raw.charAt(0) === "'") v = raw.slice(1);
      else {
        var n = parseNum(raw);
        if (n !== null) v = n;
        else { var up = raw.trim().toUpperCase(); v = up === "TRUE" ? true : up === "FALSE" ? false : raw; }
      }
    }
    ctx.cache[key] = v;
    return v;
  }
  function toNum(v) {
    if (isErr(v)) throw v;
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    var n = parseNum(v);
    if (n === null) throw E("#VALUE!");
    return n;
  }
  function toStr(v) {
    if (isErr(v)) throw v;
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "number") return numStr(v);
    return String(v);
  }
  function toBool(v) {
    if (isErr(v)) throw v;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (v === null || v === "") return false;
    var u = String(v).toUpperCase();
    if (u === "TRUE") return true; if (u === "FALSE") return false;
    var n = parseNum(v); if (n !== null) return n !== 0;
    throw E("#VALUE!");
  }
  function numStr(v) {
    if (!isFinite(v)) return "#NUM!";
    var s = String(+v.toPrecision(12));
    return s.indexOf("e") > -1 ? String(v) : s;
  }
  function scalar(v) { return v && v.__range ? v.get(0, 0) : v; }

  function rangeObj(ctx, si, r1, c1, r2, c2) {
    return { __range: true, rows: r2 - r1 + 1, cols: c2 - c1 + 1, get: function (i, j) { return cellValue(ctx, si, r1 + i, c1 + j); },
      each: function (fn) { for (var i = r1; i <= r2; i++) for (var j = c1; j <= c2; j++) fn(cellValue(ctx, si, i, j)); } };
  }

  function evalNode(n, ctx, si) {
    switch (n.k) {
      case "num": case "str": case "bool": return n.v;
      case "blank": return null;
      case "err": return E(n.v);
      case "ref": {
        var s1 = sheetIdx(ctx, n.sheet, si); if (s1 < 0) return E("#REF!");
        return cellValue(ctx, s1, n.r, n.c);
      }
      case "range": {
        var s2 = sheetIdx(ctx, n.sheet, si); if (s2 < 0) return E("#REF!");
        if ((n.r2 - n.r1 + 1) * (n.c2 - n.c1 + 1) > 600000) return E("#VALUE!");
        return rangeObj(ctx, s2, n.r1, n.c1, n.r2, n.c2);
      }
      case "neg": return -toNum(scalar(evalNode(n.a, ctx, si)));
      case "pct": return toNum(scalar(evalNode(n.a, ctx, si))) / 100;
      case "bin": return binop(n, ctx, si);
      case "fn": return callFn(n, ctx, si);
    }
    throw E("#VALUE!");
  }
  function cmpVals(a, b) {
    // Excel: numbers < text < booleans ; النصوص غير حساسة لحالة الأحرف
    function rank(x) { return x === null ? 0 : typeof x === "number" ? 1 : typeof x === "string" ? 2 : 3; }
    if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
    if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
    var ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (typeof a === "string") { a = a.toLowerCase(); b = b.toLowerCase(); }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function binop(n, ctx, si) {
    var a = scalar(evalNode(n.a, ctx, si)), b = scalar(evalNode(n.b, ctx, si));
    if (isErr(a)) return a; if (isErr(b)) return b;
    switch (n.op) {
      case "+": return toNum(a) + toNum(b);
      case "-": return toNum(a) - toNum(b);
      case "*": return toNum(a) * toNum(b);
      case "/": { var d = toNum(b); if (d === 0) return E("#DIV/0!"); return toNum(a) / d; }
      case "^": { var r = Math.pow(toNum(a), toNum(b)); return isFinite(r) ? r : E("#NUM!"); }
      case "&": return toStr(a) + toStr(b);
      case "=": return cmpVals(a, b) === 0;
      case "<>": return cmpVals(a, b) !== 0;
      case "<": return cmpVals(a, b) < 0;
      case ">": return cmpVals(a, b) > 0;
      case "<=": return cmpVals(a, b) <= 0;
      case ">=": return cmpVals(a, b) >= 0;
    }
    return E("#VALUE!");
  }

  /* ---------- functions ---------- */
  function nums(args, ctx, si, strict) {
    var out = [];
    args.forEach(function (a) {
      var v = evalNode(a, ctx, si);
      if (v && v.__range) {
        v.each(function (x) { if (isErr(x)) throw x; if (typeof x === "number") out.push(x); });
      } else {
        if (isErr(v)) throw v;
        if (v === null || v === undefined) { if (strict) out.push(0); return; }
        if (typeof v === "string" && parseNum(v) === null) throw E("#VALUE!");
        out.push(toNum(v));
      }
    });
    return out;
  }
  function critFn(c) {
    if (typeof c === "number") return function (v) { return typeof v === "number" && v === c; };
    var s = String(c === null ? "" : c), m = /^(<=|>=|<>|=|<|>)?(.*)$/.exec(s), op = m[1] || "=", rhs = m[2], n = parseNum(rhs);
    var re = null;
    if (n === null && /[*?]/.test(rhs)) re = new RegExp("^" + rhs.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
    return function (v) {
      if (n !== null) {
        var x = typeof v === "number" ? v : (typeof v === "string" ? parseNum(v) : null);
        if (x === null) return op === "<>";
        return op === "=" ? x === n : op === "<>" ? x !== n : op === "<" ? x < n : op === ">" ? x > n : op === "<=" ? x <= n : x >= n;
      }
      var t = v === null ? "" : String(v);
      if (re) { var ok = re.test(t); return op === "<>" ? !ok : ok; }
      var c2 = cmpVals(t, rhs);
      return op === "=" ? c2 === 0 : op === "<>" ? c2 !== 0 : op === "<" ? c2 < 0 : op === ">" ? c2 > 0 : op === "<=" ? c2 <= 0 : c2 >= 0;
    };
  }
  function rangeArg(n, ctx, si) { var v = evalNode(n, ctx, si); if (!(v && v.__range)) { if (isErr(v)) throw v; return { __range: true, rows: 1, cols: 1, get: function () { return v; }, each: function (f) { f(v); } }; } return v; }
  function roundTo(x, d, mode) {
    var f = Math.pow(10, d), y = x * f;
    y = mode === "up" ? (y < 0 ? Math.floor(y) : Math.ceil(y)) : mode === "down" ? (y < 0 ? Math.ceil(y) : Math.floor(y)) : (y < 0 ? -Math.round(-y + 1e-12) : Math.round(y + 1e-12));
    return y / f;
  }
  function fmtText(v, f) {
    var n = toNum(v), m = /^(#,##)?0(\.(0+))?(%)?$/.exec(String(f));
    if (!m) return numStr(n);
    var dec = m[3] ? m[3].length : 0, x = m[4] ? n * 100 : n, s = Math.abs(x).toFixed(dec);
    if (m[1]) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (x < 0 ? "-" : "") + s + (m[4] ? "%" : "");
  }
  function today() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }

  var F = {
    SUM: function (a, c, s) { return nums(a, c, s).reduce(function (x, y) { return x + y; }, 0); },
    AVERAGE: function (a, c, s) { var v = nums(a, c, s); if (!v.length) return E("#DIV/0!"); return v.reduce(function (x, y) { return x + y; }, 0) / v.length; },
    MIN: function (a, c, s) { var v = nums(a, c, s); return v.length ? Math.min.apply(null, v) : 0; },
    MAX: function (a, c, s) { var v = nums(a, c, s); return v.length ? Math.max.apply(null, v) : 0; },
    PRODUCT: function (a, c, s) { return nums(a, c, s).reduce(function (x, y) { return x * y; }, 1); },
    MEDIAN: function (a, c, s) { var v = nums(a, c, s).sort(function (x, y) { return x - y; }); if (!v.length) return E("#NUM!"); var m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; },
    COUNT: function (a, c, s) { var k = 0; a.forEach(function (x) { var v = evalNode(x, c, s); if (v && v.__range) v.each(function (y) { if (typeof y === "number") k++; }); else if (typeof v === "number" || (typeof v === "string" && parseNum(v) !== null)) k++; }); return k; },
    COUNTA: function (a, c, s) { var k = 0; a.forEach(function (x) { var v = evalNode(x, c, s); if (v && v.__range) v.each(function (y) { if (y !== null && y !== "") k++; }); else if (v !== null) k++; }); return k; },
    COUNTBLANK: function (a, c, s) { var k = 0, v = rangeArg(a[0], c, s); v.each(function (y) { if (y === null || y === "") k++; }); return k; },
    ABS: function (a, c, s) { return Math.abs(toNum(scalar(evalNode(a[0], c, s)))); },
    SQRT: function (a, c, s) { var x = toNum(scalar(evalNode(a[0], c, s))); return x < 0 ? E("#NUM!") : Math.sqrt(x); },
    INT: function (a, c, s) { return Math.floor(toNum(scalar(evalNode(a[0], c, s)))); },
    POWER: function (a, c, s) { return Math.pow(toNum(scalar(evalNode(a[0], c, s))), toNum(scalar(evalNode(a[1], c, s)))); },
    MOD: function (a, c, s) { var x = toNum(scalar(evalNode(a[0], c, s))), y = toNum(scalar(evalNode(a[1], c, s))); if (!y) return E("#DIV/0!"); return x - y * Math.floor(x / y); },
    ROUND: function (a, c, s) { return roundTo(toNum(scalar(evalNode(a[0], c, s))), a[1] ? toNum(scalar(evalNode(a[1], c, s))) : 0); },
    ROUNDUP: function (a, c, s) { return roundTo(toNum(scalar(evalNode(a[0], c, s))), a[1] ? toNum(scalar(evalNode(a[1], c, s))) : 0, "up"); },
    ROUNDDOWN: function (a, c, s) { return roundTo(toNum(scalar(evalNode(a[0], c, s))), a[1] ? toNum(scalar(evalNode(a[1], c, s))) : 0, "down"); },
    IF: function (a, c, s) { var t = toBool(scalar(evalNode(a[0], c, s))); var n = t ? a[1] : a[2]; if (!n) return t; return scalar(evalNode(n, c, s)); },
    IFERROR: function (a, c, s) { var v; try { v = scalar(evalNode(a[0], c, s)); } catch (e) { if (isErr(e)) v = e; else throw e; } return isErr(v) ? scalar(evalNode(a[1], c, s)) : v; },
    AND: function (a, c, s) { return a.every(function (x) { var v = evalNode(x, c, s); if (v && v.__range) { var ok = true; v.each(function (y) { if (y !== null && y !== "" && !toBool(y)) ok = false; }); return ok; } return toBool(v); }); },
    OR: function (a, c, s) { return a.some(function (x) { var v = evalNode(x, c, s); if (v && v.__range) { var ok = false; v.each(function (y) { if (y !== null && y !== "" && toBool(y)) ok = true; }); return ok; } return toBool(v); }); },
    NOT: function (a, c, s) { return !toBool(scalar(evalNode(a[0], c, s))); },
    ISBLANK: function (a, c, s) { var v = scalar(evalNode(a[0], c, s)); return v === null || v === ""; },
    ISNUMBER: function (a, c, s) { return typeof scalar(evalNode(a[0], c, s)) === "number"; },
    ISTEXT: function (a, c, s) { return typeof scalar(evalNode(a[0], c, s)) === "string"; },
    ISERROR: function (a, c, s) { var v; try { v = scalar(evalNode(a[0], c, s)); } catch (e) { return true; } return isErr(v); },
    LEN: function (a, c, s) { return toStr(scalar(evalNode(a[0], c, s))).length; },
    UPPER: function (a, c, s) { return toStr(scalar(evalNode(a[0], c, s))).toUpperCase(); },
    LOWER: function (a, c, s) { return toStr(scalar(evalNode(a[0], c, s))).toLowerCase(); },
    TRIM: function (a, c, s) { return toStr(scalar(evalNode(a[0], c, s))).replace(/\s+/g, " ").trim(); },
    LEFT: function (a, c, s) { return toStr(scalar(evalNode(a[0], c, s))).slice(0, a[1] ? toNum(scalar(evalNode(a[1], c, s))) : 1); },
    RIGHT: function (a, c, s) { var t = toStr(scalar(evalNode(a[0], c, s))), k = a[1] ? toNum(scalar(evalNode(a[1], c, s))) : 1; return k ? t.slice(-k) : ""; },
    MID: function (a, c, s) { var t = toStr(scalar(evalNode(a[0], c, s))), st = toNum(scalar(evalNode(a[1], c, s))), k = toNum(scalar(evalNode(a[2], c, s))); return t.substr(st - 1, k); },
    CONCAT: function (a, c, s) { var o = ""; a.forEach(function (x) { var v = evalNode(x, c, s); if (v && v.__range) v.each(function (y) { o += toStr(y); }); else o += toStr(v); }); return o; },
    SUBSTITUTE: function (a, c, s) { var t = toStr(scalar(evalNode(a[0], c, s))), f = toStr(scalar(evalNode(a[1], c, s))), r = toStr(scalar(evalNode(a[2], c, s))); return f ? t.split(f).join(r) : t; },
    FIND: function (a, c, s) { var i = toStr(scalar(evalNode(a[1], c, s))).indexOf(toStr(scalar(evalNode(a[0], c, s)))); return i < 0 ? E("#VALUE!") : i + 1; },
    TEXT: function (a, c, s) { return fmtText(scalar(evalNode(a[0], c, s)), toStr(scalar(evalNode(a[1], c, s)))); },
    VALUE: function (a, c, s) { return toNum(scalar(evalNode(a[0], c, s))); },
    TODAY: function () { return today(); },
    NOW: function () { return today() + " " + new Date().toTimeString().slice(0, 8); },
    ROW: function (a, c, s) { return a[0] && a[0].k === "ref" ? a[0].r + 1 : E("#VALUE!"); },
    COLUMN: function (a, c, s) { return a[0] && a[0].k === "ref" ? a[0].c + 1 : E("#VALUE!"); },
    SUMIF: function (a, c, s) {
      var rg = rangeArg(a[0], c, s), f = critFn(scalar(evalNode(a[1], c, s))), sr = a[2] ? rangeArg(a[2], c, s) : rg, t = 0;
      for (var i = 0; i < rg.rows; i++) for (var j = 0; j < rg.cols; j++) if (f(rg.get(i, j))) { var v = sr.get(i, j); if (isErr(v)) return v; if (typeof v === "number") t += v; }
      return t;
    },
    COUNTIF: function (a, c, s) { var rg = rangeArg(a[0], c, s), f = critFn(scalar(evalNode(a[1], c, s))), k = 0; rg.each(function (v) { if (f(v)) k++; }); return k; },
    AVERAGEIF: function (a, c, s) {
      var rg = rangeArg(a[0], c, s), f = critFn(scalar(evalNode(a[1], c, s))), sr = a[2] ? rangeArg(a[2], c, s) : rg, t = 0, k = 0;
      for (var i = 0; i < rg.rows; i++) for (var j = 0; j < rg.cols; j++) if (f(rg.get(i, j))) { var v = sr.get(i, j); if (typeof v === "number") { t += v; k++; } }
      return k ? t / k : E("#DIV/0!");
    },
    VLOOKUP: function (a, c, s) {
      var key = scalar(evalNode(a[0], c, s)), tb = rangeArg(a[1], c, s), ci = toNum(scalar(evalNode(a[2], c, s))), ex = a[3] ? !toBool(scalar(evalNode(a[3], c, s))) : false;
      if (ci < 1 || ci > tb.cols) return E("#REF!");
      var best = -1;
      for (var i = 0; i < tb.rows; i++) {
        var v = tb.get(i, 0), d = cmpVals(v, key);
        if (ex) { if (d === 0) { best = i; break; } } else { if (d <= 0) best = i; else break; }
      }
      return best < 0 ? E("#N/A") : tb.get(best, ci - 1);
    },
    MATCH: function (a, c, s) {
      var key = scalar(evalNode(a[0], c, s)), rg = rangeArg(a[1], c, s), t = a[2] ? toNum(scalar(evalNode(a[2], c, s))) : 1, k = [];
      rg.each(function (v) { k.push(v); });
      if (t === 0) { for (var i = 0; i < k.length; i++) if (cmpVals(k[i], key) === 0) return i + 1; return E("#N/A"); }
      var b = -1; for (var j = 0; j < k.length; j++) { if (cmpVals(k[j], key) <= 0) b = j; else break; } return b < 0 ? E("#N/A") : b + 1;
    },
    INDEX: function (a, c, s) {
      var rg = rangeArg(a[0], c, s), r = a[1] ? toNum(scalar(evalNode(a[1], c, s))) : 1, k = a[2] ? toNum(scalar(evalNode(a[2], c, s))) : 1;
      if (rg.rows === 1 && !a[2]) { k = r; r = 1; }
      if (r < 1 || k < 1 || r > rg.rows || k > rg.cols) return E("#REF!");
      return rg.get(r - 1, k - 1);
    }
  };
  F.AVG = F.AVERAGE; F.CONCATENATE = F.CONCAT;
  var FN_NAMES = Object.keys(F).filter(function (k) { return k !== "AVG"; }).sort();

  function callFn(n, ctx, si) {
    var f = F[n.name];
    if (!f) return E("#NAME?");
    var r = f(n.args, ctx, si);
    if (r && r.__range) r = r.get(0, 0);
    if (typeof r === "number" && !isFinite(r)) return E("#NUM!");
    return r === undefined ? null : r;
  }

  /* ---------- public: evaluate cell with cache ---------- */
  function evaluate(ctx, si, r, c) { return cellValue(ctx, si, r, c); }

  /* ---------- reference rewriting (copy / insert / delete) ---------- */
  function mapRefs(f, fn) {
    var out = "", i = 0, n = f.length, ch, m;
    while (i < n) {
      ch = f.charAt(i);
      if (ch === '"') { var j = i + 1; while (j < n) { if (f.charAt(j) === '"') { if (f.charAt(j + 1) === '"') { j += 2; continue; } break; } j++; } out += f.slice(i, j + 1); i = j + 1; continue; }
      m = match(RE_REF, f, i);
      if (m && !WORD.test(i > 0 ? f.charAt(i - 1) : "") && !/[A-Za-z0-9_(]/.test(f.charAt(i + m[0].length) || "")) {
        var rep = fn({
          sheet: m[1] || m[2] || null, quoted: !!m[1],
          ac1: !!m[3], c1: colIndex(m[4]), ar1: !!m[5], r1: +m[6] - 1,
          isRange: !!m[10], ac2: !!m[7], c2: m[8] ? colIndex(m[8]) : 0, ar2: !!m[9], r2: m[10] ? +m[10] - 1 : 0
        });
        out += rep === null ? m[0] : rep; i += m[0].length; continue;
      }
      if (/[A-Za-z_\u0600-\u06FF]/.test(ch)) { var k = i; while (k < n && /[A-Za-z0-9_.\u0600-\u06FF$]/.test(f.charAt(k))) k++; if (k > i && !m) { out += f.slice(i, k); i = k; continue; } }
      out += ch; i++;
    }
    return out;
  }
  function build(t) {
    var pre = t.sheet ? (t.quoted || /[^A-Za-z0-9_.]/.test(t.sheet) ? "'" + t.sheet + "'" : t.sheet) + "!" : "";
    var a = (t.ac1 ? "$" : "") + colLetter(t.c1) + (t.ar1 ? "$" : "") + (t.r1 + 1);
    if (!t.isRange) return pre + a;
    return pre + a + ":" + (t.ac2 ? "$" : "") + colLetter(t.c2) + (t.ar2 ? "$" : "") + (t.r2 + 1);
  }
  /* إزاحة المراجع النسبية (للنسخ واللصق والتعبئة) */
  function shiftRel(f, dr, dc) {
    if (!dr && !dc) return f;
    return mapRefs(f, function (t) {
      var r1 = t.ar1 ? t.r1 : t.r1 + dr, c1 = t.ac1 ? t.c1 : t.c1 + dc, r2 = t.ar2 ? t.r2 : t.r2 + dr, c2 = t.ac2 ? t.c2 : t.c2 + dc;
      if (r1 < 0 || c1 < 0 || (t.isRange && (r2 < 0 || c2 < 0))) return "#REF!";
      t.r1 = r1; t.c1 = c1; t.r2 = r2; t.c2 = c2; return build(t);
    });
  }
  /* تعديل المراجع عند إدراج/حذف صفوف أو أعمدة في ورقة معيّنة.
     axis: "r"|"c" ، at: الفهرس ، delta>0 إدراج delta ، delta<0 حذف |delta|.  fSheet: اسم ورقة المعادلة، target: اسم الورقة المتأثرة */
  function adjust(f, fSheet, target, axis, at, delta) {
    var tl = target.toLowerCase();
    return mapRefs(f, function (t) {
      var nm = (t.sheet || fSheet).toLowerCase();
      if (nm !== tl) return null;
      function mv(i) { return i >= at ? i + delta : i; }
      var a = axis === "r" ? t.r1 : t.c1, b = axis === "r" ? (t.isRange ? t.r2 : t.r1) : (t.isRange ? t.c2 : t.c1);
      if (delta > 0) { a = mv(a); b = mv(b); }
      else {
        var k = -delta, end = at + k - 1;
        if (!t.isRange) { if (a >= at && a <= end) return "#REF!"; a = a > end ? a - k : a; b = a; }
        else {
          if (a >= at && b <= end) return "#REF!";
          var na = a < at ? a : (a > end ? a - k : at), nb = b < at ? b : (b > end ? b - k : at - 1);
          if (b > end) nb = b - k; else if (b >= at) nb = at - 1;
          if (a >= at && a <= end) na = at;
          a = na; b = nb;
          if (b < a) return "#REF!";
        }
      }
      if (axis === "r") { t.r1 = a; if (t.isRange) t.r2 = b; } else { t.c1 = a; if (t.isRange) t.c2 = b; }
      return build(t);
    });
  }

  /* ---------- number formatting for display ---------- */
  function group(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function format(v, nf) {
    if (isErr(v)) return v.code;
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "number") {
      if (nf === "n2") { var s = Math.abs(v).toFixed(2); return (v < 0 && +s ? "-" : "") + group(s); }
      if (nf === "n0") { var s0 = Math.abs(v).toFixed(0); return (v < 0 && +s0 ? "-" : "") + group(s0); }
      if (nf === "pct") return (v * 100).toFixed(2) + "%";
      return numStr(v);
    }
    return String(v);
  }

  var api = { colLetter: colLetter, colIndex: colIndex, refOf: refOf, parseNum: parseNum, toLatin: toLatin, makeCtx: makeCtx, evaluate: evaluate,
    shiftRel: shiftRel, adjust: adjust, format: format, isErr: isErr, FN_NAMES: FN_NAMES, compile: compile };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.XLF = api;
})(typeof window !== "undefined" ? window : globalThis);
