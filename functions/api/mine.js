// GET /api/mine?name=XX&month=YYYY-MM -> { name, month, leave: [...] }
const STAFF_OK = ['榮德','耀南','淑玲','泰霖','蓬逸','建發','敏誠','瑜芳','宜萱','俊霖'];

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const name = url.searchParams.get('name') || '';
  const month = url.searchParams.get('month') || '';
  if (!STAFF_OK.includes(name) || !/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'bad args' }, { status: 400 });
  const row = await env.DB.prepare(
    'SELECT leave_dates FROM submissions WHERE name = ? AND month = ?'
  ).bind(name, month).first();
  let leave = [];
  if (row) { try { leave = JSON.parse(row.leave_dates); } catch {} }
  return Response.json({ name, month, leave });
}
