import { ensureSchema, verifyAdmin } from './config.js';

// 單日自訂休假人數上限（例如某幾天只准 2~3 人休假）。
// GET  /api/caps?month=YYYY-MM              -> { month, caps: { "YYYY-MM-DD": n } }（公開）
// POST /api/caps { token, caps: {"YYYY-MM-DD": n|null} } -> 設定／清除（需管理密碼）
//   n 為 1~20 的整數；null 表示清除該日設定、恢復預設上限。

export async function readCaps(env, month) {
  const caps = {};
  try {
    const rows = await env.DB.prepare(
      'SELECT day, cap FROM day_caps WHERE day LIKE ?'
    ).bind(month + '%').all();
    for (const r of rows.results || []) {
      const n = parseInt(r.cap, 10);
      if (n >= 1 && n <= 20) caps[r.day] = n;
    }
  } catch {}
  return caps;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const month = url.searchParams.get('month') || '';
  if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'bad month' }, { status: 400 });
  if (!env.DB) return Response.json({ error: 'db_not_bound' }, { status: 500 });
  await ensureSchema(env);
  return Response.json({ month, caps: await readCaps(env, month) });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  if (!env.DB) return Response.json({ error: 'db_not_bound' }, { status: 500 });
  await ensureSchema(env);
  if (!await verifyAdmin(env, body.token)) return Response.json({ error: 'forbidden' }, { status: 403 });
  const caps = body.caps;
  if (!caps || typeof caps !== 'object' || Array.isArray(caps)) {
    return Response.json({ error: 'bad caps' }, { status: 400 });
  }
  const days = Object.keys(caps);
  if (days.length > 62) return Response.json({ error: 'too many' }, { status: 400 });
  for (const d of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return Response.json({ error: 'bad day' }, { status: 400 });
    const v = caps[d];
    if (v === null || v === undefined || v === '') {
      await env.DB.prepare('DELETE FROM day_caps WHERE day = ?').bind(d).run();
    } else {
      const n = parseInt(v, 10);
      if (!(n >= 1 && n <= 20)) return Response.json({ error: 'bad cap' }, { status: 400 });
      await env.DB.prepare(
        'INSERT INTO day_caps (day, cap) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET cap = excluded.cap'
      ).bind(d, n).run();
    }
  }
  return Response.json({ ok: true });
}
