const STAFF = ['榮德','耀南','淑玲','泰霖','蓬逸','建發','敏誠','瑜芳','宜萱','俊霖'];
// 榮德、俊霖不佔每日休假限額：count 只算佔限額的人數，names 照樣列出所有人
const EXEMPT = ['榮德', '俊霖'];

function maxLeave(env) {
  return parseInt(env.MAX_LEAVE || '4', 10);
}

// GET /api/stats?month=YYYY-MM -> { month, maxLeave, days: { "YYYY-MM-DD": { count, names } } }
// count = 佔限額人數（不含榮德、俊霖）；names = 當天所有休假的人
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
      if (!EXEMPT.includes(r.name)) days[d].count++;
      days[d].names.push(r.name);
    }
  }
  return Response.json({ month, maxLeave: maxLeave(env), days });
}
