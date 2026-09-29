// GET /api/mine?name=XX&month=YYYY-MM -> { name, month, leave: [...] }
const STAFF_OK = ['榮德','耀南','淑玲','泰霖','蓬逸','建發','敏誠','瑜芳','宜萱','俊霖'];

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

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const name = url.searchParams.get('name') || '';
  const month = url.searchParams.get('month') || '';
  if (!STAFF_OK.includes(name) || !/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'bad args' }, { status: 400 });
  if (!env.DB) return Response.json({ error: 'db_not_bound' }, { status: 500 });
  await ensureSchema(env);
  const row = await env.DB.prepare(
    'SELECT leave_dates FROM submissions WHERE name = ? AND month = ?'
  ).bind(name, month).first();
  let leave = [];
  if (row) { try { leave = JSON.parse(row.leave_dates); } catch {} }
  return Response.json({ name, month, leave });
}
