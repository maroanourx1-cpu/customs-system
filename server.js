// نظام INX لإدارة الشحنات والمستندات — Node.js + Express + MySQL (Aiven)
require('dotenv').config();
process.env.TZ = process.env.TZ || 'Africa/Cairo';

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const nunjucks = require('nunjucks');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const db = require('./db');
const C = require('./constants.json');
const { scanGemini, SCAN_EXT } = require('./scan');

const { STAGES, STAGE_INFO, DOC_TYPES, REQUIRED_DOCS, EXTRA_FIELDS, STAGE_RULES, PULL_TYPES, PULL_STATUSES, TASK_STATUSES, CURRENCIES } = C;
const ALLOWED_EXT = new Set(C.ALLOWED_EXT);
const EXTRA_COLS = EXTRA_FIELDS.map(f => f[0]);
const FIELD_LABELS = { bl_number: 'رقم البوليصة', ...Object.fromEntries(EXTRA_FIELDS.map(f => [f[0], f[1]])) };
const { q, one, run } = db;

// ------------------------------------------------------------ helpers
const pad = n => String(n).padStart(2, '0');
const now = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpErr = (status, message) => Object.assign(new Error(message || ''), { status });
const str = v => String(v ?? '').trim();
const arr = v => [].concat(v === undefined ? [] : v);
const flash = (req, msg, cat = 'ok') => { const f = req.session.flash || []; f.push({ msg, cat }); req.session.flash = f; };
const extOf = name => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
const fixName = n => {                       // multer بيقرأ أسماء الملفات العربي latin1 أحيانًا
  if ([...n].every(ch => ch.charCodeAt(0) <= 255)) {
    const d = Buffer.from(n, 'latin1').toString('utf8');
    if (!d.includes('\uFFFD')) return d;
  }
  return n;
};
const fmtG = v => String(parseFloat(Number(v).toPrecision(6)));
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

function statusOf(stage) {
  if (stage >= 8) return ['مكتملة', 'green'];
  if (stage >= 4) return ['قيد الإجراءات', 'blue'];
  if (stage >= 2) return ['تحت المراجعة', 'orange'];
  return ['مستلمة', 'gray'];
}

const ROUTES = {
  home: '/', login: '/login', logout: '/logout', shipments: '/shipments', search: '/search',
  shipment_scan: '/shipments/scan', save_ai_key: '/settings/ai-key', save_prefs: '/settings/prefs', shipment_new: '/shipments/new',
  shipment_detail: '/shipments/:sid', shipment_history: '/shipments/:sid/history', shipment_edit: '/shipments/:sid/edit',
  shipment_stage: '/shipments/:sid/stage', shipment_note: '/shipments/:sid/note', shipment_delete: '/shipments/:sid/delete',
  doc_upload: '/shipments/:sid/upload', documents: '/documents', doc_download: '/documents/:did/download',
  doc_delete: '/documents/:did/delete', pulls: '/pulls', pull_add: '/shipments/:sid/pulls/add',
  pull_update: '/pulls/:pid/update', pull_delete: '/pulls/:pid/delete',
  offers: '/shipments/:sid/offers', offer_add: '/shipments/:sid/offers/add', offer_approve: '/offers/:oid/approve',
  offer_unapprove: '/offers/:oid/unapprove', offer_delete: '/offers/:oid/delete',
  api_notify: '/api/notify', chat: '/chat', chat_poll: '/chat/poll', chat_send: '/chat/send', chat_file: '/chat/file/:mid',
  tasks: '/tasks', task_new: '/tasks/new', task_detail: '/tasks/:tid', task_status: '/tasks/:tid/status',
  reports: '/reports', reports_export: '/reports/export',
  employees: '/employees', employee_new: '/employees/new', employee_edit: '/employees/:uid/edit',
  audit: '/audit', settings: '/settings',
};
function urlFor(endpoint, kw = {}) {
  const args = { ...kw }; delete args.__keywords;
  if (endpoint === 'static') return '/static/' + args.filename;
  let p = ROUTES[endpoint];
  if (!p) throw new Error('unknown endpoint: ' + endpoint);
  p = p.replace(/:(\w+)/g, (_, k) => { const v = args[k]; delete args[k]; return encodeURIComponent(v); });
  const qs = Object.entries(args).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return qs ? `${p}?${qs}` : p;
}

// ------------------------------------------------------------ app
const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'html');
const env = nunjucks.configure(path.join(__dirname, 'views'), {
  autoescape: true, express: app, noCache: process.env.NODE_ENV !== 'production',
});
Object.entries({ STAGES, STAGE_INFO, DOC_TYPES, EXTRA_FIELDS, PULL_TYPES, PULL_STATUSES, TASK_STATUSES, CURRENCIES,
  TASK_STATUSES_NEXT: TASK_STATUSES.slice(1), status_of: statusOf, url_for: urlFor }).forEach(([k, v]) => env.addGlobal(k, v));
env.addGlobal('ic', name => new nunjucks.runtime.SafeString(`<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`));
env.addFilter('extname', n => (String(n).includes('.') ? String(n).split('.').pop().toUpperCase() : 'FILE'));
env.addFilter('substr', (s, start, len) => String(s ?? '').substr(start, len));
env.addFilter('money', v => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
env.addFilter('g', fmtG);
env.addFilter('map', (a, kw) => (a || []).map(x => x[kw.attribute]));

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('!! ضع SESSION_SECRET في المتغيرات البيئية (وإلا هتتسجل خروج كل المستخدمين عند كل إعادة تشغيل)');

app.get('/healthz', (req, res) => res.send('ok'));
app.get('/favicon.ico', (req, res) => {
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0a3a82"/>' +
    '<text x="32" y="41" font-size="24" font-weight="800" text-anchor="middle" fill="#fff" font-family="Arial">INX</text></svg>');
});
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

app.use(cookieSession({ name: 'sess', secret: SECRET, maxAge: 10 * 3600 * 1000, httpOnly: true, sameSite: 'lax' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
app.use((req, res, next) => (req.is('multipart/form-data') ? upload.any()(req, res, next) : next()));

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Cache-Control': 'no-store' });
  next();
});

// ------------------------------------------------------------ counts (الشات والأوامر)
async function generalUnread(uid) {
  const seen = await one('SELECT last_general_id FROM chat_seen WHERE user_id=?', [uid]);
  return (await one('SELECT COUNT(*) AS c FROM messages WHERE recipient_id=0 AND sender_id<>? AND id>?', [uid, seen ? seen.last_general_id : 0])).c;
}
async function getCounts(u) {
  if (!u) return {};
  const gen = await generalUnread(u.id);
  const direct = (await one('SELECT COUNT(*) AS c FROM messages WHERE recipient_id=? AND read_at IS NULL AND task_id IS NULL', [u.id])).c;
  return {
    chat: direct + (u.pref_general ? gen : 0),
    general: gen,
    prefs: { sound: u.pref_sound, badges: u.pref_badges, poll: u.pref_poll },
    orders_unread: (await one('SELECT COUNT(*) AS c FROM tasks WHERE to_id=? AND read_at IS NULL', [u.id])).c,
    orders_open: (await one("SELECT COUNT(*) AS c FROM tasks WHERE to_id=? AND status<>'مكتمل'", [u.id])).c,
  };
}

app.use(wrap(async (req, res, next) => {
  req.user = null;
  if (req.session.uid) {
    const u = await one('SELECT * FROM users WHERE id=? AND active=1', [req.session.uid]);
    if (u) req.user = u; else req.session = {};
  }
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.me = req.user;
  res.locals.request = { path: req.path, args: { get: (k, d = '') => (req.query[k] === undefined ? d : String(req.query[k])) } };
  res.locals.get_flashed_messages = () => {
    const f = req.session.flash || [];
    req.session.flash = null;
    return f.map(x => [x.cat, x.msg]);
  };
  if (req.method === 'POST') {
    const t = req.session.csrf;
    if (!t || t !== (req.body && req.body.csrf)) throw httpErr(400, 'طلب غير صالح (CSRF)');
  }
  // الصفحات الكاملة بتاخد العدادات تلقائيًا (الأجزاء اللي بتتعمل لها render بـ callback لا)
  const orig = res.render.bind(res);
  res.render = (view, opts, cb) => {
    if (typeof opts === 'function' || cb || !req.user) return orig(view, opts, cb);
    getCounts(req.user).then(c => { res.locals.counts = c; orig(view, opts); }).catch(next);
  };
  next();
}));

const loginRequired = (req, res, next) => (req.user ? next() : res.redirect('/login?next=' + encodeURIComponent(req.originalUrl)));
const perm = name => (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  if (!(req.user.is_admin || req.user[name])) return next(httpErr(403));
  next();
};
const adminRequired = (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  if (!req.user.is_admin) return next(httpErr(403));
  next();
};

async function log(req, action, entity = '', entityId = '', details = '') {
  await run('INSERT INTO audit(ts,username,action,entity,entity_id,details) VALUES(?,?,?,?,?,?)',
    [now(), req.user ? req.user.username : '-', action, entity, String(entityId), details]);
}

// ------------------------------------------------------------ stages
const filled = v => !['', '0', '0.0'].includes(String(v ?? '').trim());
function stageRequirements(s, have, stage) {
  return STAGE_RULES[stage - 1].map(([kind, key]) => (kind === 'f' ? [FIELD_LABELS[key], filled(s[key])] : [key, have.has(key)]));
}
async function autoAdvance(req, sid) {
  const s = await one('SELECT * FROM shipments WHERE id=? AND deleted=0', [sid]);
  if (!s) return null;
  const have = new Set((await q('SELECT doc_type FROM documents WHERE shipment_id=? AND deleted=0', [sid])).map(r => r.doc_type));
  let st = s.stage; const start = st;
  while (st < 8 && stageRequirements(s, have, st).every(([, ok]) => ok)) st++;
  if (st === start) return null;
  await run('UPDATE shipments SET stage=?,updated_by=?,updated_at=? WHERE id=?', [st, req.user ? req.user.username : 'system', now(), sid]);
  await log(req, 'ترقية تلقائية للمرحلة', 'shipment', sid, `${STAGES[start - 1]} ← ${STAGES[st - 1]}`);
  flash(req, `المرحلة اكتملت — انتقلت الشحنة تلقائيًا إلى: ${STAGES[st - 1]}`, 'ok');
  return [start, st];
}

async function nextNumber() {
  const r = await one("SELECT MAX(CAST(SUBSTR(number,4) AS UNSIGNED)) AS m FROM shipments WHERE number LIKE 'SH-%'");
  return `SH-${(Number(r && r.m) || 1000) + 1}`;
}
const usersList = () => q('SELECT id, full_name FROM users WHERE active=1 ORDER BY full_name');
async function getShipment(sid) {
  const s = await one('SELECT s.*, u.full_name AS resp_name FROM shipments s LEFT JOIN users u ON u.id=s.responsible_id WHERE s.id=? AND s.deleted=0', [sid]);
  if (!s) throw httpErr(404);
  return s;
}
const DOC_COLS = 'id,shipment_id,doc_type,original_name,size,uploaded_by,uploaded_at';
async function getGeminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const r = await one("SELECT v FROM settings WHERE k='gemini_key'");
  return r ? r.v : '';
}
const shipmentChoices = () => q('SELECT id, number, client FROM shipments WHERE deleted=0 ORDER BY id DESC LIMIT 500');
async function shipmentFromText(v) {
  v = str(v).split(' ')[0];
  return v ? one('SELECT * FROM shipments WHERE number=? AND deleted=0', [v]) : null;
}

// ------------------------------------------------------------ auth
const attempts = new Map();
app.get('/login', (req, res) => (req.user ? res.redirect('/') : res.render('login.html')));
app.post('/login', wrap(async (req, res) => {
  if (req.user) return res.redirect('/');
  const cutoff = Date.now() - 10 * 60 * 1000;
  const tries = (attempts.get(req.ip) || []).filter(t => t > cutoff);
  if (tries.length >= 8) { flash(req, 'محاولات كثيرة. حاول بعد 10 دقائق.', 'error'); return res.render('login.html'); }
  const u = await one('SELECT * FROM users WHERE username=?', [str(req.body.username)]);
  if (u && u.active && bcrypt.compareSync(req.body.password || '', u.password_hash)) {
    req.session = { uid: u.id, csrf: crypto.randomBytes(16).toString('hex') };
    req.user = u;
    await log(req, 'تسجيل دخول');
    const nxt = String(req.query.next || '');
    return res.redirect(nxt.startsWith('/') && !nxt.startsWith('//') ? nxt : '/');
  }
  tries.push(Date.now()); attempts.set(req.ip, tries);
  flash(req, 'اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب موقوف.', 'error');
  res.render('login.html');
}));
app.get('/logout', wrap(async (req, res) => {
  if (req.user) await log(req, 'تسجيل خروج');
  req.session = {};
  res.redirect('/login');
}));

// ------------------------------------------------------------ home / shipments
function shipmentQuery(args) {
  let sql = 'SELECT s.*, u.full_name AS resp_name, ' +
    "(SELECT COUNT(*) FROM doc_pulls p WHERE p.shipment_id=s.id AND p.status<>'تم السحب') AS pull_missing, " +
    '(SELECT COUNT(*) FROM doc_pulls p WHERE p.shipment_id=s.id) AS pull_total ' +
    'FROM shipments s LEFT JOIN users u ON u.id=s.responsible_id WHERE s.deleted=0';
  const p = [];
  const g = k => str(args[k]);
  if (g('q')) {
    const cols = ['s.number', 's.client', 's.bl_number', 's.carrier', 's.supplier', 's.tax_number', 's.origin', 's.category', 's.order_number', 's.acid'];
    sql += ' AND (' + cols.map(c => `${c} LIKE ?`).join(' OR ') + ')';
    cols.forEach(() => p.push(`%${g('q')}%`));
  }
  for (const [field, col] of [['client', 's.client'], ['carrier', 's.carrier'], ['bl', 's.bl_number'], ['number', 's.number'],
    ['supplier', 's.supplier'], ['origin', 's.origin'], ['tax_number', 's.tax_number'], ['tariff_item', 's.tariff_item'],
    ['order_number', 's.order_number'], ['acid', 's.acid']]) {
    if (g(field)) { sql += ` AND ${col} LIKE ?`; p.push(`%${g(field)}%`); }
  }
  if (g('currency')) { sql += ' AND UPPER(s.invoice_currency)=?'; p.push(g('currency').toUpperCase()); }
  if (args.pull === 'missing') sql += " AND EXISTS(SELECT 1 FROM doc_pulls p WHERE p.shipment_id=s.id AND p.status<>'تم السحب')";
  else if (args.pull === 'done') sql += " AND EXISTS(SELECT 1 FROM doc_pulls p WHERE p.shipment_id=s.id) AND NOT EXISTS(SELECT 1 FROM doc_pulls p WHERE p.shipment_id=s.id AND p.status<>'تم السحب')";
  if (args.status === 'open') sql += ' AND s.stage<8';
  else if (args.status === 'closed') sql += ' AND s.stage>=8';
  if (args.date_from) { sql += ' AND s.arrival_date>=?'; p.push(String(args.date_from)); }
  if (args.date_to) { sql += ' AND s.arrival_date<=?'; p.push(String(args.date_to)); }
  return q(sql + ' ORDER BY s.id DESC', p);
}

app.get('/', loginRequired, wrap(async (req, res) => {
  const total = (await one('SELECT COUNT(*) AS c FROM shipments WHERE deleted=0')).c;
  const open_ = (await one('SELECT COUNT(*) AS c FROM shipments WHERE deleted=0 AND stage<8')).c;
  const docs = (await one('SELECT COUNT(*) AS c FROM documents WHERE deleted=0')).c;
  const recent = (await shipmentQuery({})).slice(0, 5);
  const pull_pending = (await one("SELECT COUNT(*) AS c FROM doc_pulls p JOIN shipments s ON s.id=p.shipment_id WHERE s.deleted=0 AND p.status<>'تم السحب'")).c;
  res.render('home.html', { total, open_, docs, recent, pull_pending, page: 'home' });
}));

app.get('/shipments', loginRequired, wrap(async (req, res) => {
  const rows = await shipmentQuery(req.query);
  const per = 15;
  const pages = Math.max(Math.ceil(rows.length / per), 1);
  const pageNo = Math.min(Math.max(parseInt(req.query.p, 10) || 1, 1), pages);
  res.render('shipments.html', { rows: rows.slice((pageNo - 1) * per, pageNo * per), total: rows.length, page_no: pageNo, pages, page: 'shipments' });
}));

app.get('/search', loginRequired, wrap(async (req, res) => {
  const searched = Object.keys(req.query).length > 0;
  res.render('search.html', { rows: searched ? await shipmentQuery(req.query) : [], searched, page: 'search' });
}));

// ------------------------------------------------------------ scan (Gemini)
app.get('/shipments/scan', adminRequired, wrap(async (req, res) => {
  res.render('scan.html', { can_scan: !!(await getGeminiKey()), engine: 'Gemini', page: 'shipments' });
}));
app.post('/shipments/scan', adminRequired, wrap(async (req, res) => {
  const ajax = req.body.ajax === '1';
  const fail = msg => { if (ajax) return res.json({ ok: false, message: msg }); flash(req, msg, 'error'); return res.redirect('/shipments/scan'); };
  const f = (req.files || []).find(x => x.fieldname === 'file');
  if (!f || !f.originalname) return fail('اختر صورة المستند أولاً');
  const name = fixName(f.originalname);
  const ext = extOf(name);
  if (!SCAN_EXT[ext]) return fail('الاسكان يقبل صور (png / jpg / webp) أو ملف PDF فقط');
  if (f.size > 10 * 1024 * 1024) return fail('حجم الملف أكبر من 10 ميجا، صغّر الصورة وحاول مرة أخرى');
  const key = await getGeminiKey();
  if (!key) return fail('الاسكان محتاج مفتاح Gemini (من الإعدادات).');
  let d;
  try { d = await scanGemini(key, f.buffer, SCAN_EXT[ext]); } catch (e) { return fail(e.message); }
  if (!Object.values(d).some(Boolean)) return fail('لم أجد بيانات واضحة في المستند، جرّب صورة أوضح');
  const number = await nextNumber();
  const t = now();
  const r = await run(
    `INSERT INTO shipments(number,client,carrier,bl_number,arrival_date,type,stage,responsible_id,created_by,created_at,updated_by,updated_at,${EXTRA_COLS.join(',')})
     VALUES(?,?,?,?,?,?,1,?,?,?,?,?,${EXTRA_COLS.map(() => '?').join(',')})`,
    [number, d.client || 'غير محدد', d.carrier, d.bl_number, d.arrival_date, d.type, req.user.id, req.user.username, t, req.user.username, t, ...EXTRA_COLS.map(c => d[c])]);
  const sid = r.insertId;
  await run('INSERT INTO documents(shipment_id,doc_type,original_name,size,data,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?)',
    [sid, DOC_TYPES[DOC_TYPES.length - 1], name, f.size, f.buffer, req.user.full_name, t]);
  const nFilled = Object.values(d).filter(Boolean).length;
  await log(req, 'إضافة شحنة', 'shipment', sid, `${number} (اسكان بـ Gemini من ملف: ${name} — ${nFilled} حقل)`);
  await autoAdvance(req, sid);
  flash(req, `تم اسكان المستند بـ Gemini وإضافة الشحنة ${number} (${nFilled} حقل). راجع البيانات وعدّل أي خطأ.`, 'ok');
  const url = `/shipments/${sid}`;
  return ajax ? res.json({ ok: true, url }) : res.redirect(url);
}));

app.post('/settings/ai-key', adminRequired, wrap(async (req, res) => {
  const k = str(req.body.key);
  if (req.body.remove) {
    await run("DELETE FROM settings WHERE k='gemini_key'");
    await log(req, 'حذف مفتاح Gemini');
    flash(req, 'تم حذف المفتاح', 'ok');
  } else if (k.length < 20) {
    flash(req, 'المفتاح غير صالح', 'error');
  } else {
    await run("INSERT INTO settings(k,v) VALUES('gemini_key',?) ON DUPLICATE KEY UPDATE v=VALUES(v)", [k]);
    await log(req, 'ضبط مفتاح Gemini');
    flash(req, 'تم حفظ مفتاح Gemini، الاسكان جاهز', 'ok');
  }
  res.redirect('/settings');
}));

// ------------------------------------------------------------ shipment CRUD
const extraVals = f => EXTRA_COLS.map(c => (c === 'invoice_currency' ? str(f[c]).toUpperCase() : str(f[c])));

app.get('/shipments/new', perm('can_add'), wrap(async (req, res) => {
  res.render('shipment_form.html', { s: {}, users: await usersList(), page: 'shipments' });
}));
app.post('/shipments/new', perm('can_add'), wrap(async (req, res) => {
  const f = req.body;
  const form = async msg => { flash(req, msg, 'error'); return res.render('shipment_form.html', { s: f, users: await usersList(), page: 'shipments' }); };
  const number = str(f.number) || await nextNumber();
  if (!str(f.client)) return form('اسم العميل مطلوب');
  if (await one('SELECT 1 FROM shipments WHERE number=?', [number])) return form('رقم الشحنة مستخدم من قبل');
  const t = now();
  const r = await run(
    `INSERT INTO shipments(number,client,carrier,bl_number,arrival_date,type,stage,responsible_id,created_by,created_at,updated_by,updated_at,${EXTRA_COLS.join(',')})
     VALUES(?,?,?,?,?,?,1,?,?,?,?,?,${EXTRA_COLS.map(() => '?').join(',')})`,
    [number, str(f.client), str(f.carrier), str(f.bl_number), f.arrival_date || '', str(f.type), req.user.id, req.user.username, t, req.user.username, t, ...extraVals(f)]);
  await log(req, 'إضافة شحنة', 'shipment', r.insertId, number);
  flash(req, 'تمت إضافة الشحنة', 'ok');
  await autoAdvance(req, r.insertId);
  res.redirect(`/shipments/${r.insertId}`);
}));

async function pullRows(sid) {
  const rows = await q('SELECT p.*, u.full_name AS resp_name FROM doc_pulls p LEFT JOIN users u ON u.id=p.responsible_id WHERE p.shipment_id=? ORDER BY p.id', [sid]);
  const files = {};
  for (const d of await q(`SELECT ${DOC_COLS} FROM documents WHERE shipment_id=? AND deleted=0 ORDER BY id DESC`, [sid])) (files[d.doc_type] = files[d.doc_type] || []).push(d);
  return rows.map(r => [r, files[r.doc_type] || []]);
}
const offerRows = sid => q('SELECT * FROM offers WHERE shipment_id=? AND deleted=0 ORDER BY id', [sid]);

app.get('/shipments/:sid(\\d+)', loginRequired, wrap(async (req, res) => {
  const sid = +req.params.sid;
  let s = await getShipment(sid);
  if (await autoAdvance(req, sid)) s = await getShipment(sid);
  const docs = await q(`SELECT ${DOC_COLS} FROM documents WHERE shipment_id=? AND deleted=0 ORDER BY id DESC`, [sid]);
  const notes = await q('SELECT * FROM notes WHERE shipment_id=? ORDER BY id DESC', [sid]);
  const hist = await q("SELECT * FROM audit WHERE entity='shipment' AND entity_id=? ORDER BY id DESC LIMIT 20", [String(sid)]);
  const have = new Set(docs.map(d => d.doc_type));
  const missing = REQUIRED_DOCS.filter(d => !have.has(d));
  const reqs = s.stage < 8 ? stageRequirements(s, have, s.stage) : [];
  const pulls = await pullRows(sid);
  const pull_missing = pulls.filter(([r]) => r.status !== 'تم السحب').map(([r]) => r.doc_type);
  const offs = await offerRows(sid);
  const approved = offs.find(o => o.status === 'معتمد') || null;
  let stasks = await q('SELECT t.*, uf.full_name AS from_name, ut.full_name AS to_name FROM tasks t JOIN users uf ON uf.id=t.from_id JOIN users ut ON ut.id=t.to_id WHERE t.shipment_id=? ORDER BY t.id DESC', [sid]);
  if (!req.user.is_admin) stasks = stasks.filter(t => [t.from_id, t.to_id].includes(req.user.id));
  res.render('shipment_detail.html', { s, docs, notes, hist, missing, reqs, pulls, pull_missing, offers_n: offs.length, approved, stasks, users: await usersList(), page: 'shipments' });
}));

app.get('/shipments/:sid(\\d+)/history', loginRequired, wrap(async (req, res) => {
  const sid = +req.params.sid;
  const s = await getShipment(sid);
  const rows = await q("SELECT * FROM audit WHERE entity='shipment' AND entity_id=? ORDER BY id ASC", [String(sid)]);
  if (!rows.some(r => r.action === 'إضافة شحنة')) rows.unshift({ ts: s.created_at, username: s.created_by, action: 'إضافة شحنة', details: s.number });
  res.render('shipment_history.html', { s, rows, page: 'shipments' });
}));

app.get('/shipments/:sid(\\d+)/edit', perm('can_edit'), wrap(async (req, res) => {
  const sid = +req.params.sid;
  res.render('shipment_form.html', { s: await getShipment(sid), sid, users: await usersList(), page: 'shipments' });
}));
app.post('/shipments/:sid(\\d+)/edit', perm('can_edit'), wrap(async (req, res) => {
  const sid = +req.params.sid;
  const s = await getShipment(sid);
  const f = req.body;
  const number = str(f.number) || s.number;
  if (await one('SELECT 1 FROM shipments WHERE number=? AND id<>?', [number, sid])) {
    flash(req, 'رقم الشحنة مستخدم من قبل', 'error');
    return res.render('shipment_form.html', { s: f, sid, users: await usersList(), page: 'shipments' });
  }
  const nw = [number, str(f.client), str(f.carrier), str(f.bl_number), f.arrival_date || '', str(f.type), s.responsible_id, ...extraVals(f)];
  const old = [s.number, s.client, s.carrier, s.bl_number, s.arrival_date, s.type, s.responsible_id, ...EXTRA_COLS.map(c => s[c])];
  const names = ['الرقم', 'اسم الشركة', 'شركة الشحن', 'البوليصة', 'تاريخ الوصول', 'النوع', 'المسؤول', ...EXTRA_FIELDS.map(x => x[1])];
  const changes = names.map((n, i) => [n, old[i], nw[i]]).filter(([, o, v]) => String(o ?? '') !== String(v ?? ''))
    .map(([n, o, v]) => `${n}: ${o || '-'} ← ${v || '-'}`);
  await run(`UPDATE shipments SET number=?,client=?,carrier=?,bl_number=?,arrival_date=?,type=?,responsible_id=?,${EXTRA_COLS.map(c => c + '=?').join(',')},updated_by=?,updated_at=? WHERE id=?`,
    [...nw, req.user.username, now(), sid]);
  await log(req, 'تعديل شحنة', 'shipment', sid, changes.join(' | ') || 'بدون تغيير');
  flash(req, 'تم حفظ التعديلات', 'ok');
  await autoAdvance(req, sid);
  res.redirect(`/shipments/${sid}`);
}));

app.post('/shipments/:sid(\\d+)/stage', perm('can_edit'), wrap(async (req, res) => {
  const sid = +req.params.sid;
  const s = await getShipment(sid);
  const st = parseInt(req.body.stage ?? s.stage, 10);
  if (!(st >= 1 && st <= 8)) throw httpErr(400, 'طلب غير صالح');
  await run('UPDATE shipments SET stage=?,updated_by=?,updated_at=? WHERE id=?', [st, req.user.username, now(), sid]);
  await log(req, 'تغيير مرحلة', 'shipment', sid, `${STAGES[s.stage - 1]} ← ${STAGES[st - 1]}`);
  flash(req, 'تم تحديث المرحلة', 'ok');
  res.redirect(`/shipments/${sid}`);
}));

app.post('/shipments/:sid(\\d+)/note', perm('can_edit'), wrap(async (req, res) => {
  const sid = +req.params.sid;
  await getShipment(sid);
  const text = str(req.body.text);
  if (text) {
    await run('INSERT INTO notes(shipment_id,username,ts,text) VALUES(?,?,?,?)', [sid, req.user.full_name, now(), text]);
    await log(req, 'إضافة ملاحظة', 'shipment', sid, text.slice(0, 80));
  }
  res.redirect(`/shipments/${sid}#notes`);
}));

app.post('/shipments/:sid(\\d+)/delete', perm('can_delete'), wrap(async (req, res) => {
  const sid = +req.params.sid;
  const s = await getShipment(sid);
  await run('UPDATE shipments SET deleted=1,updated_by=?,updated_at=? WHERE id=?', [req.user.username, now(), sid]);
  await log(req, 'حذف شحنة', 'shipment', sid, s.number);
  flash(req, 'تم حذف الشحنة (محفوظة في السجل)', 'ok');
  res.redirect('/shipments');
}));

// ------------------------------------------------------------ documents
app.post('/shipments/:sid(\\d+)/upload', perm('can_add'), wrap(async (req, res) => {
  const sid = +req.params.sid;
  await getShipment(sid);
  const files = (req.files || []).filter(f => f.fieldname === 'file' && f.originalname);
  let dtype = req.body.doc_type || DOC_TYPES[DOC_TYPES.length - 1];
  if (!DOC_TYPES.includes(dtype)) dtype = DOC_TYPES[DOC_TYPES.length - 1];
  const back = `/shipments/${sid}` + (req.body.anchor === 'pulls' ? '#pulls' : '');
  if (!files.length) { flash(req, 'اختر ملفًا أولاً', 'error'); return res.redirect(`/shipments/${sid}`); }
  let n = 0;
  for (const f of files) {
    const name = fixName(f.originalname);
    if (!ALLOWED_EXT.has(extOf(name))) { flash(req, `نوع الملف غير مسموح: ${name}`, 'error'); continue; }
    await run('INSERT INTO documents(shipment_id,doc_type,original_name,size,data,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?)',
      [sid, dtype, name, f.size, f.buffer, req.user.full_name, now()]);
    await log(req, 'رفع مستند', 'shipment', sid, `${dtype}: ${name}`);
    n++;
  }
  if (n) { flash(req, `تم رفع ${n} مستند`, 'ok'); await autoAdvance(req, sid); }
  res.redirect(back);
}));

app.get('/documents', loginRequired, wrap(async (req, res) => {
  const qv = str(req.query.q), t = String(req.query.t || '');
  let sql = 'SELECT d.id,d.shipment_id,d.doc_type,d.original_name,d.size,d.uploaded_by,d.uploaded_at, s.number, s.client FROM documents d JOIN shipments s ON s.id=d.shipment_id WHERE d.deleted=0 AND s.deleted=0';
  const p = [];
  if (qv) { sql += ' AND (d.original_name LIKE ? OR s.number LIKE ? OR s.client LIKE ? OR s.bl_number LIKE ?)'; p.push(...Array(4).fill(`%${qv}%`)); }
  if (t) { sql += ' AND d.doc_type=?'; p.push(t); }
  res.render('documents.html', { rows: await q(sql + ' ORDER BY d.id DESC LIMIT 300', p), page: 'documents' });
}));

app.get('/documents/:did(\\d+)/download', loginRequired, wrap(async (req, res) => {
  const d = await one('SELECT id,shipment_id,original_name,data FROM documents WHERE id=? AND deleted=0', [+req.params.did]);
  if (!d || !d.data) throw httpErr(404);
  await log(req, 'تحميل مستند', 'shipment', d.shipment_id, d.original_name);
  res.set('Content-Type', 'application/octet-stream');
  res.attachment(d.original_name);
  res.send(d.data);
}));

app.post('/documents/:did(\\d+)/delete', perm('can_delete'), wrap(async (req, res) => {
  const d = await one('SELECT id,shipment_id,original_name FROM documents WHERE id=?', [+req.params.did]);
  if (!d) throw httpErr(404);
  await run('UPDATE documents SET deleted=1 WHERE id=?', [d.id]);
  await log(req, 'حذف مستند', 'shipment', d.shipment_id, d.original_name);
  flash(req, 'تم حذف المستند (محفوظ في قاعدة البيانات)', 'ok');
  res.redirect(`/shipments/${d.shipment_id}`);
}));

// ------------------------------------------------------------ سحب المستندات
app.post('/shipments/:sid(\\d+)/pulls/add', perm('can_edit'), wrap(async (req, res) => {
  const sid = +req.params.sid;
  await getShipment(sid);
  const types = arr(req.body.doc_type).filter(t => PULL_TYPES.includes(t));
  const back = `/shipments/${sid}#pulls`;
  if (!types.length) { flash(req, 'اختر نوع مستند واحد على الأقل', 'error'); return res.redirect(back); }
  const added = [];
  for (const t of types) {
    const r = await run("INSERT IGNORE INTO doc_pulls(shipment_id,doc_type,status,updated_by,updated_at) VALUES(?,?,'مطلوب',?,?)", [sid, t, req.user.username, now()]);
    if (r.affectedRows) added.push(t);
  }
  if (added.length) {
    await log(req, 'تحديد مستندات مطلوبة للسحب', 'shipment', sid, added.join('، '));
    flash(req, `تمت إضافة ${added.length} مستند لقائمة السحب`, 'ok');
  } else flash(req, 'المستندات المختارة موجودة بالفعل في القائمة', 'error');
  res.redirect(back);
}));

app.post('/pulls/:pid(\\d+)/update', perm('can_edit'), wrap(async (req, res) => {
  const pid = +req.params.pid;
  const p = await one('SELECT * FROM doc_pulls WHERE id=?', [pid]);
  if (!p) throw httpErr(404);
  const f = req.body;
  const status = f.status || p.status;
  if (!PULL_STATUSES.includes(status)) throw httpErr(400, 'طلب غير صالح');
  let date = '', resp = p.responsible_id;
  if (status === 'تم السحب') {
    date = str(f.pulled_date);
    if (!validDate(date)) date = now().slice(0, 10);
    resp = parseInt(f.responsible_id, 10) || req.user.id;
    if (!(await one('SELECT 1 FROM users WHERE id=?', [resp]))) resp = req.user.id;
  } else if (f.responsible_id) resp = parseInt(f.responsible_id, 10) || p.responsible_id;
  const note = str(f.note).slice(0, 300);
  await run('UPDATE doc_pulls SET status=?,pulled_date=?,responsible_id=?,note=?,updated_by=?,updated_at=? WHERE id=?',
    [status, date || null, resp, note, req.user.username, now(), pid]);
  const who = resp ? await one('SELECT full_name FROM users WHERE id=?', [resp]) : null;
  await log(req, 'سحب مستند', 'shipment', p.shipment_id,
    `${p.doc_type}: ${p.status} ← ${status}` + (date ? ` | التاريخ ${date}` : '') + (who ? ` | المسؤول ${who.full_name}` : ''));
  flash(req, 'تم تحديث حالة المستند', 'ok');
  const back = String(f.back || '');
  res.redirect(back.startsWith('/') && !back.startsWith('//') ? back : `/shipments/${p.shipment_id}#pulls`);
}));

app.post('/pulls/:pid(\\d+)/delete', perm('can_edit'), wrap(async (req, res) => {
  const p = await one('SELECT * FROM doc_pulls WHERE id=?', [+req.params.pid]);
  if (!p) throw httpErr(404);
  await run('DELETE FROM doc_pulls WHERE id=?', [p.id]);
  await log(req, 'إلغاء مستند من قائمة السحب', 'shipment', p.shipment_id, `${p.doc_type} (كان: ${p.status})`);
  flash(req, 'تم إلغاء المستند من القائمة (الملفات المرفوعة لم تُحذف)', 'ok');
  res.redirect(`/shipments/${p.shipment_id}#pulls`);
}));

app.get('/pulls', loginRequired, wrap(async (req, res) => {
  const st = req.query.status === undefined ? 'pending' : String(req.query.status);
  const t = String(req.query.t || ''), qv = str(req.query.q);
  let sql = 'SELECT p.*, s.number, s.client, u.full_name AS resp_name, ' +
    '(SELECT COUNT(*) FROM documents d WHERE d.shipment_id=p.shipment_id AND d.doc_type=p.doc_type AND d.deleted=0) AS files ' +
    'FROM doc_pulls p JOIN shipments s ON s.id=p.shipment_id LEFT JOIN users u ON u.id=p.responsible_id WHERE s.deleted=0';
  const p = [];
  if (st === 'pending') sql += " AND p.status<>'تم السحب'";
  else if (PULL_STATUSES.includes(st)) { sql += ' AND p.status=?'; p.push(st); }
  if (t) { sql += ' AND p.doc_type=?'; p.push(t); }
  if (qv) { sql += ' AND (s.number LIKE ? OR s.client LIKE ? OR s.bl_number LIKE ?)'; p.push(...Array(3).fill(`%${qv}%`)); }
  res.render('pulls.html', { rows: await q(sql + ' ORDER BY p.id DESC LIMIT 400', p), st, t, q: qv, page: 'pulls' });
}));

// ------------------------------------------------------------ الاختيارات (العروض)
app.get('/shipments/:sid(\\d+)/offers', loginRequired, wrap(async (req, res) => {
  const sid = +req.params.sid;
  const s = await getShipment(sid);
  const rows = (await offerRows(sid)).map(r => ({ ...r }));
  const mins = {};
  for (const r of rows) if (r.price !== null) { const c = r.currency || ''; mins[c] = Math.min(mins[c] ?? r.price, r.price); }
  for (const r of rows) {
    const m = mins[r.currency || ''];
    const same = rows.filter(x => (x.currency || '') === (r.currency || '') && x.price !== null).length;
    r.best = !!(m !== undefined && r.price !== null && r.price === m && same > 1);
    r.diff = (m && r.price !== null) ? Math.round((r.price - m) * 1000 / m) / 10 : null;
  }
  const cmp_rows = [...rows].sort((a, b) => (a.currency || '').localeCompare(b.currency || '') || (a.price ?? 1e18) - (b.price ?? 1e18));
  res.render('offers.html', { s, rows, cmp_rows, mixed: Object.keys(mins).length > 1, page: 'shipments' });
}));

app.post('/shipments/:sid(\\d+)/offers/add', perm('can_edit'), wrap(async (req, res) => {
  const sid = +req.params.sid;
  await getShipment(sid);
  const f = req.body, back = `/shipments/${sid}/offers`;
  const provider = str(f.provider);
  if (!provider) { flash(req, 'اسم الجهة المقدمة للعرض مطلوب', 'error'); return res.redirect(back); }
  const price = Number(str(f.price).replace(/,/g, ''));
  if (str(f.price) === '' || isNaN(price) || price < 0) { flash(req, 'السعر لازم يكون رقم صحيح', 'error'); return res.redirect(back); }
  const cur = str(f.currency).toUpperCase().slice(0, 8) || 'EGP';
  const r = await run('INSERT INTO offers(shipment_id,provider,service,price,currency,details,added_by,added_at) VALUES(?,?,?,?,?,?,?,?)',
    [sid, provider, str(f.service), price, cur, str(f.details), req.user.full_name, now()]);
  await log(req, 'إضافة عرض', 'shipment', sid, `عرض #${r.insertId}: ${provider} — ${fmtG(price)} ${cur}`);
  flash(req, 'تمت إضافة العرض', 'ok');
  res.redirect(back);
}));

async function getOffer(oid) {
  const o = await one('SELECT * FROM offers WHERE id=? AND deleted=0', [oid]);
  if (!o) throw httpErr(404);
  return o;
}
app.post('/offers/:oid(\\d+)/approve', perm('can_approve'), wrap(async (req, res) => {
  const oid = +req.params.oid, o = await getOffer(oid);
  await run("UPDATE offers SET status='مقترح',approved_by=NULL,approved_at=NULL WHERE shipment_id=? AND status='معتمد'", [o.shipment_id]);
  await run("UPDATE offers SET status='معتمد',approved_by=?,approved_at=? WHERE id=?", [req.user.full_name, now(), oid]);
  await log(req, 'اعتماد عرض', 'shipment', o.shipment_id, `عرض #${oid}: ${o.provider} — ${fmtG(o.price)} ${o.currency}`);
  flash(req, 'تم اعتماد العرض', 'ok');
  res.redirect(`/shipments/${o.shipment_id}/offers`);
}));
app.post('/offers/:oid(\\d+)/unapprove', perm('can_approve'), wrap(async (req, res) => {
  const oid = +req.params.oid, o = await getOffer(oid);
  await run("UPDATE offers SET status='مقترح',approved_by=NULL,approved_at=NULL WHERE id=?", [oid]);
  await log(req, 'إلغاء اعتماد عرض', 'shipment', o.shipment_id, `عرض #${oid}: ${o.provider}`);
  flash(req, 'تم إلغاء الاعتماد', 'ok');
  res.redirect(`/shipments/${o.shipment_id}/offers`);
}));
app.post('/offers/:oid(\\d+)/delete', loginRequired, wrap(async (req, res) => {
  const oid = +req.params.oid, o = await getOffer(oid), back = `/shipments/${o.shipment_id}/offers`;
  if (!(req.user.is_admin || req.user.can_delete || o.added_by === req.user.full_name)) throw httpErr(403);
  if (o.status === 'معتمد' && !req.user.is_admin) { flash(req, 'لا يمكن حذف عرض معتمد (ألغِ اعتماده أولاً)', 'error'); return res.redirect(back); }
  await run('UPDATE offers SET deleted=1 WHERE id=?', [oid]);
  await log(req, 'حذف عرض', 'shipment', o.shipment_id, `عرض #${oid}: ${o.provider} — ${fmtG(o.price)} ${o.currency}`);
  flash(req, 'تم حذف العرض (محفوظ في السجل)', 'ok');
  res.redirect(back);
}));

// ------------------------------------------------------------ الشات الداخلي
// (أعمدة الرسالة بدون محتوى الملف؛ stored_name = هل فيه مرفق)
const MSG_COLS = 'm.id,m.sender_id,m.recipient_id,m.shipment_id,m.task_id,m.body,m.file_name,(m.file_data IS NOT NULL) AS stored_name,m.created_at,m.read_at';

app.get('/api/notify', loginRequired, wrap(async (req, res) => {
  const c = await getCounts(req.user);
  const items = await q('SELECT t.id, t.title, t.created_at, u.full_name AS frm, s.number FROM tasks t JOIN users u ON u.id=t.from_id JOIN shipments s ON s.id=t.shipment_id WHERE t.to_id=? AND t.read_at IS NULL ORDER BY t.id DESC LIMIT 5', [req.user.id]);
  c.items = items.map(i => ({ ...i, url: urlFor('task_detail', { tid: i.id }) }));
  res.json(c);
}));

async function chatContacts(me) {
  const out = [];
  for (const u of await q('SELECT id, full_name, username FROM users WHERE active=1 AND id<>? ORDER BY full_name', [me])) {
    const last = await one(`SELECT ${MSG_COLS} FROM messages m WHERE (m.sender_id=? AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=?) ORDER BY m.id DESC LIMIT 1`, [me, u.id, u.id, me]);
    const unread = (await one('SELECT COUNT(*) AS c FROM messages WHERE sender_id=? AND recipient_id=? AND read_at IS NULL AND task_id IS NULL', [u.id, me])).c;
    out.push({ id: u.id, name: u.full_name, last, unread });
  }
  return out.sort((a, b) => (b.last ? b.last.id : 0) - (a.last ? a.last.id : 0) || a.name.localeCompare(b.name));
}
async function generalInfo(uid) {
  const last = await one(`SELECT ${MSG_COLS}, u.full_name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.recipient_id=0 ORDER BY m.id DESC LIMIT 1`);
  return { last, unread: await generalUnread(uid) };
}
async function threadMessages(me, peer, after = 0) {
  let base = `SELECT ${MSG_COLS}, s.number AS ship_number, t.status AS task_status, t.title AS task_title, us.full_name AS sender_name ` +
    'FROM messages m LEFT JOIN shipments s ON s.id=m.shipment_id LEFT JOIN tasks t ON t.id=m.task_id JOIN users us ON us.id=m.sender_id WHERE ';
  let args = [];
  if (peer === 0) base += 'm.recipient_id=0';
  else { base += '((m.sender_id=? AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=?))'; args = [me, peer, peer, me]; }
  const rows = after
    ? await q(base + ' AND m.id>? ORDER BY m.id LIMIT 200', [...args, after])
    : (await q(base + ' ORDER BY m.id DESC LIMIT 100', args)).reverse();
  if (peer === 0) {
    if (rows.length) await run('INSERT INTO chat_seen(user_id,last_general_id) VALUES(?,?) ON DUPLICATE KEY UPDATE last_general_id=GREATEST(last_general_id, VALUES(last_general_id))', [me, rows[rows.length - 1].id]);
    return rows;
  }
  const mark = rows.filter(r => r.recipient_id === me && r.read_at === null && r.task_id === null).map(r => r.id);
  if (mark.length) await run('UPDATE messages SET read_at=? WHERE id IN (?)', [now(), mark]);
  return rows;
}

app.get('/chat', loginRequired, wrap(async (req, res) => {
  const peer = parseInt(req.query.u, 10);
  let peerU = null;
  if (peer === 0) peerU = { id: 0, full_name: 'الشات العام (كل الموظفين)' };
  else if (peer > 0) peerU = await one('SELECT id, full_name FROM users WHERE id=? AND active=1 AND id<>?', [peer, req.user.id]);
  const msgs = peerU ? await threadMessages(req.user.id, peerU.id) : [];
  res.render('chat.html', {
    contacts: await chatContacts(req.user.id), general: await generalInfo(req.user.id), peer: peerU, msgs,
    last_id: msgs.length ? msgs[msgs.length - 1].id : 0, ships: await shipmentChoices(), page: 'chat',
  });
}));

app.get('/chat/poll', loginRequired, wrap(async (req, res) => {
  const peer = parseInt(req.query.u ?? 0, 10), after = parseInt(req.query.after ?? 0, 10);
  if (isNaN(peer) || isNaN(after)) throw httpErr(400, 'طلب غير صالح');
  const msgs = await threadMessages(req.user.id, peer, after);
  const html = await new Promise((ok, no) => res.render('_chat_msgs.html', { msgs }, (e, h) => (e ? no(e) : ok(h))));
  res.json({ html, last: msgs.length ? msgs[msgs.length - 1].id : after, n: msgs.length, counts: await getCounts(req.user) });
}));

app.post('/chat/send', loginRequired, wrap(async (req, res) => {
  const f = req.body, ajax = f.ajax === '1';
  const fail = msg => { if (ajax) return res.json({ ok: false, message: msg }); flash(req, msg, 'error'); return res.redirect(urlFor('chat', { u: f.to ?? '' })); };
  const to = parseInt(f.to ?? 0, 10);
  if (isNaN(to)) return fail('اختر الموظف');
  if (to !== 0 && !(await one('SELECT 1 FROM users WHERE id=? AND active=1 AND id<>?', [to, req.user.id]))) return fail('الموظف غير موجود');
  const body = str(f.body).slice(0, 4000);
  const up = (req.files || []).find(x => x.fieldname === 'file' && x.originalname);
  let fname = null, data = null;
  if (up) {
    fname = fixName(up.originalname);
    if (!ALLOWED_EXT.has(extOf(fname))) return fail(`نوع الملف غير مسموح: ${fname}`);
    data = up.buffer;
  }
  if (!body && !data) return fail('اكتب رسالة أو أرفق ملفًا');
  const sh = await shipmentFromText(f.shipment);
  if (str(f.shipment) && !sh) return fail('رقم الشحنة غير صحيح');
  await run('INSERT INTO messages(sender_id,recipient_id,shipment_id,body,file_name,file_data,created_at) VALUES(?,?,?,?,?,?,?)',
    [req.user.id, to, sh ? sh.id : null, body, fname, data, now()]);
  return ajax ? res.json({ ok: true }) : res.redirect(urlFor('chat', { u: to }));
}));

app.get('/chat/file/:mid(\\d+)', loginRequired, wrap(async (req, res) => {
  const m = await one('SELECT sender_id,recipient_id,file_name,file_data FROM messages WHERE id=?', [+req.params.mid]);
  if (!m || !m.file_data || !(m.recipient_id === 0 || [m.sender_id, m.recipient_id].includes(req.user.id))) throw httpErr(404);
  res.set('Content-Type', 'application/octet-stream');
  res.attachment(m.file_name);
  res.send(m.file_data);
}));

// ------------------------------------------------------------ الأوامر والمهام
const TASK_SQL = 'SELECT t.*, s.number, s.client, uf.full_name AS from_name, ut.full_name AS to_name FROM tasks t JOIN shipments s ON s.id=t.shipment_id JOIN users uf ON uf.id=t.from_id JOIN users ut ON ut.id=t.to_id';
async function taskRow(req, tid) {
  const t = await one(TASK_SQL + ' WHERE t.id=?', [tid]);
  if (!t) throw httpErr(404);
  if (!(req.user.is_admin || [t.from_id, t.to_id].includes(req.user.id))) throw httpErr(403);
  return t;
}

app.get('/tasks', loginRequired, wrap(async (req, res) => {
  let box = String(req.query.box || 'in');
  const st = String(req.query.status || '');
  let sql = TASK_SQL + ' WHERE 1=1';
  const p = [];
  if (box === 'all' && req.user.is_admin) { /* الكل */ }
  else if (box === 'out') { sql += ' AND t.from_id=?'; p.push(req.user.id); }
  else { box = 'in'; sql += ' AND t.to_id=?'; p.push(req.user.id); }
  if (st === 'open') sql += " AND t.status<>'مكتمل'";
  else if (TASK_STATUSES.includes(st)) { sql += ' AND t.status=?'; p.push(st); }
  res.render('tasks.html', { rows: await q(sql + ' ORDER BY (t.read_at IS NULL) DESC, t.id DESC LIMIT 300', p), box, st, page: 'tasks' });
}));

app.get('/tasks/new', loginRequired, wrap(async (req, res) => {
  const users = await q('SELECT id, full_name FROM users WHERE active=1 AND id<>? ORDER BY full_name', [req.user.id]);
  const pre = {};
  if (req.query.shipment) {
    const s = await one('SELECT number FROM shipments WHERE id=? AND deleted=0', [parseInt(req.query.shipment, 10) || 0]);
    pre.shipment = s ? s.number : '';
  }
  pre.to = String(req.query.to || '');
  res.render('task_form.html', { users, ships: await shipmentChoices(), f: pre, page: 'tasks' });
}));
app.post('/tasks/new', loginRequired, wrap(async (req, res) => {
  const users = await q('SELECT id, full_name FROM users WHERE active=1 AND id<>? ORDER BY full_name', [req.user.id]);
  const f = req.body;
  const sh = await shipmentFromText(f.shipment);
  const title = str(f.title).slice(0, 200);
  const toU = await one('SELECT id, full_name FROM users WHERE id=? AND active=1 AND id<>?', [parseInt(f.to, 10) || 0, req.user.id]);
  if (!sh || !title || !toU) {
    flash(req, 'اختر الشحنة والموظف واكتب عنوان الأمر', 'error');
    return res.render('task_form.html', { users, ships: await shipmentChoices(), f, page: 'tasks' });
  }
  const r = await run("INSERT INTO tasks(shipment_id,from_id,to_id,title,details,status,created_at) VALUES(?,?,?,?,?,'جديد',?)",
    [sh.id, req.user.id, toU.id, title, str(f.details).slice(0, 4000), now()]);
  await run('INSERT INTO messages(sender_id,recipient_id,shipment_id,task_id,body,created_at) VALUES(?,?,?,?,?,?)', [req.user.id, toU.id, sh.id, r.insertId, title, now()]);
  await log(req, 'إرسال أمر', 'shipment', sh.id, `أمر #${r.insertId} إلى ${toU.full_name}: ${title}`);
  flash(req, 'تم إرسال الأمر وسيظهر للموظف كتنبيه حتى يفتحه', 'ok');
  res.redirect(`/tasks/${r.insertId}`);
}));

app.get('/tasks/:tid(\\d+)', loginRequired, wrap(async (req, res) => {
  const tid = +req.params.tid;
  let t = await taskRow(req, tid);
  if (req.user.id === t.to_id && !t.read_at) {
    await run("UPDATE tasks SET read_at=?, status=CASE WHEN status='جديد' THEN 'تم الاطلاع' ELSE status END WHERE id=?", [now(), tid]);
    await run('UPDATE messages SET read_at=? WHERE task_id=? AND read_at IS NULL', [now(), tid]);
    await log(req, 'قراءة أمر', 'shipment', t.shipment_id, `أمر #${tid}: ${t.title}`);
    t = await taskRow(req, tid);
  }
  res.render('task_detail.html', { t, page: 'tasks' });
}));

app.post('/tasks/:tid(\\d+)/status', loginRequired, wrap(async (req, res) => {
  const tid = +req.params.tid;
  const t = await taskRow(req, tid);
  if (!(req.user.is_admin || req.user.id === t.to_id)) throw httpErr(403);
  const st = String(req.body.status || '');
  if (!TASK_STATUSES.slice(1).includes(st)) throw httpErr(400, 'طلب غير صالح');
  const sets = ['status=?'], args = [st], n = now();
  if (!t.read_at && req.user.id === t.to_id) { sets.push('read_at=?'); args.push(n); }
  if (st === 'جاري التنفيذ' && !t.started_at) { sets.push('started_at=?'); args.push(n); }
  if (st === 'مكتمل') { sets.push('done_at=?'); args.push(n); if (!t.started_at) { sets.push('started_at=?'); args.push(n); } }
  else sets.push('done_at=NULL');
  await run(`UPDATE tasks SET ${sets.join(',')} WHERE id=?`, [...args, tid]);
  await log(req, 'تغيير حالة أمر', 'shipment', t.shipment_id, `أمر #${tid}: ${t.status} ← ${st}`);
  flash(req, 'تم تحديث حالة الأمر', 'ok');
  res.redirect(`/tasks/${tid}`);
}));

// ------------------------------------------------------------ reports
async function reportData(args) {
  const dFrom = String(args.date_from || ''), dTo = String(args.date_to || '');
  let sql = 'SELECT * FROM shipments WHERE deleted=0';
  const p = [];
  if (dFrom) { sql += ' AND arrival_date>=?'; p.push(dFrom); }
  if (dTo) { sql += ' AND arrival_date<=?'; p.push(dTo); }
  const rows = await q(sql + ' ORDER BY arrival_date DESC, id DESC', p);
  const groups = { 'مكتملة': 0, 'قيد الإجراءات': 0, 'تحت المراجعة': 0, 'مستلمة': 0 };
  const have = {};
  for (const d of await q('SELECT shipment_id, doc_type FROM documents WHERE deleted=0')) (have[d.shipment_id] = have[d.shipment_id] || new Set()).add(d.doc_type);
  const out = rows.map(r => {
    const [label, color] = statusOf(r.stage);
    groups[label]++;
    return { r, label, color, missing: REQUIRED_DOCS.filter(x => !(have[r.id] || new Set()).has(x)) };
  });
  return { dFrom, dTo, groups, out };
}

app.get('/reports', loginRequired, wrap(async (req, res) => {
  const { dFrom, dTo, groups, out } = await reportData(req.query);
  const total = Object.values(groups).reduce((a, b) => a + b, 0) || 1;
  const colors = { 'مكتملة': '#22a447', 'قيد الإجراءات': '#1f6fe0', 'تحت المراجعة': '#f5a31a', 'مستلمة': '#9aa7ba' };
  let acc = 0; const parts = [], legend = [];
  for (const [k, v] of Object.entries(groups)) {
    const pct = v * 100 / total;
    if (v) parts.push(`${colors[k]} ${acc.toFixed(2)}% ${(acc + pct).toFixed(2)}%`);
    acc += pct;
    legend.push([k, v, Math.round(pct), colors[k]]);
  }
  res.render('reports.html', {
    d_from: dFrom, d_to: dTo, groups, out, gradient: parts.join(', ') || '#e3e9f3 0 100%', legend,
    open_count: out.filter(o => o.r.stage < 8).length, closed_count: out.filter(o => o.r.stage >= 8).length, page: 'reports',
  });
}));

const csvCell = v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
app.get('/reports/export', loginRequired, wrap(async (req, res) => {
  const { out } = await reportData(req.query);
  const pend = {};
  for (const p of await q("SELECT shipment_id, doc_type FROM doc_pulls WHERE status<>'تم السحب'")) (pend[p.shipment_id] = pend[p.shipment_id] || []).push(p.doc_type);
  const rows = [['رقم الشحنة', 'اسم الشركة', 'شركة الشحن', 'رقم البوليصة', 'تاريخ الوصول', 'النوع', ...EXTRA_FIELDS.map(x => x[1]), 'المرحلة', 'الحالة', 'مستندات ناقصة', 'مستندات سحب لم تُسحب']];
  for (const o of out) {
    const r = o.r;
    rows.push([r.number, r.client, r.carrier, r.bl_number, r.arrival_date, r.type, ...EXTRA_COLS.map(c => r[c]), STAGES[r.stage - 1], o.label, o.missing.join('، '), (pend[r.id] || []).join('، ')]);
  }
  await log(req, 'تصدير تقرير');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=report.csv' });
  res.send('\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'));
}));

// ------------------------------------------------------------ employees
app.get('/employees', adminRequired, wrap(async (req, res) => {
  res.render('employees.html', { rows: await q('SELECT * FROM users ORDER BY id'), page: 'employees' });
}));
app.get('/employees/new', adminRequired, (req, res) => res.render('employee_form.html', { u: { can_add: 1, can_edit: 1 }, page: 'employees' }));
app.post('/employees/new', adminRequired, wrap(async (req, res) => {
  const f = req.body;
  const bad = async msg => { flash(req, msg, 'error'); return res.render('employee_form.html', { u: f, page: 'employees' }); };
  const username = str(f.username), pw = f.password || '';
  if (!username || !str(f.full_name) || pw.length < 6) return bad('أكمل البيانات (كلمة المرور 6 أحرف على الأقل)');
  if (await one('SELECT 1 FROM users WHERE username=?', [username])) return bad('اسم المستخدم موجود');
  const r = await run('INSERT INTO users(username,full_name,password_hash,is_admin,can_add,can_edit,can_delete,can_approve,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [username, str(f.full_name), bcrypt.hashSync(pw, 10), +('is_admin' in f), +('can_add' in f), +('can_edit' in f), +('can_delete' in f), +('can_approve' in f), now()]);
  await log(req, 'إضافة موظف', 'user', r.insertId, username);
  flash(req, 'تمت إضافة الموظف', 'ok');
  res.redirect('/employees');
}));
app.get('/employees/:uid(\\d+)/edit', adminRequired, wrap(async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id=?', [+req.params.uid]);
  if (!u) throw httpErr(404);
  res.render('employee_form.html', { u, uid: u.id, page: 'employees' });
}));
app.post('/employees/:uid(\\d+)/edit', adminRequired, wrap(async (req, res) => {
  const uid = +req.params.uid;
  const u = await one('SELECT * FROM users WHERE id=?', [uid]);
  if (!u) throw httpErr(404);
  const f = req.body;
  let active = +('active' in f), isAdmin = +('is_admin' in f);
  if (uid === req.user.id) { active = 1; isAdmin = 1; }
  await run('UPDATE users SET full_name=?,is_admin=?,can_add=?,can_edit=?,can_delete=?,can_approve=?,active=? WHERE id=?',
    [str(f.full_name) || u.full_name, isAdmin, +('can_add' in f), +('can_edit' in f), +('can_delete' in f), +('can_approve' in f), active, uid]);
  if (f.password) {
    if (f.password.length < 6) { flash(req, 'كلمة المرور قصيرة', 'error'); return res.render('employee_form.html', { u, uid, page: 'employees' }); }
    await run('UPDATE users SET password_hash=? WHERE id=?', [bcrypt.hashSync(f.password, 10), uid]);
  }
  await log(req, 'تعديل موظف', 'user', uid, u.username + (active ? '' : ' (إيقاف)'));
  flash(req, 'تم الحفظ', 'ok');
  res.redirect('/employees');
}));

// ------------------------------------------------------------ audit / settings
app.get('/audit', adminRequired, wrap(async (req, res) => {
  const qv = str(req.query.q), cat = String(req.query.cat || '');
  const cats = { orders: 'أمر', offers: 'عرض', pulls: 'سحب', docs: 'مستند', edits: 'تعديل' };
  const where = [], p = [];
  if (qv) { where.push('(username LIKE ? OR action LIKE ? OR details LIKE ?)'); p.push(...Array(3).fill(`%${qv}%`)); }
  if (cats[cat]) { where.push('action LIKE ?'); p.push(`%${cats[cat]}%`); }
  const sql = 'SELECT * FROM audit' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC LIMIT 300';
  res.render('audit.html', { rows: await q(sql, p), cat, page: 'audit' });
}));

async function renderSettings(req, res) {
  const k = req.user.is_admin ? await getGeminiKey() : '';
  res.render('settings.html', { ai_key_tail: k ? k.slice(-4) : '', page: 'settings' });
}
app.get('/settings', loginRequired, wrap(renderSettings));
app.post('/settings', loginRequired, wrap(async (req, res) => {
  const f = req.body;
  if (!bcrypt.compareSync(f.old || '', req.user.password_hash)) flash(req, 'كلمة المرور الحالية غير صحيحة', 'error');
  else if ((f.new || '').length < 6 || f.new !== f.new2) flash(req, 'كلمة المرور الجديدة غير متطابقة أو قصيرة', 'error');
  else {
    await run('UPDATE users SET password_hash=? WHERE id=?', [bcrypt.hashSync(f.new, 10), req.user.id]);
    await log(req, 'تغيير كلمة المرور');
    flash(req, 'تم تغيير كلمة المرور', 'ok');
  }
  await renderSettings(req, res);
}));
app.post('/settings/prefs', loginRequired, wrap(async (req, res) => {
  const f = req.body;
  const poll = Math.min(Math.max(parseInt(f.pref_poll, 10) || 7, 3), 60);
  await run('UPDATE users SET pref_sound=?,pref_badges=?,pref_general=?,pref_poll=? WHERE id=?',
    [+('pref_sound' in f), +('pref_badges' in f), +('pref_general' in f), poll, req.user.id]);
  flash(req, 'تم حفظ إعدادات الإشعارات والعدادات', 'ok');
  res.redirect('/settings');
}));

// ------------------------------------------------------------ errors
app.use((req, res, next) => next(httpErr(404)));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  let status = err.status || 500, msg = err.message;
  if (err.code === 'LIMIT_FILE_SIZE') { status = 400; msg = 'حجم الملف أكبر من 30 ميجا'; }
  else if (status === 403) msg = 'ليست لديك صلاحية لهذا الإجراء';
  else if (status === 404) msg = 'الصفحة غير موجودة';
  else if (status >= 500) { console.error(err); msg = 'حصل خطأ في السيرفر'; }
  if (res.headersSent) return;
  res.status(status).render('error.html', { code: status, msg: msg || 'طلب غير صالح', page: '' });
});

// ------------------------------------------------------------ start
async function seedDemo() {
  if ((await one('SELECT COUNT(*) AS c FROM shipments')).c) return;
  const t = now();
  for (const r of [['SH-1022', 'شركة الأمل', 'Maersk', 'MAE778812', '2026-11-01', 'حاويات', 1], ['SH-1023', 'كريم للتجارة', 'MSC', 'MSC445521', '2026-11-03', 'بضاعة عامة', 3],
    ['SH-1024', 'شركة النور', 'DHL', '123456789', '2026-11-05', 'بضاعة عامة', 4], ['SH-1025', 'أحمد خالد', 'ABC', 'ABC90012', '2026-10-20', 'أجهزة', 8]]) {
    await run("INSERT INTO shipments(number,client,carrier,bl_number,arrival_date,type,stage,responsible_id,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,1,'admin',?,'admin',?)", [...r, t, t]);
  }
}

(async () => {
  await db.init(bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Admin@123', 10), now);
  if (process.argv.includes('--demo')) await seedDemo();
  const port = +(process.env.PORT || 5000);
  app.listen(port, () => console.log(`>> السيرفر شغال على: http://localhost:${port}`));
})().catch(e => { console.error('فشل التشغيل:', e.message); process.exit(1); });
