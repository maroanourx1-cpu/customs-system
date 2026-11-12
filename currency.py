# -*- coding: utf-8 -*-
"""أسعار العملات + محوّل العملات.

- السيرفر هو اللي بيجيب الأسعار (مصدر أساسي + مصدر احتياطي) ويخزنها في data/fx_rates.json،
  فالصفحة تفتح بسرعة وتشتغل حتى لو النت قطع (بتعرض آخر سعر محفوظ مع تنبيه).
- كل الأسعار مقابل الدولار (USD) والمتصفح بيحسب أي تحويل بين أي عملتين منها.
"""
import json
import os
import threading
import time
import urllib.request
from datetime import datetime, timezone

from flask import jsonify, render_template, request

REFRESH_AFTER = 3600        # نحدّث الأسعار لو أقدم من ساعة
FORCE_COOLDOWN = 60         # زر "تحديث" مسموح مرة كل دقيقة
KEEP_DAYS = 14              # عدد الأيام المحفوظة لحساب نسبة التغير
TIMEOUT = 8

SOURCES = [
    ("open.er-api.com", "https://open.er-api.com/v6/latest/USD", "er"),
    ("currency-api", "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json", "fa"),
]

_lock = threading.Lock()
_state = {"data": None, "last_try": 0.0, "last_force": 0.0, "dir": "."}


def _path():
    return os.path.join(_state["dir"], "fx_rates.json")


def _load():
    try:
        with open(_path(), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _save(d):
    try:
        tmp = _path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False)
        os.replace(tmp, _path())
    except OSError:
        pass


def _clean(rates):
    out = {}
    for k, v in (rates or {}).items():
        try:
            v = float(v)
        except (TypeError, ValueError):
            continue
        k = str(k).upper()
        if len(k) == 3 and k.isalpha() and v > 0:
            out[k] = v
    return out


def _fetch():
    """يرجع (rates, اسم المصدر, وقت تحديث المصدر) أو None."""
    for name, url, kind in SOURCES:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "INX-fx/1.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                j = json.loads(r.read().decode("utf-8"))
            if kind == "er":
                if j.get("result") != "success":
                    continue
                rates = _clean(j.get("rates"))
                src_ts = j.get("time_last_update_unix")
            else:
                rates = _clean(j.get("usd"))
                src_ts = None
            rates["USD"] = 1.0
            if "EGP" in rates and "EUR" in rates and len(rates) > 20:
                return rates, name, src_ts
        except Exception:
            continue
    return None


def _snapshot(d, rates):
    """لقطة يومية (أول تحديث في اليوم) لحساب التغير عن اليوم السابق."""
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    daily = d.setdefault("daily", {})
    daily.setdefault(day, rates)
    for k in sorted(daily)[:-KEEP_DAYS]:
        daily.pop(k, None)


def get_rates(force=False):
    """يرجع (dict البيانات, stale?)."""
    with _lock:
        now = time.time()
        d = _state["data"] or _load()
        _state["data"] = d
        age = now - d["fetched"] if d else None
        if force and now - _state["last_force"] < FORCE_COOLDOWN:
            force = False
        need = d is None or force or age > REFRESH_AFTER
        # لو الجلب فشل قريب ما نفضلش نعيد المحاولة في كل طلب
        if need and now - _state["last_try"] >= (20 if d is None else 120 if not force else 0):
            _state["last_try"] = now
            if force:
                _state["last_force"] = now
            got = _fetch()
            if got:
                rates, src, src_ts = got
                d = d or {}
                d.update(rates=rates, source=src, fetched=now, src_ts=src_ts)
                _snapshot(d, rates)
                _state["data"] = d
                _save(d)
        if not d:
            return None, True
        stale = (now - d["fetched"]) > REFRESH_AFTER * 6
        return d, stale


def _prev_rates(d):
    """أسعار آخر يوم قبل النهارده (لو متاحة)."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    days = [k for k in sorted(d.get("daily", {})) if k < today]
    return d["daily"][days[-1]] if days else None


def register(app, login_required, data_dir):
    _state["dir"] = data_dir

    @app.route("/currency")
    @login_required
    def currency():
        return render_template("currency.html", page="currency")

    @app.route("/api/rates")
    @login_required
    def api_rates():
        d, stale = get_rates(force=request.args.get("force") == "1")
        if not d:
            return jsonify(error="تعذّر جلب أسعار العملات الآن — تأكد من اتصال السيرفر بالإنترنت وحاول بعد قليل"), 503
        return jsonify(
            base="USD",
            rates=d["rates"],
            prev=_prev_rates(d),
            fetched=d["fetched"],
            src_ts=d.get("src_ts"),
            source=d.get("source"),
            stale=stale,
        )
