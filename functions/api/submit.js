const STAFF_OK = ['榮德','耀南','淑玲','泰霖','蓬逸','建發','敏誠','瑜芳','宜萱','俊霖'];

function maxLeave(env) {
  return parseInt(env.MAX_LEAVE || '4', 10);
}

// POST /api/submit { name, month, leave: ["YYYY-MM-DD", ...] }
// Enforces the daily leave cap (excluding the submitter's own previous picks).
// Returns { ok, accepted, rejected, maxLeave }.
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const { name, month } = body;
  if (!STAFF_OK.includes(name)) return Response.json({ error: 'bad name' }, { status: 400 });
  if (!/^\d{4}-\d{2}$/.test(month || '')) return Response.json({ error: 'bad month' }, { status: 400 });
  const cap = maxLeave(env);
  const dates = [...new Set((body.leave || []).filter(
    d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d.startsWith(month)
  ))].sort();

  const rows = await env.DB.prepare(
    'SELECT name, leave_dates FROM submissions WHERE month = ?'
  ).bind(month).all();
  const counts = {};
  for (const r of rows.results || []) {
    if (r.name === name) continue;
    let ds = [];
    try { ds = JSON.parse(r.leave_dates); } catch {}
    for (const d of ds) counts[d] = (counts[d] || 0) + 1;
  }
  const accepted = dates.filter(d => (counts[d] || 0) < cap);
  const rejected = dates.filter(d => (counts[d] || 0) >= cap);

  await env.DB.prepare(
    `INSERT INTO submissions (name, month, leave_dates, prefs, updated_at)
     VALUES (?, ?, ?, '{}', datetime('now'))
     ON CONFLICT(name, month) DO UPDATE SET leave_dates = excluded.leave_dates, updated_at = datetime('now')`
  ).bind(name, month, JSON.stringify(accepted)).run();

  return Response.json({ ok: true, accepted, rejected, maxLeave: cap });
}
