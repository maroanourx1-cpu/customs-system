# نشر INX System على Suga (من GitHub)

## 1) رفع المشروع على GitHub
```bash
cd inx-system
git init
git add .
git commit -m "INX system - base version"
git branch -M main
git remote add origin https://github.com/<USERNAME>/<REPO>.git
git push -u origin main
```

## 2) على Suga
- New Project ← Deploy from GitHub ← اختار الريبو ← Build بـ **Dockerfile**
- Port: `8080` (الافتراضي في Suga) — البرنامج بيسمع على 8080 و3000 و5000 مع بعض، فأي منهم يشتغل
- Volume: اعمل Volume واربطه على المسار `/app/data` (مهم جدًا عشان قاعدة البيانات والمستندات تفضل بعد كل نشر)

## Environment Variables (كلها اختيارية)
| المتغير | الاستخدام |
|---|---|
| `PORT` | بورت إضافي لو Suga حدد بورت تاني (البرنامج بيسمع دايمًا على 8080 و3000 و5000 كمان) |
| `HOST` | الافتراضي 0.0.0.0 |
| `GEMINI_API_KEY` | مفتاح Gemini لقراءة المستندات (أو تحطه من الإعدادات جوه البرنامج) |
| `CUSTOMS_GEMINI_MODEL` | موديل Gemini مخصص |

البرنامج بيشتغل بـ SQLite جوه `data/` فمش محتاج قاعدة بيانات خارجية.
أول تشغيل: بيانات الدخول الافتراضية موجودة في README.md.

## السرعة
التشغيل بيتم من `wsgi.py` (من غير أي تعديل في `app.py`): ضغط gzip للصفحات والـ CSS/JS، كاش للملفات الثابتة، و8 threads.
متغيرات اختيارية: `THREADS` (الافتراضي 8) و`STATIC_MAX_AGE` بالثواني (الافتراضي 0 = تحديث فوري)، و`SPEEDUP=0` لتشغيل البرنامج الأصلي من غير الإضافة.
Start Command لو Suga طلبه: `python wsgi.py`
