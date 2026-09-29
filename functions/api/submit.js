import { ensureSchema, getConfig } from './config.js';

// 該日期所在週（週一起算）的 key：同屬一週的日期 key 相同
function weekKey(ds) {
  const p = ds.split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

// POST /api/submit { name, month, leave: ["YYYY-MM-DD", ...] }
// 強制執行三條規則：開放起始日、每天上限人數（豁免人員不計）、每人每週最多天數。
// 回傳 { ok, accepted, rejected, rejectedWeekly, rejectedClosed, maxLeave, weeklyCap }。
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const { name, month } = body;
  if (!env.DB) return Response.json({ error: 'db_not_bound' }, { status: 500 });
  await ensureSchema(env);
  const cfg = await getConfig(env);
  if (!cfg.staff.includes(name)) return Response.json({ error: 'bad name' }, { status: 400 });
  if (!/^\d{4}-\d{2}$/.test(month || '')) return Response.json({ error: 'bad month' }, { status: 400 });
  const cap = cfg.maxLeave;
  const raw = Array.isArray(body.leave) ? body.leave : [];
  const picked = raw.filter(isValidDate);
  const all = [...new Set(picked)].sort();
  // 未開放的日期（開放起始日之前，多半是已經排完的）：直接退回，不計入任何規則
  const openFrom = cfg.openFrom || '';
  const rejectedClosed = openFrom ? all.filter(d => d < openFrom) : [];
  const dates = openFrom ? all.filter(d => d >= openFrom) : all;

  function isValidDate(d) {
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d.startsWith(month);
  }

  const rows = await env.DB.prepare(
    'SELECT name, leave_dates FROM submissions WHERE month = ?'
  ).bind(month).all();
  const counts = {};
  for (const r of rows.results || []) {
    if (r.name === name) continue;
    if (cfg.exempt.includes(r.name)) continue;
    let ds = [];
    try { ds = JSON.parse(r.leave_dates); } catch {}
    for (const d of ds) counts[d] = (counts[d] || 0) + 1;
  }
  const exemptSelf = cfg.exempt.includes(name);
  const passedDaily = exemptSelf ? dates : dates.filter(d => (counts[d] || 0) < cap);
  const rejected = exemptSelf ? [] : dates.filter(d => (counts[d] || 0) >= cap);

  // 每人每週最多 weeklyCap 天：同一週超過的部分退回（留日期較早的）
  const weeklyCount = {};
  const accepted = [], rejectedWeekly = [];
  for (const d of passedDaily) {
    const w = weekKey(d);
    weeklyCount[w] = weeklyCount[w] || 0;
    if (weeklyCount[w] < cfg.weeklyCap) { weeklyCount[w]++; accepted.push(d); }
    else rejectedWeekly.push(d);
  }

  await env.DB.prepare(
    `INSERT INTO submissions (name, month, leave_dates, prefs, updated_at)
     VALUES (?, ?, ?, '{}', datetime('now'))
     ON CONFLICT(name, month) DO UPDATE SET leave_dates = excluded.leave_dates, updated_at = datetime('now')`
  ).bind(name, month, JSON.stringify(accepted)).run();

  return Response.json({ ok: true, accepted, rejected, rejectedWeekly, rejectedClosed, maxLeave: cap, weeklyCap: cfg.weeklyCap });
}
