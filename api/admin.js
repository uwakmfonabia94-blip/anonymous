export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON) return json({ error: 'supabase_not_configured' }, 500);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }

  const { action } = body || {};

  if (action === 'login') {
    const { password } = body;
    if (!password) return json({ error: 'missing_password' }, 400);
    const token = await rpc('admin_login', { p_password: password });
    if (!token) return json({ error: 'wrong_password' }, 401);
    return json({ token }, 200);
  }

  if (action === 'change_password') {
    const { token, newPassword } = body;
    if (!token || !newPassword) return json({ error: 'missing_fields' }, 400);
    const ok = await rpc('admin_change_password', { p_token: token, p_new_password: newPassword });
    return json({ ok: !!ok }, ok ? 200 : 500);
  }

  if (action === 'dashboard') {
    const { token } = body;
    if (!token) return json({ error: 'missing_token' }, 400);
    const data = await rpc('admin_dashboard_secure', { p_token: token });
    if (!data) return json({ error: 'rpc_failed' }, 500);
    return json(data, 200);
  }

  if (action === 'delete_post') {
    const { token, postId } = body;
    if (!token || !postId) return json({ error: 'missing_fields' }, 400);
    const ok = await rpc('admin_delete_post', { p_token: token, p_post_id: postId });
    return json({ ok: !!ok }, ok ? 200 : 500);
  }

  if (action === 'resolve_report') {
    const { token, reportId } = body;
    if (!token || !reportId) return json({ error: 'missing_fields' }, 400);
    const ok = await rpc('admin_resolve_report', { p_token: token, p_report_id: reportId });
    return json({ ok: !!ok }, ok ? 200 : 500);
  }

  return json({ error: 'unknown_action' }, 400);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });
}

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`rpc ${fn} failed:`, res.status, text);
    return null;
  }
  return text ? JSON.parse(text) : null;
}