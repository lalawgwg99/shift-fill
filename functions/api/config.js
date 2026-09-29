// 排班設定 API：GET 讀取公開設定；POST 修改設定（需管理密碼）。
// 同時匯出共用 helper 給其他 API 使用：ensureSchema、getConfig。
//
// 可調設定（存在 D1 config 表，管理頁可改，不用改程式）：
//   maxLeave  每天最多休假人數（預設 4）
//   weeklyCap 每人每週最多休假天數（預設 2，先排兩天）
//   openFrom  開放選擇起始日 YYYY-MM-DD（此日期之前的日期變透明、不能選；空白=不限制）
//   staff     員工名單（陣列）
//   exempt    不佔每日名額的人員（陣列，須為 staff 子集）
//   adminToken 管理密碼（永不經由 GET 回傳）

const DEFAULT_STAFF = ['榮德','耀南','淑玲','泰霖','蓬逸','建發','敏誠','瑜芳','宜萱','俊霖'];
const DEFAULT_EXEMPT = ['榮德','俊霖'];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    month TEXT NOT NULL,
    leave_dates TEXT NOT NULL DEFAULT '[]',
    prefs TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name, month)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_submissions_month ON submissions(month)`,
  `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pins (name TEXT PRIMARY KEY, pin_hash TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS pin_fails (name TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, last_fail TEXT NOT NULL DEFAULT (datetime('now')))`
];

// 資料表自動建置：第一次被呼叫時若表不存在就自己建好，
// 就算 Cloudflare 那邊沒手動跑過 migration 也能正常運作。
export async function ensureSchema(env) {
  for (const sql of SCHEMA) await env.DB.prepare(sql).run();
}

function parseNameList(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split('\n');
  const out = [];
  for (let n of arr) {
    n = String(n).trim();
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= 50) break;
  }
  return out;
}

// 從 config 表讀出的值可能是 JSON 字串（寫入時 JSON.stringify），先還原再解析
function parseStoredNameList(v) {
  if (typeof v === 'string') {
    try { const a = JSON.parse(v); if (Array.isArray(a)) return parseNameList(a); } catch {}
  }
  return parseNameList(v);
}

function parseCap(v, def, min, max) {
  const n = parseInt(v, 10);
  return (n >= min && n <= max) ? n : def;
}

// 讀取目前設定；config 表沒值就用預設（環境變數可覆寫預設）
export async function getConfig(env) {
  const cfg = {
    maxLeave: parseCap(env.MAX_LEAVE, 4, 1, 20),
    weeklyCap: parseCap(env.WEEKLY_CAP, 2, 1, 7),
    openFrom: '',
    openTo: '',
    staff: [...DEFAULT_STAFF],
    exempt: [...DEFAULT_EXEMPT]
  };
  try {
    const rows = await env.DB.prepare('SELECT key, value FROM config').all();
    for (const r of (rows.results || [])) {
      if (r.key === 'maxLeave') cfg.maxLeave = parseCap(r.value, cfg.maxLeave, 1, 20);
      else if (r.key === 'weeklyCap') cfg.weeklyCap = parseCap(r.value, cfg.weeklyCap, 1, 7);
      else if (r.key === 'openFrom') cfg.openFrom = String(r.value || '');
      else if (r.key === 'openTo') cfg.openTo = String(r.value || '');
      else if (r.key === 'staff') { const a = parseStoredNameList(r.value); if (a.length) cfg.staff = a; }
      else if (r.key === 'exempt') cfg.exempt = parseStoredNameList(r.value).filter(n => cfg.staff.includes(n));
    }
  } catch {}
  return cfg;
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('shift-fill-admin:' + s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function getAdminToken(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM config WHERE key = 'adminToken'").first();
    return row ? row.value : null;
  } catch { return null; }
}

export async function verifyAdmin(env, token) {
  const cur = await getAdminToken(env);
  if (!cur) return false;
  return (await sha256hex(String(token || ''))) === cur;
}

async function setConfigValue(env, key, value) {
  await env.DB.prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(key, value).run();
}

function publicConfig(cfg, hasAdminToken) {
  return { maxLeave: cfg.maxLeave, weeklyCap: cfg.weeklyCap, openFrom: cfg.openFrom, openTo: cfg.openTo, staff: cfg.staff, exempt: cfg.exempt, hasAdminToken };
}

// GET /api/config -> { maxLeave, weeklyCap, staff, exempt, hasAdminToken }
export async function onRequestGet({ env }) {
  if (!env.DB) return Response.json({ error: 'db_not_bound' }, { status: 500 });
  await ensureSchema(env);
  const cfg = await getConfig(env);
  const token = await getAdminToken(env);
  return Response.json(publicConfig(cfg, !!token));
}

// POST /api/config { token?, newToken?, maxLeave?, weeklyCap?, openFrom?, staff?, exempt? }
// 第一次使用（還沒設密碼）：帶 newToken（至少 4 碼）即完成初次設定，可同時帶其他設定。
// 之後：需帶正確 token；帶 newToken 可順便換密碼。
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  if (!env.DB) return Response.json({ error: 'db_not_bound' }, { status: 500 });
  await ensureSchema(env);
  const cur = await getAdminToken(env);
  if (!cur) {
    const nt = String(body.newToken || '');
    if (nt.length < 4) return Response.json({ error: 'setup_required' }, { status: 403 });
    await setConfigValue(env, 'adminToken', await sha256hex(nt));
  } else {
    if (await sha256hex(String(body.token || '')) !== cur) return Response.json({ error: 'forbidden' }, { status: 403 });
    if (body.newToken !== undefined) {
      const nt = String(body.newToken || '');
      if (nt.length < 4) return Response.json({ error: 'weak_token' }, { status: 400 });
      await setConfigValue(env, 'adminToken', await sha256hex(nt));
    }
  }
  if (body.maxLeave !== undefined) {
    const n = parseInt(body.maxLeave, 10);
    if (!(n >= 1 && n <= 20)) return Response.json({ error: 'bad maxLeave' }, { status: 400 });
    await setConfigValue(env, 'maxLeave', String(n));
  }
  if (body.weeklyCap !== undefined) {
    const n = parseInt(body.weeklyCap, 10);
    if (!(n >= 1 && n <= 7)) return Response.json({ error: 'bad weeklyCap' }, { status: 400 });
    await setConfigValue(env, 'weeklyCap', String(n));
  }
  const curCfg = await getConfig(env);
  if (body.openFrom !== undefined) {
    const v = String(body.openFrom || '').trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return Response.json({ error: 'bad openFrom' }, { status: 400 });
    const t = body.openTo !== undefined ? String(body.openTo || '').trim() : curCfg.openTo;
    if (v && t && t < v) return Response.json({ error: 'bad range' }, { status: 400 });
    await setConfigValue(env, 'openFrom', v);
  }
  if (body.openTo !== undefined) {
    const v = String(body.openTo || '').trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return Response.json({ error: 'bad openTo' }, { status: 400 });
    const f = body.openFrom !== undefined ? String(body.openFrom || '').trim() : curCfg.openFrom;
    if (v && f && v < f) return Response.json({ error: 'bad range' }, { status: 400 });
    await setConfigValue(env, 'openTo', v);
  }
  let staff = null;
  if (body.staff !== undefined) {
    staff = parseNameList(body.staff);
    if (!staff.length) return Response.json({ error: 'bad staff' }, { status: 400 });
    await setConfigValue(env, 'staff', JSON.stringify(staff));
  }
  if (body.exempt !== undefined) {
    const base = staff || (await getConfig(env)).staff;
    const ex = parseNameList(body.exempt).filter(n => base.includes(n));
    await setConfigValue(env, 'exempt', JSON.stringify(ex));
  }
  if (body.resetPin !== undefined) {
    const base = staff || (await getConfig(env)).staff;
    const n = String(body.resetPin || '').trim();
    if (!base.includes(n)) return Response.json({ error: 'bad name' }, { status: 400 });
    await env.DB.prepare('DELETE FROM pins WHERE name = ?').bind(n).run();
    await env.DB.prepare('DELETE FROM pin_fails WHERE name = ?').bind(n).run();
  }
  const cfg = await getConfig(env);
  const pinRows = await env.DB.prepare('SELECT name FROM pins').all();
  const pinSet = (pinRows.results || []).map(r => r.name);
  return Response.json({ ok: true, ...publicConfig(cfg, true), pinSet });
}
