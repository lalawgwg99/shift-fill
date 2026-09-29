// 個人 4 位數密碼：每個人第一次進來設定，之後讀取/送出自己的休假需驗證，
// 防止有人冒用別人的名字亂排。密碼以 SHA-256 雜湊存放在 pins 表，不存明文。
import { ensureSchema, getConfig } from './config.js';

export async function pinHash(name, pin) {
  const data = new TextEncoder().encode('shift-fill-pin:' + name + ':' + pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPin(env, name, pin) {
  return (await checkPin(env, name, pin)) === 'ok';
}

// 驗證個人密碼，回傳 'ok' | 'pin_required'（還沒設）| 'bad_pin' | 'locked'（10 分鐘內錯 5 次）
// 成功會清除失敗計數；失敗會累計，滿 5 次鎖 10 分鐘（防 4 位數暴力破解）
const MAX_FAILS = 5;
export async function checkPin(env, name, pin) {
  const row = await env.DB.prepare('SELECT pin_hash FROM pins WHERE name = ?').bind(name).first();
  if (!row) return 'pin_required';
  const f = await env.DB.prepare(
    "SELECT fails FROM pin_fails WHERE name = ? AND last_fail > datetime('now', '-10 minutes')"
  ).bind(name).first();
  if (f && f.fails >= MAX_FAILS) return 'locked';
  if (row.pin_hash === await pinHash(name, String(pin || ''))) {
    await env.DB.prepare('DELETE FROM pin_fails WHERE name = ?').bind(name).run();
    return 'ok';
  }
  await env.DB.prepare(
    `INSERT INTO pin_fails (name, fails, last_fail) VALUES (?, 1, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET fails = fails + 1, last_fail = datetime('now')`
  ).bind(name).run();
  const f2 = await env.DB.prepare('SELECT fails FROM pin_fails WHERE name = ?').bind(name).first();
  return (f2 && f2.fails >= MAX_FAILS) ? 'locked' : 'bad_pin';
}

// GET /api/pin?name=XX -> { name, hasPin }
export async function onRequestGet({ request, env }) {
  const name = new URL(request.url).searchParams.get('name') || '';
  if (!env.DB) return Response.json({ error: 'db_not_bound' }, { status: 500 });
  await ensureSchema(env);
  const cfg = await getConfig(env);
  if (!cfg.staff.includes(name)) return Response.json({ error: 'bad name' }, { status: 400 });
  const row = await env.DB.prepare('SELECT pin_hash FROM pins WHERE name = ?').bind(name).first();
  return Response.json({ name, hasPin: !!row });
}

// POST /api/pin { name, pin?, newPin? }
// 還沒設密碼：帶 newPin（或 pin）完成初次設定，須為 4 位數字。
// 已設密碼：帶 pin 驗證，錯了回 403。
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const name = String(body.name || '');
  if (!env.DB) return Response.json({ error: 'db_not_bound' }, { status: 500 });
  await ensureSchema(env);
  const cfg = await getConfig(env);
  if (!cfg.staff.includes(name)) return Response.json({ error: 'bad name' }, { status: 400 });
  const existing = await env.DB.prepare('SELECT pin_hash FROM pins WHERE name = ?').bind(name).first();
  if (!existing) {
    const np = String(body.newPin || body.pin || '');
    if (!/^\d{4}$/.test(np)) return Response.json({ error: 'bad pin' }, { status: 400 });
    await env.DB.prepare('INSERT INTO pins (name, pin_hash) VALUES (?, ?)').bind(name, await pinHash(name, np)).run();
    return Response.json({ ok: true, created: true });
  }
  const chk = await checkPin(env, name, body.pin);
  if (chk === 'ok') return Response.json({ ok: true });
  return Response.json({ error: chk }, { status: 403 });
}
