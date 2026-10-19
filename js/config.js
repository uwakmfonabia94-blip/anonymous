export const SUPABASE_URL      = 'https://vdjdulwyqgqhtrglvsjy.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkamR1bHd5cWdxaHRyZ2x2c2p5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzOTQ5NzUsImV4cCI6MjEwNzk3MDk3NX0.igyD6Zf2c4Ac_avhtPqNdWt6glrEfZB7xQiBBluYHAI';

export const PRIMARY_DOMAIN = null;

export function detectUniversity() {
  const host = location.hostname;
  const qs = new URLSearchParams(location.search);
  if (qs.has('uni')) return qs.get('uni');
  if (!PRIMARY_DOMAIN) return 'default';
  if (host === 'localhost' || host.startsWith('127.')) return 'default';
  if (host.endsWith('.vercel.app')) return 'default';
  if (host === PRIMARY_DOMAIN) return 'default';
  if (host.endsWith('.' + PRIMARY_DOMAIN)) return host.slice(0, -1 * ('.' + PRIMARY_DOMAIN).length);
  return 'default';
}