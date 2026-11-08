// اسكان المستندات بـ Google Gemini (مفتاح مجاني من aistudio.google.com)
const C = require('./constants.json');

const EXTRA_FIELDS = C.EXTRA_FIELDS;
const SCAN_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' };
const SCAN_FIELDS = {
  client: 'اسم الشركة / العميل', carrier: 'شركة الشحن', bl_number: 'رقم البوليصة',
  arrival_date: 'تاريخ الوصول بصيغة YYYY-MM-DD', type: 'نوع الشحنة',
  ...Object.fromEntries(EXTRA_FIELDS.map(([c, l]) => [c, l])),
};
const NUM_COLS = EXTRA_FIELDS.filter(f => f[2] === 'num').map(f => f[0]);
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite'];

const AR = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';
const toEn = s => s.replace(/[٠-٩۰-۹]/g, ch => String(AR.indexOf(ch) % 10));

function cleanScan(raw) {
  const out = {};
  for (const c of Object.keys(SCAN_FIELDS)) {
    let v = toEn(String((raw && raw[c]) ?? '')).trim();
    if (NUM_COLS.includes(c)) {
      v = v.replace(/,/g, '');
      if (v === '' || isNaN(Number(v))) v = '';
    } else if (c === 'arrival_date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) v = '';
    }
    out[c] = v;
  }
  return out;
}

let modelCache = { t: 0, list: null };
async function geminiModels(key) {
  if (modelCache.list && Date.now() - modelCache.t < 3600e3) return modelCache.list;
  const found = [];
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    for (const m of j.models || []) {
      const n = (m.name || '').replace('models/', '');
      if (n.startsWith('gemini-') && n.includes('flash') && (m.supportedGenerationMethods || []).includes('generateContent')
        && !/image|tts|live|audio|embed|robotics|computer|thinking|exp|preview-\d/.test(n)) found.push(n);
    }
  } catch (e) { /* نكمل بالقائمة الاحتياطية */ }
  const rank = n => { const v = n.match(/gemini-(\d+(?:\.\d+)?)/); return [-(v ? parseFloat(v[1]) : 0), n.includes('lite') ? 1 : 0]; };
  found.sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || a.localeCompare(b); });
  const list = [process.env.CUSTOMS_GEMINI_MODEL, ...found.slice(0, 3)].filter(Boolean);
  for (const m of FALLBACK_MODELS) if (!list.includes(m)) list.push(m);
  if (found.length) modelCache = { t: Date.now(), list };
  return list;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function scanGemini(key, buffer, mediaType) {
  const prompt =
    'هذه صورة مستند شحنة/جمارك (قد يكون بخط اليد أو مطبوعًا، عربي أو إنجليزي). استخرج منه البيانات التالية وأرجع JSON فقط بدون أي شرح.\n' +
    'المفاتيح (المفتاح: معناه):\n' + Object.entries(SCAN_FIELDS).map(([k, v]) => `- ${k}: ${v}`).join('\n') + '\n' +
    `الحقول الرقمية (${NUM_COLS.join(', ')}) أرجعها أرقامًا فقط بدون وحدات أو فواصل. اكتب الأرقام بالإنجليزية (0-9). لو الحقل غير موجود أو غير واضح اتركه نصًا فارغًا "" ولا تخمّن.`;
  const build = model => {
    const cfg = { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 2048 };
    if (model.startsWith('gemini-2.5')) cfg.thinkingConfig = { thinkingBudget: 0 };
    return JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mediaType, data: buffer.toString('base64') } }, { text: prompt }] }],
      generationConfig: cfg,
    });
  };
  const models = await geminiModels(key);
  const plan = [models[0], ...models];
  let lastErr = 'تعذر الاتصال بـ Gemini';
  let resp = null;
  const dead = new Set();
  for (let i = 0; i < plan.length; i++) {
    const model = plan[i];
    if (dead.has(model)) continue;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: build(model), signal: AbortSignal.timeout(40000),
      });
      if (r.ok) { resp = await r.json(); break; }
      let msg = r.statusText;
      try { msg = (await r.json()).error.message; } catch (e) { /* ignore */ }
      lastErr = `خطأ من Gemini (${r.status}): ${msg}`;
      if ([400, 404].includes(r.status) && i < plan.length - 1) { dead.add(model); continue; }
      if ([429, 500, 502, 503, 504].includes(r.status)) { await sleep(1500); continue; }
      throw new Error(lastErr);
    } catch (e) {
      if (e.message === lastErr) throw e;
      lastErr = `تعذر الاتصال بـ Gemini: ${e.message}`;
      await sleep(1000);
    }
  }
  if (!resp) throw new Error(lastErr);
  let text;
  try { text = resp.candidates[0].content.parts.map(p => p.text || '').join(''); }
  catch (e) { throw new Error('Gemini لم يرجّع نتيجة (ممكن المستند اتحجب أو غير واضح).'); }
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  try { return cleanScan(JSON.parse(text.slice(s, e + 1))); }
  catch (err) { throw new Error('رد Gemini غير مفهوم، حاول بصورة أوضح.'); }
}

module.exports = { scanGemini, SCAN_EXT, SCAN_FIELDS };
