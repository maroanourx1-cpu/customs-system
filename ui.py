# -*- coding: utf-8 -*-
"""مصدر واحد للتنقل (القائمة الجانبية + الشريط السفلي + لوحة البحث السريع) وواجهة البحث السريع."""
from flask import g, jsonify, request, url_for

# (المفتاح = قيمة page في القالب, endpoint, أيقونة, العنوان, اسم العداد, للمدير فقط)
NAV = [
    ("عام", [
        ("home", "home", "home", "الرئيسية", None, False),
        ("shipments", "shipments", "ship", "الشحنات", None, False),
        ("sheets", "sheets_list", "grid", "جداول Excel", None, False),
        ("pdftools", "pdf_tools", "file", "تحويل PDF", None, False),
        ("currency", "currency", "dollar", "أسعار العملات", None, False),
    ]),
    ("المتابعة", [
        ("chat", "chat", "chat", "الشات الداخلي", "chat", False),
        ("tasks", "tasks", "task", "الأوامر والمهام", "orders_open", False),
        ("regulatory", "regulatory", "alert", "العروض الرقابية", None, False),
        ("pulls", "pulls", "pull", "سحب المستندات", None, False),
        ("documents", "documents", "file", "المستندات", None, False),
    ]),
    ("التحليل", [
        ("search", "search", "search", "البحث والاستعلام", None, False),
        ("reports", "reports", "chart", "التقارير", None, False),
    ]),
    ("الإدارة", [
        ("employees", "employees", "users", "الموظفون", None, True),
        ("audit", "audit", "history", "سجل التعديلات", None, True),
        ("settings", "settings", "settings", "الإعدادات", None, False),
    ]),
]

# اختصارات سريعة تظهر في لوحة الأوامر (Ctrl+K)
ACTIONS = [
    ("شحنة جديدة", "plus", "shipment_new", "can_add"),
    ("جدول Excel جديد", "grid", "sheets_list", "can_add"),
    ("إرسال أمر جديد", "task", "task_new", None),
]


def register(app, get_db, login_required):
    @app.context_processor
    def _nav():
        me = g.get("user")
        if not me:
            return {}
        groups, flat = [], []
        for title, items in NAV:
            out = []
            for key, ep, icon, label, badge, admin_only in items:
                if admin_only and not me["is_admin"]:
                    continue
                it = dict(key=key, url=url_for(ep), icon=icon, label=label, badge=badge)
                out.append(it)
                flat.append(dict(label=label, url=it["url"], icon=icon, group=title))
            if out:
                groups.append(dict(title=title, items=out))
        acts = []
        for label, icon, ep, p in ACTIONS:
            if p and not (me["is_admin"] or me[p]):
                continue
            url = url_for(ep) + ("?new=1" if ep == "sheets_list" else "")
            acts.append(dict(label=label, url=url, icon=icon, group="إجراءات سريعة"))
        return dict(nav_groups=groups, palette_items=acts + flat)

    @app.route("/api/quick-search")
    @login_required
    def api_quick_search():
        q = (request.args.get("q") or "").strip()
        if len(q) < 2:
            return jsonify([])
        like = f"%{q}%"
        rows = get_db().execute(
            "SELECT id, number, client, supplier, acid FROM shipments WHERE deleted=0 AND "
            "(number LIKE ? OR client LIKE ? OR supplier LIKE ? OR acid LIKE ? OR bl_number LIKE ? OR order_number LIKE ?) "
            "ORDER BY id DESC LIMIT 8", (like,) * 6).fetchall()
        return jsonify([dict(label=f"{r['number']} — {r['client']}",
                             sub=" · ".join(x for x in (r["supplier"], r["acid"]) if x),
                             url=url_for("shipment_detail", sid=r["id"])) for r in rows])
