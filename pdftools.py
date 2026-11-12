# -*- coding: utf-8 -*-
"""أدوات PDF: دمج وفصل الملفات (التحويل من صور يتم داخل المتصفح في static/js/img2pdf.js)."""
import io
import re
import zipfile

from flask import jsonify, redirect, render_template, request, send_file, url_for

MAX_FILES = 30          # أقصى عدد ملفات في الدمج
MAX_PAGES = 3000        # أقصى عدد صفحات في العملية الواحدة

_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩،؛–—", "0123456789,,--")


class PdfError(Exception):
    pass


def _open(stream, name="الملف"):
    """يفتح PDF من stream ويرجع PdfReader (مع محاولة فك التشفير بكلمة مرور فارغة)."""
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError
    try:
        data = stream.read()
        if not data.lstrip()[:5] == b"%PDF-" and b"%PDF-" not in data[:1024]:
            raise PdfError(f"«{name}» ليس ملف PDF صالحًا")
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                ok = reader.decrypt("")
            except Exception:
                ok = 0
            if not ok:
                raise PdfError(f"«{name}» محمي بكلمة مرور — فُكّ الحماية أولًا ثم أعد المحاولة")
        n = len(reader.pages)
        if n < 1:
            raise PdfError(f"«{name}» لا يحتوي على صفحات")
        return reader
    except PdfError:
        raise
    except (PyPdfError, Exception):
        raise PdfError(f"تعذّرت قراءة «{name}» — الملف تالف أو غير مدعوم")


def parse_ranges(text, n):
    """'1-3, 5, 8-' -> [[0,1,2],[4],[7..n-1]] (كل عنصر = نطاق). يرفع PdfError لو فيه خطأ."""
    text = (text or "").translate(_AR_DIGITS).strip()
    if not text:
        raise PdfError("اكتب أرقام الصفحات المطلوبة، مثال: 1-3, 5, 8-10")
    out = []
    for part in re.split(r"[,\s]+", text):
        if not part:
            continue
        m = re.fullmatch(r"(\d*)-(\d*)|(\d+)", part)
        if not m:
            raise PdfError(f"صيغة غير صحيحة: «{part}» — استخدم مثل 1-3, 5, 8-10")
        if m.group(3):
            a = b = int(m.group(3))
        else:
            if not m.group(1) and not m.group(2):
                raise PdfError(f"صيغة غير صحيحة: «{part}»")
            a = int(m.group(1)) if m.group(1) else 1
            b = int(m.group(2)) if m.group(2) else n
        if a < 1 or b < 1 or a > n or b > n:
            raise PdfError(f"الصفحة «{part}» خارج النطاق — الملف فيه {n} صفحة")
        if a > b:
            raise PdfError(f"النطاق «{part}» معكوس — اكتبه من الأصغر للأكبر")
        out.append(list(range(a - 1, b)))
    if not out:
        raise PdfError("اكتب أرقام الصفحات المطلوبة")
    return out


def _writer_from(reader, page_idx):
    from pypdf import PdfWriter
    w = PdfWriter()
    for i in page_idx:
        w.add_page(reader.pages[i])
    buf = io.BytesIO()
    w.write(buf)
    buf.seek(0)
    return buf


def _safe(s):
    s = re.sub(r'[\\/:*?"<>|\r\n]+', " ", s or "").strip()
    return re.sub(r"\.pdf$", "", s, flags=re.I)[:80] or "document"


def register(app, login_required):
    def fail(msg, code=400):
        return jsonify(ok=False, error=msg), code

    @app.route("/tools/pdf")
    @login_required
    def pdf_tools():
        return render_template("pdf_tools.html", page="pdftools")

    @app.route("/tools/images-to-pdf")
    @login_required
    def img2pdf_old():
        return redirect(url_for("pdf_tools"))

    @app.route("/tools/pdf/info", methods=["POST"])
    @login_required
    def pdf_info():
        f = request.files.get("file")
        if not f:
            return fail("اختر ملف PDF")
        try:
            r = _open(f.stream, f.filename or "الملف")
        except PdfError as e:
            return fail(str(e))
        return jsonify(ok=True, pages=len(r.pages))

    @app.route("/tools/pdf/merge", methods=["POST"])
    @login_required
    def pdf_merge():
        files = [f for f in request.files.getlist("files") if f and f.filename]
        if len(files) < 2:
            return fail("اختر ملفين PDF على الأقل للدمج")
        if len(files) > MAX_FILES:
            return fail(f"الحد الأقصى {MAX_FILES} ملف في المرة الواحدة")
        from pypdf import PdfWriter
        w, total = PdfWriter(), 0
        try:
            for f in files:
                r = _open(f.stream, f.filename)
                total += len(r.pages)
                if total > MAX_PAGES:
                    return fail(f"إجمالي الصفحات أكبر من {MAX_PAGES}")
                w.append(r)
        except PdfError as e:
            return fail(str(e))
        except Exception:
            return fail("تعذّر دمج الملفات — تأكد إنها ملفات PDF سليمة")
        buf = io.BytesIO()
        w.write(buf)
        buf.seek(0)
        return send_file(buf, mimetype="application/pdf", as_attachment=True, download_name="merged.pdf")

    @app.route("/tools/pdf/split", methods=["POST"])
    @login_required
    def pdf_split():
        f = request.files.get("file")
        if not f:
            return fail("اختر ملف PDF")
        mode = request.form.get("mode", "extract")
        base = _safe(request.form.get("name") or (f.filename or ""))
        try:
            r = _open(f.stream, f.filename or "الملف")
            n = len(r.pages)
            if mode == "each":
                groups = [[i] for i in range(n)]
            else:
                groups = parse_ranges(request.form.get("ranges"), n)
            if mode == "extract":
                idx = [i for g in groups for i in g]
                return send_file(_writer_from(r, idx), mimetype="application/pdf", as_attachment=True,
                                 download_name=base + ".pdf")
            if mode not in ("ranges", "each"):
                return fail("طريقة الفصل غير معروفة")
            if len(groups) > 500:
                return fail("عدد الملفات الناتجة كبير جدًا (الحد 500)")
            zbuf = io.BytesIO()
            width = len(str(len(groups)))
            with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
                for k, g in enumerate(groups, 1):
                    label = f"p{g[0] + 1}" if len(g) == 1 else f"p{g[0] + 1}-{g[-1] + 1}"
                    z.writestr(f"{base}-{str(k).zfill(width)}-{label}.pdf", _writer_from(r, g).getvalue())
            zbuf.seek(0)
            return send_file(zbuf, mimetype="application/zip", as_attachment=True, download_name=base + ".zip")
        except PdfError as e:
            return fail(str(e))
        except Exception:
            return fail("تعذّر فصل الملف — تأكد إنه PDF سليم")
