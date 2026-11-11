# -*- coding: utf-8 -*-
"""وحدة «جداول Excel» داخل INX: جداول بيانات قابلة للتعديل (معادلات + تنسيق) محفوظة في قاعدة البيانات،
مع استيراد/تصدير .xlsx و .csv وإنشاء جدول من نتائج الشحنات.

الشكل المخزَّن للمصنّف (JSON):
{"v":1, "active":0, "sheets":[{"name":"Sheet1","rows":100,"cols":26,"cells":{"A1":{"r":"نص أو =SUM(B1:B3)","s":{"b":1,"al":"c","bg":"#ffeeaa","nf":"n2"}}},
                              "colw":{"0":140}, "freeze":0}]}
"""
import csv
import io
import json
import re

from flask import abort, flash, g, jsonify, redirect, render_template, request, send_file, session, url_for
from markupsafe import Markup

MAX_BYTES = 12 * 1024 * 1024
MAX_ROWS, MAX_COLS, MAX_SHEETS = 5000, 100, 40
_DIG = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")

SHIP_COLS = [  # (عنوان, دالة استخراج, عرض بالبكسل, رقمي؟)
    ("رقم الشحنة", lambda s: s["number"], 110, False),
    ("العميل", lambda s: s["client"], 170, False),
    ("المورد", lambda s: s["supplier"], 160, False),
    ("ACID", lambda s: s["acid"], 130, False),
    ("الرقم الضريبي", lambda s: s["tax_number"], 120, False),
    ("رقم البوليصة", lambda s: s["bl_number"], 130, False),
    ("شركة الشحن", lambda s: s["carrier"], 120, False),
    ("تاريخ الوصول", lambda s: s["arrival_date"], 110, False),
    ("الطرود", lambda s: s["packages"], 80, True),
    ("الوزن القائم", lambda s: s["weight"], 100, True),
    ("الوزن الصافي", lambda s: s["net_weight"], 100, True),
    ("العملة", lambda s: s["invoice_currency"], 80, False),
    ("قيمة الفاتورة", lambda s: s["invoice_value"], 120, True),
    ("المنشأ", lambda s: s["origin"], 100, False),
    ("المرحلة", None, 190, False),
    ("الموظف المسؤول", lambda s: s["resp_name"], 140, False),
]


# ---------------------------------------------------------------- helpers
def col_letter(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def col_index(letters):
    n = 0
    for ch in letters.upper():
        n = n * 26 + ord(ch) - 64
    return n - 1


def parse_num(raw):
    """نفس منطق الواجهة: يحوّل نصًا يشبه الرقم إلى رقم أو يرجع None."""
    t = str(raw).strip().translate(_DIG)
    if not t:
        return None
    pct = t.endswith("%")
    if pct:
        t = t[:-1].strip()
    if re.fullmatch(r"-?\d{1,3}(,\d{3})+(\.\d+)?", t):
        t = t.replace(",", "")
    if not re.fullmatch(r"-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?", t):
        return None
    v = float(t)
    return v / 100 if pct else v


def blank_sheet(name="Sheet1", rows=100, cols=26):
    return {"name": name, "rows": rows, "cols": cols, "cells": {}, "colw": {}, "freeze": 0}


def blank_book(title=""):
    return {"v": 1, "active": 0, "sheets": [blank_sheet()]}


def book_info(book):
    return json.dumps({"sheets": len(book["sheets"]), "cells": sum(len(s.get("cells", {})) for s in book["sheets"])})


def validate_book(raw):
    """يتحقق من JSON القادم من المتصفح ويرجع قاموسًا نظيفًا أو يرفع ValueError."""
    if len(raw) > MAX_BYTES:
        raise ValueError("حجم الجدول كبير جدًا")
    try:
        d = json.loads(raw)
    except Exception:
        raise ValueError("بيانات الجدول غير صالحة")
    if not isinstance(d, dict) or not isinstance(d.get("sheets"), list) or not 1 <= len(d["sheets"]) <= MAX_SHEETS:
        raise ValueError("بنية الجدول غير صحيحة")
    out = {"v": 1, "active": int(d.get("active") or 0), "sheets": []}
    for sh in d["sheets"]:
        if not isinstance(sh, dict):
            raise ValueError("بنية الورقة غير صحيحة")
        cells = {}
        for ref, c in (sh.get("cells") or {}).items():
            if not re.fullmatch(r"[A-Z]{1,3}[0-9]{1,5}", str(ref)) or not isinstance(c, dict):
                continue
            r = str(c.get("r", ""))[:32000]
            s = c.get("s") if isinstance(c.get("s"), dict) else None
            if r == "" and not s:
                continue
            cells[ref] = {"r": r}
            if s:
                cells[ref]["s"] = {k: v for k, v in s.items() if k in ("b", "i", "al", "bg", "fg", "nf", "bd") and isinstance(v, (str, int))}
        colw = {str(k): max(30, min(int(v), 800)) for k, v in (sh.get("colw") or {}).items() if str(k).isdigit() and isinstance(v, (int, float))}
        out["sheets"].append({
            "name": str(sh.get("name") or "Sheet")[:60],
            "rows": max(1, min(int(sh.get("rows") or 100), MAX_ROWS)),
            "cols": max(1, min(int(sh.get("cols") or 26), MAX_COLS)),
            "cells": cells, "colw": colw, "freeze": 1 if sh.get("freeze") else 0})
    out["active"] = min(max(out["active"], 0), len(out["sheets"]) - 1)
    return out


def js_embed(obj):
    """JSON آمن للتضمين داخل <script>."""
    return Markup(json.dumps(obj, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026").replace("\u2028", "\\u2028"))


def _semis_to_commas(f):
    """يحوّل ; إلى , خارج النصوص المقتبسة (Excel بالإنجليزي يحتاج الفاصلة)."""
    out, q = [], False
    for ch in f:
        if ch == '"':
            q = not q
        out.append("," if ch == ";" and not q else ch)
    return "".join(out)


# ---------------------------------------------------------------- xlsx <-> book
NF_OUT = {"n2": "#,##0.00", "n0": "#,##0", "pct": "0.00%", "cur": '#,##0.00 "EGP"'}


def book_to_xlsx(book):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    wb = Workbook()
    wb.remove(wb.active)
    used = set()
    thin = Side(style="thin", color="FFBBBBBB")
    for sh in book["sheets"]:
        name = re.sub(r"[\[\]\*\?/\\:]", "-", sh["name"])[:31] or "Sheet"
        base, n = name, 2
        while name.lower() in used:
            name = f"{base[:28]}-{n}"
            n += 1
        used.add(name.lower())
        ws = wb.create_sheet(title=name)
        for ref, c in sh["cells"].items():
            raw, st = c.get("r", ""), c.get("s") or {}
            cell = ws[ref]
            if raw.startswith("="):
                cell.value = _semis_to_commas(raw)
            elif raw.startswith("'"):
                cell.value = raw[1:]
            else:
                num = parse_num(raw)
                if num is None:
                    up = raw.strip().upper()
                    cell.value = (up == "TRUE") if up in ("TRUE", "FALSE") else raw
                else:
                    cell.value = int(num) if num == int(num) and abs(num) < 1e15 and "%" not in raw and "." not in raw else num
                    if raw.strip().endswith("%"):
                        cell.number_format = "0.##%"
            if st.get("b") or st.get("i") or st.get("fg"):
                cell.font = Font(bold=bool(st.get("b")), italic=bool(st.get("i")), color=(st["fg"].lstrip("#").upper() if st.get("fg") else None))
            if st.get("bg"):
                cell.fill = PatternFill("solid", fgColor=st["bg"].lstrip("#").upper())
            if st.get("al") in ("l", "c", "r"):
                cell.alignment = Alignment(horizontal={"l": "left", "c": "center", "r": "right"}[st["al"]])
            if st.get("nf") in NF_OUT:
                cell.number_format = NF_OUT[st["nf"]]
            if st.get("bd"):
                cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)
        for k, w in (sh.get("colw") or {}).items():
            ws.column_dimensions[get_column_letter(int(k) + 1)].width = round(int(w) / 7.2, 1)
        if sh.get("freeze"):
            ws.freeze_panes = "A2"
    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    return bio


def _rgb(color):
    try:
        v = color.rgb
        if isinstance(v, str) and len(v) == 8 and v[:2] in ("FF", "00") and v != "00000000":
            return "#" + v[2:].lower()
    except Exception:
        pass
    return None


def xlsx_to_book(fileobj):
    from openpyxl import load_workbook
    wb = load_workbook(fileobj, data_only=False)
    book = {"v": 1, "active": 0, "sheets": []}
    for ws in wb.worksheets[:MAX_SHEETS]:
        rows, cols = min(ws.max_row or 1, MAX_ROWS), min(ws.max_column or 1, MAX_COLS)
        cells = {}
        for row in ws.iter_rows(min_row=1, max_row=rows, max_col=cols):
            for c in row:
                v = c.value
                if v is None:
                    continue
                if hasattr(v, "text"):         # ArrayFormula
                    v = v.text
                if isinstance(v, bool):
                    raw = "TRUE" if v else "FALSE"
                elif isinstance(v, (int, float)):
                    raw = str(int(v)) if float(v) == int(v) and abs(v) < 1e15 else repr(float(v))
                elif hasattr(v, "isoformat"):
                    raw = v.isoformat()[:10] if not getattr(v, "hour", 0) else v.isoformat(sep=" ")[:19]
                else:
                    raw = str(v)
                cell = {"r": raw}
                st = {}
                try:
                    if c.font and c.font.b:
                        st["b"] = 1
                    if c.font and c.font.i:
                        st["i"] = 1
                    fg = _rgb(c.font.color) if c.font and c.font.color else None
                    if fg and fg != "#000000":
                        st["fg"] = fg
                    if c.fill and c.fill.fill_type == "solid":
                        bg = _rgb(c.fill.fgColor)
                        if bg and bg != "#ffffff":
                            st["bg"] = bg
                    h = c.alignment.horizontal if c.alignment else None
                    if h in ("left", "center", "right"):
                        st["al"] = h[0]
                    nf = c.number_format or ""
                    if "%" in nf:
                        st["nf"] = "pct"
                    elif nf in ("#,##0.00", "0.00", "#,##0.00_);(#,##0.00)"):
                        st["nf"] = "n2"
                    elif nf in ("#,##0", "0"):
                        st["nf"] = "n0" if nf != "0" else None
                    if c.border and (c.border.left.style or c.border.top.style):
                        st["bd"] = 1
                except Exception:
                    pass
                st = {k: v for k, v in st.items() if v}
                if st:
                    cell["s"] = st
                cells[f"{col_letter(c.column - 1)}{c.row}"] = cell
        colw = {}
        for letter, dim in ws.column_dimensions.items():
            if dim.width:
                try:
                    colw[str(col_index(letter))] = int(dim.width * 7.2)
                except Exception:
                    pass
        book["sheets"].append({"name": (ws.title or "Sheet")[:60], "rows": max(rows + 40, 100), "cols": max(cols + 4, 12),
                               "cells": cells, "colw": {k: v for k, v in colw.items() if int(k) < MAX_COLS},
                               "freeze": 1 if ws.freeze_panes and ws.freeze_panes.endswith("2") else 0})
    if not book["sheets"]:
        book = blank_book()
    return book


def csv_to_book(data):
    for enc in ("utf-8-sig", "cp1256", "latin-1"):
        try:
            text = data.decode(enc)
            break
        except Exception:
            continue
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except Exception:
        dialect = csv.excel
    cells, cols = {}, 1
    for r, row in enumerate(csv.reader(io.StringIO(text), dialect)):
        if r >= MAX_ROWS:
            break
        for c, v in enumerate(row[:MAX_COLS]):
            if v != "":
                cells[f"{col_letter(c)}{r + 1}"] = {"r": v}
                cols = max(cols, c + 1)
    n = max([int(re.sub(r"\D", "", k)) for k in cells] or [1])
    sh = blank_sheet("Sheet1", max(n + 40, 100), max(cols + 4, 12))
    sh["cells"] = cells
    return {"v": 1, "active": 0, "sheets": [sh]}


def shipments_to_book(rows, stages):
    head_style = {"b": 1, "bg": "#dbe8ff", "bd": 1}
    cells, colw = {}, {}
    for c, (title, _, w, _) in enumerate(SHIP_COLS):
        cells[f"{col_letter(c)}1"] = {"r": title, "s": dict(head_style)}
        colw[str(c)] = w
    for r, s in enumerate(rows, start=2):
        for c, (title, fn, _, num) in enumerate(SHIP_COLS):
            if fn is None:
                v = stages[s["stage"] - 1] if 1 <= (s["stage"] or 0) <= len(stages) else ""
            else:
                v = fn(s)
            if v in (None, ""):
                continue
            cell = {"r": str(v)}
            if num:
                cell["s"] = {"nf": "n2" if "الوزن" in title or "قيمة" in title else "n0"}
            cells[f"{col_letter(c)}{r}"] = cell
    last = len(rows) + 1
    if rows:
        tot = last + 1
        cells[f"A{tot}"] = {"r": "الإجمالي", "s": {"b": 1, "bg": "#e6f3f1"}}
        for c, (title, _, _, num) in enumerate(SHIP_COLS):
            if num and "قيمة" not in title:
                L = col_letter(c)
                cells[f"{L}{tot}"] = {"r": f"=SUM({L}2:{L}{last})", "s": {"b": 1, "bg": "#e6f3f1", "nf": "n2" if "الوزن" in title else "n0"}}
        cells[f"A{tot + 1}"] = {"r": "عدد الشحنات"}
        cells[f"B{tot + 1}"] = {"r": f"=COUNTA(A2:A{last})", "s": {"b": 1}}
    sh = blank_sheet("الشحنات", max(len(rows) + 40, 100), max(len(SHIP_COLS) + 4, 20))
    sh["cells"], sh["colw"], sh["freeze"] = cells, colw, 1
    return {"v": 1, "active": 0, "sheets": [sh]}


# ---------------------------------------------------------------- routes
def register(app, get_db, login_required, perm, log, now, shipment_query, stages):
    app.config.setdefault("MAX_FORM_MEMORY_SIZE", MAX_BYTES + 1024 * 1024)

    def row_or_404(sid):
        r = get_db().execute("SELECT * FROM sheets WHERE id=? AND deleted=0", (sid,)).fetchone()
        if not r:
            abort(404)
        return r

    def create(title, book, action="إنشاء جدول Excel"):
        db = get_db()
        cur = db.execute(
            "INSERT INTO sheets(title,sheet_data,info,version,created_by,created_at,updated_by,updated_at,deleted) VALUES(?,?,?,?,?,?,?,?,0)",
            ((title or "جدول بدون عنوان")[:150], json.dumps(book, ensure_ascii=False), book_info(book), 1,
             g.user["username"], now(), g.user["username"], now()))
        sid = cur.lastrowid
        log(action, "sheet", sid, title)
        db.commit()
        return sid

    @app.route("/sheets")
    @login_required
    def sheets_list():
        q = (request.args.get("q") or "").strip()
        sql = "SELECT id,title,info,version,created_by,updated_by,updated_at FROM sheets WHERE deleted=0"
        args = []
        if q:
            sql += " AND title LIKE ?"
            args.append(f"%{q}%")
        rows = get_db().execute(sql + " ORDER BY updated_at DESC, id DESC", args).fetchall()
        items = []
        for r in rows:
            try:
                info = json.loads(r["info"] or "{}")
            except Exception:
                info = {}
            items.append(dict(r=r, sheets=info.get("sheets", 1), cells=info.get("cells", 0)))
        return render_template("sheets.html", items=items, q=q, page="sheets")

    @app.route("/sheets/new", methods=["POST"])
    @perm("can_add")
    def sheets_new():
        sid = create(request.form.get("title", "").strip(), blank_book())
        return redirect(url_for("sheets_edit", sid=sid))

    @app.route("/sheets/import", methods=["POST"])
    @perm("can_add")
    def sheets_import():
        f = request.files.get("file")
        if not f or not f.filename:
            flash("اختر ملف Excel أو CSV أولًا.", "error")
            return redirect(url_for("sheets_list"))
        name = f.filename.rsplit("/", 1)[-1]
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        data = f.read()
        try:
            if ext in ("xlsx", "xlsm"):
                book = xlsx_to_book(io.BytesIO(data))
            elif ext in ("csv", "txt", "tsv"):
                book = csv_to_book(data)
            else:
                flash("الصيغ المدعومة: ‎.xlsx ‎.xlsm ‎.csv", "error")
                return redirect(url_for("sheets_list"))
        except Exception as e:  # ملف تالف / غير مدعوم
            print("sheets import failed:", e, flush=True)
            flash("تعذّر قراءة الملف. تأكد إنه ملف Excel سليم (xlsx).", "error")
            return redirect(url_for("sheets_list"))
        sid = create(name.rsplit(".", 1)[0], book, "استيراد جدول Excel")
        flash("تم استيراد الملف كجدول جديد.", "ok")
        return redirect(url_for("sheets_edit", sid=sid))

    @app.route("/sheets/from-shipments", methods=["POST"])
    @perm("can_add")
    def sheets_from_shipments():
        args = {k: v for k, v in request.form.items() if k != "csrf" and v}
        rows = shipment_query(args)[:MAX_ROWS - 5]
        sid = create(f"جدول الشحنات — {now()[:16]}", shipments_to_book(rows, stages), "إنشاء جدول من الشحنات")
        return redirect(url_for("sheets_edit", sid=sid))

    @app.route("/sheets/<int:sid>")
    @login_required
    def sheets_edit(sid):
        r = row_or_404(sid)
        try:
            book = json.loads(r["sheet_data"])
        except Exception:
            book = blank_book()
        can = bool(g.user["is_admin"] or g.user["can_edit"])
        return render_template("sheet_edit.html", s=r, book_json=js_embed(book), can_edit=can, page="sheets")

    @app.route("/sheets/<int:sid>/save", methods=["POST"])
    @perm("can_edit")
    def sheets_save(sid):
        r = row_or_404(sid)
        try:
            book = validate_book(request.form.get("data", ""))
        except ValueError as e:
            return jsonify(ok=False, error=str(e)), 400
        base = int(request.form.get("version") or 0)
        if base != int(r["version"] or 1) and request.form.get("force") != "1":
            return jsonify(ok=False, conflict=True, version=r["version"], by=r["updated_by"], at=r["updated_at"],
                           error="تم تعديل الجدول من مستخدم آخر أثناء عملك."), 409
        title = (request.form.get("title") or r["title"]).strip()[:150] or r["title"]
        ver = int(r["version"] or 1) + 1
        db = get_db()
        db.execute("UPDATE sheets SET title=?,sheet_data=?,info=?,version=?,updated_by=?,updated_at=? WHERE id=?",
                   (title, json.dumps(book, ensure_ascii=False), book_info(book), ver, g.user["username"], now(), sid))
        last = session.get("sheet_log", {})
        if now()[:15] != last.get(str(sid)):   # سجل واحد كل ~10 دقائق لكل جدول حتى لا يمتلئ السجل
            log("تعديل جدول Excel", "sheet", sid, title)
            last[str(sid)] = now()[:15]
            session["sheet_log"] = last
        db.commit()
        return jsonify(ok=True, version=ver, at=now())

    @app.route("/sheets/<int:sid>/rename", methods=["POST"])
    @perm("can_edit")
    def sheets_rename(sid):
        row_or_404(sid)
        title = (request.form.get("title") or "").strip()[:150]
        if title:
            db = get_db()
            db.execute("UPDATE sheets SET title=?,updated_by=?,updated_at=? WHERE id=?", (title, g.user["username"], now(), sid))
            log("إعادة تسمية جدول Excel", "sheet", sid, title)
            db.commit()
            flash("تم تغيير الاسم.", "ok")
        return redirect(request.form.get("next") or url_for("sheets_list"))

    @app.route("/sheets/<int:sid>/duplicate", methods=["POST"])
    @perm("can_add")
    def sheets_duplicate(sid):
        r = row_or_404(sid)
        new = create(f"{r['title']} (نسخة)", json.loads(r["sheet_data"]), "نسخ جدول Excel")
        flash("تم إنشاء نسخة من الجدول.", "ok")
        return redirect(url_for("sheets_edit", sid=new))

    @app.route("/sheets/<int:sid>/delete", methods=["POST"])
    @login_required
    def sheets_delete(sid):
        r = row_or_404(sid)
        if not (g.user["is_admin"] or g.user["can_delete"] or r["created_by"] == g.user["username"]):
            abort(403)
        db = get_db()
        db.execute("UPDATE sheets SET deleted=1,updated_by=?,updated_at=? WHERE id=?", (g.user["username"], now(), sid))
        log("حذف جدول Excel", "sheet", sid, r["title"])
        db.commit()
        flash("تم حذف الجدول.", "ok")
        return redirect(url_for("sheets_list"))

    @app.route("/sheets/<int:sid>/export.xlsx")
    @login_required
    def sheets_export(sid):
        r = row_or_404(sid)
        try:
            bio = book_to_xlsx(json.loads(r["sheet_data"]))
        except ImportError:
            abort(501, "مكتبة openpyxl غير مثبتة (pip install openpyxl)")
        log("تصدير جدول Excel", "sheet", sid, r["title"])
        get_db().commit()
        safe = re.sub(r'[\\/:*?"<>|]', "-", r["title"]) or "sheet"
        return send_file(bio, as_attachment=True, download_name=f"{safe}.xlsx",
                         mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
