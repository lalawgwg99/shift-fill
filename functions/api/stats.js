import { ensureSchema, getConfig } from './config.js';
import { readCaps } from './caps.js';

// GET /api/stats?month=YYYY-MM -> { month, maxLeave, caps, days: { "YYYY-MM-DD": { count, names } } }
// count = 佔限額人數（不含豁免人員）；names = 當天所有休假的人
// caps = 單日自訂上限 {"YYYY-MM-DD": n}，無設定則用 maxLeave
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const month = url.searchParams.get('month') || '';
  if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'bad month' }, { status: 400 });
  if (!env.DB) return Response.json({ error: 'db_not_bound' }, { status: 500 });
  await ensureSchema(env);
  const cfg = await getConfig(env);
  const rows = await env.DB.prepare(
    'SELECT name, leave_dates FROM submissions WHERE month = ?'
  ).bind(month).all();
  const days = {};
  for (const r of rows.results || []) {
    let dates = [];
    try { dates = JSON.parse(r.leave_dates); } catch {}
    for (const d of dates) {
      if (!days[d]) days[d] = { count: 0, names: [] };
      if (!cfg.exempt.includes(r.name)) days[d].count++;
      days[d].names.push(r.name);
    }
  }
  return Response.json({ month, maxLeave: cfg.maxLeave, caps: await readCaps(env, month), days });
}
