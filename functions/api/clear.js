// 一鍵清空排假：POST {token, month} -> 刪除該月全部排假（管理員限定，不動個人密碼）。
import { ensureSchema, verifyAdmin } from './config.js';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return Response.json({ error: 'db_not_bound' }, { status: 500 });
  await ensureSchema(env);
  let body = {};
  try { body = await request.json(); } catch {}
  const month = String(body.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'bad month' }, { status: 400 });
  if (!(await verifyAdmin(env, body.token))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const r = await env.DB.prepare('DELETE FROM submissions WHERE month = ?').bind(month).run();
  const deleted = (r && r.meta && typeof r.meta.changes === 'number') ? r.meta.changes : 0;
  return Response.json({ ok: true, month, deleted });
}
