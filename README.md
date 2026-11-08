# نظام INX لإدارة الشحنات والمستندات (Node.js + MySQL)
شحنات، مستندات، سحب مستندات، عروض، شات داخلي، أوامر ومهام، تقارير.

## تشغيل محلي
1. `npm install`
2. انسخ `.env.example` باسم `.env` وعبّي بيانات Aiven.
3. `npm start` ← http://localhost:5000 — الدخول: `admin` / `Admin@123` (غيّرها فورًا).

## النشر على Suga + Aiven
1. GitHub: Repository **Private** وارفع محتوى الفولدر (فيه `Dockerfile` و `server.js`). ملف `.env` ميترفعش.
2. Aiven: من Overview خد Host, Port, User, Password (وCA certificate لو عايز).
   الجداول بتتعمل لوحدها أول تشغيل.
3. Suga: New Container ← Build from GitHub ← اختار الـ repo ← **Dockerfile** ← **Port: 3000**
   ← Environment Variables (من `.env.example`: بيانات Aiven + `SESSION_SECRET` + `ADMIN_PASSWORD`) ← Deploy.
   مفيش Volume مطلوب: المستندات متخزنة داخل القاعدة.
4. اختبار: `/healthz` يرجّع `ok`، وبعدها سجّل دخول بالأدمن.

HeidiSQL: نفس بيانات Aiven، نوع MySQL، وSSL مفعّل.
