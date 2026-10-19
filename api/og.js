export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

export default async function handler(req) {
  const id = new URL(req.url).pathname.split('/').pop();
  let title = 'Say it. Nobody knows.';
  let desc  = 'Your campus. No names.';

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/posts?id=eq.${id}&select=content,shareable`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
    );
    const [p] = await r.json();
    if (p?.content && p.shareable) {
      title = p.content.slice(0, 80);
      desc  = 'Anonymous · Reply without a name';
    }
  } catch {}

  return new Response(`<!doctype html><html><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="https://anonymous.app/og-default.png">
<meta property="og:url" content="https://anonymous.app/p/${esc(id)}">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary">
<meta name="robots" content="noindex">
<style>html,body{margin:0;background:#0E0E14}</style>
<script>location.replace('/p/${esc(id)}')</script>
</head><body></body></html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}