# -*- coding: utf-8 -*-
"""INX – Shipping & Customs Management System"""
import base64
import csv
import io
import json
import re
import os
import secrets
import shutil
import sqlite3
import sys
import time
import uuid
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timedelta
from functools import wraps

from flask import (Flask, abort, flash, g, jsonify, redirect, render_template, request,
                   send_file, session, url_for, Response)
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR") or ("/data" if os.path.isdir("/data") else os.path.join(BASE_DIR, "data"))
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
DB_PATH = os.path.join(DATA_DIR, "app.db")
SECRET_PATH = os.path.join(DATA_DIR, "secret.key")
for d in (DATA_DIR, UPLOAD_DIR, BACKUP_DIR):
    os.makedirs(d, exist_ok=True)

if os.environ.get("SESSION_SECRET"):
    SECRET = os.environ["SESSION_SECRET"]
elif os.path.exists(SECRET_PATH):
    SECRET = open(SECRET_PATH).read().strip()
else:
    SECRET = secrets.token_hex(32)
    with open(SECRET_PATH, "w") as f:
        f.write(SECRET)

app = Flask(__name__)
app.secret_key = SECRET
from werkzeug.middleware.proxy_fix import ProxyFix  # noqa: E402
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)  # خلف بروكسي suga (HTTPS)
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.permanent_session_lifetime = timedelta(hours=10)

STAGES = [
    "استلام المستندات", "مراجعة المستندات", "الإدراج", "الإجراءات الجمركية",
    "سداد المستحقات", "الإفراج الجمركي", "التسليم النهائي للعميل",
    "إغلاق الشحنة وتسوية الحساب",
]
# شرح كل مرحلة (للعرض في صفحة الشحنة). عدّل النصوص هنا حسب إجراءات شركتكم.
STAGE_INFO = [
    {"summary": "استلام ملف الشحنة من العميل والتأكد إن المستندات الأساسية وصلت.",
     "steps": ["استلم من العميل المستندات الأصلية أو صورها.",
               "راجع إن كل مستند موجود وواضح (مفيش صفحة ناقصة).",
               "ارفع المستندات على الشحنة من قسم المستندات، واختار نوع كل مستند.",
               "سجّل أي ملاحظة (مستند هيتأخر، أو العميل هيبعت تعديل)."],
     "needs": ["الفاتورة التجارية", "بوليصة الشحن", "شهادة المنشأ", "إذن التسليم", "رقم ACID", "البطاقة الضريبية للمستورد"]},
    {"summary": "مراجعة المستندات مع بعضها قبل ما تتقدم أي إجراءات.",
     "steps": ["طابق اسم المستورد والمورد في الفاتورة والبوليصة.",
               "طابق عدد الطرود والوزن والقيمة بين الفاتورة والبوليصة وقائمة التعبئة.",
               "اتأكد إن رقم ACID صحيح ومطابق للشحنة، وإن بلد المنشأ مطابق للشهادة.",
               "لو فيه اختلاف، كلّم العميل أو المورد يصلحه قبل ما تكمل."],
     "needs": ["كل مستندات المرحلة الأولى", "ملاحظات المراجعة"]},
    {"summary": "تسجيل الشحنة في المنظومة الجمركية وربطها ببياناتها، واستلام إذن التسليم من الخط الملاحي.",
     "steps": ["سجّل بيانات الشحنة (رقم البوليصة، الحاويات أو الطرود، رقم ACID).",
               "اتأكد إن الشحنة ظاهرة ومربوطة بالمنفذ الجمركي المقصود.",
               "استلم إذن التسليم من الخط الملاحي بعد سداد مصاريفه.",
               "سجّل رقم الإدراج في ملاحظات الشحنة."],
     "needs": ["بوليصة الشحن", "رقم ACID", "إذن التسليم"]},
    {"summary": "تجهيز البيان الجمركي وإتمام المعاينة والفحص لو مطلوبين.",
     "steps": ["حدّد البند الجمركي (التصنيف) للصنف واكتبه في حقل البند.",
               "جهّز البيان الجمركي بالقيمة والمنشأ والوزن والعدد.",
               "قدّم البيان وتابع حالته لحد القبول.",
               "حضّر المعاينة لو اتطلبت، وتابع أي عينات أو فحص."],
     "needs": ["مستندات الجمارك", "البند الجمركي", "الفاتورة وشهادة المنشأ"]},
    {"summary": "سداد الرسوم والضرائب والمصاريف المستحقة على الشحنة.",
     "steps": ["احسب الرسوم الجمركية والضرائب من البيان الجمركي.",
               "ادفع الرسوم الجمركية والضرائب.",
               "سدد مصاريف الميناء والأرضيات والخط الملاحي لو مستحقة.",
               "احتفظ بإيصالات السداد وارفعها على الشحنة."],
     "needs": ["إيصالات السداد", "البيان الجمركي", "رصيد أو دفعة من العميل"]},
    {"summary": "الجمارك بتفرج عن الشحنة بعد استيفاء الإجراءات والسداد.",
     "steps": ["اتأكد إن كل الرسوم اتسددت والمعاينة خلصت.",
               "استلم قرار الإفراج الجمركي وإذن خروج الشحنة.",
               "ارفع صورة الإفراج على الشحنة.",
               "نسّق مع العميل أو الناقل ميعاد خروج الشحنة."],
     "needs": ["قرار أو إذن الإفراج", "إيصالات السداد"]},
    {"summary": "خروج الشحنة من الميناء وتسليمها للعميل.",
     "steps": ["رتّب النقل من الميناء لمكان العميل.",
               "اتأكد من العدد والحالة عند الاستلام (عدد الطرود يطابق المستندات).",
               "خلّي العميل يوقّع إيصال الاستلام.",
               "ارفع إيصال الاستلام على الشحنة."],
     "needs": ["إذن خروج الشحنة", "إيصال استلام موقّع من العميل"]},
    {"summary": "قفل الملف حسابيًا وإداريًا بعد التسليم.",
     "steps": ["اعمل كشف حساب بكل المصاريف الفعلية للشحنة.",
               "قارنه بالدفعات المستلمة من العميل، وحدّد المتبقي أو المرتجع.",
               "حصّل المتبقي أو رجّع الزيادة للعميل.",
               "أرشف المستندات وغيّر المرحلة لـ \"إغلاق\"."],
     "needs": ["كشف الحساب النهائي", "إيصالات الدفع والتحصيل"]},
]
# أنواع سحب المستندات الجديدة (تظهر كاختيارات مستقلة في قسم سحب المستندات)
NEW_PULL_DOCS = ["تفريغ (Discharge)", "يورو وان (EUR.1)", "استثمار", "إيصال نولون (Freight Receipt)",
                 "عقد ملحق 4", "موافقة السياحة"]
DOC_TYPES = ["الفاتورة التجارية", "بوليصة الشحن", "شهادة المنشأ", "إذن التسليم",
             "مستندات الجمارك", "إيصالات السداد", "قرار الإفراج", "إيصال الاستلام", *NEW_PULL_DOCS, "مستند آخر"]
# كل ما يمكن تحديده كمطلوب سحبه على الشحنة (الجديد أولاً)
PULL_TYPES = [*NEW_PULL_DOCS, *[t for t in DOC_TYPES if t not in NEW_PULL_DOCS and t != "مستند آخر"]]
PULL_STATUSES = ["مطلوب", "تم السحب", "لم يتم السحب"]
TASK_STATUSES = ["جديد", "تم الاطلاع", "جاري التنفيذ", "مكتمل"]
CURRENCIES = ["EGP", "USD", "EUR", "GBP", "CNY", "AED", "SAR", "TRY"]
REQUIRED_DOCS = ["الفاتورة التجارية", "بوليصة الشحن", "شهادة المنشأ", "إذن التسليم", "مستندات الجمارك"]
ALLOWED_EXT = {"pdf", "png", "jpg", "jpeg", "doc", "docx", "xls", "xlsx", "csv", "txt", "zip"}
CHAT_EXT = ALLOWED_EXT


def status_of(stage):
    if stage >= 8:
        return "مكتملة", "green"
    if stage >= 4:
        return "قيد الإجراءات", "blue"
    if stage >= 2:
        return "تحت المراجعة", "orange"
    return "مستلمة", "gray"


from markupsafe import Markup  # noqa: E402


def ic(name):
    return Markup(f'<svg class="i" aria-hidden="true"><use href="#i-{name}"/></svg>')


# حقول الشحنة الإضافية: (اسم العمود, العنوان, النوع)  — num = رقم, txt = نص
EXTRA_FIELDS = [
    ("order_number", "رقم الأوردر (Order Number)", "txt"),
    ("location", "الموقع", "txt"),
    ("tax_number", "الرقم الضريبي", "txt"),
    ("packages", "عدد الطرود (Packages)", "num"),
    ("weight", "الوزن القائم (Gross Weight) كجم", "num"),
    ("net_weight", "الوزن الصافي (Net Weight) كجم", "num"),
    ("invoice_value", "قيمة الفاتورة", "num"),
    ("invoice_currency", "عملة الفاتورة (Currency)", "cur"),
    ("contract", "التعاقد", "txt"),
    ("acid", "رقم ACID", "txt"),
    ("usage_purpose", "غرض الاستخدام", "txt"),
    ("tariff_item", "البند", "txt"),
    ("origin", "المنشأ", "txt"),
    ("category", "الصنف", "txt"),
    ("field_46", "46", "txt"),
    ("supplier", "اسم المورد (Supplier)", "txt"),
]
EXTRA_COLS = [c for c, _, _ in EXTRA_FIELDS]

# ------------------------------------------------- الترقية التلقائية للمراحل
# لكل مرحلة: المطلوب (حقل في بيانات الشحنة "f" أو مستند "d"). لما كله يتوفر الشحنة تنتقل للمرحلة اللي بعدها لوحدها.
STAGE_RULES = [
    [("d", "الفاتورة التجارية"), ("d", "بوليصة الشحن"), ("d", "شهادة المنشأ"), ("f", "acid"), ("f", "tax_number")],
    [("f", "packages"), ("f", "weight"), ("f", "invoice_value"), ("f", "origin")],
    [("f", "bl_number"), ("f", "acid"), ("d", "إذن التسليم")],
    [("f", "tariff_item"), ("d", "مستندات الجمارك")],
    [("d", "إيصالات السداد")],
    [("d", "قرار الإفراج")],
    [("d", "إيصال الاستلام")],
    [],
]
FIELD_LABELS = {"bl_number": "رقم البوليصة", **{c: l for c, l, _ in EXTRA_FIELDS}}


def _filled(v):
    return str(v if v is not None else "").strip() not in ("", "0", "0.0")


def stage_requirements(s, have, stage):
    """قائمة (اسم المطلوب, متوفر؟) للمرحلة المحددة."""
    out = []
    for kind, key in STAGE_RULES[stage - 1]:
        if kind == "f":
            out.append((FIELD_LABELS[key], _filled(s[key])))
        else:
            out.append((key, key in have))
    return out


def auto_advance(db, sid):
    """يرقّي الشحنة تلقائيًا طالما متطلبات مرحلتها الحالية كاملة. بيرجع (من, إلى) لو اتغيّرت."""
    s = db.execute("SELECT * FROM shipments WHERE id=? AND deleted=0", (sid,)).fetchone()
    if not s:
        return None
    have = {r[0] for r in db.execute("SELECT doc_type FROM documents WHERE shipment_id=? AND deleted=0", (sid,))}
    st = start = s["stage"]
    while st < 8 and all(ok for _, ok in stage_requirements(s, have, st)):
        st += 1
    if st == start:
        return None
    who = g.user["username"] if getattr(g, "user", None) else "system"
    db.execute("UPDATE shipments SET stage=?,updated_by=?,updated_at=? WHERE id=?", (st, who, now(), sid))
    log("ترقية تلقائية للمرحلة", "shipment", sid, f"{STAGES[start - 1]} ← {STAGES[st - 1]}")
    db.commit()
    flash(f"المرحلة اكتملت — انتقلت الشحنة تلقائيًا إلى: {STAGES[st - 1]}", "ok")
    return start, st

app.jinja_env.globals.update(STAGE_INFO=STAGE_INFO, STAGES=STAGES, DOC_TYPES=DOC_TYPES, status_of=status_of, ic=ic, EXTRA_FIELDS=EXTRA_FIELDS,
                             PULL_TYPES=PULL_TYPES, PULL_STATUSES=PULL_STATUSES, TASK_STATUSES=TASK_STATUSES, CURRENCIES=CURRENCIES)

# ----------------------------------------------------------------- database
SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  can_add INTEGER DEFAULT 1,
  can_edit INTEGER DEFAULT 1,
  can_delete INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS shipments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE NOT NULL,
  client TEXT NOT NULL,
  carrier TEXT,
  bl_number TEXT,
  arrival_date TEXT,
  type TEXT,
  stage INTEGER DEFAULT 1,
  responsible_id INTEGER,
  created_by TEXT, created_at TEXT,
  updated_by TEXT, updated_at TEXT,
  deleted INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS documents(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL,
  doc_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  uploaded_by TEXT, uploaded_at TEXT,
  deleted INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL,
  username TEXT, ts TEXT, text TEXT
);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT, username TEXT, action TEXT, entity TEXT, entity_id TEXT, details TEXT
);
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL,
  from_id INTEGER NOT NULL, to_id INTEGER NOT NULL,
  title TEXT NOT NULL, details TEXT,
  status TEXT DEFAULT 'جديد',
  created_at TEXT, read_at TEXT, started_at TEXT, done_at TEXT
);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL, recipient_id INTEGER NOT NULL,
  shipment_id INTEGER, task_id INTEGER,
  body TEXT, file_name TEXT, stored_name TEXT,
  created_at TEXT, read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(sender_id, recipient_id, id);
CREATE INDEX IF NOT EXISTS idx_msg_unread ON messages(recipient_id, read_at);
CREATE TABLE IF NOT EXISTS chat_seen(
  user_id INTEGER PRIMARY KEY, last_general_id INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS offers(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL,
  provider TEXT NOT NULL, service TEXT, price REAL, currency TEXT, details TEXT,
  status TEXT DEFAULT 'مقترح',
  added_by TEXT, added_at TEXT, approved_by TEXT, approved_at TEXT,
  deleted INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS doc_pulls(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL,
  doc_type TEXT NOT NULL,
  status TEXT DEFAULT 'مطلوب',
  pulled_date TEXT, responsible_id INTEGER, note TEXT,
  updated_by TEXT, updated_at TEXT,
  UNIQUE(shipment_id, doc_type)
);
"""


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def close_db(_):
    db = g.pop("db", None)
    if db:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    have = {r[1] for r in db.execute("PRAGMA table_info(shipments)")}
    for col in EXTRA_COLS:
        if col not in have:
            db.execute(f"ALTER TABLE shipments ADD COLUMN {col} TEXT")
    ucols = {r[1] for r in db.execute("PRAGMA table_info(users)")}
    for col, default in (("pref_sound", 1), ("pref_badges", 1), ("pref_general", 1), ("pref_poll", 7)):
        if col not in ucols:     # تفضيلات الإشعارات والعدادات الشخصية لكل موظف
            db.execute(f"ALTER TABLE users ADD COLUMN {col} INTEGER DEFAULT {default}")
    if "can_approve" not in ucols:   # صلاحية اعتماد العروض (المدير يملكها دائمًا)
        db.execute("ALTER TABLE users ADD COLUMN can_approve INTEGER DEFAULT 0")
    if not db.execute("SELECT 1 FROM users").fetchone():
        db.execute(
            "INSERT INTO users(username,full_name,password_hash,is_admin,can_add,can_edit,can_delete,created_at)"
            " VALUES('admin','مدير النظام',?,1,1,1,1,?)",
            (generate_password_hash(os.environ.get("ADMIN_PASSWORD") or "Admin@123"), now()))
        print(">> تم إنشاء المدير الافتراضي: admin / Admin@123  (غيّر كلمة المرور فور الدخول)")
    db.commit()
    db.close()


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(action, entity="", entity_id="", details=""):
    u = g.user["username"] if getattr(g, "user", None) else "-"
    get_db().execute(
        "INSERT INTO audit(ts,username,action,entity,entity_id,details) VALUES(?,?,?,?,?,?)",
        (now(), u, action, entity, str(entity_id), details))


# ----------------------------------------------------------------- auth
@app.before_request
def load_user():
    g.user = None
    uid = session.get("uid")
    if uid:
        u = get_db().execute("SELECT * FROM users WHERE id=? AND active=1", (uid,)).fetchone()
        if u:
            g.user = u
        else:
            session.clear()
    if request.method == "POST":
        token = session.get("csrf")
        if not token or token != request.form.get("csrf"):
            abort(400, "طلب غير صالح (CSRF)")


@app.context_processor
def _asset_version():
    try:
        v = int(max(os.path.getmtime(os.path.join(BASE_DIR, "static", f)) for f in ("style.css", "app.js")))
    except OSError:
        v = 0
    return {"asset_v": v}


@app.after_request
def secure_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.context_processor
def inject():
    if "csrf" not in session:
        session["csrf"] = secrets.token_hex(16)
    return dict(csrf=session["csrf"], me=g.get("user"), counts=get_counts())


def login_required(f):
    @wraps(f)
    def w(*a, **k):
        if not g.user:
            return redirect(url_for("login", next=request.path))
        return f(*a, **k)
    return w


def perm(name):
    def deco(f):
        @wraps(f)
        def w(*a, **k):
            if not g.user:
                return redirect(url_for("login"))
            if not (g.user["is_admin"] or g.user[name]):
                abort(403)
            return f(*a, **k)
        return w
    return deco


def admin_required(f):
    @wraps(f)
    def w(*a, **k):
        if not g.user:
            return redirect(url_for("login"))
        if not g.user["is_admin"]:
            abort(403)
        return f(*a, **k)
    return w


_attempts = {}


@app.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(url_for("home"))
    if request.method == "POST":
        ip = request.remote_addr
        tries = [t for t in _attempts.get(ip, []) if t > datetime.now() - timedelta(minutes=10)]
        if len(tries) >= 8:
            flash("محاولات كثيرة. حاول بعد 10 دقائق.", "error")
            return render_template("login.html")
        username = request.form.get("username", "").strip()
        u = get_db().execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        if u and u["active"] and check_password_hash(u["password_hash"], request.form.get("password", "")):
            session.clear()
            session.permanent = True
            session["uid"] = u["id"]
            g.user = u
            log("تسجيل دخول")
            get_db().commit()
            auto_backup()
            nxt = request.args.get("next", "")
            return redirect(nxt if nxt.startswith("/") and not nxt.startswith("//") else url_for("home"))
        tries.append(datetime.now())
        _attempts[ip] = tries
        flash("اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب موقوف.", "error")
    return render_template("login.html")


@app.route("/logout")
def logout():
    if g.user:
        log("تسجيل خروج")
        get_db().commit()
    session.clear()
    return redirect(url_for("login"))


# ----------------------------------------------------------------- home
@app.route("/")
@login_required
def home():
    db = get_db()
    total = db.execute("SELECT COUNT(*) FROM shipments WHERE deleted=0").fetchone()[0]
    open_ = db.execute("SELECT COUNT(*) FROM shipments WHERE deleted=0 AND stage<8").fetchone()[0]
    docs = db.execute("SELECT COUNT(*) FROM documents WHERE deleted=0").fetchone()[0]
    recent = shipment_query({})[:5]
    pull_pending = db.execute("SELECT COUNT(*) FROM doc_pulls p JOIN shipments s ON s.id=p.shipment_id "
                              "WHERE s.deleted=0 AND p.status<>'تم السحب'").fetchone()[0]
    return render_template("home.html", total=total, open_=open_, docs=docs, recent=recent, pull_pending=pull_pending, page="home")


# ----------------------------------------------------------------- shipments
def shipment_query(args):
    sql = ("SELECT s.*, u.full_name AS resp_name, "
           "(SELECT COUNT(*) FROM doc_pulls p WHERE p.shipment_id=s.id AND p.status<>'تم السحب') AS pull_missing, "
           "(SELECT COUNT(*) FROM doc_pulls p WHERE p.shipment_id=s.id) AS pull_total "
           "FROM shipments s LEFT JOIN users u ON u.id=s.responsible_id WHERE s.deleted=0")
    p = []
    q = args.get("q", "").strip()
    if q:
        cols = ["s.number", "s.client", "s.bl_number", "s.carrier", "s.supplier", "s.tax_number", "s.origin", "s.category", "s.order_number", "s.acid"]
        sql += " AND (" + " OR ".join(f"{c} LIKE ?" for c in cols) + ")"
        p += [f"%{q}%"] * len(cols)
    for field, col in (("client", "s.client"), ("carrier", "s.carrier"), ("bl", "s.bl_number"), ("number", "s.number"),
                         ("supplier", "s.supplier"), ("origin", "s.origin"), ("tax_number", "s.tax_number"), ("tariff_item", "s.tariff_item"),
                         ("order_number", "s.order_number"), ("acid", "s.acid")):
        v = args.get(field, "").strip()
        if v:
            sql += f" AND {col} LIKE ?"
            p.append(f"%{v}%")
    cur_f = args.get("currency", "").strip()
    if cur_f:
        sql += " AND UPPER(s.invoice_currency)=?"
        p.append(cur_f.upper())
    pl = args.get("pull", "")
    if pl == "missing":
        sql += " AND EXISTS(SELECT 1 FROM doc_pulls p WHERE p.shipment_id=s.id AND p.status<>'تم السحب')"
    elif pl == "done":
        sql += (" AND EXISTS(SELECT 1 FROM doc_pulls p WHERE p.shipment_id=s.id) AND NOT EXISTS"
                "(SELECT 1 FROM doc_pulls p WHERE p.shipment_id=s.id AND p.status<>'تم السحب')")
    st = args.get("status", "")
    if st == "open":
        sql += " AND s.stage<8"
    elif st == "closed":
        sql += " AND s.stage>=8"
    if args.get("date_from"):
        sql += " AND s.arrival_date>=?"
        p.append(args["date_from"])
    if args.get("date_to"):
        sql += " AND s.arrival_date<=?"
        p.append(args["date_to"])
    sql += " ORDER BY s.id DESC"
    return get_db().execute(sql, p).fetchall()


@app.route("/shipments")
@login_required
def shipments():
    rows = shipment_query(request.args)
    page_no = max(int(request.args.get("p", 1) or 1), 1)
    per = 15
    pages = max((len(rows) + per - 1) // per, 1)
    page_no = min(page_no, pages)
    return render_template("shipments.html", rows=rows[(page_no - 1) * per: page_no * per],
                           total=len(rows), page_no=page_no, pages=pages, page="shipments")


@app.route("/search")
@login_required
def search():
    rows = shipment_query(request.args) if request.args else []
    return render_template("search.html", rows=rows, searched=bool(request.args), page="search")


def users_list():
    return get_db().execute("SELECT id, full_name FROM users WHERE active=1 ORDER BY full_name").fetchall()


# ----------------------------------------------------------------- اسكان (استخراج بيانات الشحنة من صورة المستند)
# المحرك الأول: Google Gemini (مفتاح مجاني من Google AI Studio) — والبديل: Tesseract محلي بدون إنترنت
GEMINI_KEY_PATH = os.path.join(DATA_DIR, "gemini_key.txt")   # خارج قاعدة البيانات فلا يدخل في النسخ الاحتياطية
GEMINI_MODELS = [m for m in [os.environ.get("CUSTOMS_GEMINI_MODEL"), "gemini-flash-latest", "gemini-3.5-flash", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-3.5-flash-lite"] if m]
SCAN_EXT = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
            "gif": "image/gif", "pdf": "application/pdf"}
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
SCAN_FIELDS = {"client": "اسم الشركة / العميل", "carrier": "شركة الشحن", "bl_number": "رقم البوليصة",
               "arrival_date": "تاريخ الوصول بصيغة YYYY-MM-DD", "type": "نوع الشحنة",
               **{c: l for c, l, _ in EXTRA_FIELDS}}
NUM_COLS = [c for c, _, k in EXTRA_FIELDS if k == "num"]


def get_gemini_key():
    k = os.environ.get("GEMINI_API_KEY", "").strip()
    if not k and os.path.exists(GEMINI_KEY_PATH):
        k = open(GEMINI_KEY_PATH, encoding="utf-8").read().strip()
    return k


def find_tesseract():
    p = os.environ.get("TESSERACT_CMD") or shutil.which("tesseract")
    if p and os.path.exists(p):
        return p
    for c in (r"C:\Program Files\Tesseract-OCR\tesseract.exe", r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
              "/usr/bin/tesseract", "/usr/local/bin/tesseract", "/opt/homebrew/bin/tesseract"):
        if os.path.exists(c):
            return c
    return None


def clean_scan(raw):
    """يوحّد القيم: أرقام إنجليزية، حقول رقمية فعلاً أرقام، تاريخ بصيغة ISO."""
    out = {}
    for c in SCAN_FIELDS:
        v = str((raw or {}).get(c, "") or "").translate(_DIGITS).strip()
        if c in NUM_COLS:
            v = v.replace(",", "")
            try:
                float(v)
            except ValueError:
                v = ""
        elif c == "arrival_date":
            try:
                datetime.strptime(v, "%Y-%m-%d")
            except ValueError:
                v = ""
        out[c] = v
    return out


# ---- المحرك الأول: Gemini

_MODEL_CACHE = {"t": 0, "list": None}


def gemini_models(key):
    """يسأل جوجل عن الموديلات المتاحة لمفتاحك فعلاً (لأن الأسماء بتتغير)، ويرتبها: الأحدث ثم غير lite أولاً."""
    if _MODEL_CACHE["list"] and time.time() - _MODEL_CACHE["t"] < 3600:
        return _MODEL_CACHE["list"]
    found = []
    try:
        req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
                                     headers={"x-goog-api-key": key})
        with urllib.request.urlopen(req, timeout=10) as r:
            for m in json.loads(r.read().decode()).get("models", []):
                n = m.get("name", "").replace("models/", "")
                if (n.startswith("gemini-") and "flash" in n and "generateContent" in m.get("supportedGenerationMethods", [])
                        and not re.search(r"image|tts|live|audio|embed|robotics|computer|thinking|exp|preview-\d", n)):
                    found.append(n)
    except Exception:
        pass

    def rank(n):
        v = re.search(r"gemini-(\d+(?:\.\d+)?)", n)
        return (-(float(v.group(1)) if v else 0), "lite" in n, n)
    found.sort(key=rank)
    lst = [m for m in [os.environ.get("CUSTOMS_GEMINI_MODEL")] if m] + found[:3]
    lst += [m for m in GEMINI_MODELS if m not in lst]
    if found:
        _MODEL_CACHE.update(t=time.time(), list=lst)
    return lst

def scan_gemini(data, media_type):
    key = get_gemini_key()
    prompt = (
        "هذه صورة مستند شحنة/جمارك (قد يكون بخط اليد أو مطبوعًا، عربي أو إنجليزي). "
        "استخرج منه البيانات التالية وأرجع JSON فقط بدون أي شرح.\n"
        "المفاتيح (المفتاح: معناه):\n" + "\n".join(f"- {k}: {v}" for k, v in SCAN_FIELDS.items()) + "\n"
        f"الحقول الرقمية ({', '.join(NUM_COLS)}) أرجعها أرقامًا فقط بدون وحدات أو فواصل. "
        "اكتب الأرقام بالإنجليزية (0-9). لو الحقل غير موجود أو غير واضح اتركه نصًا فارغًا \"\" ولا تخمّن.")
    def build(model):
        cfg = {"responseMimeType": "application/json", "temperature": 0, "maxOutputTokens": 2048}
        if model.startswith("gemini-2.5"):
            cfg["thinkingConfig"] = {"thinkingBudget": 0}   # بدون تفكير طويل = أسرع بكتير
        return json.dumps({
            "contents": [{"parts": [
                {"inline_data": {"mime_type": media_type, "data": base64.b64encode(data).decode()}},
                {"text": prompt}]}],
            "generationConfig": cfg}).encode()
    # محاولات متتالية: نفس الموديل مرتين ثم الباقي، كل محاولة 40 ثانية بحد أقصى
    models = gemini_models(key)
    plan = [models[0]] + models
    last_err = "تعذر الاتصال بـ Gemini"
    resp = None
    dead = set()
    for i, model in enumerate(plan):
        if model in dead:
            continue
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", data=build(model),
            headers={"content-type": "application/json", "x-goog-api-key": key})
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                resp = json.loads(r.read().decode())
            break
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode())["error"]["message"]
            except Exception:
                msg = str(e)
            if e.code != 404 or "خطأ" not in last_err:
                last_err = f"خطأ من Gemini ({e.code}): {msg}"
            if e.code in (400, 404) and i < len(plan) - 1:    # موديل/إعداد غير مدعوم، جرّب التالي
                dead.add(model)
                continue
            if e.code in (429, 500, 502, 503, 504):            # ضغط مؤقت، أعد المحاولة
                time.sleep(1.5)
                continue
            raise RuntimeError(last_err)
        except Exception as e:                                  # انتهى الوقت / النت ضعيف، أعد المحاولة
            last_err = f"تعذر الاتصال بـ Gemini (تأكد من الإنترنت): {e}"
            time.sleep(1)
            continue
    if resp is None:
        raise RuntimeError(last_err)
    try:
        text = "".join(p.get("text", "") for p in resp["candidates"][0]["content"]["parts"])
    except (KeyError, IndexError):
        raise RuntimeError("Gemini لم يرجّع نتيجة (ممكن المستند اتحجب أو غير واضح).")
    s, e = text.find("{"), text.rfind("}")
    try:
        return clean_scan(json.loads(text[s:e + 1]))
    except ValueError:
        raise RuntimeError("رد Gemini غير مفهوم، حاول بصورة أوضح.")


# ---- البديل: Tesseract المحلي + قواعد استخراج بالعناوين
_LABELS = [
    ("bl_number", r"رقم\s*البوليصة|البوليصة|B/?L(?:\s*No\.?|\s*Number)?|Bill\s*of\s*Lading"),
    ("tax_number", r"الرقم\s*الضريبي|رقم\s*ضريبي|Tax\s*(?:ID|No\.?|Number)|VAT"),
    ("arrival_date", r"تاريخ\s*الوصول|ETA|Arrival(?:\s*Date)?"),
    ("carrier", r"شركة\s*الشحن|الخط\s*الملاحي|Carrier|Shipping\s*Line"),
    ("type", r"نوع\s*الشحنة|Shipment\s*Type"),
    ("packages", r"عدد\s*الطرود|الطرود|No\.?\s*of\s*Packages|Packages|Pkgs"),
    ("net_weight", r"الوزن\s*الصافي|Net\s*Weight"),
    ("weight", r"الوزن(?!\s*الصافي)|Gross\s*Weight|(?<!Net )Weight"),
    ("order_number", r"رقم\s*الأوردر|رقم\s*الاوردر|Order\s*(?:No\.?|Number)|P\.?O\.?\s*(?:No\.?|Number)"),
    ("invoice_currency", r"عملة\s*الفاتورة|العملة|Currency"),
    ("invoice_value", r"قيمة\s*الفاتورة|إجمالي\s*الفاتورة|Invoice\s*(?:Value|Total)|Total\s*Amount"),
    ("contract", r"التعاقد|العقد|Contract"),
    ("acid", r"ACID"),
    ("usage_purpose", r"غرض\s*الاستخدام|Purpose"),
    ("tariff_item", r"البند\s*الجمركي|البند|HS\s*Code|Tariff"),
    ("origin", r"بلد\s*المنشأ|المنشأ|Country\s*of\s*Origin|Origin"),
    ("category", r"الصنف|البيان|Commodity|Description|Goods"),
    ("supplier", r"المورد|Supplier|Shipper|Exporter|Seller"),
    ("location", r"الموقع|Location"),
    ("client", r"اسم\s*الشركة|اسم\s*العميل|المستورد|Consignee|Importer|Company(?:\s*Name)?|Client"),
]
_SEP = r"\s*[:：\-–]\s*|\s+"


def _iso_date(s):
    m = re.search(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", s)
    if m:
        y, mo, d = m.groups()
    else:
        m = re.search(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", s)
        if not m:
            return ""
        d, mo, y = m.groups()
    try:
        return datetime(int(y), int(mo), int(d)).strftime("%Y-%m-%d")
    except ValueError:
        return ""


def parse_scan_text(text):
    text = text.translate(_DIGITS)
    out = {c: "" for c in SCAN_FIELDS}
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        for col, labels in _LABELS:
            if out[col]:
                continue
            m = re.search(r"(?:^|[\s|])(?:" + labels + r")(?:" + _SEP + r")(.+)$", line, re.I)
            if not m:
                continue
            val = m.group(1).strip(" |:：-–_.")
            if col in NUM_COLS:
                n = re.search(r"\d[\d,]*\.?\d*", val)
                val = n.group(0).replace(",", "") if n else ""
            elif col == "arrival_date":
                val = _iso_date(val)
            if val:
                out[col] = val
    m = re.search(r"(?:^|\n)\s*46\s*[:：]\s*(.+)", text)
    if m:
        out["field_46"] = m.group(1).strip()
    return clean_scan(out)


def scan_tesseract(data, ext):
    exe = find_tesseract()
    if not exe:
        raise RuntimeError("برنامج Tesseract غير مثبت على الجهاز.")
    if ext == "pdf":
        raise RuntimeError("Tesseract يقرأ الصور فقط. حوّل الـ PDF لصورة أو استخدم مفتاح Gemini.")
    import subprocess
    import tempfile
    try:
        langs = subprocess.run([exe, "--list-langs"], capture_output=True, text=True, timeout=20).stdout.split()
    except Exception:
        langs = []
    lang = "+".join(l for l in ("ara", "eng") if l in langs) or "eng"
    with tempfile.TemporaryDirectory() as td:
        img = os.path.join(td, "scan." + ext)
        with open(img, "wb") as fh:
            fh.write(data)
        try:
            r = subprocess.run([exe, img, "stdout", "-l", lang, "--psm", "6"], capture_output=True, timeout=120)
        except Exception as e:
            raise RuntimeError(f"فشل تشغيل Tesseract: {e}")
    text = r.stdout.decode("utf-8", "ignore")
    if r.returncode != 0 or not text.strip():
        raise RuntimeError("Tesseract لم يستطع قراءة نص من الصورة.")
    return parse_scan_text(text)


def scan_document(data, ext):
    """يرجع (البيانات, اسم المحرك). Gemini لو المفتاح موجود، وإلا Tesseract، ويرجع له لو Gemini فشل."""
    if get_gemini_key():
        try:
            return scan_gemini(data, SCAN_EXT[ext]), "Gemini"
        except RuntimeError as e:
            if find_tesseract() and ext != "pdf":
                return scan_tesseract(data, ext), "Tesseract (تعذّر Gemini: %s)" % e
            raise
    if find_tesseract():
        return scan_tesseract(data, ext), "Tesseract"
    raise RuntimeError("الاسكان محتاج مفتاح Gemini (من الإعدادات) أو تثبيت Tesseract على الجهاز.")


@app.route("/shipments/scan", methods=["GET", "POST"])
@admin_required
def shipment_scan():
    if request.method == "GET":
        return render_template("scan.html", can_scan=bool(get_gemini_key() or find_tesseract()),
                               engine="Gemini" if get_gemini_key() else "Tesseract", page="shipments")
    ajax = request.form.get("ajax") == "1"

    def fail(msg):
        if ajax:
            return jsonify(ok=False, message=msg)
        flash(msg, "error")
        return redirect(url_for("shipment_scan"))

    f = request.files.get("file")
    if not f or not f.filename:
        return fail("اختر صورة المستند أولاً")
    ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
    if ext not in SCAN_EXT:
        return fail("الاسكان يقبل صور (png / jpg / webp) أو ملف PDF فقط")
    data = f.read()
    if len(data) > 10 * 1024 * 1024:
        return fail("حجم الملف أكبر من 10 ميجا، صغّر الصورة وحاول مرة أخرى")
    try:
        d, engine = scan_document(data, ext)
    except RuntimeError as e:
        return fail(str(e))
    if not any(d.values()):
        return fail("لم أجد بيانات واضحة في المستند، جرّب صورة أوضح")
    db = get_db()
    last = db.execute("SELECT MAX(CAST(SUBSTR(number,4) AS INTEGER)) FROM shipments WHERE number LIKE 'SH-%'").fetchone()[0]
    number = f"SH-{(last or 1000) + 1}"
    stored = uuid.uuid4().hex + "." + ext
    with open(os.path.join(UPLOAD_DIR, stored), "wb") as fh:
        fh.write(data)
    cur = db.execute(
        "INSERT INTO shipments(number,client,carrier,bl_number,arrival_date,type,stage,responsible_id,created_by,created_at,updated_by,updated_at,"
        + ",".join(EXTRA_COLS) + ")"
        " VALUES(?,?,?,?,?,?,1,?,?,?,?,?," + ",".join("?" * len(EXTRA_COLS)) + ")",
        (number, d["client"] or "غير محدد", d["carrier"], d["bl_number"], d["arrival_date"], d["type"],
         g.user["id"], g.user["username"], now(), g.user["username"], now(), *[d[c] for c in EXTRA_COLS]))
    sid = cur.lastrowid
    db.execute("INSERT INTO documents(shipment_id,doc_type,original_name,stored_name,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?)",
               (sid, DOC_TYPES[-1], f.filename, stored, g.user["full_name"], now()))
    filled = sum(1 for v in d.values() if v)
    log("إضافة شحنة", "shipment", sid, f"{number} (اسكان بـ {engine} من ملف: {f.filename} — {filled} حقل)")
    db.commit()
    auto_advance(db, sid)
    flash(f"تم اسكان المستند بـ {engine.split(' (')[0]} وإضافة الشحنة {number} ({filled} حقل). راجع البيانات وعدّل أي خطأ.", "ok")
    if ajax:
        return jsonify(ok=True, url=url_for("shipment_detail", sid=sid))
    return redirect(url_for("shipment_detail", sid=sid))


@app.route("/settings/ai-key", methods=["POST"])
@admin_required
def save_ai_key():
    k = request.form.get("key", "").strip()
    if request.form.get("remove"):
        if os.path.exists(GEMINI_KEY_PATH):
            os.remove(GEMINI_KEY_PATH)
        log("حذف مفتاح Gemini")
        flash("تم حذف المفتاح", "ok")
    elif len(k) < 20:
        flash("المفتاح غير صالح", "error")
    else:
        with open(GEMINI_KEY_PATH, "w", encoding="utf-8") as fh:
            fh.write(k)
        try:
            os.chmod(GEMINI_KEY_PATH, 0o600)
        except OSError:
            pass
        log("ضبط مفتاح Gemini")
        flash("تم حفظ مفتاح Gemini، الاسكان جاهز", "ok")
    get_db().commit()
    return redirect(url_for("settings"))


@app.route("/shipments/new", methods=["GET", "POST"])
@perm("can_add")
def shipment_new():
    if request.method == "POST":
        f = request.form
        db = get_db()
        number = f.get("number", "").strip()
        if not number:
            last = db.execute("SELECT MAX(CAST(SUBSTR(number,4) AS INTEGER)) FROM shipments WHERE number LIKE 'SH-%'").fetchone()[0]
            number = f"SH-{(last or 1000) + 1}"
        if not f.get("client", "").strip():
            flash("اسم العميل مطلوب", "error")
            return render_template("shipment_form.html", s=f, users=users_list(), page="shipments")
        if db.execute("SELECT 1 FROM shipments WHERE number=?", (number,)).fetchone():
            flash("رقم الشحنة مستخدم من قبل", "error")
            return render_template("shipment_form.html", s=f, users=users_list(), page="shipments")
        extra = [(f.get(c, "").strip().upper() if c == "invoice_currency" else f.get(c, "").strip()) for c in EXTRA_COLS]
        cur = db.execute(
            "INSERT INTO shipments(number,client,carrier,bl_number,arrival_date,type,stage,responsible_id,created_by,created_at,updated_by,updated_at,"
            + ",".join(EXTRA_COLS) + ")"
            " VALUES(?,?,?,?,?,?,1,?,?,?,?,?," + ",".join("?" * len(EXTRA_COLS)) + ")",
            (number, f["client"].strip(), f.get("carrier", "").strip(), f.get("bl_number", "").strip(),
             f.get("arrival_date", ""), f.get("type", "").strip(), g.user["id"],
             g.user["username"], now(), g.user["username"], now(), *extra))
        log("إضافة شحنة", "shipment", cur.lastrowid, number)
        db.commit()
        flash("تمت إضافة الشحنة", "ok")
        auto_advance(db, cur.lastrowid)
        return redirect(url_for("shipment_detail", sid=cur.lastrowid))
    return render_template("shipment_form.html", s={}, users=users_list(), page="shipments")


def get_shipment(sid):
    s = get_db().execute(
        "SELECT s.*, u.full_name AS resp_name FROM shipments s LEFT JOIN users u ON u.id=s.responsible_id WHERE s.id=? AND s.deleted=0",
        (sid,)).fetchone()
    if not s:
        abort(404)
    return s


@app.route("/shipments/<int:sid>")
@login_required
def shipment_detail(sid):
    s = get_shipment(sid)
    db = get_db()
    if auto_advance(db, sid):
        s = get_shipment(sid)
    docs = db.execute("SELECT * FROM documents WHERE shipment_id=? AND deleted=0 ORDER BY id DESC", (sid,)).fetchall()
    notes = db.execute("SELECT * FROM notes WHERE shipment_id=? ORDER BY id DESC", (sid,)).fetchall()
    hist = db.execute("SELECT * FROM audit WHERE entity='shipment' AND entity_id=? ORDER BY id DESC LIMIT 20", (str(sid),)).fetchall()
    have = {d["doc_type"] for d in docs}
    missing = [d for d in REQUIRED_DOCS if d not in have]
    reqs = stage_requirements(s, have, s["stage"]) if s["stage"] < 8 else []
    pulls_ = pull_rows(sid)
    pull_missing = [r["doc_type"] for r, _ in pulls_ if r["status"] != "تم السحب"]
    offs = offer_rows(sid)
    approved = next((o for o in offs if o["status"] == "معتمد"), None)
    stasks = db.execute(
        "SELECT t.*, uf.full_name AS from_name, ut.full_name AS to_name FROM tasks t JOIN users uf ON uf.id=t.from_id "
        "JOIN users ut ON ut.id=t.to_id WHERE t.shipment_id=? ORDER BY t.id DESC", (sid,)).fetchall()
    if not g.user["is_admin"]:
        stasks = [t for t in stasks if g.user["id"] in (t["from_id"], t["to_id"])]
    return render_template("shipment_detail.html", s=s, docs=docs, notes=notes, hist=hist, missing=missing, reqs=reqs,
                           pulls=pulls_, pull_missing=pull_missing, offers_n=len(offs), approved=approved,
                           stasks=stasks, users=users_list(), page="shipments")


@app.route("/shipments/<int:sid>/history")
@login_required
def shipment_history(sid):
    s = get_shipment(sid)
    rows = get_db().execute(
        "SELECT * FROM audit WHERE entity='shipment' AND entity_id=? ORDER BY id ASC", (str(sid),)).fetchall()
    rows = [dict(r) for r in rows]
    if not any(r["action"] == "إضافة شحنة" for r in rows):
        rows.insert(0, {"ts": s["created_at"], "username": s["created_by"], "action": "إضافة شحنة",
                        "details": s["number"]})
    return render_template("shipment_history.html", s=s, rows=rows, page="shipments")


@app.route("/shipments/<int:sid>/edit", methods=["GET", "POST"])
@perm("can_edit")
def shipment_edit(sid):
    s = get_shipment(sid)
    if request.method == "POST":
        f = request.form
        db = get_db()
        number = f.get("number", "").strip() or s["number"]
        if db.execute("SELECT 1 FROM shipments WHERE number=? AND id<>?", (number, sid)).fetchone():
            flash("رقم الشحنة مستخدم من قبل", "error")
            return render_template("shipment_form.html", s=f, sid=sid, users=users_list(), page="shipments")
        new = (number, f["client"].strip(), f.get("carrier", "").strip(), f.get("bl_number", "").strip(),
               f.get("arrival_date", ""), f.get("type", "").strip(), s["responsible_id"],
               *[(f.get(c, "").strip().upper() if c == "invoice_currency" else f.get(c, "").strip()) for c in EXTRA_COLS])
        old = (s["number"], s["client"], s["carrier"], s["bl_number"], s["arrival_date"], s["type"], s["responsible_id"],
               *[s[c] for c in EXTRA_COLS])
        names = ["الرقم", "اسم الشركة", "شركة الشحن", "البوليصة", "تاريخ الوصول", "النوع", "المسؤول", *[l for _, l, _ in EXTRA_FIELDS]]
        changes = [f"{n}: {o or '-'} ← {v or '-'}" for n, o, v in zip(names, old, new) if str(o or "") != str(v or "")]
        db.execute("UPDATE shipments SET number=?,client=?,carrier=?,bl_number=?,arrival_date=?,type=?,responsible_id=?,"
                   + ",".join(f"{c}=?" for c in EXTRA_COLS) + ",updated_by=?,updated_at=? WHERE id=?",
                   (*new, g.user["username"], now(), sid))
        log("تعديل شحنة", "shipment", sid, " | ".join(changes) or "بدون تغيير")
        db.commit()
        flash("تم حفظ التعديلات", "ok")
        auto_advance(db, sid)
        return redirect(url_for("shipment_detail", sid=sid))
    return render_template("shipment_form.html", s=s, sid=sid, users=users_list(), page="shipments")


@app.route("/shipments/<int:sid>/stage", methods=["POST"])
@perm("can_edit")
def shipment_stage(sid):
    s = get_shipment(sid)
    try:
        st = int(request.form.get("stage", s["stage"]))
    except ValueError:
        abort(400)
    if not 1 <= st <= 8:
        abort(400)
    db = get_db()
    db.execute("UPDATE shipments SET stage=?,updated_by=?,updated_at=? WHERE id=?", (st, g.user["username"], now(), sid))
    log("تغيير مرحلة", "shipment", sid, f"{STAGES[s['stage'] - 1]} ← {STAGES[st - 1]}")
    db.commit()
    flash("تم تحديث المرحلة", "ok")
    return redirect(url_for("shipment_detail", sid=sid))


@app.route("/shipments/<int:sid>/note", methods=["POST"])
@perm("can_edit")
def shipment_note(sid):
    get_shipment(sid)
    text = request.form.get("text", "").strip()
    if text:
        db = get_db()
        db.execute("INSERT INTO notes(shipment_id,username,ts,text) VALUES(?,?,?,?)", (sid, g.user["full_name"], now(), text))
        log("إضافة ملاحظة", "shipment", sid, text[:80])
        db.commit()
    return redirect(url_for("shipment_detail", sid=sid) + "#notes")


@app.route("/shipments/<int:sid>/delete", methods=["POST"])
@perm("can_delete")
def shipment_delete(sid):
    s = get_shipment(sid)
    db = get_db()
    db.execute("UPDATE shipments SET deleted=1,updated_by=?,updated_at=? WHERE id=?", (g.user["username"], now(), sid))
    log("حذف شحنة", "shipment", sid, s["number"])
    db.commit()
    flash("تم حذف الشحنة (محفوظة في السجل)", "ok")
    return redirect(url_for("shipments"))


# ----------------------------------------------------------------- documents
@app.route("/shipments/<int:sid>/upload", methods=["POST"])
@perm("can_add")
def doc_upload(sid):
    s = get_shipment(sid)
    files = [f for f in request.files.getlist("file") if f and f.filename]
    dtype = request.form.get("doc_type", DOC_TYPES[-1])
    if dtype not in DOC_TYPES:
        dtype = DOC_TYPES[-1]
    if not files:
        flash("اختر ملفًا أولاً", "error")
        return redirect(url_for("shipment_detail", sid=sid))
    db = get_db()
    n = 0
    for f in files:
        ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
        if ext not in ALLOWED_EXT:
            flash(f"نوع الملف غير مسموح: {f.filename}", "error")
            continue
        stored = uuid.uuid4().hex + "." + ext
        f.save(os.path.join(UPLOAD_DIR, stored))
        cur = db.execute("INSERT INTO documents(shipment_id,doc_type,original_name,stored_name,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?)",
                         (sid, dtype, f.filename, stored, g.user["full_name"], now()))
        log("رفع مستند", "shipment", sid, f"{dtype}: {f.filename}")
        n += 1
    db.commit()
    if n:
        flash(f"تم رفع {n} مستند", "ok")
        auto_advance(db, sid)
    return redirect(url_for("shipment_detail", sid=sid) + ("#pulls" if request.form.get("anchor") == "pulls" else ""))


@app.route("/documents")
@login_required
def documents():
    q = request.args.get("q", "").strip()
    t = request.args.get("t", "")
    sql = ("SELECT d.*, s.number, s.client FROM documents d JOIN shipments s ON s.id=d.shipment_id "
           "WHERE d.deleted=0 AND s.deleted=0")
    p = []
    if q:
        sql += " AND (d.original_name LIKE ? OR s.number LIKE ? OR s.client LIKE ? OR s.bl_number LIKE ?)"
        p += [f"%{q}%"] * 4
    if t:
        sql += " AND d.doc_type=?"
        p.append(t)
    rows = get_db().execute(sql + " ORDER BY d.id DESC LIMIT 300", p).fetchall()
    return render_template("documents.html", rows=rows, page="documents")


@app.route("/documents/<int:did>/download")
@login_required
def doc_download(did):
    d = get_db().execute("SELECT * FROM documents WHERE id=? AND deleted=0", (did,)).fetchone()
    if not d:
        abort(404)
    path = os.path.join(UPLOAD_DIR, os.path.basename(d["stored_name"]))
    if not os.path.exists(path):
        abort(404)
    log("تحميل مستند", "shipment", d["shipment_id"], d["original_name"])
    get_db().commit()
    return send_file(path, as_attachment=True, download_name=d["original_name"])


@app.route("/documents/<int:did>/delete", methods=["POST"])
@perm("can_delete")
def doc_delete(did):
    d = get_db().execute("SELECT * FROM documents WHERE id=?", (did,)).fetchone()
    if not d:
        abort(404)
    db = get_db()
    db.execute("UPDATE documents SET deleted=1 WHERE id=?", (did,))
    log("حذف مستند", "shipment", d["shipment_id"], d["original_name"])
    db.commit()
    flash("تم حذف المستند (الملف محفوظ في النسخ الاحتياطي)", "ok")
    return redirect(url_for("shipment_detail", sid=d["shipment_id"]))


# ----------------------------------------------------------------- سحب المستندات
def shipment_choices():
    return get_db().execute(
        "SELECT id, number, client FROM shipments WHERE deleted=0 ORDER BY id DESC LIMIT 500").fetchall()


def shipment_from_text(v):
    """يقبل رقم الشحنة (SH-1022) أو أي نص يبدأ به، ويرجع صف الشحنة أو None."""
    v = (v or "").strip().split(" ")[0] if v else ""
    if not v:
        return None
    return get_db().execute("SELECT * FROM shipments WHERE number=? AND deleted=0", (v,)).fetchone()


def pull_rows(sid):
    db = get_db()
    rows = db.execute(
        "SELECT p.*, u.full_name AS resp_name FROM doc_pulls p LEFT JOIN users u ON u.id=p.responsible_id "
        "WHERE p.shipment_id=? ORDER BY p.id", (sid,)).fetchall()
    files = {}
    for d in db.execute("SELECT * FROM documents WHERE shipment_id=? AND deleted=0 ORDER BY id DESC", (sid,)):
        files.setdefault(d["doc_type"], []).append(d)
    return [(r, files.get(r["doc_type"], [])) for r in rows]


@app.route("/shipments/<int:sid>/pulls/add", methods=["POST"])
@perm("can_edit")
def pull_add(sid):
    get_shipment(sid)
    types = [t for t in request.form.getlist("doc_type") if t in PULL_TYPES]
    if not types:
        flash("اختر نوع مستند واحد على الأقل", "error")
        return redirect(url_for("shipment_detail", sid=sid) + "#pulls")
    db = get_db()
    added = []
    for t in types:
        cur = db.execute("INSERT OR IGNORE INTO doc_pulls(shipment_id,doc_type,status,updated_by,updated_at) VALUES(?,?,'مطلوب',?,?)",
                         (sid, t, g.user["username"], now()))
        if cur.rowcount:
            added.append(t)
    if added:
        log("تحديد مستندات مطلوبة للسحب", "shipment", sid, "، ".join(added))
        flash(f"تمت إضافة {len(added)} مستند لقائمة السحب", "ok")
    else:
        flash("المستندات المختارة موجودة بالفعل في القائمة", "error")
    db.commit()
    return redirect(url_for("shipment_detail", sid=sid) + "#pulls")


@app.route("/pulls/<int:pid>/update", methods=["POST"])
@perm("can_edit")
def pull_update(pid):
    db = get_db()
    p = db.execute("SELECT * FROM doc_pulls WHERE id=?", (pid,)).fetchone()
    if not p:
        abort(404)
    f = request.form
    status = f.get("status", p["status"])
    if status not in PULL_STATUSES:
        abort(400)
    date, resp = "", None
    if status == "تم السحب":
        date = f.get("pulled_date", "").strip()
        try:
            datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            date = datetime.now().strftime("%Y-%m-%d")
        try:
            resp = int(f.get("responsible_id") or g.user["id"])
        except ValueError:
            resp = g.user["id"]
        if not db.execute("SELECT 1 FROM users WHERE id=?", (resp,)).fetchone():
            resp = g.user["id"]
    else:
        try:
            resp = int(f["responsible_id"]) if f.get("responsible_id") else p["responsible_id"]
        except ValueError:
            resp = p["responsible_id"]
    note = f.get("note", "").strip()[:300]
    db.execute("UPDATE doc_pulls SET status=?,pulled_date=?,responsible_id=?,note=?,updated_by=?,updated_at=? WHERE id=?",
               (status, date or None, resp, note, g.user["username"], now(), pid))
    who = db.execute("SELECT full_name FROM users WHERE id=?", (resp,)).fetchone() if resp else None
    log("سحب مستند", "shipment", p["shipment_id"],
        f"{p['doc_type']}: {p['status']} ← {status}" + (f" | التاريخ {date}" if date else "") + (f" | المسؤول {who[0]}" if who else ""))
    db.commit()
    flash("تم تحديث حالة المستند", "ok")
    return redirect((request.form.get("back") or url_for("shipment_detail", sid=p["shipment_id"]) + "#pulls"))


@app.route("/pulls/<int:pid>/delete", methods=["POST"])
@perm("can_edit")
def pull_delete(pid):
    db = get_db()
    p = db.execute("SELECT * FROM doc_pulls WHERE id=?", (pid,)).fetchone()
    if not p:
        abort(404)
    db.execute("DELETE FROM doc_pulls WHERE id=?", (pid,))
    log("إلغاء مستند من قائمة السحب", "shipment", p["shipment_id"], f"{p['doc_type']} (كان: {p['status']})")
    db.commit()
    flash("تم إلغاء المستند من القائمة (الملفات المرفوعة لم تُحذف)", "ok")
    return redirect(url_for("shipment_detail", sid=p["shipment_id"]) + "#pulls")


@app.route("/pulls")
@login_required
def pulls():
    st = request.args.get("status", "pending")
    t = request.args.get("t", "")
    q = request.args.get("q", "").strip()
    sql = ("SELECT p.*, s.number, s.client, u.full_name AS resp_name, "
           "(SELECT COUNT(*) FROM documents d WHERE d.shipment_id=p.shipment_id AND d.doc_type=p.doc_type AND d.deleted=0) AS files "
           "FROM doc_pulls p JOIN shipments s ON s.id=p.shipment_id LEFT JOIN users u ON u.id=p.responsible_id WHERE s.deleted=0")
    args = []
    if st == "pending":
        sql += " AND p.status<>'تم السحب'"
    elif st in PULL_STATUSES:
        sql += " AND p.status=?"
        args.append(st)
    if t:
        sql += " AND p.doc_type=?"
        args.append(t)
    if q:
        sql += " AND (s.number LIKE ? OR s.client LIKE ? OR s.bl_number LIKE ?)"
        args += [f"%{q}%"] * 3
    rows = get_db().execute(sql + " ORDER BY p.id DESC LIMIT 400", args).fetchall()
    return render_template("pulls.html", rows=rows, st=st, t=t, q=q, page="pulls")


# ----------------------------------------------------------------- الاختيارات (العروض)
def offer_rows(sid):
    return get_db().execute("SELECT * FROM offers WHERE shipment_id=? AND deleted=0 ORDER BY id", (sid,)).fetchall()


@app.route("/shipments/<int:sid>/offers")
@login_required
def offers(sid):
    s = get_shipment(sid)
    rows = [dict(r) for r in offer_rows(sid)]
    mins = {}
    for r in rows:
        if r["price"] is not None:
            c = r["currency"] or ""
            mins[c] = min(mins.get(c, r["price"]), r["price"])
    for r in rows:
        m = mins.get(r["currency"] or "")
        r["best"] = bool(m is not None and r["price"] is not None and r["price"] == m and
                         sum(1 for x in rows if (x["currency"] or "") == (r["currency"] or "") and x["price"] is not None) > 1)
        r["diff"] = round((r["price"] - m) * 100 / m, 1) if (m and r["price"] is not None) else None
    cmp_rows = sorted(rows, key=lambda r: ((r["currency"] or ""), r["price"] if r["price"] is not None else 1e18))
    return render_template("offers.html", s=s, rows=rows, cmp_rows=cmp_rows, mixed=len(mins) > 1, page="shipments")


@app.route("/shipments/<int:sid>/offers/add", methods=["POST"])
@perm("can_edit")
def offer_add(sid):
    get_shipment(sid)
    f = request.form
    provider = f.get("provider", "").strip()
    if not provider:
        flash("اسم الجهة المقدمة للعرض مطلوب", "error")
        return redirect(url_for("offers", sid=sid))
    try:
        price = float(f.get("price", "").replace(",", "").strip())
        if price < 0:
            raise ValueError
    except ValueError:
        flash("السعر لازم يكون رقم صحيح", "error")
        return redirect(url_for("offers", sid=sid))
    cur_ = f.get("currency", "").strip().upper()[:8] or "EGP"
    db = get_db()
    cur = db.execute("INSERT INTO offers(shipment_id,provider,service,price,currency,details,added_by,added_at) VALUES(?,?,?,?,?,?,?,?)",
                     (sid, provider, f.get("service", "").strip(), price, cur_, f.get("details", "").strip(),
                      g.user["full_name"], now()))
    log("إضافة عرض", "shipment", sid, f"عرض #{cur.lastrowid}: {provider} — {price:g} {cur_}")
    db.commit()
    flash("تمت إضافة العرض", "ok")
    return redirect(url_for("offers", sid=sid))


def get_offer(oid):
    o = get_db().execute("SELECT * FROM offers WHERE id=? AND deleted=0", (oid,)).fetchone()
    if not o:
        abort(404)
    return o


@app.route("/offers/<int:oid>/approve", methods=["POST"])
@perm("can_approve")
def offer_approve(oid):
    o = get_offer(oid)
    db = get_db()
    db.execute("UPDATE offers SET status='مقترح',approved_by=NULL,approved_at=NULL WHERE shipment_id=? AND status='معتمد'", (o["shipment_id"],))
    db.execute("UPDATE offers SET status='معتمد',approved_by=?,approved_at=? WHERE id=?", (g.user["full_name"], now(), oid))
    log("اعتماد عرض", "shipment", o["shipment_id"], f"عرض #{oid}: {o['provider']} — {o['price']:g} {o['currency']}")
    db.commit()
    flash("تم اعتماد العرض", "ok")
    return redirect(url_for("offers", sid=o["shipment_id"]))


@app.route("/offers/<int:oid>/unapprove", methods=["POST"])
@perm("can_approve")
def offer_unapprove(oid):
    o = get_offer(oid)
    db = get_db()
    db.execute("UPDATE offers SET status='مقترح',approved_by=NULL,approved_at=NULL WHERE id=?", (oid,))
    log("إلغاء اعتماد عرض", "shipment", o["shipment_id"], f"عرض #{oid}: {o['provider']}")
    db.commit()
    flash("تم إلغاء الاعتماد", "ok")
    return redirect(url_for("offers", sid=o["shipment_id"]))


@app.route("/offers/<int:oid>/delete", methods=["POST"])
@login_required
def offer_delete(oid):
    o = get_offer(oid)
    if not (g.user["is_admin"] or g.user["can_delete"] or o["added_by"] == g.user["full_name"]):
        abort(403)
    if o["status"] == "معتمد" and not g.user["is_admin"]:
        flash("لا يمكن حذف عرض معتمد (ألغِ اعتماده أولاً)", "error")
        return redirect(url_for("offers", sid=o["shipment_id"]))
    db = get_db()
    db.execute("UPDATE offers SET deleted=1 WHERE id=?", (oid,))
    log("حذف عرض", "shipment", o["shipment_id"], f"عرض #{oid}: {o['provider']} — {o['price']:g} {o['currency']}")
    db.commit()
    flash("تم حذف العرض (محفوظ في السجل)", "ok")
    return redirect(url_for("offers", sid=o["shipment_id"]))


# ----------------------------------------------------------------- الشات الداخلي
def general_unread(uid):
    db = get_db()
    seen = db.execute("SELECT last_general_id FROM chat_seen WHERE user_id=?", (uid,)).fetchone()
    return db.execute("SELECT COUNT(*) FROM messages WHERE recipient_id=0 AND sender_id<>? AND id>?",
                      (uid, seen[0] if seen else 0)).fetchone()[0]


def get_counts():
    u = g.get("user")
    if not u:
        return {}
    db = get_db()
    gen = general_unread(u["id"])
    return {
        "chat": db.execute("SELECT COUNT(*) FROM messages WHERE recipient_id=? AND read_at IS NULL AND task_id IS NULL", (u["id"],)).fetchone()[0]
                + (gen if u["pref_general"] else 0),
        "general": gen,
        "prefs": {"sound": u["pref_sound"], "badges": u["pref_badges"], "poll": u["pref_poll"]},
        "orders_unread": db.execute("SELECT COUNT(*) FROM tasks WHERE to_id=? AND read_at IS NULL", (u["id"],)).fetchone()[0],
        "orders_open": db.execute("SELECT COUNT(*) FROM tasks WHERE to_id=? AND status<>'مكتمل'", (u["id"],)).fetchone()[0],
    }


@app.route("/api/notify")
@login_required
def api_notify():
    db = get_db()
    c = get_counts()
    items = db.execute(
        "SELECT t.id, t.title, t.created_at, u.full_name AS frm, s.number FROM tasks t JOIN users u ON u.id=t.from_id "
        "JOIN shipments s ON s.id=t.shipment_id WHERE t.to_id=? AND t.read_at IS NULL ORDER BY t.id DESC LIMIT 5",
        (g.user["id"],)).fetchall()
    c["items"] = [dict(i, url=url_for("task_detail", tid=i["id"])) for i in items]
    return jsonify(c)


def chat_contacts():
    db = get_db()
    me = g.user["id"]
    out = []
    for u in db.execute("SELECT id, full_name, username FROM users WHERE active=1 AND id<>? ORDER BY full_name", (me,)):
        last = db.execute(
            "SELECT * FROM messages WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?) ORDER BY id DESC LIMIT 1",
            (me, u["id"], u["id"], me)).fetchone()
        unread = db.execute("SELECT COUNT(*) FROM messages WHERE sender_id=? AND recipient_id=? AND read_at IS NULL AND task_id IS NULL",
                            (u["id"], me)).fetchone()[0]
        out.append(dict(id=u["id"], name=u["full_name"], last=last, unread=unread))
    out.sort(key=lambda c: (-(c["last"]["id"] if c["last"] else 0), c["name"]))
    return out


def general_info():
    last = get_db().execute(
        "SELECT m.*, u.full_name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.recipient_id=0 ORDER BY m.id DESC LIMIT 1").fetchone()
    return dict(last=last, unread=general_unread(g.user["id"]))


def thread_messages(peer, after=0):
    """peer=0 يعني الشات العام (كل الموظفين)."""
    me = g.user["id"]
    db = get_db()
    base = ("SELECT m.*, s.number AS ship_number, t.status AS task_status, t.title AS task_title, us.full_name AS sender_name "
            "FROM messages m LEFT JOIN shipments s ON s.id=m.shipment_id LEFT JOIN tasks t ON t.id=m.task_id "
            "JOIN users us ON us.id=m.sender_id WHERE ")
    if peer == 0:
        base += "m.recipient_id=0"
        args = []
    else:
        base += "((m.sender_id=? AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=?))"
        args = [me, peer, peer, me]
    if after:
        rows = db.execute(base + " AND m.id>? ORDER BY m.id LIMIT 200", (*args, after)).fetchall()
    else:
        rows = list(reversed(db.execute(base + " ORDER BY m.id DESC LIMIT 100", args).fetchall()))
    if peer == 0:
        if rows:
            db.execute("INSERT INTO chat_seen(user_id,last_general_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET "
                       "last_general_id=MAX(last_general_id, excluded.last_general_id)", (me, rows[-1]["id"]))
            db.commit()
        return rows
    mark = [r["id"] for r in rows if r["recipient_id"] == me and r["read_at"] is None and r["task_id"] is None]
    if mark:
        db.execute("UPDATE messages SET read_at=? WHERE id IN (%s)" % ",".join("?" * len(mark)), (now(), *mark))
        db.commit()
    return rows


@app.route("/chat")
@login_required
def chat():
    try:
        peer = int(request.args.get("u", -1))
    except ValueError:
        peer = -1
    general = peer == 0
    peer_u = None
    if general:
        peer_u = {"id": 0, "full_name": "الشات العام (كل الموظفين)"}
    elif peer > 0:
        peer_u = get_db().execute("SELECT id, full_name FROM users WHERE id=? AND active=1 AND id<>?", (peer, g.user["id"])).fetchone()
    msgs = thread_messages(peer_u["id"]) if peer_u else []
    return render_template("chat.html", contacts=chat_contacts(), general=general_info(), peer=peer_u, msgs=msgs,
                           last_id=(msgs[-1]["id"] if msgs else 0), ships=shipment_choices(), page="chat")


@app.route("/chat/poll")
@login_required
def chat_poll():
    try:
        peer, after = int(request.args.get("u", 0)), int(request.args.get("after", 0))
    except ValueError:
        abort(400)
    msgs = thread_messages(peer, after)
    return jsonify(html=render_template("_chat_msgs.html", msgs=msgs), last=(msgs[-1]["id"] if msgs else after),
                   n=len(msgs), counts=get_counts())


@app.route("/chat/send", methods=["POST"])
@login_required
def chat_send():
    ajax = request.form.get("ajax") == "1"
    f = request.form

    def fail(msg):
        if ajax:
            return jsonify(ok=False, message=msg)
        flash(msg, "error")
        return redirect(url_for("chat", u=f.get("to", "")))
    db = get_db()
    try:
        to = int(f.get("to", 0))
    except ValueError:
        return fail("اختر الموظف")
    if to != 0 and not db.execute("SELECT 1 FROM users WHERE id=? AND active=1 AND id<>?", (to, g.user["id"])).fetchone():
        return fail("الموظف غير موجود")
    body = f.get("body", "").strip()[:4000]
    up = request.files.get("file")
    fname = stored = None
    if up and up.filename:
        ext = up.filename.rsplit(".", 1)[-1].lower() if "." in up.filename else ""
        if ext not in CHAT_EXT:
            return fail(f"نوع الملف غير مسموح: {up.filename}")
        stored = uuid.uuid4().hex + "." + ext
        up.save(os.path.join(UPLOAD_DIR, stored))
        fname = up.filename
    if not body and not stored:
        return fail("اكتب رسالة أو أرفق ملفًا")
    sh = shipment_from_text(f.get("shipment", ""))
    if f.get("shipment", "").strip() and not sh:
        return fail("رقم الشحنة غير صحيح")
    db.execute("INSERT INTO messages(sender_id,recipient_id,shipment_id,body,file_name,stored_name,created_at) VALUES(?,?,?,?,?,?,?)",
               (g.user["id"], to, sh["id"] if sh else None, body, fname, stored, now()))
    db.commit()
    if ajax:
        return jsonify(ok=True)
    return redirect(url_for("chat", u=to))


@app.route("/chat/file/<int:mid>")
@login_required
def chat_file(mid):
    m = get_db().execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
    if not m or not m["stored_name"] or not (m["recipient_id"] == 0 or g.user["id"] in (m["sender_id"], m["recipient_id"])):
        abort(404)
    path = os.path.join(UPLOAD_DIR, os.path.basename(m["stored_name"]))
    if not os.path.exists(path):
        abort(404)
    return send_file(path, as_attachment=True, download_name=m["file_name"])


# ----------------------------------------------------------------- الأوامر والمهام
def task_row(tid):
    t = get_db().execute(
        "SELECT t.*, s.number, s.client, uf.full_name AS from_name, ut.full_name AS to_name FROM tasks t "
        "JOIN shipments s ON s.id=t.shipment_id JOIN users uf ON uf.id=t.from_id JOIN users ut ON ut.id=t.to_id WHERE t.id=?", (tid,)).fetchone()
    if not t:
        abort(404)
    if not (g.user["is_admin"] or g.user["id"] in (t["from_id"], t["to_id"])):
        abort(403)
    return t


@app.route("/tasks")
@login_required
def tasks():
    box = request.args.get("box", "in")
    st = request.args.get("status", "")
    sql = ("SELECT t.*, s.number, s.client, uf.full_name AS from_name, ut.full_name AS to_name FROM tasks t "
           "JOIN shipments s ON s.id=t.shipment_id JOIN users uf ON uf.id=t.from_id JOIN users ut ON ut.id=t.to_id WHERE 1=1")
    args = []
    if box == "all" and g.user["is_admin"]:
        pass
    elif box == "out":
        sql += " AND t.from_id=?"
        args.append(g.user["id"])
    else:
        box = "in"
        sql += " AND t.to_id=?"
        args.append(g.user["id"])
    if st == "open":
        sql += " AND t.status<>'مكتمل'"
    elif st in TASK_STATUSES:
        sql += " AND t.status=?"
        args.append(st)
    rows = get_db().execute(sql + " ORDER BY (t.read_at IS NULL) DESC, t.id DESC LIMIT 300", args).fetchall()
    return render_template("tasks.html", rows=rows, box=box, st=st, page="tasks")


@app.route("/tasks/new", methods=["GET", "POST"])
@login_required
def task_new():
    users = get_db().execute("SELECT id, full_name FROM users WHERE active=1 AND id<>? ORDER BY full_name", (g.user["id"],)).fetchall()
    if request.method == "POST":
        f = request.form
        sh = shipment_from_text(f.get("shipment", ""))
        title = f.get("title", "").strip()[:200]
        try:
            to = int(f.get("to", 0))
        except ValueError:
            to = 0
        to_u = get_db().execute("SELECT id, full_name FROM users WHERE id=? AND active=1 AND id<>?", (to, g.user["id"])).fetchone()
        if not sh or not title or not to_u:
            flash("اختر الشحنة والموظف واكتب عنوان الأمر", "error")
            return render_template("task_form.html", users=users, ships=shipment_choices(), f=f, page="tasks")
        db = get_db()
        cur = db.execute("INSERT INTO tasks(shipment_id,from_id,to_id,title,details,status,created_at) VALUES(?,?,?,?,?, 'جديد', ?)",
                         (sh["id"], g.user["id"], to, title, f.get("details", "").strip()[:4000], now()))
        tid = cur.lastrowid
        db.execute("INSERT INTO messages(sender_id,recipient_id,shipment_id,task_id,body,created_at) VALUES(?,?,?,?,?,?)",
                   (g.user["id"], to, sh["id"], tid, title, now()))
        log("إرسال أمر", "shipment", sh["id"], f"أمر #{tid} إلى {to_u['full_name']}: {title}")
        db.commit()
        flash("تم إرسال الأمر وسيظهر للموظف كتنبيه حتى يفتحه", "ok")
        return redirect(url_for("task_detail", tid=tid))
    pre = {}
    if request.args.get("shipment"):
        s = get_db().execute("SELECT number FROM shipments WHERE id=? AND deleted=0", (request.args.get("shipment"),)).fetchone()
        pre["shipment"] = s["number"] if s else ""
    pre["to"] = request.args.get("to", "")
    return render_template("task_form.html", users=users, ships=shipment_choices(), f=pre, page="tasks")


@app.route("/tasks/<int:tid>")
@login_required
def task_detail(tid):
    t = task_row(tid)
    db = get_db()
    if g.user["id"] == t["to_id"] and not t["read_at"]:
        db.execute("UPDATE tasks SET read_at=?, status=CASE WHEN status='جديد' THEN 'تم الاطلاع' ELSE status END WHERE id=?", (now(), tid))
        db.execute("UPDATE messages SET read_at=? WHERE task_id=? AND read_at IS NULL", (now(), tid))
        log("قراءة أمر", "shipment", t["shipment_id"], f"أمر #{tid}: {t['title']}")
        db.commit()
        t = task_row(tid)
    return render_template("task_detail.html", t=t, page="tasks")


@app.route("/tasks/<int:tid>/status", methods=["POST"])
@login_required
def task_status(tid):
    t = task_row(tid)
    if not (g.user["is_admin"] or g.user["id"] == t["to_id"]):
        abort(403)
    st = request.form.get("status", "")
    if st not in TASK_STATUSES[1:]:
        abort(400)
    sets = ["status=?"]
    args = [st]
    if not t["read_at"] and g.user["id"] == t["to_id"]:
        sets.append("read_at=?")
        args.append(now())
    if st == "جاري التنفيذ" and not t["started_at"]:
        sets.append("started_at=?")
        args.append(now())
    if st == "مكتمل":
        sets.append("done_at=?")
        args.append(now())
        if not t["started_at"]:
            sets.append("started_at=?")
            args.append(now())
    else:
        sets.append("done_at=NULL")
    db = get_db()
    db.execute(f"UPDATE tasks SET {','.join(sets)} WHERE id=?", (*args, tid))
    log("تغيير حالة أمر", "shipment", t["shipment_id"], f"أمر #{tid}: {t['status']} ← {st}")
    db.commit()
    flash("تم تحديث حالة الأمر", "ok")
    return redirect(url_for("task_detail", tid=tid))


# ----------------------------------------------------------------- reports
def report_data(args):
    d_from = args.get("date_from", "")
    d_to = args.get("date_to", "")
    sql = "SELECT * FROM shipments WHERE deleted=0"
    p = []
    if d_from:
        sql += " AND arrival_date>=?"
        p.append(d_from)
    if d_to:
        sql += " AND arrival_date<=?"
        p.append(d_to)
    rows = get_db().execute(sql + " ORDER BY arrival_date DESC, id DESC", p).fetchall()
    groups = {"مكتملة": 0, "قيد الإجراءات": 0, "تحت المراجعة": 0, "مستلمة": 0}
    out = []
    docs = get_db().execute("SELECT shipment_id, doc_type FROM documents WHERE deleted=0").fetchall()
    have = {}
    for d in docs:
        have.setdefault(d["shipment_id"], set()).add(d["doc_type"])
    for r in rows:
        label, color = status_of(r["stage"])
        groups[label] += 1
        miss = [x for x in REQUIRED_DOCS if x not in have.get(r["id"], set())]
        out.append(dict(r=r, label=label, color=color, missing=miss))
    return d_from, d_to, groups, out


@app.route("/reports")
@login_required
def reports():
    d_from, d_to, groups, out = report_data(request.args)
    total = sum(groups.values()) or 1
    colors = {"مكتملة": "#22a447", "قيد الإجراءات": "#1f6fe0", "تحت المراجعة": "#f5a31a", "مستلمة": "#9aa7ba"}
    acc, parts, legend = 0, [], []
    for k, v in groups.items():
        pct = v * 100 / total
        if v:
            parts.append(f"{colors[k]} {acc:.2f}% {acc + pct:.2f}%")
        acc += pct
        legend.append((k, v, round(pct), colors[k]))
    gradient = ", ".join(parts) or "#e3e9f3 0 100%"
    return render_template("reports.html", d_from=d_from, d_to=d_to, groups=groups, out=out, gradient=gradient,
                           legend=legend, open_count=sum(1 for o in out if o["r"]["stage"] < 8),
                           closed_count=sum(1 for o in out if o["r"]["stage"] >= 8), page="reports")


@app.route("/reports/export")
@login_required
def reports_export():
    _, _, _, out = report_data(request.args)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["رقم الشحنة", "اسم الشركة", "شركة الشحن", "رقم البوليصة", "تاريخ الوصول", "النوع",
                *[l for _, l, _ in EXTRA_FIELDS], "المرحلة", "الحالة", "مستندات ناقصة", "مستندات سحب لم تُسحب"])
    pend = {}
    for p in get_db().execute("SELECT shipment_id, doc_type FROM doc_pulls WHERE status<>'تم السحب'"):
        pend.setdefault(p["shipment_id"], []).append(p["doc_type"])
    for o in out:
        r = o["r"]
        w.writerow([r["number"], r["client"], r["carrier"], r["bl_number"], r["arrival_date"], r["type"],
                    *[r[c] for c in EXTRA_COLS], STAGES[r["stage"] - 1], o["label"], "، ".join(o["missing"]),
                    "، ".join(pend.get(r["id"], []))])
    log("تصدير تقرير")
    get_db().commit()
    return Response("﻿" + buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=report.csv"})


# ----------------------------------------------------------------- employees
@app.route("/employees")
@admin_required
def employees():
    rows = get_db().execute("SELECT * FROM users ORDER BY id").fetchall()
    return render_template("employees.html", rows=rows, page="employees")


@app.route("/employees/new", methods=["GET", "POST"])
@admin_required
def employee_new():
    if request.method == "POST":
        f = request.form
        username = f.get("username", "").strip()
        pw = f.get("password", "")
        if not username or not f.get("full_name", "").strip() or len(pw) < 6:
            flash("أكمل البيانات (كلمة المرور 6 أحرف على الأقل)", "error")
            return render_template("employee_form.html", u=f, page="employees")
        db = get_db()
        if db.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            flash("اسم المستخدم موجود", "error")
            return render_template("employee_form.html", u=f, page="employees")
        cur = db.execute(
            "INSERT INTO users(username,full_name,password_hash,is_admin,can_add,can_edit,can_delete,can_approve,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            (username, f["full_name"].strip(), generate_password_hash(pw), int("is_admin" in f), int("can_add" in f),
             int("can_edit" in f), int("can_delete" in f), int("can_approve" in f), now()))
        log("إضافة موظف", "user", cur.lastrowid, username)
        db.commit()
        flash("تمت إضافة الموظف", "ok")
        return redirect(url_for("employees"))
    return render_template("employee_form.html", u={"can_add": 1, "can_edit": 1}, page="employees")


@app.route("/employees/<int:uid>/edit", methods=["GET", "POST"])
@admin_required
def employee_edit(uid):
    db = get_db()
    u = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not u:
        abort(404)
    if request.method == "POST":
        f = request.form
        active = int("active" in f)
        is_admin = int("is_admin" in f)
        if uid == g.user["id"]:
            active, is_admin = 1, 1
        db.execute("UPDATE users SET full_name=?,is_admin=?,can_add=?,can_edit=?,can_delete=?,can_approve=?,active=? WHERE id=?",
                   (f.get("full_name", u["full_name"]).strip(), is_admin, int("can_add" in f), int("can_edit" in f),
                    int("can_delete" in f), int("can_approve" in f), active, uid))
        if f.get("password"):
            if len(f["password"]) < 6:
                flash("كلمة المرور قصيرة", "error")
                return render_template("employee_form.html", u=u, uid=uid, page="employees")
            db.execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(f["password"]), uid))
        log("تعديل موظف", "user", uid, u["username"] + (" (إيقاف)" if not active else ""))
        db.commit()
        flash("تم الحفظ", "ok")
        return redirect(url_for("employees"))
    return render_template("employee_form.html", u=u, uid=uid, page="employees")


# ----------------------------------------------------------------- audit
@app.route("/audit")
@admin_required
def audit():
    q = request.args.get("q", "").strip()
    cat = request.args.get("cat", "")
    cats = {"orders": "أمر", "offers": "عرض", "pulls": "سحب", "docs": "مستند", "edits": "تعديل"}
    where, p = [], []
    if q:
        where.append("(username LIKE ? OR action LIKE ? OR details LIKE ?)")
        p += [f"%{q}%"] * 3
    if cat in cats:
        where.append("action LIKE ?")
        p.append(f"%{cats[cat]}%")
    sql = "SELECT * FROM audit" + (" WHERE " + " AND ".join(where) if where else "")
    rows = get_db().execute(sql + " ORDER BY id DESC LIMIT 300", p).fetchall()
    return render_template("audit.html", rows=rows, cat=cat, page="audit")


# ----------------------------------------------------------------- settings / backup
def make_backup(path):
    tmp = path + ".db"
    src = sqlite3.connect(DB_PATH)
    dst = sqlite3.connect(tmp)
    src.backup(dst)
    dst.close()
    src.close()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(tmp, "app.db")
        for fn in os.listdir(UPLOAD_DIR):
            z.write(os.path.join(UPLOAD_DIR, fn), "uploads/" + fn)
    os.remove(tmp)


def auto_backup():
    try:
        files = sorted(f for f in os.listdir(BACKUP_DIR) if f.endswith(".zip"))
        if files:
            last = datetime.strptime(files[-1][7:22], "%Y%m%d-%H%M%S")
            if datetime.now() - last < timedelta(hours=24):
                return
        make_backup(os.path.join(BACKUP_DIR, "backup-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".zip"))
        for old in files[:-13]:
            os.remove(os.path.join(BACKUP_DIR, old))
    except Exception as e:  # النسخ الاحتياطي لا يجب أن يعطل الدخول
        print("backup error:", e)


@app.route("/settings", methods=["GET", "POST"])
@login_required
def settings():
    if request.method == "POST":
        f = request.form
        if not check_password_hash(g.user["password_hash"], f.get("old", "")):
            flash("كلمة المرور الحالية غير صحيحة", "error")
        elif len(f.get("new", "")) < 6 or f.get("new") != f.get("new2"):
            flash("كلمة المرور الجديدة غير متطابقة أو قصيرة", "error")
        else:
            get_db().execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(f["new"]), g.user["id"]))
            log("تغيير كلمة المرور")
            get_db().commit()
            flash("تم تغيير كلمة المرور", "ok")
    backups = sorted(os.listdir(BACKUP_DIR), reverse=True)[:10] if g.user["is_admin"] else []
    k = get_gemini_key()
    return render_template("settings.html", backups=backups, ai_key_tail=(k[-4:] if k else ""),
                           tess_ok=bool(find_tesseract()), page="settings")


@app.route("/settings/prefs", methods=["POST"])
@login_required
def save_prefs():
    f = request.form
    try:
        poll = min(max(int(f.get("pref_poll", 7)), 3), 60)
    except ValueError:
        poll = 7
    get_db().execute("UPDATE users SET pref_sound=?,pref_badges=?,pref_general=?,pref_poll=? WHERE id=?",
                     (int("pref_sound" in f), int("pref_badges" in f), int("pref_general" in f), poll, g.user["id"]))
    get_db().commit()
    flash("تم حفظ إعدادات الإشعارات والعدادات", "ok")
    return redirect(url_for("settings"))


@app.route("/backup/create", methods=["POST"])
@admin_required
def backup_create():
    name = "backup-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".zip"
    make_backup(os.path.join(BACKUP_DIR, name))
    log("نسخة احتياطية", details=name)
    get_db().commit()
    return send_file(os.path.join(BACKUP_DIR, name), as_attachment=True, download_name=name)


@app.route("/backup/download/<name>")
@admin_required
def backup_download(name):
    name = os.path.basename(name)
    path = os.path.join(BACKUP_DIR, name)
    if not os.path.exists(path):
        abort(404)
    return send_file(path, as_attachment=True, download_name=name)


@app.route("/backup/restore", methods=["POST"])
@admin_required
def backup_restore():
    f = request.files.get("file")
    if not f or not f.filename.endswith(".zip"):
        flash("اختر ملف نسخة احتياطية (zip)", "error")
        return redirect(url_for("settings"))
    # نسخة أمان قبل الاستعادة
    make_backup(os.path.join(BACKUP_DIR, "before-restore-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".zip"))
    tmp = os.path.join(DATA_DIR, "restore.zip")
    f.save(tmp)
    try:
        with zipfile.ZipFile(tmp) as z:
            names = z.namelist()
            if "app.db" not in names:
                raise ValueError("ملف غير صالح")
            z.extract("app.db", DATA_DIR)
            os.replace(os.path.join(DATA_DIR, "app.db"), DB_PATH)
            for n in names:
                if n.startswith("uploads/") and not n.endswith("/") and ".." not in n:
                    with z.open(n) as src, open(os.path.join(UPLOAD_DIR, os.path.basename(n)), "wb") as dst:
                        shutil.copyfileobj(src, dst)
        init_db()   # لو النسخة قديمة: يضيف الجداول والأعمدة الجديدة (شات / عروض / سحب)
        flash("تمت استعادة البيانات", "ok")
    except Exception as e:
        flash(f"فشلت الاستعادة: {e}", "error")
    finally:
        os.remove(tmp)
    session.clear()
    return redirect(url_for("login"))


@app.route("/favicon.ico")
def favicon():
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0a3a82"/>'
           '<text x="32" y="41" font-size="24" font-weight="800" text-anchor="middle" fill="#fff" font-family="Arial">INX</text></svg>')
    return Response(svg, mimetype="image/svg+xml", headers={"Cache-Control": "public, max-age=86400"})


@app.errorhandler(403)
def e403(_):
    return render_template("error.html", code=403, msg="ليست لديك صلاحية لهذا الإجراء", page=""), 403


@app.errorhandler(404)
def e404(_):
    return render_template("error.html", code=404, msg="الصفحة غير موجودة", page=""), 404


@app.errorhandler(400)
def e400(e):
    return render_template("error.html", code=400, msg=getattr(e, "description", "طلب غير صالح"), page=""), 400


def seed_demo():
    db = sqlite3.connect(DB_PATH)
    if db.execute("SELECT COUNT(*) FROM shipments").fetchone()[0]:
        db.close()
        return
    rows = [("SH-1022", "شركة الأمل", "Maersk", "MAE778812", "2026-11-01", "حاويات", 1),
            ("SH-1023", "كريم للتجارة", "MSC", "MSC445521", "2026-11-03", "بضاعة عامة", 3),
            ("SH-1024", "شركة النور", "DHL", "123456789", "2026-11-05", "بضاعة عامة", 4),
            ("SH-1025", "أحمد خالد", "ABC", "ABC90012", "2026-10-20", "أجهزة", 8)]
    for r in rows:
        db.execute("INSERT INTO shipments(number,client,carrier,bl_number,arrival_date,type,stage,responsible_id,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,1,'admin',?, 'admin',?)",
                   (*r, now(), now()))
    db.commit()
    db.close()


init_db()
if "--demo" in sys.argv:
    seed_demo()

if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8080" if os.environ.get("DATA_DIR") or os.path.isdir("/data") else "5000"))
    print(f">> افتح المتصفح على: http://localhost:{port}")
    try:
        from waitress import serve
        serve(app, host=host, port=port)
    except ImportError:
        app.run(host=host, port=port)
