// GET /api/export?month=YYYY-MM[&token=...] -> all submissions for the month.
// Used by the manager's scheduling app to pull everyone's picks.
// If the SYNC_TOKEN env var is set, the matching ?token= is required.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (env.SYNC_TOKEN && url.searchParams.get('token') !== env.SYNC_TOKEN) {
    return new Response('forbidden', { status: 403 });
  }
  const month = url.searchParams.get('month') || '';
  if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'bad month' }, { status: 400 });
  const rows = await env.DB.prepare(
    'SELECT name, leave_dates, prefs, updated_at FROM submissions WHERE month = ? ORDER BY name'
  ).bind(month).all();
  const submissions = (rows.results || []).map(r => {
    let leave = [], prefs = {};
    try { leave = JSON.parse(r.leave_dates); } catch {}
    try { prefs = JSON.parse(r.prefs); } catch {}
    return { name: r.name, leave, prefs, updated_at: r.updated_at };
  });
  return Response.json({ month, submissions });
}
