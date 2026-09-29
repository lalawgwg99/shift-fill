const STAFF_OK = ['榮德','耀南','淑玲','泰霖','蓬逸','建發','敏誠','瑜芳','宜萱','俊霖'];
// 榮德、俊霖不佔每日休假限額：不計入每日人數，本人送出也不受限額擋下
const EXEMPT = ['榮德', '俊霖'];

function maxLeave(env) {
  return parseInt(env.MAX_LEAVE || '4', 10);
}

// 資料表自動建置：第一次被呼叫時若表不存在就自己建好，
// 就算 Cloudflare 那邊沒手動跑過 migration 也能正常運作。
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
  `CREATE INDEX IF NOT EXISTS idx_submissions_month ON submissions(month)`
];
async function ensureSchema(env) {
  for (const sql of SCHEMA) await env.DB.prepare(sql).run();
}

// POST /api/submit { name, month, leave: ["YYYY-MM-DD", ...] }
// Enforces the daily leave cap (excluding the submitter's own previous picks
// and exempt staff). Returns { ok, accepted, rejected, maxLeave }.
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const { name, month } = body;
  if (!STAFF_OK.includes(name)) return Response.json({ error: 'bad name' }, { status: 400 });
  if (!/^\d{4}-\d{2}$/.test(month || '')) return Response.json({ error: 'bad month' }, { status: 400 });
  if (!env.DB) return Response.json({ error: 'db_not_bound' }, { status: 500 });
  await ensureSchema(env);
  const cap = maxLeave(env);
  const raw = Array.isArray(body.leave) ? body.leave : [];
  const picked = raw.filter(isValidDate);
  const dates = [...new Set(picked)].sort();

  function isValidDate(d) {
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d.startsWith(month);
  }

  const rows = await env.DB.prepare(
    'SELECT name, leave_dates FROM submissions WHERE month = ?'
  ).bind(month).all();
  const counts = {};
  for (const r of rows.results || []) {
    if (r.name === name) continue;
    if (EXEMPT.includes(r.name)) continue;
    let ds = [];
    try { ds = JSON.parse(r.leave_dates); } catch {}
    for (const d of ds) counts[d] = (counts[d] || 0) + 1;
  }
  const exemptSelf = EXEMPT.includes(name);
  const accepted = exemptSelf ? dates : dates.filter(d => (counts[d] || 0) < cap);
  const rejected = exemptSelf ? [] : dates.filter(d => (counts[d] || 0) >= cap);

  await env.DB.prepare(
    `INSERT INTO submissions (name, month, leave_dates, prefs, updated_at)
     VALUES (?, ?, ?, '{}', datetime('now'))
     ON CONFLICT(name, month) DO UPDATE SET leave_dates = excluded.leave_dates, updated_at = datetime('now')`
  ).bind(name, month, JSON.stringify(accepted)).run();

  return Response.json({ ok: true, accepted, rejected, maxLeave: cap });
}
