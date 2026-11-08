const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function buildConfig() {
  let c;
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    c = {
      host: u.hostname, port: +u.port || 3306,
      user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, '') || 'defaultdb',
    };
  } else {
    c = {
      host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'defaultdb',
    };
  }
  const local = ['localhost', '127.0.0.1'].includes(c.host);
  if (process.env.DB_SSL !== 'false' && !local) {
    // Aiven: ضع محتوى ca.pem في DB_CA (أو اتركه فاضي وهيتصل بتشفير بدون التحقق من الشهادة)
    const ca = process.env.DB_CA ? process.env.DB_CA.replace(/\\n/g, '\n') : null;
    c.ssl = ca ? { ca } : { rejectUnauthorized: false };
  }
  return c;
}

const pool = mysql.createPool({
  ...buildConfig(),
  waitForConnections: true, connectionLimit: 5, charset: 'utf8mb4',
  dateStrings: true, enableKeepAlive: true,
});

async function q(sql, params = []) { const [rows] = await pool.query(sql, params); return rows; }
async function one(sql, params = []) { const rows = await q(sql, params); return rows[0] || null; }
async function run(sql, params = []) { const [res] = await pool.query(sql, params); return res; }

async function init(defaultAdminHash, now) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) await run(stmt);
  // ترقية قاعدة قديمة: إضافة الأعمدة الجديدة لو ناقصة
  const addCols = {
    users: { can_approve: 'TINYINT NOT NULL DEFAULT 0', pref_sound: 'TINYINT NOT NULL DEFAULT 1', pref_badges: 'TINYINT NOT NULL DEFAULT 1',
      pref_general: 'TINYINT NOT NULL DEFAULT 1', pref_poll: 'INT NOT NULL DEFAULT 7' },
    shipments: { order_number: 'VARCHAR(255)', net_weight: 'VARCHAR(100)', invoice_currency: 'VARCHAR(20)' },
  };
  for (const [table, cols] of Object.entries(addCols)) {
    const have = new Set((await q(`SHOW COLUMNS FROM ${table}`)).map(r => r.Field));
    for (const [col, ddl] of Object.entries(cols)) if (!have.has(col)) await run(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  }
  if (!(await one('SELECT 1 FROM users LIMIT 1'))) {
    await run(
      "INSERT INTO users(username,full_name,password_hash,is_admin,can_add,can_edit,can_delete,created_at) VALUES('admin','مدير النظام',?,1,1,1,1,?)",
      [defaultAdminHash, now()]);
    console.log('>> تم إنشاء المدير الافتراضي: admin  (غيّر كلمة المرور فور الدخول)');
  }
}

module.exports = { pool, q, one, run, init };
