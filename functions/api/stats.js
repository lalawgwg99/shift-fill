const STAFF = ['榮德','耀南','淑玲','泰霖','蓬逸','建發','敏誠','瑜芳','宜萱','俊霖'];

function maxLeave(env) {
  return parseInt(env.MAX_LEAVE || '4', 10);
}

// GET /api/stats?month=YYYY-MM -> { month, maxLeave, days: { "YYYY-MM-DD": { count, names } } }
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const month = url.searchParams.get('month') || '';
  if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'bad month' }, { status: 400 });
  const rows = await env.DB.prepare(
    'SELECT name, leave_dates FROM submissions WHERE month = ?'
  ).bind(month).all();
  const days = {};
  for (const r of rows.results || []) {
    let dates = [];
    try { dates = JSON.parse(r.leave_dates); } catch {}
    for (const d of dates) {
      if (!days[d]) days[d] = { count: 0, names: [] };
      days[d].count++;
      days[d].names.push(r.name);
    }
  }
  return Response.json({ month, maxLeave: maxLeave(env), days });
}
