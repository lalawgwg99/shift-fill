// GET /api/mine?name=XX&month=YYYY-MM&pin=1234 -> { name, month, leave: [...] }
import { ensureSchema, getConfig } from './config.js';
import { checkPin } from './pin.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const name = url.searchParams.get('name') || '';
  const month = url.searchParams.get('month') || '';
  if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'bad args' }, { status: 400 });
  if (!env.DB) return Response.json({ error: 'db_not_bound' }, { status: 500 });
  await ensureSchema(env);
  const cfg = await getConfig(env);
  if (!cfg.staff.includes(name)) return Response.json({ error: 'bad args' }, { status: 400 });
  const chk = await checkPin(env, name, url.searchParams.get('pin'));
  if (chk !== 'ok') return Response.json({ error: chk }, { status: 403 });
  const row = await env.DB.prepare(
    'SELECT leave_dates FROM submissions WHERE name = ? AND month = ?'
  ).bind(name, month).first();
  let leave = [];
  if (row) { try { leave = JSON.parse(row.leave_dates); } catch {} }
  return Response.json({ name, month, leave });
}
