// GET /api/export?month=YYYY-MM[&token=...] -> all submissions for the month.
// Used by the manager's scheduling app to pull everyone's picks.
// If the SYNC_TOKEN env var is set, the matching ?token= is required.
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
  if (env.SYNC_TOKEN && url.searchParams.get('token') !== env.SYNC_TOKEN) {
    return new Response('forbidden', { status: 403 });
  }
  const month = url.searchParams.get('month') || '';
  if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'bad month' }, { status: 400 });
  if (!env.DB) return Response.json({ error: 'db_not_bound' }, { status: 500 });
  await ensureSchema(env);
  const rows = await env.DB.prepare(
    'SELECT name, leave_dates, prefs, updated_at FROM submissions WHERE month = ? ORDER BY name'
  ).bind(month).all();
  const submissions = (rows.results || []).map(r => {
    let leave = [], prefs = {};
    try { leave = JSON.parse(r.leave_dates); } catch {}
    try { prefs = JSON.parse(r.prefs); } catch {}
    return { name: r.name, leave, prefs, updated_at: r.updated_at };
  });
  return Response.json({ month, submissions });
}
