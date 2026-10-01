'use strict';

function isPrivilegedKey(key) {
  if (/^sb_secret_/i.test(key)) return true;
  try {
    const payload = key.split('.')[1];
    if (!payload) return false;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
    return claims.role === 'service_role';
  } catch (_) {
    return false;
  }
}

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('');
  }

  const rawUrl = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
  let supabaseUrl;
  try { supabaseUrl = new URL(rawUrl); } catch (_) {}
  const validUrl = supabaseUrl && supabaseUrl.protocol === 'https:' && supabaseUrl.hostname;

  if (!validUrl || !anonKey || isPrivilegedKey(anonKey)) {
    return res.status(503).send('console.error("App configuration is unavailable.");');
  }

  const config = JSON.stringify({
    SUPABASE_URL: supabaseUrl.href.replace(/\/$/, ''),
    SUPABASE_ANON_KEY: anonKey
  }).replace(/</g, '\\u003c');

  return res.status(200).send(`window.__ENV__ = ${config};`);
};
